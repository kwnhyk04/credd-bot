'use strict';

/**
 * level-reward-compensation — retroactive Combat/Believer level rewards
 * (Genesis update, spec section 4).
 *
 * Usage (exactly one flag is required):
 *   npm run compensate:levels:dry     → node scripts/level-reward-compensation.js --dry-run
 *   npm run compensate:levels         → node scripts/level-reward-compensation.js --execute
 *
 * Dry run: read-only (no BEGIN is ever issued) — reports exactly what the
 * production run would grant, changes nothing.
 *
 * Execute: per-user transaction (bag lock → grant → COMMIT). Reuses the SAME
 * grant functions as live level-ups (utils/grantLevelRewards), so exactly-once
 * semantics come from the (discord_id, level) primary keys: reruns, crashes
 * mid-way, and users already partially rewarded are all safe — only missing
 * levels are credited. One user's failure rolls back that user only; the run
 * continues.
 *
 * Recovery:
 *   - Rerunning either mode is always safe (idempotent).
 *   - To reverse a compensation run, see scripts/migrations/20260720_09_rollback.sql
 *     ("Reversing GRANTED REWARDS" section) — tracking rows carry
 *     source = 'compensation' and every credit wrote game_logs rows.
 *
 * Memory: keyset pagination (BATCH_SIZE rows at a time); only scalar totals
 * are held between batches — never all users.
 */

const pool = require('../src/db/pool');
const {
  MIN_REWARD_LEVEL,
  MAX_REWARD_LEVEL,
  REWARD_CHEST_COLUMNS,
  CHEST_LABELS,
  sumLevelRewards,
} = require('../src/config/levelRewards');
const {
  grantCombatLevelRewards,
  grantBelieverLevelRewards,
} = require('../src/utils/grantLevelRewards');

const BATCH_SIZE = 200;

function parseMode(argv) {
  const dry = argv.includes('--dry-run');
  const exec = argv.includes('--execute');
  if (dry === exec) {
    console.error('Refusing to run: pass exactly one of --dry-run or --execute.');
    process.exit(2);
  }
  return dry ? 'dry-run' : 'execute';
}

function newTotals() {
  const chests = {};
  for (const col of REWARD_CHEST_COLUMNS) chests[col] = 0;
  return { credux: 0, chests };
}

function addGrant(totals, grant) {
  if (!grant) return false;
  totals.credux += grant.credux;
  for (const [col, qty] of Object.entries(grant.chests)) {
    totals.chests[col] = (totals.chests[col] || 0) + qty;
  }
  return grant.levels ? grant.levels.length > 0 : (grant.credux > 0);
}

/** Levels MIN..cap(current) that are not yet in `rows` (already-rewarded set). */
function missingLevels(currentLevel, rewardedRows) {
  const cap = Math.min(Number(currentLevel), MAX_REWARD_LEVEL);
  if (cap < MIN_REWARD_LEVEL) return [];
  const have = new Set(rewardedRows.map((r) => Number(r.level)));
  const missing = [];
  for (let lvl = MIN_REWARD_LEVEL; lvl <= cap; lvl++) {
    if (!have.has(lvl)) missing.push(lvl);
  }
  return missing;
}

/** Dry-run one batch: read-only diff against the tracking tables. */
async function dryRunBatch(users, totals, counters) {
  const ids = users.map((u) => u.discord_id);
  const [combatRows, believerRows] = await Promise.all([
    pool.query('SELECT discord_id, level FROM combat_level_rewards WHERE discord_id = ANY($1)', [ids]),
    pool.query('SELECT discord_id, level FROM believer_level_rewards WHERE discord_id = ANY($1)', [ids]),
  ]);
  const byUser = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.discord_id)) m.set(r.discord_id, []);
      m.get(r.discord_id).push(r);
    }
    return m;
  };
  const combatByUser = byUser(combatRows.rows);
  const believerByUser = byUser(believerRows.rows);

  for (const u of users) {
    counters.checked++;
    const combatMissing = missingLevels(u.combat_level, combatByUser.get(u.discord_id) || []);
    const believerMissing = missingLevels(u.believer_level, believerByUser.get(u.discord_id) || []);
    let granted = false;
    granted = addGrant(totals, combatMissing.length ? { ...sumLevelRewards('combat', combatMissing), levels: combatMissing } : null) || granted;
    granted = addGrant(totals, believerMissing.length ? { ...sumLevelRewards('believer', believerMissing), levels: believerMissing } : null) || granted;
    if (granted) counters.compensated++; else counters.skipped++;
  }
}

/** Execute one batch: per-user transaction, isolated failures. */
async function executeBatch(users, totals, counters, failedIds) {
  for (const u of users) {
    counters.checked++;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock order: users_bag before user_character/tracking (project convention).
      const bag = await client.query(
        'SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE',
        [u.discord_id]
      );
      if (bag.rows.length === 0) {
        // No bag row → nothing creditable; count as skipped, not failed.
        await client.query('ROLLBACK');
        counters.skipped++;
        continue;
      }
      const combat = await grantCombatLevelRewards(client, u.discord_id, 1, u.combat_level, 'compensation');
      const believer = await grantBelieverLevelRewards(client, u.discord_id, 1, u.believer_level, 'compensation');
      await client.query('COMMIT');
      let granted = false;
      granted = addGrant(totals, combat) || granted;
      granted = addGrant(totals, believer) || granted;
      if (granted) counters.compensated++; else counters.skipped++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      counters.failed++;
      failedIds.push(u.discord_id);
      console.error(`[compensation] FAILED ${u.discord_id}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  console.log(`level-reward-compensation — mode: ${mode.toUpperCase()} (levels ${MIN_REWARD_LEVEL}-${MAX_REWARD_LEVEL}, batch ${BATCH_SIZE})`);
  const startedAt = Date.now();

  const totals = newTotals();
  const counters = { checked: 0, compensated: 0, skipped: 0, failed: 0 };
  const failedIds = [];

  let cursor = '';
  for (;;) {
    const { rows: users } = await pool.query(
      `SELECT discord_id, combat_level, believer_level
         FROM user_character
        WHERE discord_id > $1
        ORDER BY discord_id
        LIMIT $2`,
      [cursor, BATCH_SIZE]
    );
    if (users.length === 0) break;
    cursor = users[users.length - 1].discord_id;

    if (mode === 'dry-run') {
      await dryRunBatch(users, totals, counters);
    } else {
      await executeBatch(users, totals, counters, failedIds);
    }
    console.log(`  … ${counters.checked} users checked (compensated ${counters.compensated}, skipped ${counters.skipped}, failed ${counters.failed})`);
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('================ COMPENSATION REPORT ================');
  console.log(`Mode:               ${mode.toUpperCase()}${mode === 'dry-run' ? ' (nothing was changed)' : ''}`);
  console.log(`Users checked:      ${counters.checked}`);
  console.log(`Users compensated:  ${counters.compensated}`);
  console.log(`Users skipped:      ${counters.skipped} (already fully rewarded or no bag)`);
  console.log(`Users failed:       ${counters.failed}`);
  console.log(`Total Credux:       ${totals.credux.toLocaleString('en-US')}`);
  for (const col of REWARD_CHEST_COLUMNS) {
    console.log(`Total ${CHEST_LABELS[col]}${' '.repeat(Math.max(1, 19 - CHEST_LABELS[col].length))}${totals.chests[col].toLocaleString('en-US')}`);
  }
  if (failedIds.length > 0) {
    console.log(`Failed user ids:    ${failedIds.join(', ')}`);
    console.log('Rerun after fixing — already-granted users are skipped automatically.');
  }
  console.log(`Duration:           ${secs}s`);
  console.log('=====================================================');

  await pool.end();
  process.exit(counters.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('[compensation] fatal:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  BATCH_SIZE,
  addGrant,
  dryRunBatch,
  executeBatch,
  main,
  missingLevels,
  newTotals,
  parseMode,
};

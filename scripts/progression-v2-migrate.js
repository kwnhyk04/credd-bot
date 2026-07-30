'use strict';

/**
 * progression-v2-migrate.js — one-time conversion to lifetime_exp.
 *
 *   node scripts/progression-v2-migrate.js              (dry run, default)
 *   node scripts/progression-v2-migrate.js --dry-run    (explicit dry run)
 *   node scripts/progression-v2-migrate.js --execute    (convert)
 *
 * Flag convention matches scripts/level-reward-compensation.js. Requires
 * scripts/migrations/20260730_01_progression_v2.sql to have been applied first.
 *
 * ── What this does, and just as importantly what it does NOT ────────────────
 * For every player:      lifetime_exp = CUMULATIVE_EXP[level - 1] + combat_exp
 * combat_level and combat_exp are written back UNCHANGED. Levels are NOT
 * recomputed from earned EXP — under the v2 curve that would drop everyone 3-5
 * levels. combat_exp is NOT scaled or rebased; the raw number carries across
 * exactly as stored.
 *
 * The visible effect is that progress bars SHRINK: the same EXP is now a smaller
 * fraction of a larger requirement (a level 31 player with 500,000 EXP goes from
 * 34.5% to 23.8%). That is intended and must not be "corrected".
 *
 * ── Why this is safe ────────────────────────────────────────────────────────
 * Every level in the v2 table costs at least what it cost pre-v2 (equality only at
 * levels 1-3), so a player's stored within-level EXP can never exceed the new
 * requirement and nobody lands on an already-complete bar. OLD_EXP_TO_NEXT below
 * is what lets this script verify that claim rather than assume it.
 */

const path = require('path');
const pool = require('../src/db/pool');
const {
  MAX_COMBAT_LEVEL,
  EXP_TO_NEXT,
  lifetimeExpFor,
  levelFromLifetimeExp,
} = require('../src/config/combatExp');

// ── OLD table — migration use only. Do not delete. Do not use at runtime. ────
// The pre-v2 curve, preserved here because reconstructing player history is
// impossible without it and this conversion only ever runs once. It is used for
// drift detection and to assert the "every level got more expensive" invariant.
// Index 0 = EXP from level 1 -> 2. Length 49; the old cap was 50.
const OLD_EXP_TO_NEXT = [
  100, 250, 500, 900, 1500, 2400, 3700, 5500, 8000, 12000,
  17000, 24000, 33000, 45000, 60000, 80000, 105000, 135000, 175000, 215000,
  265000, 325000, 395000, 475000, 565000, 670000, 790000, 925000, 1080000, 1250000,
  1450000, 1680000, 1950000, 2250000, 2600000, 3000000, 3450000, 3950000, 4500000, 5100000,
  5800000, 6600000, 7500000, 8500000, 9600000, 10800000, 12100000, 13500000, 15000000,
];

const PAGE_SIZE = 500;
const SAMPLE_SIZE = 20;

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const SCRIPT = path.basename(__filename);

function fmt(n) { return Number(n).toLocaleString('en-US'); }
function pct(part, whole) { return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : 'n/a'; }
function idList(list) {
  if (list.length === 0) return '';
  const shown = list.slice(0, 10).map((r) => r.discordId).join(', ');
  return ` (${shown}${list.length > 10 ? ', …' : ''})`;
}

/** Guard the invariant this whole conversion rests on, before touching any data. */
function assertCurveInvariant() {
  const violations = [];
  for (let i = 0; i < OLD_EXP_TO_NEXT.length; i += 1) {
    if (EXP_TO_NEXT[i] < OLD_EXP_TO_NEXT[i]) {
      violations.push(`level ${i + 1}: new ${EXP_TO_NEXT[i]} < old ${OLD_EXP_TO_NEXT[i]}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      'Curve invariant broken — a level got CHEAPER, so stored combat_exp could exceed '
      + 'the new requirement and players would sit on completed bars:\n  '
      + violations.join('\n  ')
    );
  }
}

/**
 * Convert one row. Pure — every branch is reported, nothing is silently repaired.
 * `combat_exp` arrives as a number because src/db/pool.js parses int8, but every
 * read is wrapped anyway so this script is correct even without that parser.
 */
function convertRow(row) {
  const level = Math.max(1, Math.min(MAX_COMBAT_LEVEL, Number(row.combat_level) || 1));
  const rawExp = row.combat_exp === null || row.combat_exp === undefined
    ? null
    : Number(row.combat_exp);

  const flags = [];
  let expCurrent = rawExp;
  if (rawExp === null || Number.isNaN(rawExp)) {
    expCurrent = 0;
    flags.push('NULL_EXP');
  } else if (rawExp < 0) {
    expCurrent = 0;
    flags.push('NEGATIVE_EXP');
  }

  // Data drift: exp at or above what the OLD table required for this level. Carry the
  // raw value across anyway — never clamp — but surface it for review.
  const oldRequirement = OLD_EXP_TO_NEXT[level - 1];
  if (oldRequirement !== undefined && expCurrent >= oldRequirement) {
    flags.push('DRIFT_OVER_OLD_REQUIREMENT');
  }

  const lifetimeExp = lifetimeExpFor(level, expCurrent);
  const derived = levelFromLifetimeExp(lifetimeExp);

  // The assertion. A mismatch means the conversion would silently change someone's
  // level, which is the one outcome this migration exists to prevent.
  if (derived.level !== level || derived.exp !== expCurrent) flags.push('ABORT_CLASS');

  return {
    discordId: row.discord_id,
    level,
    rawExp,
    expCurrent,
    lifetimeExp,
    derivedLevel: derived.level,
    derivedExp: derived.exp,
    flags,
    // Progress-bar fraction before and after — the visible effect of the change.
    oldBar: oldRequirement ? expCurrent / oldRequirement : null,
    newBar: EXP_TO_NEXT[level - 1] ? expCurrent / EXP_TO_NEXT[level - 1] : null,
  };
}

async function main() {
  assertCurveInvariant();

  console.log(`\n=== ${SCRIPT} — ${EXECUTE ? 'EXECUTE' : 'DRY RUN'} ===`);
  if (!EXECUTE) console.log('No writes will be made. Re-run with --execute to convert.\n');

  const client = await pool.connect();
  try {
    // ── idempotency guard ───────────────────────────────────────────────────
    // An unconverted row reads lifetime_exp = 0, including a brand-new level 1
    // player, so "every row is zero" correctly means "not yet converted".
    const already = await client.query(
      'SELECT count(*)::int AS n FROM user_character WHERE lifetime_exp > 0'
    );
    if (Number(already.rows[0].n) > 0) {
      console.log(
        `ALREADY CONVERTED — ${fmt(already.rows[0].n)} row(s) have lifetime_exp > 0.\n`
        + 'Refusing to run so a second pass cannot double-convert. Nothing was changed.'
      );
      return;
    }

    // ── scan ────────────────────────────────────────────────────────────────
    const rows = [];
    let after = '';
    for (;;) {
      const page = await client.query(
        `SELECT discord_id, combat_level, combat_exp
           FROM user_character
          WHERE discord_id > $1
          ORDER BY discord_id
          LIMIT $2`,
        [after, PAGE_SIZE]
      );
      if (page.rows.length === 0) break;
      for (const r of page.rows) rows.push(convertRow(r));
      after = page.rows[page.rows.length - 1].discord_id;
    }

    if (rows.length === 0) {
      console.log('No user_character rows found. Nothing to do.');
      return;
    }

    // ── report ──────────────────────────────────────────────────────────────
    const abortClass = rows.filter((r) => r.flags.includes('ABORT_CLASS'));
    const nullExp = rows.filter((r) => r.flags.includes('NULL_EXP'));
    const negExp = rows.filter((r) => r.flags.includes('NEGATIVE_EXP'));
    const drift = rows.filter((r) => r.flags.includes('DRIFT_OVER_OLD_REQUIREMENT'));

    console.log(`Users affected: ${fmt(rows.length)}\n`);

    // Level distribution before and after. These are IDENTICAL by construction —
    // printing both is the proof, not a formality.
    const before = new Map();
    const afterDist = new Map();
    for (const r of rows) {
      before.set(r.level, (before.get(r.level) || 0) + 1);
      afterDist.set(r.derivedLevel, (afterDist.get(r.derivedLevel) || 0) + 1);
    }
    const levels = [...new Set([...before.keys(), ...afterDist.keys()])].sort((a, b) => a - b);
    console.log('Level distribution (before -> after; must match exactly):');
    for (const lv of levels) {
      const b = before.get(lv) || 0;
      const a = afterDist.get(lv) || 0;
      console.log(
        `  L${String(lv).padStart(3)}: ${String(b).padStart(5)} -> ${String(a).padStart(5)}`
        + `${b === a ? '' : '   *** MISMATCH ***'}`
      );
    }

    // The thing that actually changes.
    const withBars = rows.filter((r) => r.oldBar !== null && r.newBar !== null);
    if (withBars.length > 0) {
      const avgOld = withBars.reduce((s, r) => s + r.oldBar, 0) / withBars.length;
      const avgNew = withBars.reduce((s, r) => s + r.newBar, 0) / withBars.length;
      console.log(
        `\nProgress bar (mean fill): ${(avgOld * 100).toFixed(1)}% -> ${(avgNew * 100).toFixed(1)}%`
        + '  — shrinking is expected and intended.'
      );
    }

    console.log('\nEdge cases:');
    console.log(`  NULL combat_exp        : ${nullExp.length}${idList(nullExp)}`);
    console.log(`  Negative combat_exp    : ${negExp.length}${idList(negExp)}`);
    console.log(`  Drift over old req.    : ${drift.length}${idList(drift)}`);
    console.log(`  ABORT-CLASS            : ${abortClass.length}`);

    if (abortClass.length > 0) {
      console.log(
        '\n*** ABORT-CLASS ROWS ***\n'
        + 'These re-derive to a different level or EXP than they hold now. Converting them\n'
        + 'would silently change a player\'s level, so --execute refuses to run while any\n'
        + 'exist. Their combat_exp is NOT clamped — fix the data deliberately, then re-run.\n'
      );
      for (const r of abortClass.slice(0, 50)) {
        console.log(
          `  ${r.discordId}: stored L${r.level}/${fmt(r.expCurrent)} `
          + `-> lifetime ${fmt(r.lifetimeExp)} -> derived L${r.derivedLevel}/${fmt(r.derivedExp)}`
        );
      }
      if (abortClass.length > 50) console.log(`  … and ${abortClass.length - 50} more`);
    }

    // Random sample.
    const sample = [...rows].sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
    console.log(`\nRandom sample of ${sample.length}:`);
    for (const r of sample) {
      const oldPct = r.oldBar === null ? 'n/a' : pct(r.expCurrent, OLD_EXP_TO_NEXT[r.level - 1]);
      const newPct = r.newBar === null ? 'n/a' : pct(r.expCurrent, EXP_TO_NEXT[r.level - 1]);
      console.log(
        `  ${r.discordId}: L${r.level}/${fmt(r.expCurrent)} -> lifetime ${fmt(r.lifetimeExp)} `
        + `-> L${r.derivedLevel}/${fmt(r.derivedExp)}  bar ${oldPct} -> ${newPct}`
      );
    }

    if (!EXECUTE) {
      console.log('\nDRY RUN complete. No changes were made.');
      return;
    }

    if (abortClass.length > 0) {
      throw new Error(
        `Refusing to convert: ${abortClass.length} ABORT-CLASS row(s). See the report above.`
      );
    }

    // ── write ───────────────────────────────────────────────────────────────
    // One transaction: snapshot, then convert. Any failure rolls back both.
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO progression_backup_pre_v2 (discord_id, combat_level, combat_exp)
       SELECT * FROM unnest($1::varchar[], $2::smallint[], $3::bigint[])
       ON CONFLICT (discord_id) DO NOTHING`,
      [
        rows.map((r) => r.discordId),
        rows.map((r) => r.level),
        rows.map((r) => (r.rawExp === null || Number.isNaN(r.rawExp) ? 0 : r.rawExp)),
      ]
    );

    await client.query(
      `UPDATE user_character uc
          SET lifetime_exp = u.lifetime,
              combat_exp   = u.exp
         FROM unnest($1::varchar[], $2::bigint[], $3::bigint[]) AS u(discord_id, lifetime, exp)
        WHERE uc.discord_id = u.discord_id`,
      [
        rows.map((r) => r.discordId),
        rows.map((r) => r.lifetimeExp),
        rows.map((r) => r.expCurrent),
      ]
    );

    // Post-write verification inside the transaction, so a bad result rolls back.
    const check = await client.query(
      `SELECT count(*)::int AS n FROM user_character
        WHERE lifetime_exp = 0 AND (combat_level > 1 OR combat_exp > 0)`
    );
    if (Number(check.rows[0].n) > 0) {
      throw new Error(`Post-write check failed: ${check.rows[0].n} row(s) left unconverted.`);
    }

    await client.query('COMMIT');
    console.log(
      `\nCONVERTED ${fmt(rows.length)} row(s). Snapshot in progression_backup_pre_v2.`
    );
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* not in a transaction */ }
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`\n${SCRIPT} FAILED: ${err.message}`);
    pool.end().catch(() => {});
    process.exitCode = 1;
  });

'use strict';

const REQUIRED_COLUMNS = Object.freeze({
  user_deities: Object.freeze(['sigils', 'ascended']),
  // Progression v2 — lifetime_exp is the source of truth for combat levels.
  // Booting without it means every EXP award writes to a column that is not there.
  user_character: Object.freeze(['lifetime_exp']),
  // Genesis update — apply scripts/migrations/20260720_01..03 before deploy.
  users_bag: Object.freeze(['change_class', 'diamond_chest', 'genesis_chest']),
  combat_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  believer_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  crd_shop_purchases: Object.freeze(['discord_id', 'product_id', 'period_key', 'qty']),
});

const MIGRATION_HINTS = Object.freeze({
  user_deities: 'scripts/migrations/20260711_add_deity_ascension_progress.sql',
  user_character: 'scripts/migrations/20260730_01_progression_v2.sql',
  users_bag: 'scripts/migrations/20260720_03_crd_inventory_columns.sql',
  combat_level_rewards: 'scripts/migrations/20260720_01_level_reward_tracking.sql',
  believer_level_rewards: 'scripts/migrations/20260720_01_level_reward_tracking.sql',
  crd_shop_purchases: 'scripts/migrations/20260720_02_crd_shop_tracking.sql',
});

const REQUIRED_CHECKS = Object.freeze({
  user_weapons_enhancement_check: Object.freeze({
    table: 'public.user_weapons',
    fragments: Object.freeze(['enhancement >= 1', 'enhancement <= 21']),
    migration: 'scripts/migrations/20260721_10_genesis_enhancement_cap.sql',
  }),
  // Progression v2 cap raise. Left at 50, every level-up past the old cap fails the
  // CHECK and rolls back the EXP grant — so this must be verified at boot, not
  // discovered by the first player to hit level 51.
  user_character_combat_level_check: Object.freeze({
    table: 'public.user_character',
    fragments: Object.freeze(['combat_level >= 1', 'combat_level <= 100']),
    migration: 'scripts/migrations/20260730_01_progression_v2.sql',
  }),
});

function normalizeConstraintDefinition(definition) {
  return String(definition || '')
    .toLowerCase()
    .replace(/[()\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function verifyRequiredSchema(db) {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const actual = new Set(rows.map((row) => row.column_name));
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(
        `required schema is missing ${missing.map((column) => `${table}.${column}`).join(', ')}; ` +
        `apply ${MIGRATION_HINTS[table] || 'the pending scripts in scripts/migrations/'}`
      );
    }
  }

  for (const [constraint, requirement] of Object.entries(REQUIRED_CHECKS)) {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = $1::regclass
          AND conname = $2
          AND contype = 'c'`,
      [requirement.table, constraint]
    );
    const definition = normalizeConstraintDefinition(rows[0]?.definition);
    const valid = requirement.fragments.every((fragment) => definition.includes(fragment));
    if (!valid) {
      throw new Error(
        `required schema has a stale or missing constraint ${requirement.table}.${constraint}; ` +
        `apply ${requirement.migration}`
      );
    }
  }

  await warnOnProgressionDesync(db);
}

/**
 * [Progression v2] Soft check that lifetime_exp is actually populated.
 *
 * WARNS, never throws — a desync is a data problem, not a reason to take the bot
 * down, and the full row-by-row invariant scan belongs in production-preflight.js
 * where an O(n) pass is appropriate. This is the cheap version: one aggregate that
 * catches the two failure modes that matter in practice — the conversion script was
 * never run, or a new write path updates level/exp without maintaining lifetime_exp.
 * Both show up as rows with real progress and a zero lifetime total.
 *
 * Deliberately NOT a cron job: a scheduler, a failure mode and alert noise are not
 * worth it for an invariant only two code paths can break.
 */
async function warnOnProgressionDesync(db) {
  try {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM user_character
        WHERE lifetime_exp = 0 AND (combat_level > 1 OR combat_exp > 0)`
    );
    const desynced = Number(rows[0]?.n || 0);
    if (desynced > 0) {
      console.warn(
        `[schemaGuard] ${desynced} user_character row(s) have progress but lifetime_exp = 0. `
        + 'Either scripts/progression-v2-migrate.js has not been run with --execute, or a '
        + 'write path is updating combat_level/combat_exp without maintaining lifetime_exp. '
        + 'Run `npm run preflight` for the full per-row invariant scan.'
      );
    }
  } catch (err) {
    // Never let a diagnostic block boot. If lifetime_exp is missing entirely the
    // REQUIRED_COLUMNS check above has already thrown with a better message.
    console.warn(`[schemaGuard] progression desync check skipped: ${err.message}`);
  }
}

module.exports = {
  REQUIRED_COLUMNS,
  REQUIRED_CHECKS,
  MIGRATION_HINTS,
  verifyRequiredSchema,
  warnOnProgressionDesync,
};

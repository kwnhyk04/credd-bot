'use strict';

const REQUIRED_COLUMNS = Object.freeze({
  user_deities: Object.freeze(['sigils', 'ascended']),
  // Genesis update — apply scripts/migrations/20260720_01..03 before deploy.
  users_bag: Object.freeze(['change_class', 'diamond_chest', 'genesis_chest']),
  combat_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  believer_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  crd_shop_purchases: Object.freeze(['discord_id', 'product_id', 'period_key', 'qty']),
});

const MIGRATION_HINTS = Object.freeze({
  user_deities: 'scripts/migrations/20260711_add_deity_ascension_progress.sql',
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
}

module.exports = { REQUIRED_COLUMNS, REQUIRED_CHECKS, verifyRequiredSchema };

'use strict';

const REQUIRED_COLUMNS = Object.freeze({
  user_deities: Object.freeze(['sigils', 'ascended']),
  // Progression v2 — lifetime_exp is the source of truth for combat levels.
  // Booting without it means every EXP award writes to a column that is not there.
  user_character: Object.freeze([
    'lifetime_exp', 'active_preset_slot', 'highest_raid_streak', 'highest_rank_streak',
  ]),
  // Genesis update — apply scripts/migrations/20260720_01..03 before deploy.
  users_bag: Object.freeze([
    'change_class', 'diamond_chest', 'genesis_chest',
    'custom_avatar_token', 'custom_deity_token',
  ]),
  combat_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  believer_level_rewards: Object.freeze(['discord_id', 'level', 'source']),
  crd_shop_purchases: Object.freeze(['discord_id', 'product_id', 'period_key', 'qty']),
  user_presets: Object.freeze([
    'id', 'discord_id', 'slot', 'name',
    'equipped_deity_1_id', 'equipped_deity_2_id', 'equipped_deity_3_id',
    'equipped_echo_deity_id', 'equipped_armor_id', 'equipped_weapon_id', 'updated_at',
  ]),
  tickets: Object.freeze([
    'ticket_id', 'type', 'user_id', 'status', 'created_at', 'updated_at',
    'completed_at', 'completed_by', 'notes',
  ]),
  supporter_item_grants: Object.freeze([
    'grant_id', 'discord_id', 'item_key', 'quantity', 'grant_reason', 'grant_ref', 'created_at',
  ]),
  boss_state: Object.freeze([
    'boss_level', 'spawn_source', 'last_attack_at', 'passive_state',
  ]),
  boss_spawn_queue: Object.freeze([
    'queue_id', 'guild_id', 'boss_name', 'requested_by', 'status', 'created_at',
    'updated_at', 'claim_started_at', 'spawned_at', 'cancelled_at', 'cancelled_by', 'spawn_id',
  ]),
  active_battles: Object.freeze(['enemy_level']),
});

const MIGRATION_HINTS = Object.freeze({
  user_deities: 'scripts/migrations/20260711_add_deity_ascension_progress.sql',
  user_character: 'scripts/migrations/20260730_01_progression_v2.sql',
  users_bag: 'scripts/migrations/20260720_03_crd_inventory_columns.sql and scripts/migrations/20260803_02_custom_content_tickets.sql',
  combat_level_rewards: 'scripts/migrations/20260720_01_level_reward_tracking.sql',
  believer_level_rewards: 'scripts/migrations/20260720_01_level_reward_tracking.sql',
  crd_shop_purchases: 'scripts/migrations/20260720_02_crd_shop_tracking.sql',
  user_presets: 'scripts/migrations/20260803_01_user_presets.sql',
  tickets: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  supporter_item_grants: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  boss_state: 'scripts/migrations/20260803_03, 20260803_06, and 20260803_07',
  boss_spawn_queue: 'scripts/migrations/20260803_03_boss_spawn_source_queue.sql and 20260803_08_boss_queue_recovery_rls.sql',
  active_battles: 'scripts/migrations/20260803_06_boss_level_nullable.sql',
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
  user_character_active_preset_slot_check: Object.freeze({
    table: 'public.user_character',
    fragments: Object.freeze(['active_preset_slot = any', 'array[1, 2]']),
    migration: 'scripts/migrations/20260803_01_user_presets.sql',
  }),
  user_character_highest_raid_streak_check: Object.freeze({
    table: 'public.user_character',
    fragments: Object.freeze(['highest_raid_streak >= 0']),
    migration: 'scripts/migrations/20260803_04_character_record_highs.sql',
  }),
  user_character_highest_rank_streak_check: Object.freeze({
    table: 'public.user_character',
    fragments: Object.freeze(['highest_rank_streak >= 0']),
    migration: 'scripts/migrations/20260803_04_character_record_highs.sql',
  }),
  users_bag_custom_avatar_token_check: Object.freeze({
    table: 'public.users_bag',
    fragments: Object.freeze(['custom_avatar_token >= 0']),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  users_bag_custom_deity_token_check: Object.freeze({
    table: 'public.users_bag',
    fragments: Object.freeze(['custom_deity_token >= 0']),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  tickets_type_check: Object.freeze({
    table: 'public.tickets',
    fragments: Object.freeze(["type = any", "avatar", "deity"]),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  tickets_status_check: Object.freeze({
    table: 'public.tickets',
    fragments: Object.freeze(["status = any", "queued", "in_progress", "done"]),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  supporter_item_grants_item_key_check: Object.freeze({
    table: 'public.supporter_item_grants',
    fragments: Object.freeze(["item_key", "custom_deity_token"]),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  supporter_item_grants_quantity_check: Object.freeze({
    table: 'public.supporter_item_grants',
    fragments: Object.freeze(['quantity > 0']),
    migration: 'scripts/migrations/20260803_02_custom_content_tickets.sql',
  }),
  boss_spawn_queue_status_check: Object.freeze({
    table: 'public.boss_spawn_queue',
    fragments: Object.freeze(["status", "= any", "pending", "spawning", "spawned", "cancelled"]),
    migration: 'scripts/migrations/20260803_03_boss_spawn_source_queue.sql',
  }),
});

const REQUIRED_RLS_TABLES = Object.freeze([
  'user_presets', 'tickets', 'supporter_item_grants', 'boss_spawn_queue',
]);

const REQUIRED_INDEXES = Object.freeze([
  'idx_user_presets_discord_id',
  'idx_tickets_status_type_created',
  'supporter_item_grants_idempotency_key',
  'boss_spawn_queue_one_live_per_guild',
]);

const REQUIRED_INDEX_FRAGMENTS = Object.freeze({
  idx_user_presets_discord_id: Object.freeze(['user_presets', 'discord_id']),
  idx_tickets_status_type_created: Object.freeze(['tickets', 'status', 'type', 'created_at']),
  supporter_item_grants_idempotency_key: Object.freeze([
    'unique', 'supporter_item_grants', 'discord_id', 'item_key', 'grant_reason', 'grant_ref',
  ]),
  boss_spawn_queue_one_live_per_guild: Object.freeze([
    'unique', 'boss_spawn_queue', 'guild_id', "status", "pending", "spawning",
  ]),
});

const REQUIRED_NULLABLE_COLUMNS = Object.freeze([
  Object.freeze({ table: 'boss_state', column: 'boss_level', migration: 'scripts/migrations/20260803_06_boss_level_nullable.sql' }),
  Object.freeze({ table: 'active_battles', column: 'enemy_level', migration: 'scripts/migrations/20260803_06_boss_level_nullable.sql' }),
]);

const REQUIRED_NAMED_CONSTRAINTS = Object.freeze({
  user_character_active_preset_slot_check: 'c',
  user_character_highest_raid_streak_check: 'c',
  user_character_highest_rank_streak_check: 'c',
  users_bag_custom_avatar_token_check: 'c',
  users_bag_custom_deity_token_check: 'c',
  user_presets_pkey: 'p',
  user_presets_discord_slot_key: 'u',
  user_presets_slot_check: 'c',
  user_presets_echo_source_check: 'c',
  user_presets_discord_id_fkey: 'f',
  user_presets_equipped_deity_1_id_fkey: 'f',
  user_presets_equipped_deity_2_id_fkey: 'f',
  user_presets_equipped_deity_3_id_fkey: 'f',
  user_presets_equipped_echo_deity_id_fkey: 'f',
  user_presets_equipped_armor_id_fkey: 'f',
  user_presets_equipped_weapon_id_fkey: 'f',
  tickets_pkey: 'p',
  tickets_type_check: 'c',
  tickets_status_check: 'c',
  tickets_user_id_fkey: 'f',
  supporter_item_grants_pkey: 'p',
  supporter_item_grants_item_key_check: 'c',
  supporter_item_grants_quantity_check: 'c',
  supporter_item_grants_idempotency_key: 'u',
  supporter_item_grants_discord_id_fkey: 'f',
  boss_spawn_queue_pkey: 'p',
  boss_spawn_queue_status_check: 'c',
});

// Optional until 20260803_01_user_presets.sql has been applied. Once the table
// exists, a partial preset schema must fail loudly rather than letting the
// accessor boundary run against an incomplete migration.
const PRESET_REQUIRED_COLUMNS = Object.freeze({
  user_presets: Object.freeze([
    'id', 'discord_id', 'slot', 'name',
    'equipped_deity_1_id', 'equipped_deity_2_id', 'equipped_deity_3_id',
    'equipped_echo_deity_id', 'equipped_armor_id', 'equipped_weapon_id',
    'updated_at',
  ]),
  user_character: Object.freeze(['active_preset_slot']),
});

const PRESET_MIGRATION = 'scripts/migrations/20260803_01_user_presets.sql';

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
  await verifyPresetSchema(db);
  await verifyMonthsaryProperties(db);
}

async function verifyMonthsaryProperties(db) {
  const constraintNames = Object.keys(REQUIRED_NAMED_CONSTRAINTS);
  const { rows: constraintRows } = await db.query(
    `SELECT pc.conname, pc.contype
       FROM pg_constraint pc
       JOIN pg_class c ON c.oid = pc.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND pc.conname = ANY($1::text[])`,
    [constraintNames]
  );
  const constraintByName = new Map(constraintRows.map((row) => [row.conname, row.contype]));
  for (const [name, type] of Object.entries(REQUIRED_NAMED_CONSTRAINTS)) {
    if (constraintByName.get(name) !== type) {
      throw new Error(`required schema has a missing or stale constraint public.${name}`);
    }
  }

  const { rows: rlsRows } = await db.query(
    `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [REQUIRED_RLS_TABLES]
  );
  const rlsByTable = new Map(rlsRows.map((row) => [row.relname, row.relrowsecurity]));
  for (const table of REQUIRED_RLS_TABLES) {
    if (rlsByTable.get(table) !== true) {
      throw new Error(`required schema has RLS disabled or missing on public.${table}; apply the Monthsary migrations`);
    }
  }

  const { rows: indexRows } = await db.query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const indexByName = new Map(indexRows.map((row) => [row.indexname, String(row.indexdef || '').toLowerCase()]));
  for (const index of REQUIRED_INDEXES) {
    const definition = indexByName.get(index) || '';
    const valid = REQUIRED_INDEX_FRAGMENTS[index].every((fragment) => definition.includes(fragment));
    if (!valid) throw new Error(`required schema has a missing or stale index public.${index}`);
  }

  for (const requirement of REQUIRED_NULLABLE_COLUMNS) {
    const { rows } = await db.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [requirement.table, requirement.column]
    );
    if (rows[0]?.is_nullable !== 'YES') {
      throw new Error(
        `required schema column public.${requirement.table}.${requirement.column} must be nullable; ` +
        `apply ${requirement.migration}`
      );
    }
  }
}

async function verifyPresetSchema(db) {
  const { rows: tableRows } = await db.query(
    `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'user_presets'`
  );
  if (tableRows.length === 0) throw new Error(`required schema is missing public.user_presets; apply ${PRESET_MIGRATION}`);
  if (!tableRows[0].relrowsecurity) {
    throw new Error(`required schema has RLS disabled on public.user_presets; apply ${PRESET_MIGRATION}`);
  }

  for (const [table, required] of Object.entries(PRESET_REQUIRED_COLUMNS)) {
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
        `required preset schema is missing ${missing.map((column) => `${table}.${column}`).join(', ')}; ` +
        `apply ${PRESET_MIGRATION}`
      );
    }
  }

  const { rows: constraints } = await db.query(
    `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = 'public.user_presets'::regclass
        AND conname IN (
          'user_presets_slot_check',
          'user_presets_echo_source_check',
          'user_presets_discord_slot_key'
        )`
  );
  const byName = new Map(constraints.map((row) => [row.conname, row]));
  const slotCheck = normalizeConstraintDefinition(byName.get('user_presets_slot_check')?.definition);
  const echoCheck = normalizeConstraintDefinition(byName.get('user_presets_echo_source_check')?.definition);
  if (!byName.has('user_presets_discord_slot_key') || byName.get('user_presets_discord_slot_key').contype !== 'u'
      || !slotCheck.includes('slot = any') || !echoCheck.includes('equipped_echo_deity_id is null')) {
    throw new Error(`required preset constraints are missing or stale; apply ${PRESET_MIGRATION}`);
  }

  return true;
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
  PRESET_REQUIRED_COLUMNS,
  PRESET_MIGRATION,
  REQUIRED_RLS_TABLES,
  REQUIRED_INDEXES,
  REQUIRED_INDEX_FRAGMENTS,
  REQUIRED_NULLABLE_COLUMNS,
  REQUIRED_NAMED_CONSTRAINTS,
  verifyRequiredSchema,
  verifyPresetSchema,
  verifyMonthsaryProperties,
  warnOnProgressionDesync,
};

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const {
  buildPlayerFighter,
  computeClassBattleStats,
  accumulateRuneStats,
} = require('../src/engine/statAssembly');
const { execute: executeProfile } = require('../src/commands/rpg/profile');
const {
  postOfficialRedirect,
  postFreshLiveMessage,
  redirectChannelIssue,
} = require('../src/engine/bossSystem');
const {
  REQUIRED_COLUMNS,
  REQUIRED_CHECKS,
  REQUIRED_RLS_TABLES,
  REQUIRED_INDEXES,
  REQUIRED_INDEX_FRAGMENTS,
  REQUIRED_NAMED_CONSTRAINTS,
  verifyRequiredSchema,
} = require('../src/db/schemaGuard');
const {
  REQUIRED_COLUMNS: PREFLIGHT_COLUMNS,
  REQUIRED_TABLES: PREFLIGHT_TABLES,
} = require('./production-preflight');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Healthy definitions for every constraint in REQUIRED_CHECKS, keyed by constraint
// name. The second argument overrides only the enhancement check, so existing callers
// that pass a drifted definition keep working unchanged.
const HEALTHY_CONSTRAINTS = {
  user_weapons_enhancement_check: 'CHECK (((enhancement >= 1) AND (enhancement <= 21)))',
  user_character_combat_level_check: 'CHECK (((combat_level >= 1) AND (combat_level <= 100)))',
};
for (const [name, requirement] of Object.entries(REQUIRED_CHECKS)) {
  if (!HEALTHY_CONSTRAINTS[name]) HEALTHY_CONSTRAINTS[name] = `CHECK (${requirement.fragments.join(' ')})`;
}

function schemaFixture(
  overrides = {},
  constraintDefinition = HEALTHY_CONSTRAINTS.user_weapons_enhancement_check,
  constraintOverrides = {},
) {
  return {
    query: async (sql, params) => {
      if (sql.includes('pg_constraint')) {
        if (sql.includes('user_presets_slot_check')) {
          return { rows: [
            { conname: 'user_presets_slot_check', contype: 'c', definition: 'CHECK (slot = ANY (ARRAY[1, 2]))' },
            { conname: 'user_presets_echo_source_check', contype: 'c', definition: 'CHECK (equipped_echo_deity_id IS NULL)' },
            { conname: 'user_presets_discord_slot_key', contype: 'u', definition: 'UNIQUE (discord_id, slot)' },
          ] };
        }
        if (Array.isArray(params?.[0])) {
          return { rows: Object.entries(REQUIRED_NAMED_CONSTRAINTS).map(([conname, contype]) => ({ conname, contype })) };
        }
        const name = params?.[1];
        const definition = Object.prototype.hasOwnProperty.call(constraintOverrides, name)
          ? constraintOverrides[name]
          : name === 'user_weapons_enhancement_check'
            ? constraintDefinition
            : HEALTHY_CONSTRAINTS[name];
        return definition == null ? { rows: [] } : { rows: [{ definition }] };
      }
      if (sql.includes('pg_class')) {
        if (params?.[0]) {
          return { rows: params[0].map((relname) => ({ relname, relrowsecurity: true })) };
        }
        return { rows: [{ relname: 'user_presets', relrowsecurity: true }] };
      }
      if (sql.includes('pg_indexes')) {
        return { rows: REQUIRED_INDEXES.map((indexname) => ({
          indexname,
          indexdef: `CREATE ${REQUIRED_INDEX_FRAGMENTS[indexname].join(' ')} INDEX`,
        })) };
      }
      // [Progression v2] The soft desync aggregate takes no params; a healthy fixture
      // reports zero desynced rows so the guard stays quiet.
      if (sql.includes('lifetime_exp = 0')) return { rows: [{ n: 0 }] };
      if (sql.includes('is_nullable')) return { rows: [{ is_nullable: 'YES' }] };
      const table = params[0];
      const columns = Object.prototype.hasOwnProperty.call(overrides, table)
        ? overrides[table]
        : REQUIRED_COLUMNS[table];
      return { rows: (columns || []).map((column_name) => ({ column_name })) };
    },
  };
}

function playerRow(overrides = {}) {
  return {
    class: 'Fighter', combat_level: 1, username: 'Tester',
    deity_name: 'Odin', d1_batk: 100, d1_bhp: 200, d1_bdef: 50,
    d1_unlocked_sigils: 5, d1_ascended: false, d1_enhancement: 1,
    deity2_name: null, deity3_name: null, echo_deity_name: null,
    w_native: null, a_native: null,
    ...overrides,
  };
}

async function fighterFor(row) {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      return { rows: [row] };
    },
  };
  return { fighter: await buildPlayerFighter(db, '123'), sql: queries[0] };
}

function fakeRedirectChannel({ guildId = 'guild', sendAllowed = true } = {}) {
  let sends = 0;
  const channel = {
    id: 'channel', guildId, type: 0, archived: false,
    isTextBased: () => true,
    isSendable: () => true,
    isThread: () => false,
    permissionsFor: () => ({
      has: (permission) => permission === PermissionFlagsBits.ViewChannel || sendAllowed,
    }),
    send: async () => { sends += 1; return { id: 'message', channel }; },
  };
  return { channel, sends: () => sends };
}

async function main() {
  const classStats = computeClassBattleStats('Fighter', 1);

  let runeQuery = null;
  const nativeRunes = await accumulateRuneStats({
    async query(sql, params) {
      runeQuery = { sql, params };
      return { rows: [
        { effect_key: 'sharpness', value: 5 },
        { effect_key: 'precision', value: 3 },
        { effect_key: 'vitality', value: 4 },
        { effect_key: 'bulwark', value: 2 },
        { effect_key: 'vampiric', value: 20 },
      ] };
    },
  }, {
    discord_id: '123',
    w_native: [{ rune_uid: 'wn' }],
    a_native: [{ rune_uid: 'an' }],
    // Opposite lanes are intentionally disabled; legacy entries remain only
    // so their owners can unsocket them.
    w_opposite: [{ rune_uid: 'wo' }],
    a_opposite: [{ rune_uid: 'ao' }],
  });
  assert.deepEqual(runeQuery.params, [['wn', 'an'], '123']);
  assert(runeQuery.sql.includes('COALESCE(ur.rolled_value, rn.value)'));
  assert.deepEqual(nativeRunes.mods, { atkPct: 5, hpPct: 4, defPct: 2, critPts: 3 });
  assert.deepEqual(nativeRunes.effects, [{ effect_key: 'vampiric', value: 20 }]);

  let oppositeOnlyQueried = false;
  const oppositeOnly = await accumulateRuneStats({
    async query() {
      oppositeOnlyQueried = true;
      return { rows: [] };
    },
  }, {
    discord_id: '123',
    w_opposite: [{ rune_uid: 'legacy-opposite' }],
  });
  assert.equal(oppositeOnlyQueried, false);
  assert.deepEqual(oppositeOnly, {
    mods: { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 },
    effects: [],
  });

  const existing = await fighterFor(playerRow());
  assert.equal(existing.fighter.atk, classStats.atk + 75);
  assert(existing.sql.includes('COALESCE(ud.sigils, 0) AS d1_unlocked_sigils'));

  const supreme = await fighterFor(playerRow({
    w_atk: 20, w_crit: 5, bonus_dmg_pct: 50,
    passive_key: 'mjolnir', weapon_name: 'Mjolnir', weapon_tier: 'Supreme',
  }));
  assert.equal(supreme.fighter.weaponTier, 'Supreme');
  assert.equal(supreme.fighter.weaponPassiveKey, 'mjolnir');
  assert.equal(supreme.fighter.bonusDmgPct, 50);
  assert(supreme.sql.includes('active_wr.tier AS weapon_tier'));

  const divineRow = playerRow({
    w_atk: 1_600, w_crit: 20, bonus_dmg_pct: 50,
    passive_key: 'kiri', weapon_name: 'Kiri', weapon_tier: 'Divine',
  });
  const divine = await fighterFor(divineRow);
  assert.equal(divine.fighter.weaponTier, 'Divine');
  assert.equal(divine.fighter.bonusDmgPct, 100);
  assert.equal(divineRow.bonus_dmg_pct, 50, 'fighter assembly must not mutate stored equipment data');

  const zero = await fighterFor(playerRow({ d1_unlocked_sigils: 0 }));
  assert.equal(zero.fighter.atk, classStats.atk + 50);

  const missing = await fighterFor(playerRow({ deity_name: null }));
  assert.equal(missing.fighter.atk, classStats.atk);

  const profileSource = source('src/commands/rpg/profile.js');
  const statsSource = source('src/commands/rpg/stats.js');
  const raidSource = source('src/commands/rpg/raid.js');
  assert(profileSource.includes("require('../../engine/loadout')"));
  assert(profileSource.includes('getActiveLoadout(db, discordId)'));
  assert(statsSource.includes("require('../../engine/loadout')"));
  assert(statsSource.includes('getActiveLoadout(pool, discordId)'));
  assert(raidSource.includes('buildPlayerFighter(pool, discordId)'));

  const replies = [];
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    await executeProfile({
      author: {
        id: '123', username: 'Tester', displayAvatarURL: () => 'avatar', defaultAvatarURL: 'fallback',
      },
      guild: { id: 'guild', members: { cache: new Map() } },
      getMention: () => null,
      reply: async (payload) => { replies.push(payload); },
    }, {
      db: { query: async () => { throw new Error('database unavailable'); } },
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], '[profile] command failed');
  assert(logs[0][1].error instanceof Error);
  assert.equal(replies.length, 1);
  assert(!replies[0].content.includes('database unavailable'));

  const valid = fakeRedirectChannel();
  const validClient = { user: { id: 'bot' }, channels: { fetch: async () => valid.channel } };
  assert.equal(redirectChannelIssue(valid.channel, 'guild', validClient.user), null);
  assert(await postOfficialRedirect(validClient, 'guild', 'channel', { force: true }));
  assert(await postFreshLiveMessage(validClient, 'guild', { content: 'boss' }, 'channel'));
  assert.equal(valid.sends(), 2);

  const blocked = fakeRedirectChannel({ guildId: 'blocked-guild', sendAllowed: false });
  const blockedClient = { user: { id: 'bot' }, channels: { fetch: async () => blocked.channel } };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(
      redirectChannelIssue(blocked.channel, 'blocked-guild', blockedClient.user),
      'missing Send Messages'
    );
    assert.equal(await postOfficialRedirect(blockedClient, 'blocked-guild', 'channel'), null);
    assert.equal(await postOfficialRedirect(blockedClient, 'blocked-guild', 'channel'), null);
    assert.equal(
      await postFreshLiveMessage(blockedClient, 'blocked-guild', { content: 'boss' }, 'channel'),
      null
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(blocked.sends(), 0);
  assert.equal(warnings.length, 2);
  assert.equal(warnings[1][0], '[boss] live message skipped');
  assert.equal(warnings[1][1].reason, 'missing Send Messages');

  await assert.rejects(
    verifyRequiredSchema({ query: async () => ({ rows: [{ column_name: 'sigils' }] }) }),
    /user_deities\.ascended/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({ users_bag: ['change_class'] })),
    /users_bag\.diamond_chest.*users_bag\.custom_deity_token.*20260803_02_custom_content_tickets\.sql/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({ combat_level_rewards: [] })),
    /combat_level_rewards\.discord_id.*apply scripts\/migrations\/20260720_01_level_reward_tracking\.sql/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({ crd_shop_purchases: [] })),
    /crd_shop_purchases\.discord_id.*apply scripts\/migrations\/20260720_02_crd_shop_tracking\.sql/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({ tickets: [] })),
    /tickets\.ticket_id.*20260803_02_custom_content_tickets\.sql/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({}, 'CHECK (((enhancement >= 1) AND (enhancement <= 11)))')),
    /stale or missing constraint public\.user_weapons\.user_weapons_enhancement_check; apply scripts\/migrations\/20260721_10_genesis_enhancement_cap\.sql/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({}, null)),
    /stale or missing constraint public\.user_weapons\.user_weapons_enhancement_check/
  );
  await assert.rejects(
    verifyRequiredSchema(schemaFixture({}, HEALTHY_CONSTRAINTS.user_weapons_enhancement_check, {
      weapon_roster_tier_check: "CHECK (tier = ANY (ARRAY['Common', 'Genesis']))",
    })),
    /stale or missing constraint public\.weapon_roster\.weapon_roster_tier_check; apply scripts\/migrations\/20260818_02_divine_weapon_tier\.sql/
  );
  await verifyRequiredSchema(schemaFixture());
  await verifyRequiredSchema(schemaFixture({}, HEALTHY_CONSTRAINTS.user_weapons_enhancement_check, {
    // Exact shape emitted by PostgreSQL for a varchar column compared with a
    // typed ARRAY; harmless casts must not make the Divine check look stale.
    weapon_roster_tier_check: "CHECK ((((tier)::text = ANY ((ARRAY['Common'::character varying, 'Rare'::character varying, 'Mythic'::character varying, 'Legendary'::character varying, 'Supreme'::character varying, 'Divine'::character varying])::text[]))))",
  }));

  assert.equal(REQUIRED_CHECKS.weapon_roster_tier_check.table, 'public.weapon_roster');
  assert(REQUIRED_CHECKS.weapon_roster_tier_check.fragments.includes('divine'));
  assert.equal(REQUIRED_CHECKS.user_weapons_enhancement_check.table, 'public.user_weapons');
  assert(REQUIRED_CHECKS.user_weapons_enhancement_check.fragments.includes('enhancement <= 21'));

  const migration = source('scripts/migrations/20260711_add_deity_ascension_progress.sql');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS sigils'));
  assert(migration.includes('ADD COLUMN IF NOT EXISTS ascended'));
  assert(migration.includes('user_deities_sigils_check'));

  const rewardMigration = source('scripts/migrations/20260720_01_level_reward_tracking.sql');
  const shopMigration = source('scripts/migrations/20260720_02_crd_shop_tracking.sql');
  const inventoryMigration = source('scripts/migrations/20260720_03_crd_inventory_columns.sql');
  assert(rewardMigration.includes('combat_level_rewards'));
  assert(rewardMigration.includes('believer_level_rewards'));
  assert(shopMigration.includes('crd_shop_purchases'));
  for (const column of REQUIRED_COLUMNS.users_bag) {
    if (column.startsWith('custom_')) continue;
    assert(inventoryMigration.includes(column));
  }
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    assert(PREFLIGHT_TABLES.includes(table));
    for (const column of columns) assert(PREFLIGHT_COLUMNS[table].includes(column));
  }

  const monthsary02 = source('scripts/migrations/20260803_02_custom_content_tickets.sql');
  const monthsary03 = source('scripts/migrations/20260803_03_boss_spawn_source_queue.sql');
  const monthsary08 = source('scripts/migrations/20260803_08_boss_queue_recovery_rls.sql');
  assert(monthsary02.includes('custom_avatar_token'));
  assert(monthsary02.includes('custom_deity_token'));
  assert(monthsary02.includes('supporter_item_grants_idempotency_key'));
  assert(monthsary02.includes('ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY'));
  assert(monthsary03.includes('claim_started_at'));
  assert(monthsary03.includes('ALTER TABLE public.boss_spawn_queue ENABLE ROW LEVEL SECURITY'));
  assert(monthsary08.includes('ADD COLUMN IF NOT EXISTS claim_started_at'));

  for (const snapshotName of [
    'scripts/schema.sql',
    'scripts/credd_schema_v4.sql',
    'scripts/production-consolidated-schema.sql',
  ]) {
    const snapshot = source(snapshotName);
    for (const token of [
      'user_presets', 'highest_raid_streak', 'highest_rank_streak',
      'custom_avatar_token', 'custom_deity_token', 'tickets', 'supporter_item_grants',
      'supporter_item_grants_idempotency_key', 'idx_tickets_status_type_created',
      'boss_spawn_queue_status_check', 'claim_started_at',
      'daily_quest_completion_rewards', 'raid_reward_daily_totals',
      'raid_reward_grants', 'summon_reward_grants', 'raid_reward_daily_totals_silver_check',
      'raid_reward_daily_totals_gold_check', 'raid_reward_daily_totals_shards_check',
      'daily_quest_completion_rewards_relic_check', 'summon_reward_grants_source_check',
    ]) assert(snapshot.includes(token), `${snapshotName} is missing ${token}`);
    for (const table of [
      'daily_quest_completion_rewards', 'raid_reward_daily_totals', 'raid_reward_grants',
      'summon_reward_grants',
    ]) {
      const rlsPattern = new RegExp(`ALTER TABLE (?:public\\.)?["']?${table}["']? ENABLE ROW LEVEL SECURITY`);
      assert(rlsPattern.test(snapshot), `${snapshotName} is missing ${table} RLS`);
    }
    for (const table of REQUIRED_RLS_TABLES) {
      const rlsPattern = new RegExp(`ALTER TABLE (?:public\\.)?["']?${table}["']? ENABLE ROW LEVEL SECURITY`);
      assert(rlsPattern.test(snapshot), `${snapshotName} is missing ${table} RLS`);
    }
  }

  for (const table of REQUIRED_RLS_TABLES) assert(PREFLIGHT_TABLES.includes(table));

  console.log('SCHEMA DRIFT SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

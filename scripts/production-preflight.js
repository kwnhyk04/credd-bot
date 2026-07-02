'use strict';

/**
 * Read-only deployment preflight for Credd.
 *
 * This script validates env/config, DB schema readiness, and critical local
 * assets. It never starts Discord, writes DB rows, or runs migrations.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const isProdMode = process.argv.includes('--prod');

const REQUIRED_ENV = ['BOT_TOKEN', 'CLIENT_ID', 'DATABASE_URL', 'DEV_IDS'];
const DANGEROUS_FLAGS = [
  'ALLOW_DESTRUCTIVE_DEV_COMMANDS',
  'ALLOW_HIGH_VALUE_DEV_COMMANDS',
  'ALLOW_SUPPORTER_DEV_COMMANDS',
  'ALLOW_LIVE_EVENT_DEV_COMMANDS',
  'BETA_MODE',
];

const REQUIRED_TABLES = [
  'users',
  'user_character',
  'users_bag',
  'user_weapons',
  'user_armors',
  'user_runes',
  'deity_roster',
  'user_deities',
  'active_casino_sessions',
  'active_duels',
  'active_duel_participants',
  'daily_quests',
  'weekly_quests',
  'weekly_grand',
  'pvp_shop_purchases',
  'user_guild_activity',
  'title_catalog',
  'user_titles',
  'boss_state',
  'boss_attack_log',
  'mob_roster',
  'raid_logs',
  'ranked_logs',
  'ranked_reward',
  'seasons',
  'auto_raids',
  'server_config',
  'cosmetic_catalog',
  'user_cosmetics',
  'equipped_skins',
  'supporters',
  'casino_logs',
];

const REQUIRED_COLUMNS = {
  users: [
    'discord_id',
    'is_banned',
    'quest_refreshes_today',
    'last_quest_refresh_date',
    'bestow_received_today',
    'last_bestow_received',
  ],
  user_character: [
    'discord_id',
    'class',
    'combat_level',
    'combat_exp',
    'equipped_weapon_id',
    'equipped_armor_id',
    'active_deity_id',
    'active_deity_id_2',
    'active_deity_id_3',
    'equipped_title_id',
    'pvp_rating',
    'pvp_peak',
    'last_weekly_claim_week',
    'pvp_demotion_shield',
    'boss_kills',
    'boss_top_damage',
    'reputation_exp_today',
    'reputation_exp_reset_date',
  ],
  users_bag: [
    'discord_id',
    'credux',
    'belief_shards',
    'sacred_relics',
    'supreme_relics',
    'silver_chest',
    'gold_chest',
    'boss_treasure_chest',
    'boss_golden_chest',
    'supreme_chest',
    'lesser_rune_bag',
    'greater_rune_bag',
    'divine_rune_bag',
    'epic_essence',
    'mythic_essence',
    'legendary_essence',
    'supreme_essence',
    'valor_medals',
  ],
  user_weapons: ['discord_id', 'weapon_id', 'weapon_roster_id', 'curr_atk', 'crit', 'native_sockets', 'opposite_sockets'],
  user_armors: ['discord_id', 'armor_id', 'armor_roster_id', 'curr_hp', 'curr_def', 'native_sockets', 'opposite_sockets'],
  user_runes: ['discord_id', 'rune_uid', 'rune_id', 'socketed_into', 'is_locked', 'rolled_value'],
  deity_roster: ['deity_id', 'name', 'tier', 'mythology', 'base_hp', 'base_atk', 'base_def', 'blessing_name', 'blessing_description', 'is_available'],
  user_deities: ['discord_id', 'user_deity_id', 'deity_id', 'curr_atk', 'curr_hp', 'curr_def', 'enhancement'],
  active_casino_sessions: [
    'session_id',
    'discord_id',
    'game',
    'status',
    'bet_amount',
    'balance_before',
    'balance_after_debit',
    'payout',
    'balance_after',
    'channel_id',
    'message_id',
    'state_json',
    'metadata',
    'expires_at',
  ],
  active_duels: ['duel_id', 'lock_token', 'challenger_id', 'opponent_id', 'duel_type', 'stake', 'status', 'expires_at'],
  active_duel_participants: ['discord_id', 'duel_id', 'lock_token', 'role', 'expires_at'],
  daily_quests: ['id', 'discord_id', 'quest_type', 'target_count', 'current_count', 'reward_credux', 'completed', 'quest_date'],
  weekly_quests: ['id', 'discord_id', 'quest_type', 'target_count', 'current_count', 'reward_credux', 'reward_valor', 'completed', 'quest_week'],
  weekly_grand: ['discord_id', 'quest_week', 'claimed'],
  pvp_shop_purchases: ['discord_id', 'season_id', 'item_key', 'qty'],
  user_guild_activity: ['discord_id', 'guild_id', 'last_active'],
  title_catalog: ['title_id', 'code', 'display', 'source', 'is_repeatable', 'how_to', 'image_filename'],
  user_titles: ['discord_id', 'title_id'],
  boss_state: ['guild_id', 'spawn_id', 'mob_id', 'boss_level', 'max_hp', 'current_hp', 'scaled_atk', 'scaled_def', 'expires_at', 'status'],
  boss_attack_log: ['boss_spawn_id', 'discord_id', 'total_damage', 'attacked_at'],
  mob_roster: ['mob_id', 'name', 'mythology', 'mob_type', 'base_hp', 'base_atk', 'base_def', 'base_crit', 'skill_name', 'skill_description', 'special_flags'],
  raid_logs: ['discord_id', 'battle_type', 'enemy_name', 'enemy_tier', 'result', 'timestamp'],
  ranked_logs: ['player_id', 'opponent_id', 'result', 'rating_before', 'rating_after', 'timestamp'],
  ranked_reward: ['bracket', 'weekly_credux', 'weekly_payload', 'weekly_valor', 'season_end_payload', 'season_valor'],
  seasons: ['season_id', 'name', 'starts_at', 'ends_at', 'is_active'],
  auto_raids: ['discord_id', 'ends_at', 'combat_level'],
  server_config: ['guild_id', 'prefix', 'bot_channel_id', 'announcement_channel_id', 'boss_announcement_channel_id'],
  cosmetic_catalog: ['cosmetic_id', 'category', 'cosmetic_key', 'display_name', 'is_active'],
  user_cosmetics: ['discord_id', 'cosmetic_id'],
  equipped_skins: ['discord_id', 'category', 'cosmetic_id', 'override_path'],
  supporters: ['discord_id'],
  casino_logs: ['discord_id', 'game', 'bet_amount', 'result', 'payout', 'balance_before', 'balance_after'],
};

const REQUIRED_INDEXES = [
  'active_casino_sessions_one_active',
  'idx_active_casino_sessions_expiry',
  'idx_active_duels_expires_at',
  'idx_active_duel_participants_duel',
  'idx_user_guild_activity_guild_discord',
  'idx_boss_attack_spawn_damage',
  'idx_raid_logs_player_type_time_id',
  'idx_ranked_logs_player_time_id_desc',
  'idx_weekly_quests_user_week',
];

const REQUIRED_FILES = [
  'game_items.txt',
  'game_deities.txt',
  path.join('assets', 'fonts', 'DejaVuSans.ttf'),
  path.join('assets', 'fonts', 'DejaVuSans-Bold.ttf'),
  path.join('assets', 'animations', 'gacha', 'card_back.png'),
  path.join('assets', 'animations', 'gacha', 'card_remnant.png'),
  path.join('assets', 'animations', 'gacha', 'card_awakened.png'),
  path.join('assets', 'animations', 'gacha', 'card_undying.png'),
  path.join('assets', 'animations', 'gacha', 'card_primordial.png'),
  path.join('assets', 'profile', 'default_template.png'),
  path.join('assets', 'items', 'combat_exp.png'),
  path.join('assets', 'items', 'credux_coin.png'),
  path.join('assets', 'items', 'runes', 'rune_icon.png'),
  path.join('assets', 'monsters', 'boss'),
  path.join('assets', 'monsters', 'boss', 'lore', 'boss_lores.txt'),
];

const OPTIONAL_FILES = [
  path.join('assets', 'animations', 'gacha', 'card_flip.gif'),
  path.join('assets', 'animations', 'chests', 'silver_chest.gif'),
  path.join('assets', 'animations', 'chests', 'gold_chest.gif'),
  path.join('assets', 'animations', 'chests', 'supreme_chest.gif'),
  path.join('assets', 'animations', 'chests', 'sacred_relic.gif'),
];

let failures = 0;
let warnings = 0;

function print(kind, message) {
  console.log(`${kind.padEnd(4)} ${message}`);
}

function pass(message) {
  print('PASS', message);
}

function warn(message, failInProd = false) {
  if (isProdMode && failInProd) {
    fail(message);
    return;
  }
  warnings += 1;
  print('WARN', message);
}

function fail(message) {
  failures += 1;
  print('FAIL', message);
}

function hasEnv(name) {
  return String(process.env[name] || '').trim() !== '';
}

function envTrue(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function rel(filePath) {
  return filePath.split(path.sep).join('/');
}

function errorMessage(err) {
  if (!err) return 'unknown error';
  if (err.message) return err.message;
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map((inner) => inner.message || inner.code || inner.name || String(inner)).join('; ');
  }
  return err.code || err.name || String(err);
}

function checkEnvironment() {
  for (const key of REQUIRED_ENV) {
    if (hasEnv(key)) pass(`env ${key} is set`);
    else fail(`env ${key} is missing`);
  }

  if (isProdMode) {
    if (process.env.NODE_ENV === 'production') pass('NODE_ENV=production for --prod');
    else fail('NODE_ENV must be production when running --prod');
  } else if (process.env.NODE_ENV !== 'production') {
    warn('NODE_ENV is not production; run with --prod before deployment');
  } else {
    pass('NODE_ENV=production');
  }

  for (const key of DANGEROUS_FLAGS) {
    if (envTrue(key)) warn(`dangerous/dev-only flag ${key}=true`, true);
  }
}

function checkFiles() {
  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) pass(`file exists: ${rel(file)}`);
    else fail(`required file missing: ${rel(file)}`);
  }
  for (const file of OPTIONAL_FILES) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) pass(`optional file exists: ${rel(file)}`);
    else warn(`optional file missing: ${rel(file)}`);
  }
}

async function queryRows(pool, sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function checkDatabase() {
  if (!hasEnv('DATABASE_URL')) {
    fail('database checks skipped because DATABASE_URL is missing');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });

  try {
    await pool.query('SELECT 1');
    pass('database connectivity SELECT 1');

    const tableRows = await queryRows(
      pool,
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'`
    );
    const tables = new Set(tableRows.map((r) => r.table_name));
    for (const table of REQUIRED_TABLES) {
      if (tables.has(table)) pass(`table exists: ${table}`);
      else fail(`table missing: ${table} (apply the migration that creates ${table})`);
    }

    const columnRows = await queryRows(
      pool,
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'`
    );
    const columnsByTable = new Map();
    for (const row of columnRows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
      columnsByTable.get(row.table_name).add(row.column_name);
    }
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const actual = columnsByTable.get(table);
      if (!actual) continue;
      for (const column of columns) {
        if (actual.has(column)) pass(`column exists: ${table}.${column}`);
        else fail(`column missing: ${table}.${column} (check pending additive migrations)`);
      }
    }

    const indexRows = await queryRows(
      pool,
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'`
    );
    const indexes = new Set(indexRows.map((r) => r.indexname));
    for (const index of REQUIRED_INDEXES) {
      if (indexes.has(index)) pass(`index exists: ${index}`);
      else fail(`index missing: ${index} (run the matching additive index migration)`);
    }
  } catch (err) {
    fail(`database check failed: ${errorMessage(err)}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  console.log(`Credd production preflight (${isProdMode ? 'prod' : 'local/staging'})`);
  console.log('Read-only: no Discord login, no migrations, no database writes.\n');

  checkEnvironment();
  checkFiles();
  await checkDatabase();

  console.log(`\nPreflight complete: ${failures} failure(s), ${warnings} warning(s).`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL preflight crashed:', err.message);
  process.exit(1);
});

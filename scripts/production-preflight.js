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
const { REQUIRED_COLUMNS: BOOT_REQUIRED_COLUMNS } = require('../src/db/schemaGuard');

const ROOT = path.join(__dirname, '..');
const isProdMode = process.argv.includes('--prod');
const PROD_CA_PATH = path.join(ROOT, 'prod-ca-2021.crt');

const REQUIRED_ENV = ['BOT_TOKEN', 'CLIENT_ID', 'DATABASE_URL', 'DEV_IDS'];
const REQUIRED_R2_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const DANGEROUS_FLAGS = [
  'ALLOW_DESTRUCTIVE_DEV_COMMANDS',
  'ALLOW_HIGH_VALUE_DEV_COMMANDS',
  'ALLOW_SUPPORTER_DEV_COMMANDS',
  'ALLOW_LIVE_EVENT_DEV_COMMANDS',
  'BETA_MODE',
  'AVATAR_DEV_UNLOCKS',
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
  'avatar_catalog',
  'user_avatars',
  'equipped_avatars',
  'casino_logs',
  'canvas_cache',
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
    'active_echo_deity_id',
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
  deity_roster: [
    'deity_id', 'name', 'tier', 'mythology', 'base_hp', 'base_atk', 'base_def',
    'blessing_key', 'blessing_name', 'blessing_description', 'is_available',
  ],
  user_deities: [
    'discord_id', 'user_deity_id', 'deity_id', 'curr_atk', 'curr_hp', 'curr_def',
    'enhancement', 'sigils', 'ascended',
  ],
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
  active_duels: [
    'duel_id', 'lock_token', 'challenger_id', 'opponent_id', 'duel_type', 'stake',
    'status', 'message_id', 'created_at', 'expires_at',
  ],
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
  cosmetic_catalog: [
    'cosmetic_id', 'category', 'cosmetic_key', 'tier', 'display_name', 'token_cost',
    'is_base', 'has_top_label', 'display_filename', 'render_filename',
    'victory_filename', 'defeated_filename', 'is_active', 'skin_code',
  ],
  user_cosmetics: ['discord_id', 'cosmetic_id', 'source', 'acquired_at'],
  equipped_skins: ['discord_id', 'category', 'cosmetic_id', 'override_path', 'updated_at'],
  supporters: [
    'discord_id', 'tier', 'status', 'current_period_end', 'expires_at',
    'founder_number', 'founder_purchased_at', 'token_balance', 'active',
  ],
  avatar_catalog: ['avatar_id', 'avatar_key', 'display_name', 'class_name', 'gender', 'style', 'token_cost', 'asset_path', 'is_active'],
  user_avatars: ['discord_id', 'avatar_id', 'source', 'acquired_at'],
  equipped_avatars: ['discord_id', 'avatar_id', 'updated_at'],
  casino_logs: ['discord_id', 'game', 'bet_amount', 'result', 'payout', 'balance_before', 'balance_after'],
  canvas_cache: ['cache_key', 'object_key', 'url', 'last_used_at'],
};

// Keep deployment preflight aligned with the fail-fast schema guard used at boot.
for (const [table, columns] of Object.entries(BOOT_REQUIRED_COLUMNS)) {
  if (!REQUIRED_TABLES.includes(table)) REQUIRED_TABLES.push(table);
  REQUIRED_COLUMNS[table] = [
    ...new Set([...(REQUIRED_COLUMNS[table] || []), ...columns]),
  ];
}

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
  'idx_avatar_catalog_class_style_gender',
  'idx_user_avatars_user',
  'idx_equipped_avatars_avatar',
  'canvas_cache_last_used_idx',
];

const REQUIRED_LOCAL_FILES = [
  path.join('assets', 'data', 'game_items.txt'),
  path.join('assets', 'data', 'game_deities.txt'),
  path.join('assets', 'fonts', 'DejaVuSans.ttf'),
  path.join('assets', 'fonts', 'DejaVuSans-Bold.ttf'),
];

// R2 image files are required locally only when ASSET_BASE_URL is absent.
const REQUIRED_LOCAL_IMAGE_FILES = [
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

function connectionStringWithoutSslParams(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function envTrue(name) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function diskCachePathIssue(root) {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) return 'cannot be a filesystem root';
  if (pathIsWithin(resolved, ROOT)) return 'cannot be the project directory or one of its ancestors';
  if (pathIsWithin(path.join(ROOT, 'assets'), resolved)) return 'cannot be inside source assets';
  if (pathIsWithin(path.join(ROOT, '.git'), resolved)) return 'cannot be inside .git';
  return null;
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

  const configuredPgIdleTimeout = Number(process.env.PG_IDLE_TIMEOUT_MS);
  const pgIdleTimeoutMs = Number.isFinite(configuredPgIdleTimeout) && configuredPgIdleTimeout > 0
    ? Math.floor(configuredPgIdleTimeout)
    : 120_000;
  if (pgIdleTimeoutMs < 120_000) {
    warn(
      `PG_IDLE_TIMEOUT_MS=${pgIdleTimeoutMs} is below 120000 and can reconnect PostgreSQL between 60-second jobs`,
      true
    );
  } else {
    pass(`PG_IDLE_TIMEOUT_MS=${pgIdleTimeoutMs} keeps PostgreSQL connections across 60-second jobs`);
  }

  // Egress guard: without ASSET_BASE_URL every static image (chest/summon GIFs,
  // boss art, skin previews, casino spin media) is re-uploaded to Discord on
  // every command — Railway bills each upload. With it, they're served from R2
  // (free egress) by URL. Missing in production = massive egress bill.
  if (hasEnv('ASSET_BASE_URL')) {
    const base = String(process.env.ASSET_BASE_URL).trim();
    if (/^https:\/\//i.test(base)) pass('env ASSET_BASE_URL is set (static assets served from R2, zero bot egress)');
    else fail(`env ASSET_BASE_URL is not an https URL: ${base}`);
  } else {
    warn('env ASSET_BASE_URL is missing — every static image will be uploaded to Discord per command (billable egress)', true);
  }
  if (hasEnv('ASSET_VERSION')) {
    pass('env ASSET_VERSION is set (same-path R2 URLs share one cache identity)');
  } else {
    warn(
      'env ASSET_VERSION is missing - cache keys still canonicalize, but replacing an object needs explicit invalidation',
      true
    );
  }
  const diskCacheEnabled = !hasEnv('ASSET_DISK_CACHE_ENABLED') || envTrue('ASSET_DISK_CACHE_ENABLED');
  if (!diskCacheEnabled) {
    warn('ASSET_DISK_CACHE_ENABLED=false - decoded-image eviction will force repeat remote downloads', true);
  } else {
    pass('ASSET_DISK_CACHE_ENABLED=true (remote source bytes survive bounded memory eviction)');
    const diskMaxMb = Number(process.env.ASSET_DISK_CACHE_MAX_MB || 384);
    if (Number.isFinite(diskMaxMb) && diskMaxMb >= 256) {
      pass(`ASSET_DISK_CACHE_MAX_MB=${diskMaxMb} includes recommended headroom above the measured 94 MiB skin set`);
    } else {
      warn(`ASSET_DISK_CACHE_MAX_MB=${diskMaxMb} is below the recommended 256 MiB working-set target`, true);
    }
    const diskRoot = String(process.env.ASSET_DISK_CACHE_DIR || process.env.ASSET_DISK_CACHE_ROOT || '').trim();
    if (diskRoot) {
      const issue = diskCachePathIssue(diskRoot);
      if (issue) fail(`asset disk cache path ${diskRoot} is unsafe: ${issue}`);
      else pass('asset disk cache path is configured (mount it on a Railway Volume for redeploy persistence)');
    } else {
      warn('ASSET_DISK_CACHE_DIR/ROOT is blank - the default .cache/assets directory is erased on redeploy');
    }
  }
  for (const key of REQUIRED_R2_ENV) {
    if (hasEnv(key)) pass(`env ${key} is set (canvas cache can publish to R2)`);
    else warn(`env ${key} is missing - rendered canvases cannot be cached and would fall back to Discord uploads`, true);
  }
}

function checkFiles() {
  for (const file of REQUIRED_LOCAL_FILES) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) pass(`file exists: ${rel(file)}`);
    else fail(`required file missing: ${rel(file)}`);
  }

  if (hasEnv('ASSET_BASE_URL')) {
    pass('R2 asset mode enabled; remote image files are not required in the local checkout');
  } else {
    for (const file of REQUIRED_LOCAL_IMAGE_FILES) {
      const fullPath = path.join(ROOT, file);
      if (fs.existsSync(fullPath)) pass(`file exists: ${rel(file)}`);
      else fail(`required local image missing: ${rel(file)}`);
    }
    for (const file of OPTIONAL_FILES) {
      const fullPath = path.join(ROOT, file);
      if (fs.existsSync(fullPath)) pass(`optional file exists: ${rel(file)}`);
      else warn(`optional file missing: ${rel(file)}`);
    }
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
    connectionString: connectionStringWithoutSslParams(process.env.DATABASE_URL),
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(PROD_CA_PATH).toString(),
    },
  });

  try {
    await pool.query('SELECT 1');
    pass('database connectivity SELECT 1');

    const sslRows = await queryRows(
      pool,
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
    );
    if (sslRows.length > 0 && sslRows[0].ssl === true) {
      pass('database connection uses TLS');
    } else {
      warn('database connection is NOT using TLS (check DATABASE_URL and prod-ca-2021.crt)', true);
    }

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

if (require.main === module) {
  main().catch((err) => {
    console.error('FAIL preflight crashed:', err.message);
    process.exit(1);
  });
}

module.exports = { REQUIRED_COLUMNS, REQUIRED_TABLES };

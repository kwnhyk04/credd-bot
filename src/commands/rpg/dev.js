'use strict';

const fs = require('fs');
const path = require('path');

/**
 * `crd dev <subcommand>` — superuser test-enabler suite (Master §2, §26).
 *
 * The dev-id gate lives in commandHandler (mw 'dev'): non-devs never reach this
 * module (silent ignore). Every action writes one dev_logs row. All mutations
 * are parameterized; whitelisted column identifiers come only from the constant
 * maps below (never raw user input). Each mutation + its dev_logs insert share
 * one transaction (resetplayer is a single atomic wipe).
 */

const pool = require('../../db/pool');
const { computeWeaponStats, computeArmorStats } = require('../../engine/enhancement');
const { computeSigilStats } = require('../../config/ascension');
const { resolveBattle, rngOf } = require('../../engine/battleEngine');
const {
  buildPlayerFighter, buildMobFighter, fetchMobByName, fetchRandomMob, rollMobLevel,
} = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { resolveSkin } = require('../../engine/skinResolver');
const { spawnBoss, refreshLiveMessage } = require('../../engine/bossSystem');
const questsCmd = require('../economy/quests');
const dailyCmd = require('../economy/daily');
const ent = require('../../engine/supporterEntitlements');
const { grantTokens } = require('../../engine/supporterTokens');
const seasonEngine = require('../../engine/seasonEngine');
const { grantTitle } = require('../../utils/titleGrant');
const { buildShopPage } = require('../../engine/skinShopViews');
const { DIRS, SKINS_DIR } = require('../../config/cosmetics');

const INT_MAX = 2147483647; // INTEGER column ceiling (shards/chests/relics)
const MENTION_RE = /^<@!?\d+>$/;
const DISCORD_ID_RE = /^\d{5,20}$/;
const RESET_ALL_CONFIRM = 'confirm:RESET_ALL_GEAR';
const DESTRUCTIVE_PRODUCTION_MESSAGE = 'This destructive dev command is disabled in production.';
const DESTRUCTIVE_SUBCOMMANDS = new Set(['resetplayer', 'resetweapons']);
const SUPPORTER_MONTH_DAYS = 31;

// type alias → users_bag column (accepts open-cmd aliases too).
const CHEST_COLUMNS = {
  silver: 'silver_chest', gold: 'gold_chest', boss_treasure: 'boss_treasure_chest',
  boss_golden: 'boss_golden_chest', supreme: 'supreme_chest',
  sc: 'silver_chest', gc: 'gold_chest', btc: 'boss_treasure_chest',
  bgtc: 'boss_golden_chest', supc: 'supreme_chest',
};
const RELIC_COLUMNS = { sacred: 'sacred_relics', supreme: 'supreme_relics' };
// [v5 Phase 2] essence tier → users_bag column; rune-bag alias → users_bag column.
const ESSENCE_COLUMNS = {
  epic: 'epic_essence', mythic: 'mythic_essence',
  legendary: 'legendary_essence', supreme: 'supreme_essence',
};
const RUNE_BAG_COLUMNS = {
  lesser: 'lesser_rune_bag', greater: 'greater_rune_bag', divine: 'divine_rune_bag',
  lb: 'lesser_rune_bag', gb: 'greater_rune_bag', db: 'divine_rune_bag',
};

// Per-player tables wiped by resetplayer (immutable *_logs are preserved).
// Snapshot order = read order; DELETE order is FK-safe (children before users).
const SNAPSHOT_TABLES = [
  'users', 'users_bag', 'user_character', 'user_weapons', 'user_armors', 'user_deities',
  'pity_counters', 'daily_quests', 'user_guild_activity', 'active_battles', 'boss_attack_log',
];
const DELETE_ORDER = [
  'user_character', 'user_weapons', 'user_armors', 'user_deities', 'users_bag', 'pity_counters',
  'daily_quests', 'user_guild_activity', 'active_battles', 'boss_attack_log', 'users',
];

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

function nonMentionArgs(args) {
  return args.slice(1).filter(a => !MENTION_RE.test(a));
}

function argsWithoutConfirm(args) {
  return args.filter(a => !String(a).startsWith('confirm:'));
}

function destructiveCommandsAllowed() {
  return process.env.ALLOW_DESTRUCTIVE_DEV_COMMANDS === 'true';
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function destructiveProductionDenied() {
  return isProduction();
}

function hasExactToken(args, token) {
  return args.includes(token);
}

function destructiveGuardMessage(args, token, usage, { requireAllow = false } = {}) {
  if (destructiveProductionDenied()) {
    return DESTRUCTIVE_PRODUCTION_MESSAGE;
  }
  if (requireAllow && !destructiveCommandsAllowed()) {
    return 'This all-user wipe requires `ALLOW_DESTRUCTIVE_DEV_COMMANDS=true` and the exact confirmation token.';
  }
  if (!hasExactToken(args, token)) {
    return `Confirmation required. Use: \`${usage}\``;
  }
  return null;
}

function productionConfirmationMessage(args, token, usage) {
  if (!isProduction()) return null;
  if (!hasExactToken(args, token)) {
    return `Production confirmation required. Use: \`${usage}\``;
  }
  return null;
}

function highValueGuardMessage(args, token, usage) {
  return productionConfirmationMessage(args, token, usage);
}

function supporterDevGuardMessage(args, token, usage) {
  return productionConfirmationMessage(args, token, usage);
}

function liveEventGuardMessage(args, token, usage) {
  return productionConfirmationMessage(args, token, usage);
}

function authAccessGuardMessage(args, token, usage) {
  if (!isProduction()) return null;
  if (!hasExactToken(args, token)) {
    return `Production confirmation required. Use: \`${usage}\``;
  }
  return null;
}

function parseAmount(raw) {
  if (!/^\d+$/.test(raw || '')) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseDiscordId(raw) {
  const s = String(raw || '').trim();
  const mention = /^<@!?(\d+)>$/.exec(s);
  const id = mention ? mention[1] : s;
  return DISCORD_ID_RE.test(id) ? id : null;
}

function parseSupporterMonths(raw) {
  if (raw == null || raw === '') return 1;
  const months = parseAmount(raw);
  if (months == null || months > 120) return null;
  return months;
}

function addManualSupporterMonths(existing, months) {
  const now = Date.now();
  const candidates = [existing?.chosen_expires_at, existing?.current_period_end]
    .map((value) => value ? new Date(value).getTime() : NaN)
    .filter((time) => Number.isFinite(time) && time > now);
  const base = Math.max(now, ...candidates);
  return new Date(base + months * SUPPORTER_MONTH_DAYS * 24 * 60 * 60 * 1000);
}

// Accepts "+5" or "5"; valid display level 0..10.
function parseLevel(raw) {
  const m = /^\+?(\d{1,2})$/.exec(raw || '');
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 0 || n > 10) return null;
  return n;
}

async function logDev(client, devId, actionType, targetId, detail, snapshot = null) {
  await client.query(
    `INSERT INTO dev_logs (dev_id, action_type, target_discord_id, amount_or_detail, pre_reset_snapshot)
     VALUES ($1, $2, $3, $4, $5)`,
    [devId, actionType, targetId, detail ?? null, snapshot == null ? null : JSON.stringify(snapshot)]
  );
}

// ── crd dev givecredux @user <amount> ──────────────────────────────────────
async function giveCredux(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev givecredux @user <amount>`');
  const amount = parseAmount(nonMentionArgs(args)[0]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  const token = `confirm:${target.id}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev givecredux @user ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 RETURNING credux',
      [target.id, amount]
    );
    const bal = upd.rows[0].credux;
    await logDev(client, devId, 'give_credux', target.id, `+${amount} credux (→ ${bal})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount.toLocaleString()}** Credux to <@${target.id}>. Balance: ${Number(bal).toLocaleString()}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev givecredux]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev givebeliefshards @user <amount> ────────────────────────────────
async function giveBeliefShards(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev givebeliefshards @user <amount>`');
  const amount = parseAmount(nonMentionArgs(args)[0]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');
  const token = `confirm:${target.id}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev givebeliefshards @user ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      'UPDATE users_bag SET belief_shards = belief_shards + $2 WHERE discord_id = $1 RETURNING belief_shards',
      [target.id, amount]
    );
    const bal = upd.rows[0].belief_shards;
    await logDev(client, devId, 'give_beliefshards', target.id, `+${amount} belief_shards (→ ${bal})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount.toLocaleString()}** Belief Shards to <@${target.id}>. Balance: ${Number(bal).toLocaleString()}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev givebeliefshards]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev givechest @user <type> <amount> ────────────────────────────────
async function giveChest(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev givechest @user <silver|gold|boss_treasure|boss_golden|supreme> <amount>`');
  const rest = nonMentionArgs(args);
  const type = (rest[0] || '').toLowerCase();
  const col = CHEST_COLUMNS[type];
  if (!col) return reply(message, 'Type must be one of: silver, gold, boss_treasure, boss_golden, supreme (or sc/gc/btc/bgtc/supc).');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');
  const token = `confirm:${target.id}:${type}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev givechest @user ${type} ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      `UPDATE users_bag SET ${col} = ${col} + $2 WHERE discord_id = $1 RETURNING ${col} AS cnt`,
      [target.id, amount]
    );
    const cnt = upd.rows[0].cnt;
    await logDev(client, devId, 'give_chest', target.id, `+${amount} ${col} (→ ${cnt})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount}× ${col}** to <@${target.id}>. Now: ${cnt}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev givechest]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev giverelic @user <type> <amount> ────────────────────────────────
async function giveRelic(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev giverelic @user <sacred|supreme> <amount>`');
  const rest = nonMentionArgs(args);
  const type = (rest[0] || '').toLowerCase();
  const col = RELIC_COLUMNS[type];
  if (!col) return reply(message, 'Type must be: sacred or supreme.');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');
  const token = `confirm:${target.id}:${type}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev giverelic @user ${type} ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      `UPDATE users_bag SET ${col} = ${col} + $2 WHERE discord_id = $1 RETURNING ${col} AS cnt`,
      [target.id, amount]
    );
    const cnt = upd.rows[0].cnt;
    await logDev(client, devId, 'give_relic', target.id, `+${amount} ${col} (→ ${cnt})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount}× ${col}** to <@${target.id}>. Now: ${cnt}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev giverelic]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev giveessence @user <tier> <count> ───────────────────────────────
async function giveEssence(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev giveessence @user <epic|mythic|legendary|supreme> <count>`');
  const rest = nonMentionArgs(args);
  const type = (rest[0] || '').toLowerCase();
  const col = ESSENCE_COLUMNS[type];
  if (!col) return reply(message, 'Tier must be: epic, mythic, legendary, or supreme.');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Count must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Count is too large.');
  const token = `confirm:${target.id}:${type}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev giveessence @user ${type} ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      `UPDATE users_bag SET ${col} = ${col} + $2 WHERE discord_id = $1 RETURNING ${col} AS cnt`,
      [target.id, amount]
    );
    const cnt = upd.rows[0].cnt;
    await logDev(client, devId, 'give_essence', target.id, `+${amount} ${col} (→ ${cnt})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount}× ${col}** to <@${target.id}>. Now: ${cnt}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev giveessence]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev givebag @user <lesser|greater|divine> <count> ──────────────────
async function giveBag(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev givebag @user <lesser|greater|divine> <count>`');
  const rest = nonMentionArgs(args);
  const type = (rest[0] || '').toLowerCase();
  const col = RUNE_BAG_COLUMNS[type];
  if (!col) return reply(message, 'Type must be: lesser, greater, or divine (or lb/gb/db).');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Count must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Count is too large.');
  const token = `confirm:${target.id}:${type}:${amount}`;
  const guard = highValueGuardMessage(args, token, `crd dev givebag @user ${type} ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT 1 FROM users_bag WHERE discord_id = $1 FOR UPDATE', [target.id]);
    if (bag.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user has no bag (are they registered?).'); }
    const upd = await client.query(
      `UPDATE users_bag SET ${col} = ${col} + $2 WHERE discord_id = $1 RETURNING ${col} AS cnt`,
      [target.id, amount]
    );
    const cnt = upd.rows[0].cnt;
    await logDev(client, devId, 'give_bag', target.id, `+${amount} ${col} (→ ${cnt})`);
    await client.query('COMMIT');
    return reply(message, `✅ Gave **${amount}× ${col}** to <@${target.id}>. Now: ${cnt}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev givebag]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev ban|unban @user ────────────────────────────────────────────────
async function setBan(message, args, devId, banned) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, `Usage: \`crd dev ${banned ? 'ban' : 'unban'} @user\``);
  const token = `confirm:${target.id}`;
  const guard = authAccessGuardMessage(args, token, `crd dev ${banned ? 'ban' : 'unban'} @user ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      'UPDATE users SET is_banned = $2 WHERE discord_id = $1 RETURNING discord_id',
      [target.id, banned]
    );
    if (upd.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'That user is not registered.'); }
    await logDev(client, devId, banned ? 'ban' : 'unban', target.id, banned ? 'is_banned = TRUE' : 'is_banned = FALSE');
    await client.query('COMMIT');
    return reply(message, `✅ <@${target.id}> is now **${banned ? 'banned' : 'unbanned'}**.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev ban]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev resetplayer @user confirm:<discord_id> ─────────────────────────
async function resetPlayer(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev resetplayer @user confirm:<target_discord_id>`');
  const usage = `crd dev resetplayer @user confirm:${target.id}`;
  const guard = destructiveGuardMessage(args, `confirm:${target.id}`, usage);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Snapshot every per-player row first (pre_reset_snapshot recovery copy).
    const snapshot = {};
    for (const table of SNAPSHOT_TABLES) {
      const res = await client.query(`SELECT * FROM ${table} WHERE discord_id = $1`, [target.id]);
      snapshot[table] = res.rows;
    }
    if (snapshot.users.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'That user is not registered — nothing to reset.');
    }

    // Wipe in FK-safe order (children → users). Immutable *_logs are preserved.
    let totalDeleted = 0;
    for (const table of DELETE_ORDER) {
      const del = await client.query(`DELETE FROM ${table} WHERE discord_id = $1`, [target.id]);
      totalDeleted += del.rowCount;
    }

    await logDev(client, devId, 'reset', target.id, `wiped ${totalDeleted} rows across ${DELETE_ORDER.length} tables`, snapshot);
    await client.query('COMMIT');
    return reply(message, `✅ Reset <@${target.id}> — wiped **${totalDeleted}** rows. Pre-reset snapshot saved to dev_logs.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev resetplayer]', err.message);
    return reply(message, 'Failed — nothing was wiped.');
  } finally {
    client.release();
  }
}

// ── crd dev resetweapons [@user] confirm:<discord_id> ──────────────────────
// [v5] Zero the target's gear/loadout: null gear equip slots and secondary/echo
// deity loadout slots, then DELETE all user_weapons AND user_armors rows. Leaves
// deity ownership, essence, currency, chests, level, quests, runes UNTOUCHED.
// Defaults to self. Bare zero — NO starter re-grant (post-Phase-1 cleanup of
// pre-v5 / shield / test gear). Logged with a pre-wipe count snapshot.
async function resetWeapons(message, args, devId) {
  // `crd dev resetweapons all` — wipe EVERY registered user's weapons + armors.
  if ((args[1] || '').toLowerCase() === 'all') return resetAllWeapons(message, args, devId);
  const target = message.mentions.users.first() || { id: devId };
  const usage = `crd dev resetweapons ${target.id === devId ? '' : '@user '}confirm:${target.id}`.replace('  ', ' ');
  const guard = destructiveGuardMessage(args, `confirm:${target.id}`, usage);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wc = await client.query('SELECT count(*)::int AS n FROM user_weapons WHERE discord_id = $1', [target.id]);
    const ac = await client.query('SELECT count(*)::int AS n FROM user_armors WHERE discord_id = $1', [target.id]);
    const weapons = wc.rows[0].n;
    const armors = ac.rows[0].n;

    // Null equips first (FK-safe for equipped_weapon_id), then delete both gear tables.
    await client.query(
      `UPDATE user_character SET equipped_weapon_id = NULL, equipped_armor_id = NULL,
              active_deity_id_2 = NULL, active_deity_id_3 = NULL, active_echo_deity_id = NULL
       WHERE discord_id = $1`,
      [target.id]
    );
    await client.query('UPDATE user_runes SET socketed_into = NULL WHERE discord_id = $1 AND socketed_into IS NOT NULL', [target.id]);
    await client.query('DELETE FROM user_weapons WHERE discord_id = $1', [target.id]);
    await client.query('DELETE FROM user_armors WHERE discord_id = $1', [target.id]);

    await logDev(client, devId, 'reset_weapons', target.id,
      `wiped ${weapons} weapons + ${armors} armors (gear-only)`, { weapons, armors });
    await client.query('COMMIT');
    return reply(message,
      `✅ Reset gear for <@${target.id}> — removed **${weapons}** weapons + **${armors}** armors. ` +
      'Socketed runes returned to bags; gear and secondary/echo deity loadout slots cleared. ' +
      'Deity ownership, currency, chests, level, quests untouched. No starter re-granted.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev resetweapons]', err.message);
    return reply(message, 'Failed — nothing was wiped.');
  } finally {
    client.release();
  }
}

// ── crd dev resetweapons all confirm:RESET_ALL_GEAR — server-wide gear wipe ─
async function resetAllWeapons(message, args, devId) {
  const usage = `crd dev resetweapons all ${RESET_ALL_CONFIRM}`;
  const guard = destructiveGuardMessage(args, RESET_ALL_CONFIRM, usage, { requireAllow: true });
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wc = await client.query('SELECT count(*)::int AS n FROM user_weapons');
    const ac = await client.query('SELECT count(*)::int AS n FROM user_armors');
    const weapons = wc.rows[0].n;
    const armors = ac.rows[0].n;
    await client.query('UPDATE user_character SET equipped_weapon_id = NULL, equipped_armor_id = NULL, active_deity_id_2 = NULL, active_deity_id_3 = NULL, active_echo_deity_id = NULL');
    await client.query('UPDATE user_runes SET socketed_into = NULL WHERE socketed_into IS NOT NULL');
    await client.query('DELETE FROM user_weapons');
    await client.query('DELETE FROM user_armors');
    await logDev(client, devId, 'reset_weapons', devId,
      `ALL users: wiped ${weapons} weapons + ${armors} armors`, { weapons, armors, scope: 'all' });
    await client.query('COMMIT');
    return reply(message,
      `✅ Reset gear for **ALL** registered users — removed **${weapons}** weapons + **${armors}** armors. ` +
      'Socketed runes returned to bags; gear and secondary/echo deity loadout slots cleared. ' +
      'Deity ownership, currency, chests, runes untouched.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev resetweapons all]', err.message);
    return reply(message, 'Failed — nothing was wiped.');
  } finally {
    client.release();
  }
}

// ── crd dev believerlevel @user <level> ───────────────────────────────────
async function setBelieverLevel(message, args, devId) {
  const target = message.mentions.users.first() || { id: devId };
  const cleanArgs = argsWithoutConfirm(args);
  const level = parseInt(cleanArgs[cleanArgs.length - 1], 10);
  if (isNaN(level) || level < 0) {
    return reply(message, 'Usage: `crd dev believerlevel [@user] <level>`');
  }
  const token = `confirm:${target.id}:${level}`;
  const guard = highValueGuardMessage(args, token, `crd dev believerlevel ${target.id === devId ? '' : '@user '}${level} ${token}`.replace('  ', ' '));
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE user_character SET believer_level = $1 WHERE discord_id = $2',
      [level, target.id]
    );
    await logDev(client, devId, 'believer_level', target.id, `believer_level → ${level}`);
    await client.query('COMMIT');
    return reply(message, `✅ Set <@${target.id}>'s Believer Level to **${level}**.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev believerlevel]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev season <start|end|rollover|info> ──────────────────────────────
async function devSeason(message, args, devId) {
  const sub = (args[1] || 'info').toLowerCase();
  const cleanArgs = argsWithoutConfirm(args);
  try {
    if (sub === 'start') {
      const guard = liveEventGuardMessage(args, 'confirm:SEASON_START', 'crd dev season start confirm:SEASON_START');
      if (guard) return reply(message, guard);
      const name = cleanArgs.slice(2).join(' ').trim() || null;
      const s = await seasonEngine.startSeason(pool, name);
      await logDev(pool, devId, 'season_start', devId, `season_id=${s.season_id} name=${s.name}`).catch(() => {});
      return reply(message, `✅ Started **${s.name}** (id ${s.season_id}), ends ${new Date(s.ends_at).toISOString().slice(0, 10)}.`);
    }
    if (sub === 'end') {
      const guard = liveEventGuardMessage(args, 'confirm:SEASON_END', 'crd dev season end confirm:SEASON_END');
      if (guard) return reply(message, guard);
      const s = await seasonEngine.endSeasonNow(pool);
      if (s) await logDev(pool, devId, 'season_end', devId, `season_id=${s.season_id} ends_at=NOW()`).catch(() => {});
      return reply(message, s ? `✅ Season ${s.season_id} set to end now. Run \`crd dev season rollover\`.` : 'No active season.');
    }
    if (sub === 'rollover') {
      const guard = liveEventGuardMessage(args, 'confirm:SEASON_ROLLOVER', 'crd dev season rollover confirm:SEASON_ROLLOVER');
      if (guard) return reply(message, guard);
      const r = await seasonEngine.rolloverIfDue(pool, { force: true });
      if (r.rolled) {
        await logDev(pool, devId, 'season_rollover', devId,
          `ended=${r.endedSeason} paid=${r.paid}`).catch(() => {});
      }
      return reply(message, r.rolled
        ? `✅ Rolled season ${r.endedSeason}. Paid **${r.paid}** players and closed ranked season. Use \`crd dev season start\` to open the next season.`
        : 'No active season to roll.');
    }
    const s = await seasonEngine.activeSeason(pool);
    return reply(message, s
      ? `📅 **${s.name}** (id ${s.season_id}) — ends ${new Date(s.ends_at).toISOString().slice(0, 10)}.`
      : 'No active season. `crd dev season start`.');
  } catch (err) {
    console.error('[dev season]', err.message);
    return reply(message, `Season command failed: ${err.message}`);
  }
}

// ── crd dev granttitle <code> [@user] ─────────────────────────────────────
async function devGrantTitle(message, args, devId) {
  const target = message.mentions.users.first() || { id: devId };
  const cleanArgs = argsWithoutConfirm(args);
  const code = (cleanArgs[1] || '').trim();
  if (!code) return reply(message, 'Usage: `crd dev granttitle <code> [@user]`');
  const token = `confirm:${target.id}:${code}`;
  const guard = highValueGuardMessage(args, token, `crd dev granttitle ${code} ${target.id === devId ? '' : '@user '}${token}`.replace('  ', ' '));
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ok = await grantTitle(client, target.id, code);
    await logDev(client, devId, 'grant_title', target.id, `${code} (${ok ? 'granted' : 'no-op'})`);
    await client.query('COMMIT');
    return reply(message, ok ? `✅ Granted title \`${code}\` to <@${target.id}>.` : `<@${target.id}> already has \`${code}\` (or code unknown).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev granttitle]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev setrating @user <rating> ──────────────────────────────────────
async function setRating(message, args, devId) {
  const target = message.mentions.users.first() || { id: devId };
  const cleanArgs = argsWithoutConfirm(args);
  const rating = parseInt(cleanArgs[cleanArgs.length - 1], 10);
  if (isNaN(rating) || rating < 0) {
    return reply(message, 'Usage: `crd dev setrating [@user] <rating>`');
  }
  const token = `confirm:${target.id}:${rating}`;
  const guard = highValueGuardMessage(args, token, `crd dev setrating ${target.id === devId ? '' : '@user '}${rating} ${token}`.replace('  ', ' '));
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE user_character SET pvp_rating = $1, pvp_peak = GREATEST(pvp_peak, $1) WHERE discord_id = $2',
      [rating, target.id]
    );
    await logDev(client, devId, 'set_rating', target.id, `pvp_rating → ${rating}`);
    await client.query('COMMIT');
    return reply(message, `✅ Set <@${target.id}>'s PvP Rating to **${rating}**.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev setrating]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev enhanceequipment <equipment_id> <+level> ───────────────────────
// [v5] id-detect weapon vs armor: weapon scales ATK, armor scales HP/DEF.
async function enhanceEquipment(message, args, devId) {
  const cleanArgs = argsWithoutConfirm(args);
  const gearId = (cleanArgs[1] || '').trim().toLowerCase();
  const level = parseLevel(cleanArgs[2]);
  if (!gearId || level == null) return reply(message, 'Usage: `crd dev enhanceequipment <equipment_id> <+0..+10>`');
  const token = `confirm:${gearId}:${level}`;
  const guard = highValueGuardMessage(args, token, `crd dev enhanceequipment ${gearId} +${level} ${token}`);
  if (guard) return reply(message, guard);

  const stored = level + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query(
      'SELECT discord_id, base_atk FROM user_weapons WHERE weapon_id = $1 FOR UPDATE',
      [gearId]
    );
    if (wRes.rows.length > 0) {
      const w = wRes.rows[0];
      const stats = computeWeaponStats(w, stored); // ATK only
      await client.query(
        'UPDATE user_weapons SET enhancement = $2, curr_atk = $3 WHERE weapon_id = $1',
        [gearId, stored, stats.curr_atk]
      );
      await logDev(client, devId, 'enhance_equipment', w.discord_id, `weapon ${gearId} → +${level}`);
      await client.query('COMMIT');
      return reply(message, `✅ Weapon \`${gearId}\` set to **+${level}** — ATK ${stats.curr_atk}.`);
    }

    const aRes = await client.query(
      'SELECT discord_id, base_hp, base_def FROM user_armors WHERE armor_id = $1 FOR UPDATE',
      [gearId]
    );
    if (aRes.rows.length > 0) {
      const a = aRes.rows[0];
      const stats = computeArmorStats(a, stored); // HP + DEF
      await client.query(
        'UPDATE user_armors SET enhancement = $2, curr_hp = $3, curr_def = $4 WHERE armor_id = $1',
        [gearId, stored, stats.curr_hp, stats.curr_def]
      );
      await logDev(client, devId, 'enhance_equipment', a.discord_id, `armor ${gearId} → +${level}`);
      await client.query('COMMIT');
      return reply(message, `✅ Armor \`${gearId}\` set to **+${level}** — HP ${stats.curr_hp} · DEF ${stats.curr_def}.`);
    }

    await client.query('ROLLBACK');
    return reply(message, 'No equipment exists with that ID.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev enhanceequipment]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev enhancedeity @user <deity name> <+sigils> [ascend] ──────────────
// [Ascension §3.5] Repurposed: sets the Sigil count (0–10) and, with the
// trailing `ascend` keyword, the ascended flag. Stats are computed at read
// time — no curr_* writes.
async function enhanceDeity(message, args, devId) {
  const target = message.mentions.users.first();
  let rest = nonMentionArgs(argsWithoutConfirm(args));
  const wantAscend = rest[rest.length - 1]?.toLowerCase() === 'ascend';
  if (wantAscend) rest = rest.slice(0, -1);
  const level = parseLevel(rest[rest.length - 1]);
  const name = rest.slice(0, -1).join(' ').trim();
  if (!target || !name || level == null) {
    return reply(message, 'Usage: `crd dev enhancedeity @user <deity name> <+0..+10 sigils> [ascend]`');
  }
  if (wantAscend && level !== 10) {
    return reply(message, 'Ascension requires 10/10 Sigils — use `+10 ascend`.');
  }
  const token = `confirm:${target.id}:${level}`;
  const guard = highValueGuardMessage(args, token, `crd dev enhancedeity @user ${name} +${level}${wantAscend ? ' ascend' : ''} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query(
      `SELECT ud.user_deity_id, dr.name, dr.tier, dr.base_atk, dr.base_hp, dr.base_def
         FROM user_deities ud
         JOIN deity_roster dr ON ud.deity_id = dr.deity_id
        WHERE ud.discord_id = $1 AND dr.name ILIKE $2
        FOR UPDATE OF ud`,
      [target.id, name]
    );
    if (dRes.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, `<@${target.id}> doesn't own a deity named "${name}".`); }
    const d = dRes.rows[0];
    await client.query(
      'UPDATE user_deities SET sigils = $2, ascended = $3 WHERE user_deity_id = $1',
      [d.user_deity_id, level, wantAscend]
    );
    const stats = computeSigilStats(d, level);
    await logDev(client, devId, 'enhance_deity', target.id, `${d.name} → ${level}/10 sigils${wantAscend ? ' (ascended)' : ''}`);
    await client.query('COMMIT');
    return reply(message, `✅ **${d.name}** (<@${target.id}>) set to **${level}/10 Sigils**${wantAscend ? ' · **Ascended ✦**' : ''} — ATK ${stats.curr_atk} · HP ${stats.curr_hp} · DEF ${stats.curr_def}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev enhancedeity]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev battle [mob name] [seed <n>] ───────────────────────────────────
// Phase 6 live smoke test: full engine fight rendered through battleRender.
// NO rewards, NO game_logs, NO active_battles row, NO win/loss counters — the
// only write is the dev_logs entry. The seed drives mob spawn/pick/level AND
// the engine stream, so `crd dev battle seed <n>` reproduces a random battle
// exactly (and `crd dev battle <mob name> seed <n>` a named one).
async function devBattle(message, args, devId) {
  const rest = args.slice(1);
  let seed = null;
  let mobName = null;
  const seedIdx = rest.findIndex((t) => t.toLowerCase() === 'seed');
  if (seedIdx !== -1) {
    const n = Number(rest[seedIdx + 1]);
    if (!Number.isInteger(n) || n < 0) {
      return reply(message, 'Usage: `crd dev battle [mob name] [seed <n>]` — seed must be a non-negative integer.');
    }
    seed = n >>> 0;
    mobName = rest.slice(0, seedIdx).join(' ').trim() || null;
  } else {
    mobName = rest.join(' ').trim() || null;
    seed = Date.now() >>> 0;
  }

  try {
    const fighter = await buildPlayerFighter(pool, devId);
    if (!fighter) return reply(message, 'You have no character — `crd create character` first.');

    const rng = rngOf(seed); // spawn roll + pick + level come from the seed too
    let mobRow;
    if (mobName) {
      mobRow = await fetchMobByName(pool, mobName);
      if (!mobRow) return reply(message, `No mob_roster row named "${mobName}".`);
    } else {
      mobRow = await fetchRandomMob(pool, rng);
      if (!mobRow) return reply(message, 'mob_roster is empty.');
    }
    const level = rollMobLevel(fighter.level, rng);
    const mob = buildMobFighter(mobRow, level);

    const sim = resolveBattle(fighter, mob, { mode: 'raid', seed });

    await logDev(pool, devId, 'battle', devId,
      `vs ${mob.name} (${mobRow.mob_type} Lv${level}) seed=${seed} winner=${sim.winner} turns=${sim.rounds.length}`);

    await reply(message,
      `🎲 Dev battle: **${mob.name}** (${mobRow.mob_type}, Lv ${level}) — seed \`${seed}\`. No rewards granted.`);
    let battleSkinPath = null;
    let resultSkinPath = null;
    try {
      battleSkinPath = (await resolveSkin(pool, devId, 'battle')).path;
      const variant = sim.winner === 'a' ? 'victory' : 'defeated';
      resultSkinPath = (await resolveSkin(pool, devId, 'battle_result', { variant })).path;
    } catch (err) {
      console.warn('[dev battle] skin resolution:', err.message);
    }
    await runBattle(message.channel, {
      mode: 'raid', sim, battleSkinPath, resultSkinPath, ownerId: devId,
    });
  } catch (err) {
    console.error('[dev battle]', err);
    return reply(message, 'Dev battle failed — nothing was consumed.');
  }
}

// ── crd dev setbosshp <boss name> <hp> ─────────────────────────────────────
// Test-enabler: set the ACTIVE boss's shared pool HP (e.g. low, so a kill +
// reward distribution can be smoke-tested with a handful of users). Clamped
// to [1, max_hp]; the boss name must match the live boss (sanity guard).
async function setBossHp(message, args, devId) {
  const cleanArgs = argsWithoutConfirm(args);
  const rest = cleanArgs.slice(1);
  const hp = parseAmount(rest[rest.length - 1]);
  const name = rest.slice(0, -1).join(' ').trim();
  if (!name || hp == null) {
    return reply(message, 'Usage: `crd dev setbosshp <boss name> <hp>` — hp ≥ 1 (kill it with an attack).');
  }
  const guildId = message.guild.id;
  const token = `confirm:BOSS_HP:${guildId}:${hp}`;
  const guard = liveEventGuardMessage(args, token, `crd dev setbosshp ${name} ${hp} ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT bs.spawn_id, bs.max_hp, mr.name
         FROM boss_state bs
         JOIN mob_roster mr ON mr.mob_id = bs.mob_id
        WHERE bs.guild_id = $1 AND bs.status = 'active'
        FOR UPDATE OF bs`,
      [guildId]
    );
    if (res.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'No active boss in this server.');
    }
    const boss = res.rows[0];
    if (boss.name.toLowerCase() !== name.toLowerCase()) {
      await client.query('ROLLBACK');
      return reply(message, `The active boss is **${boss.name}**, not "${name}".`);
    }
    const clamped = Math.min(hp, Number(boss.max_hp));
    await client.query(
      'UPDATE boss_state SET current_hp = $3 WHERE guild_id = $1 AND spawn_id = $2',
      [guildId, boss.spawn_id, clamped]
    );
    await logDev(client, devId, 'set_boss_hp', devId, `${boss.name} current_hp → ${clamped}`);
    await client.query('COMMIT');
    await refreshLiveMessage(message.client, guildId).catch(() => {});
    return reply(message,
      `✅ **${boss.name}** HP set to **${clamped.toLocaleString()}** / ${Number(boss.max_hp).toLocaleString()}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev setbosshp]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev spawnboss [bossname] (also: crd dev spawn boss [bossname]) ──────
// Force-spawn the server boss, bypassing the 15-min respawn cooldown (smoke
// test). NEVER replaces a live boss — kill it (setbosshp + attack) first.
// An optional boss name forces that specific boss (e.g. test a Greater boss).
async function devSpawnBoss(message, args, devId, bossNameArgStart = 1) {
  const guildId = message.guild.id;
  const bossName = argsWithoutConfirm(args).slice(bossNameArgStart).join(' ').trim() || null;
  const token = `confirm:SPAWN_BOSS:${guildId}`;
  const guard = liveEventGuardMessage(args, token, `crd dev spawnboss${bossName ? ` ${bossName}` : ''} ${token}`);
  if (guard) return reply(message, guard);

  try {
    // Validate the requested boss name up front for a clear error + valid list.
    let canonicalName = null;
    if (bossName) {
      const found = await pool.query(
        `SELECT name FROM mob_roster WHERE mob_type = 'boss' AND LOWER(name) = LOWER($1)`,
        [bossName]
      );
      if (found.rows.length === 0) {
        const all = await pool.query(
          `SELECT name FROM mob_roster WHERE mob_type = 'boss' ORDER BY name`
        );
        return reply(message,
          `No boss named "${bossName}". Valid bosses: ${all.rows.map((r) => r.name).join(', ')}.`);
      }
      canonicalName = found.rows[0].name;
    }

    const active = await pool.query(
      `SELECT 1 FROM boss_state WHERE guild_id = $1 AND status = 'active'`, [guildId]
    );
    if (active.rows.length > 0) {
      return reply(message, 'A boss is already active — kill it (`crd dev setbosshp` + attack) before spawning another.');
    }
    // announce in the invoking channel when server_config has no boss/bot channel
    const ok = await spawnBoss(message.client, guildId, {
      force: true, channelId: message.channel.id, bossName: canonicalName,
    });
    if (!ok) {
      return reply(message,
        'Spawn failed — boss spawns are official-support-server-only, or no registered player has been active in this server yet (server average level is needed).');
    }
    await logDev(pool, devId, 'spawn_boss', devId,
      `forced ${canonicalName ? `${canonicalName} ` : ''}boss spawn in guild ${guildId}`);
    return reply(message,
      `✅ ${canonicalName || 'Boss'} spawned.`);
  } catch (err) {
    console.error('[dev spawnboss]', err.message);
    return reply(message, 'Failed — nothing changed.');
  }
}

// ── crd dev quest  /  crd dev quest refresh <q1|q2|q3> ─────────────────────
// Shows the dev's own quests; the refresh form bypasses the 2/day cap.
async function devQuest(message, args, devId) {
  const action = (args[1] || '').toLowerCase();
  if (action === 'refresh') {
    await logDev(pool, devId, 'quest_refresh', devId, `dev refresh ${(args[2] || '').toLowerCase()} (cap bypassed)`).catch(() => {});
    return questsCmd.handleRefresh(message, args[2], { bypassMax: true });
  }
  return questsCmd.showQuests(message);
}

// ── crd dev daily @user ────────────────────────────────────────────────────
// Grants a daily attendance claim to @user, bypassing the once-per-day lock.
async function devDaily(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev daily @user`');
  const token = `confirm:${target.id}`;
  const guard = highValueGuardMessage(args, token, `crd dev daily @user ${token}`);
  if (guard) return reply(message, guard);

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await dailyCmd.claimDaily(client, target.id, { bypass: true });
    if (result.status === 'ok') {
      await logDev(client, devId, 'daily_grant', target.id,
        `Day ${result.day}: +${result.credux} Credux, +${result.shards} shards, ${result.chestLabel} (attendance bypassed)`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev daily]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }

  if (result.status === 'missing') return reply(message, `<@${target.id}> is not registered.`);
  return reply(message,
    `✅ Daily granted to <@${target.id}> — Day ${result.day} (Month ${result.monthly}/30 · Overall ${result.overall}). ` +
    `+${result.credux.toLocaleString()} Credux · +${result.shards} Belief Shards · +1 ${result.chestLabel}. (attendance bypassed)`);
}

// ── crd dev use <profile|bskin|bresultskin|summonskin> <inc> | founderskin | skin <id> ──
// [Supporter-stage §8] Equip a skin so the next render shows it. Store skins are catalog rows
// (equipped by cosmetic_id); founder/tester sets are non-catalog folders (equipped via
// equipped_skins.override_path). Gated by the dev mw upstream.
const USE_CATEGORY = { profile: 'profile', bskin: 'battle', bresultskin: 'battle_result', summonskin: 'summon' };

const USE_USAGE = [
  'Usage:',
  '`use profile <p#>` · `use bskin <b#>` · `use bresultskin <r#>` · `use summonskin <s#>`',
  '`use founderskin` · `use skin <discord_id>` — equip a whole set via override',
  'Add a tier prefix to disambiguate, e.g. `use profile c_p1`.',
].join('\n');

async function devUse(message, args, devId) {
  const kind = (args[1] || '').toLowerCase();

  // Whole-set overrides (founder / per-user tester folder) ────────────────────
  if (kind === 'founderskin' || kind === 'skin') {
    let folder = DIRS.founder;
    let label = 'founder';
    if (kind === 'skin') {
      const folderId = (args[2] || '').replace(/[<@!>]/g, '').trim();
      if (!/^\d{5,}$/.test(folderId)) return reply(message, 'Usage: `crd dev use skin <discord_id>`');
      folder = `${DIRS.testers}/${folderId}`;
      label = `testers/${folderId}`;
    }
    const folderPath = path.join(SKINS_DIR, ...folder.split('/'));
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return reply(message, `Skin folder not found: \`assets/skins/${folder}\`.`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const cat of ['profile', 'battle', 'battle_result', 'summon']) {
        await ent.setOverrideTx(client, devId, cat, folder);
      }
      await logDev(client, devId, 'use_skin_set', devId, `override all categories → ${label}`);
      await client.query('COMMIT');
      return reply(message, `✅ Equipped **${label}** on <@${devId}> (all categories). Run a render to preview.`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[dev use set]', err.message);
      return reply(message, 'Failed — nothing changed.');
    } finally { client.release(); }
  }

  // Single store skin by increment (optionally tier-prefixed) ──────────────────
  const category = USE_CATEGORY[kind];
  if (!category) return reply(message, USE_USAGE);
  const arg = (args[2] || '').toLowerCase();
  if (!arg) return reply(message, USE_USAGE);
  const segs = arg.split('_').filter(Boolean);
  const suffix = segs[segs.length - 1];                 // <catletter><increment>, e.g. p1
  const tierLetter = segs.length > 1 ? segs[0] : null;  // optional disambiguator
  if (!/^[pbrs]\d+$/.test(suffix) || (tierLetter && !/^[bce]$/.test(tierLetter))) {
    return reply(message, USE_USAGE);
  }

  // Match the final `_p1`/`_b2` token exactly. The previous LIKE pattern depended on
  // backslash escaping and failed on some PostgreSQL string settings.
  const params = [category, suffix];
  let where = `category = $1
    AND RIGHT(LOWER(cosmetic_key), LENGTH($2) + 1) = '_' || LOWER($2)
    AND is_active = true AND is_base = false`;
  if (tierLetter) {
    params.push(tierLetter);
    where += ` AND SPLIT_PART(LOWER(cosmetic_key), '_', 1) = LOWER($3)`;
  }
  const { rows } = await pool.query(`SELECT * FROM cosmetic_catalog WHERE ${where} ORDER BY cosmetic_key`, params);
  if (rows.length === 0) return reply(message, `No ${category} skin matches \`${arg}\`.`);
  const skin = rows[0];
  const warn = rows.length > 1
    ? ` (⚠ ${rows.length} matched: ${rows.map((r) => r.cosmetic_key).join(', ')} — picked first; add a tier prefix like \`c_${suffix}\`)`
    : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ent.grantCosmeticTx(client, devId, skin.cosmetic_id, 'dev');
    await ent.equipCosmeticTx(client, devId, category, skin.cosmetic_id);
    await logDev(client, devId, 'use_skin', devId, `${category} → ${skin.cosmetic_key}`);
    await client.query('COMMIT');
    return reply(message,
      `✅ Equipped **${skin.display_name}** (\`${skin.cosmetic_key}\`)${warn}. ` +
      `Run \`crd ${category === 'profile' ? 'profile' : 'dev battle'}\` to preview.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev use]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally { client.release(); }
}

// ── crd dev givetoken @user <amount> ──
// [Supporter-stage] Grant supporter tokens for testing shop purchases. Tokens live on the
// supporters row, so the target must already be a supporter (run `crd dev sub` first). The
// shop's Buy button disables itself once a skin is owned — no separate disable needed.
async function giveToken(message, args, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev givetoken @user <amount>`');
  const amount = parseAmount(nonMentionArgs(args)[0]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');
  const token = `confirm:${target.id}:${amount}`;
  const guard = supporterDevGuardMessage(args, token, `crd dev givetoken @user ${amount} ${token}`);
  if (guard) return reply(message, guard);

  const sup = await ent.getSupporter(pool, target.id);
  if (!sup) return reply(message, 'That user has no supporter row - run `crd dev sub <discord_id> <tier> [months]` first.');
  try {
    const bal = await grantTokens(target.id, amount, 'dev_grant', `dev:${devId}`);
    await logDev(pool, devId, 'give_token', target.id, `+${amount} tokens (→ ${bal})`).catch(() => {});
    return reply(message, `✅ Gave **${amount}** supporter token${amount > 1 ? 's' : ''} to <@${target.id}>. Balance: **${bal}** 🎟️.`);
  } catch (err) {
    console.error('[dev givetoken]', err.message);
    return reply(message, 'Failed — nothing changed.');
  }
}

// ── crd dev supporter shop ──
// [addendum2 §1] Open the full paginated skin shop with subscription + tier gates bypassed
// and a DEV marker. Dev accounts already resolve as owning everything (§4).
async function devSupporterShop(message, devId) {
  const payload = await buildShopPage(pool, devId, { page: 0, ctx: 'dev' });
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

// ── crd dev buy <skin_code> ──
// [addendum2 §2] Free skin grant for testing — bypasses gates and spends no tokens.
async function devBuySkin(message, args, devId) {
  const code = (args[1] || '').toLowerCase();
  if (!code) return reply(message, 'Usage: `crd dev buy <skin_code>`');
  const skin = await ent.getCatalogByCode(pool, code);
  if (!skin) return reply(message, `No skin with code \`${code}\`.`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ent.grantCosmeticTx(client, devId, skin.cosmetic_id, 'dev');
    await logDev(client, devId, 'dev_buy', devId, `free grant ${skin.skin_code}`);
    await client.query('COMMIT');
    return reply(message, `✅ (dev) Granted **${skin.display_name}** (\`${skin.skin_code}\`) free. Equip: \`crd use skin ${skin.skin_code}\`.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev buy]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev sub [discord_id] <believer|chosen|eternal> [months] ──
// [Supporter-stage §3/§4] Simulate a subscribe/founder entitlement (the Stripe webhook has no
// host in this bot). Grants the base set + stipend; eternal also assigns a founder number.
// Manual believer/chosen grants expire after N production months (31 days each).
async function devSub(message, args, devId) {
  const usage = 'crd dev sub [discord_id] <believer|chosen|eternal> [months]';
  const cleanArgs = argsWithoutConfirm(args).slice(1);
  let targetId = devId;
  let tierIndex = 0;
  const explicitTarget = parseDiscordId(cleanArgs[0]);
  if (explicitTarget) {
    targetId = explicitTarget;
    tierIndex = 1;
  }
  const tier = (cleanArgs[tierIndex] || '').toLowerCase();
  const monthsRaw = cleanArgs[tierIndex + 1];
  const extra = cleanArgs.slice(tierIndex + 2);
  if (!['believer', 'chosen', 'eternal'].includes(tier)) {
    return reply(message, `Usage: \`${usage}\``);
  }
  if (extra.length > 0) return reply(message, `Usage: \`${usage}\``);
  const months = tier === 'eternal' ? null : parseSupporterMonths(monthsRaw);
  if (tier !== 'eternal' && months == null) {
    return reply(message, 'Months must be a positive whole number from 1 to 120.');
  }
  if (tier === 'eternal' && monthsRaw != null) {
    return reply(message, '`eternal` is permanent and does not accept a month count.');
  }
  const token = months ? `confirm:${targetId}:${tier}:${months}` : `confirm:${targetId}:${tier}`;
  const targetPart = targetId === devId ? '' : `${targetId} `;
  const monthPart = months ? ` ${months}` : '';
  const guard = supporterDevGuardMessage(args, token, `crd dev sub ${targetPart}${tier}${monthPart} ${token}`.replace('  ', ' '));
  if (guard) return reply(message, guard);
  const exists = await pool.query('SELECT 1 FROM users WHERE discord_id = $1', [targetId]);
  if (exists.rows.length === 0) return reply(message, 'That user is not registered.');
  try {
    const existing = tier === 'eternal' ? null : await ent.getSupporter(pool, targetId);
    const chosenExpiresAt = tier === 'eternal' ? null : addManualSupporterMonths(existing, months);
    const res = await ent.applySubscribe(targetId, tier, {
      founder: tier === 'eternal',
      currentPeriodEnd: chosenExpiresAt,
      chosenExpiresAt,
    });
    await logDev(pool, devId, 'sub_grant', targetId,
      `tier=${tier}${months ? ` months=${months} expires=${chosenExpiresAt.toISOString()}` : ''}` +
      `${res.founderNumber != null ? ` founder#${res.founderNumber}` : ''}`).catch(() => {});
    return reply(message,
      `✅ <@${targetId}> is now **${tier}**` +
      `${res.founderNumber != null ? ` (Founder ${String(res.founderNumber).padStart(3, '0')})` : ''}` +
      `${chosenExpiresAt ? ` until **${chosenExpiresAt.toISOString().slice(0, 10)}** (${months} month${months === 1 ? '' : 's'} x ${SUPPORTER_MONTH_DAYS} days)` : ''}` +
      (res.stipendGrant?.applied === false
        ? ' — entitlements synchronized; one-time stipend was already paid.'
        : ' — entitlements synchronized + stipend paid.'));
  } catch (err) {
    console.error('[dev sub]', err.message);
    return reply(message, 'Failed — nothing changed.');
  }
}

const USAGE = [
  '**Dev commands:**',
  '`givecredux @user <amount>` · `givebeliefshards @user <amount>`',
  '`givechest @user <type> <amount>` · `giverelic @user <sacred|supreme> <amount>`',
  '`giveessence @user <epic|mythic|legendary|supreme> <count>` · `givebag @user <lesser|greater|divine> <count>`',
  '`ban @user` · `unban @user`',
  '`resetplayer @user confirm:<id>` · `resetweapons [@user] confirm:<id>` · `resetweapons all confirm:RESET_ALL_GEAR`',
  '`enhanceequipment <equipment_id> <+level>` · `enhancedeity @user <deity name> <+sigils 0..10> [ascend]`',
  '`battle [mob name] [seed <n>]` — engine smoke test (no rewards)',
  '`setbosshp <boss name> <hp>` · `spawnboss [boss name]` — boss smoke-test enablers',
  '`quest` · `quest refresh <q1|q2|q3>` — view / refresh quests (cap bypassed)',
  '`daily @user` — grant a daily claim (attendance bypassed)',
  '`sub [discord_id] <believer|chosen|eternal> [months]` — manual supporter grant/extension (31 days/month)',
  '`givetoken @user <amount>` — grant supporter tokens for shop testing',
  '`supporter shop` — dev-bypass skin shop (all skins, gates off) · `buy <skin_code>` — free grant',
  '`use profile <p#>|bskin <b#>|bresultskin <r#>|summonskin <s#>` · `use founderskin` · `use skin <id>`',
].join('\n');

/** Dispatch — caller (commandHandler mw 'dev') has already verified superuser. */
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const devId = message.author.id;
  if (isProduction() && DESTRUCTIVE_SUBCOMMANDS.has(sub)) {
    return reply(message, DESTRUCTIVE_PRODUCTION_MESSAGE);
  }
  switch (sub) {
    case 'givecredux':       return giveCredux(message, args, devId);
    case 'givebeliefshards': return giveBeliefShards(message, args, devId);
    case 'givechest':        return giveChest(message, args, devId);
    case 'giverelic':        return giveRelic(message, args, devId);
    case 'giveessence':      return giveEssence(message, args, devId);
    case 'givebag':          return giveBag(message, args, devId);
    case 'ban':              return setBan(message, args, devId, true);
    case 'unban':            return setBan(message, args, devId, false);
    case 'resetplayer':      return resetPlayer(message, args, devId);
    case 'resetweapons':     return resetWeapons(message, args, devId);
    case 'believerlevel':    return setBelieverLevel(message, args, devId);
    case 'setrating':        return setRating(message, args, devId);
    case 'season':           return devSeason(message, args, devId);
    case 'granttitle':       return devGrantTitle(message, args, devId);
    case 'enhanceequipment': return enhanceEquipment(message, args, devId);
    case 'enhanceweapon':    return enhanceEquipment(message, args, devId); // back-compat alias
    case 'enhancedeity':     return enhanceDeity(message, args, devId);
    case 'battle':           return devBattle(message, args, devId);
    case 'setbosshp':        return setBossHp(message, args, devId);
    case 'spawnboss':        return devSpawnBoss(message, args, devId, 1);
    case 'spawn':
      if ((args[1] || '').toLowerCase() === 'boss') {
        return devSpawnBoss(message, args, devId, 2);
      }
      return reply(message, USAGE);
    case 'quest':            return devQuest(message, args, devId);
    case 'daily':            return devDaily(message, args, devId);
    case 'use':              return devUse(message, args, devId);
    case 'sub':              return devSub(message, args, devId);
    case 'givetoken':        return giveToken(message, args, devId);
    case 'supporter':
      if ((args[1] || '').toLowerCase() === 'shop') return devSupporterShop(message, devId);
      return reply(message, USAGE);
    case 'buy':              return devBuySkin(message, args, devId);
    default:                 return reply(message, USAGE);
  }
}

module.exports = { execute };

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
const { computeWeaponStats } = require('../../engine/enhancement');
const { computeDeityStats } = require('../../engine/deityEnhancement');
const { resolveBattle, rngOf } = require('../../engine/battleEngine');
const {
  buildPlayerFighter, buildMobFighter, fetchMobByName, fetchRandomMob, rollMobLevel,
} = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { resolveSkin } = require('../../engine/skinResolver');
const { spawnBoss, expireBoss, refreshLiveMessage } = require('../../engine/bossSystem');
const questsCmd = require('../economy/quests');
const dailyCmd = require('../economy/daily');
const ent = require('../../engine/supporterEntitlements');
const { grantTokens } = require('../../engine/supporterTokens');
const { buildShopPage } = require('../../engine/skinShopViews');
const { DIRS, SKINS_DIR } = require('../../config/cosmetics');

const INT_MAX = 2147483647; // INTEGER column ceiling (shards/chests/relics)
const MENTION_RE = /^<@!?\d+>$/;

// type alias → users_bag column (accepts open-cmd aliases too).
const CHEST_COLUMNS = {
  silver: 'silver_chest', gold: 'gold_chest', boss_treasure: 'boss_treasure_chest',
  boss_golden: 'boss_golden_chest', supreme: 'supreme_chest',
  sc: 'silver_chest', gc: 'gold_chest', btc: 'boss_treasure_chest',
  bgtc: 'boss_golden_chest', supc: 'supreme_chest',
};
const RELIC_COLUMNS = { sacred: 'sacred_relics', supreme: 'supreme_relics' };

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

function parseAmount(raw) {
  if (!/^\d+$/.test(raw || '')) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
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
  const col = CHEST_COLUMNS[(rest[0] || '').toLowerCase()];
  if (!col) return reply(message, 'Type must be one of: silver, gold, boss_treasure, boss_golden, supreme (or sc/gc/btc/bgtc/supc).');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');

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
  const col = RELIC_COLUMNS[(rest[0] || '').toLowerCase()];
  if (!col) return reply(message, 'Type must be: sacred or supreme.');
  const amount = parseAmount(rest[1]);
  if (amount == null) return reply(message, 'Amount must be a positive whole number.');
  if (amount > INT_MAX) return reply(message, 'Amount is too large.');

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

// ── crd dev ban|unban @user ────────────────────────────────────────────────
async function setBan(message, devId, banned) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, `Usage: \`crd dev ${banned ? 'ban' : 'unban'} @user\``);

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

// ── crd dev resetplayer @user ──────────────────────────────────────────────
async function resetPlayer(message, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev resetplayer @user`');

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

// ── crd dev resetweapons [@user] ───────────────────────────────────────────
// [v5] Zero the target's GEAR ONLY: null both equip slots, then DELETE all
// user_weapons AND user_armors rows. Leaves deities, essence, currency, chests,
// level, quests, runes UNTOUCHED. Defaults to self. Bare zero — NO starter
// re-grant (post-Phase-1 cleanup of pre-v5 / shield / test gear). Logged with a
// pre-wipe count snapshot.
async function resetWeapons(message, devId) {
  const target = message.mentions.users.first() || { id: devId };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wc = await client.query('SELECT count(*)::int AS n FROM user_weapons WHERE discord_id = $1', [target.id]);
    const ac = await client.query('SELECT count(*)::int AS n FROM user_armors WHERE discord_id = $1', [target.id]);
    const weapons = wc.rows[0].n;
    const armors = ac.rows[0].n;

    // Null equips first (FK-safe for equipped_weapon_id), then delete both gear tables.
    await client.query(
      'UPDATE user_character SET equipped_weapon_id = NULL, equipped_armor_id = NULL WHERE discord_id = $1',
      [target.id]
    );
    await client.query('DELETE FROM user_weapons WHERE discord_id = $1', [target.id]);
    await client.query('DELETE FROM user_armors WHERE discord_id = $1', [target.id]);

    await logDev(client, devId, 'reset_weapons', target.id,
      `wiped ${weapons} weapons + ${armors} armors (gear-only)`, { weapons, armors });
    await client.query('COMMIT');
    return reply(message,
      `✅ Reset gear for <@${target.id}> — removed **${weapons}** weapons + **${armors}** armors. ` +
      'Deities, currency, chests, level, quests untouched. No starter re-granted.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev resetweapons]', err.message);
    return reply(message, 'Failed — nothing was wiped.');
  } finally {
    client.release();
  }
}

// ── crd dev enhanceweapon <weapon_id> <+level> ─────────────────────────────
async function enhanceWeapon(message, args, devId) {
  const weaponId = (args[1] || '').trim().toLowerCase();
  const level = parseLevel(args[2]);
  if (!weaponId || level == null) return reply(message, 'Usage: `crd dev enhanceweapon <weapon_id> <+0..+10>`');

  const stored = level + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wRes = await client.query(
      'SELECT discord_id, base_atk FROM user_weapons WHERE weapon_id = $1 FOR UPDATE',
      [weaponId]
    );
    if (wRes.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'No weapon exists with that ID.'); }
    const w = wRes.rows[0];
    const stats = computeWeaponStats(w, stored); // [v5] ATK only
    await client.query(
      'UPDATE user_weapons SET enhancement = $2, curr_atk = $3 WHERE weapon_id = $1',
      [weaponId, stored, stats.curr_atk]
    );
    await logDev(client, devId, 'enhance_weapon', w.discord_id, `${weaponId} → +${level}`);
    await client.query('COMMIT');
    return reply(message, `✅ Weapon \`${weaponId}\` set to **+${level}** — ATK ${stats.curr_atk}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dev enhanceweapon]', err.message);
    return reply(message, 'Failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd dev enhancedeity @user <deity name> <+level> ───────────────────────
async function enhanceDeity(message, args, devId) {
  const target = message.mentions.users.first();
  const rest = nonMentionArgs(args);
  const level = parseLevel(rest[rest.length - 1]);
  const name = rest.slice(0, -1).join(' ').trim();
  if (!target || !name || level == null) {
    return reply(message, 'Usage: `crd dev enhancedeity @user <deity name> <+0..+10>`');
  }

  const stored = level + 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dRes = await client.query(
      `SELECT ud.user_deity_id, dr.name, dr.base_atk, dr.base_hp, dr.base_def
         FROM user_deities ud
         JOIN deity_roster dr ON ud.deity_id = dr.deity_id
        WHERE ud.discord_id = $1 AND dr.name ILIKE $2
        FOR UPDATE OF ud`,
      [target.id, name]
    );
    if (dRes.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, `<@${target.id}> doesn't own a deity named "${name}".`); }
    const d = dRes.rows[0];
    const stats = computeDeityStats(d, stored);
    await client.query(
      'UPDATE user_deities SET enhancement = $2, curr_atk = $3, curr_hp = $4, curr_def = $5 WHERE user_deity_id = $1',
      [d.user_deity_id, stored, stats.curr_atk, stats.curr_hp, stats.curr_def]
    );
    await logDev(client, devId, 'enhance_deity', target.id, `${d.name} → +${level}`);
    await client.query('COMMIT');
    return reply(message, `✅ **${d.name}** (<@${target.id}>) set to **+${level}** — ATK ${stats.curr_atk} · HP ${stats.curr_hp} · DEF ${stats.curr_def}.`);
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
      mode: 'raid', sim, battleSkinPath, resultSkinPath,
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
  const rest = args.slice(1);
  const hp = parseAmount(rest[rest.length - 1]);
  const name = rest.slice(0, -1).join(' ').trim();
  if (!name || hp == null) {
    return reply(message, 'Usage: `crd dev setbosshp <boss name> <hp>` — hp ≥ 1 (kill it with an attack).');
  }
  const guildId = message.guild.id;

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
// test). NEVER replaces a live boss — kill it (setbosshp + attack) first. An
// expired-but-unflipped boss is settled to 'escaped' before the spawn attempt.
// An optional boss name forces that specific boss (e.g. test a Greater boss).
async function devSpawnBoss(message, devId, bossName = null) {
  const guildId = message.guild.id;
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

    await expireBoss(message.client, guildId).catch(() => {}); // settle overdue escape first
    const active = await pool.query(
      `SELECT 1 FROM boss_state WHERE guild_id = $1 AND status = 'active'`, [guildId]
    );
    if (active.rows.length > 0) {
      return reply(message, 'A boss is already active — kill it (`crd dev setbosshp` + attack) or wait for it to escape.');
    }
    // announce in the invoking channel when server_config has no boss/bot channel
    const ok = await spawnBoss(message.client, guildId, {
      force: true, channelId: message.channel.id, bossName: canonicalName,
    });
    if (!ok) {
      return reply(message,
        'Spawn failed — no registered player has been active in this server yet (server average level is needed).');
    }
    await logDev(pool, devId, 'spawn_boss', devId,
      `forced ${canonicalName ? `${canonicalName} ` : ''}boss spawn in guild ${guildId}`);
    return reply(message,
      `✅ ${canonicalName || 'Boss'} spawned (15-min cooldown bypassed).`);
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
async function devDaily(message, devId) {
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd dev daily @user`');

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

  const sup = await ent.getSupporter(pool, target.id);
  if (!sup) return reply(message, 'That user has no supporter row — run `crd dev sub @user <tier>` first.');
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

// ── crd dev sub [@user] <believer|chosen|eternal> ──
// [Supporter-stage §3/§4] Simulate a subscribe/founder entitlement (the Stripe webhook has no
// host in this bot). Grants the base set + stipend; eternal also assigns a founder number.
async function devSub(message, args, devId) {
  const target = message.mentions.users.first() || { id: devId };
  const tier = (nonMentionArgs(args)[0] || '').toLowerCase();
  if (!['believer', 'chosen', 'eternal'].includes(tier)) {
    return reply(message, 'Usage: `crd dev sub [@user] <believer|chosen|eternal>`');
  }
  const exists = await pool.query('SELECT 1 FROM users WHERE discord_id = $1', [target.id]);
  if (exists.rows.length === 0) return reply(message, 'That user is not registered.');
  try {
    const res = await ent.applySubscribe(target.id, tier, { founder: tier === 'eternal' });
    await logDev(pool, devId, 'sub_grant', target.id,
      `tier=${tier}${res.founderNumber != null ? ` founder#${res.founderNumber}` : ''}`).catch(() => {});
    return reply(message,
      `✅ <@${target.id}> is now **${tier}**` +
      `${res.founderNumber != null ? ` (Founder ${String(res.founderNumber).padStart(3, '0')})` : ''}` +
      ' — base set granted + stipend paid.');
  } catch (err) {
    console.error('[dev sub]', err.message);
    return reply(message, 'Failed — nothing changed.');
  }
}

const USAGE = [
  '**Dev commands:**',
  '`givecredux @user <amount>` · `givebeliefshards @user <amount>`',
  '`givechest @user <type> <amount>` · `giverelic @user <sacred|supreme> <amount>`',
  '`ban @user` · `unban @user` · `resetplayer @user` · `resetweapons [@user]` (gear-only wipe)',
  '`enhanceweapon <weapon_id> <+level>` · `enhancedeity @user <deity name> <+level>`',
  '`battle [mob name] [seed <n>]` — engine smoke test (no rewards)',
  '`setbosshp <boss name> <hp>` · `spawnboss [boss name]` — boss smoke-test enablers',
  '`quest` · `quest refresh <q1|q2|q3>` — view / refresh quests (cap bypassed)',
  '`daily @user` — grant a daily claim (attendance bypassed)',
  '`sub [@user] <believer|chosen|eternal>` — simulate a supporter grant (base set + stipend)',
  '`givetoken @user <amount>` — grant supporter tokens for shop testing',
  '`supporter shop` — dev-bypass skin shop (all skins, gates off) · `buy <skin_code>` — free grant',
  '`use profile <p#>|bskin <b#>|bresultskin <r#>|summonskin <s#>` · `use founderskin` · `use skin <id>`',
].join('\n');

/** Dispatch — caller (commandHandler mw 'dev') has already verified superuser. */
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const devId = message.author.id;
  switch (sub) {
    case 'givecredux':       return giveCredux(message, args, devId);
    case 'givebeliefshards': return giveBeliefShards(message, args, devId);
    case 'givechest':        return giveChest(message, args, devId);
    case 'giverelic':        return giveRelic(message, args, devId);
    case 'ban':              return setBan(message, devId, true);
    case 'unban':            return setBan(message, devId, false);
    case 'resetplayer':      return resetPlayer(message, devId);
    case 'resetweapons':     return resetWeapons(message, devId);
    case 'enhanceweapon':    return enhanceWeapon(message, args, devId);
    case 'enhancedeity':     return enhanceDeity(message, args, devId);
    case 'battle':           return devBattle(message, args, devId);
    case 'setbosshp':        return setBossHp(message, args, devId);
    case 'spawnboss':        return devSpawnBoss(message, devId, args.slice(1).join(' ').trim() || null);
    case 'spawn':
      if ((args[1] || '').toLowerCase() === 'boss') {
        return devSpawnBoss(message, devId, args.slice(2).join(' ').trim() || null);
      }
      return reply(message, USAGE);
    case 'quest':            return devQuest(message, args, devId);
    case 'daily':            return devDaily(message, devId);
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

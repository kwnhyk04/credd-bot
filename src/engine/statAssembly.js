'use strict';

/**
 * STAT ASSEMBLY — Phase 6 (§35.2)
 *
 * Builds battle-ready fighter structs for battleEngine.resolveBattle:
 *   - buildPlayerFighter: user_character + equipped weapon/armor + ACTIVE deity
 *     curr_* (additive), with uncapped class + weapon CRIT under v5.
 *     CRIT is NEVER scaled by weapon or deity enhancement. The weapon's unified
 *     damage % (bonus_dmg_pct) is read straight off the row.
 *   - buildMobFighter: base + per_level × level (C1 — Master §16 formula, NOT
 *     level − 1), level clamped [1, 55]. Carries skill_key / immunity_tags /
 *     special_flags for the engine.
 *
 * The ONLY SQL in Phase 6 — read-only SELECTs, no transactions, no mutations.
 * is_available is intentionally ignored for owned rows: owned rows always fight.
 * floor() everywhere curr stats are computed (§35.2).
 *
 * This module supersedes config/classes.computeClassStats for BATTLE purposes;
 * that helper stays for display (profile) until the Phase 9 profile migration.
 */

const { CLASSES } = require('../config/classes');
const { ELITE_SPAWN_CHANCE } = require('../config/raidLoot');
const { ECHO_BLESSING_KEY_MAP, DIVINE_BLESSING_DEITIES, computeResonanceMods } = require('../config/blessings');
const { computeDeityProgressionStats } = require('./deityEnhancement');

const MOB_LEVEL_MIN = 1;
const MOB_LEVEL_MAX = 55;
const MOB_ROSTER_CACHE_TTL_MS = Math.max(0, Number(process.env.MOB_ROSTER_CACHE_TTL_MS || 300_000));
const MOB_SELECT_COLUMNS = `
  mob_id, name, mythology, mob_type, base_hp, hp_per_level, base_atk,
  atk_per_level, base_def, def_per_level, base_crit, skill_key,
  skill_name, skill_description, immunity_tags, special_flags
`;
const mobRosterCache = new Map();

const CLASS_PASSIVES = {
  Swordsman: 'bleed',
  Fighter: 'stun',
  Mage: 'overcharge',
  Knight: 'damage_reduction',
  Archer: 'pierce',
};

function cloneRows(rows) {
  return rows.map((row) => ({ ...row }));
}

function cachedMobRows(key) {
  if (MOB_ROSTER_CACHE_TTL_MS <= 0) return null;
  const hit = mobRosterCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MOB_ROSTER_CACHE_TTL_MS) {
    mobRosterCache.delete(key);
    return null;
  }
  return cloneRows(hit.rows);
}

function rememberMobRows(key, rows) {
  if (MOB_ROSTER_CACHE_TTL_MS > 0) {
    mobRosterCache.set(key, { at: Date.now(), rows: cloneRows(rows) });
  }
  return rows;
}

async function queryMobRows(db, key, sql, params = []) {
  const cached = cachedMobRows(key);
  if (cached) return cached;
  const res = await db.query(sql, params);
  return rememberMobRows(key, res.rows);
}

function clearMobRosterCache() {
  mobRosterCache.clear();
}

/**
 * Authoritative class battle stats: per-class base + scaling × (level − 1), floored.
 * v5 removes both the former 40% class clamp and 45% combined CRIT clamp.
 */
function computeClassBattleStats(className, level) {
  const cls = CLASSES[className];
  if (!cls) throw new Error(`Unknown class: ${className}`);
  const steps = Math.max(1, level) - 1;
  return {
    hp: Math.floor(cls.base.hp + cls.scaling.hp * steps),
    atk: Math.floor(cls.base.atk + cls.scaling.atk * steps),
    def: Math.floor(cls.base.def + cls.scaling.def * steps),
    crit: cls.base.crit + cls.scaling.crit * steps,
  };
}

/**
 * Pure assembly step — exported for the selftest. [v5 STAT ASSEMBLY]
 *   HP   = class + armor + deity        (weapon no longer carries HP)
 *   ATK  = class + weapon + deity       (armor carries no ATK)
 *   DEF  = class + armor + deity        (weapon no longer carries DEF)
 *   CRIT = class + weapon               (UNCAPPED — v5 removed the 40/45 ceiling)
 * NULL slots = zero contribution, never an error.
 * weapon: { curr_atk, crit } | null   armor: { curr_hp, curr_def } | null
 * deity:  { curr_atk, curr_hp, curr_def } | null  (slot 1, 100%)
 * pantheonMods (Phase 3): { slot2, slot3, resonance } — optional
 */
function assemblePlayerStats(className, level, weapon, armor, deity, runeMods = null, pantheonMods = null) {
  const cls = computeClassBattleStats(className, level);
  const wCrit = weapon ? Number(weapon.crit) || 0 : 0;
  const m = runeMods || { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 };
  const res = pantheonMods && pantheonMods.resonance ? pantheonMods.resonance : { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 };
  const baseAtk = cls.atk + (weapon ? weapon.curr_atk : 0);
  const baseHp = cls.hp + (armor ? armor.curr_hp : 0);
  const baseDef = cls.def + (armor ? armor.curr_def : 0);

  // Slot 1 deity: 100% stats flat-added after rune+resonance scaling
  let dAtk = deity ? deity.curr_atk : 0;
  let dHp = deity ? deity.curr_hp : 0;
  let dDef = deity ? deity.curr_def : 0;

  // Slots 2/3: 50% stats flat-added (Phase 3)
  if (pantheonMods) {
    const s2 = pantheonMods.slot2;
    const s3 = pantheonMods.slot3;
    if (s2) { dAtk += Math.floor(s2.curr_atk * 0.5); dHp += Math.floor(s2.curr_hp * 0.5); dDef += Math.floor(s2.curr_def * 0.5); }
    if (s3) { dAtk += Math.floor(s3.curr_atk * 0.5); dHp += Math.floor(s3.curr_hp * 0.5); dDef += Math.floor(s3.curr_def * 0.5); }
  }

  return {
    atk: Math.floor(baseAtk * (1 + (m.atkPct + res.atkPct) / 100) + dAtk),
    hp: Math.floor(baseHp * (1 + (m.hpPct + res.hpPct) / 100) + dHp),
    def: Math.floor(baseDef * (1 + (m.defPct + res.defPct) / 100) + dDef),
    crit: cls.crit + wCrit + m.critPts + res.critPts,
  };
}

// effect_key → which stat-% accumulator it feeds (the 4 stat families).
const RUNE_STAT_TARGET = { sharpness: 'atkPct', precision: 'critPts', vitality: 'hpPct', bulwark: 'defPct' };
const RUNE_EFFECT_KEYS = ['vampiric', 'piercing', 'venom', 'thorns', 'warding', 'aegis_rune'];

/** Collect rune_uids from a JSONB socket array (null-safe). */
function uidsFrom(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => s && s.rune_uid).filter(Boolean);
}

/**
 * Resolve socketed runes on the equipped weapon + armor into stat-% mods and a
 * combat-effect list. One query for all socketed uids. Returns
 * { mods:{atkPct,hpPct,defPct,critPts}, effects:[{effect_key,value}] }.
 */
async function accumulateRuneStats(db, r, ownerId = r?.discord_id) {
  const uids = [
    ...uidsFrom(r.w_native),
    ...uidsFrom(r.a_native),
  ];
  const mods = { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 };
  const effects = [];
  if (uids.length === 0 || !ownerId) return { mods, effects };

  const { rows } = await db.query(
    `SELECT effect_key, COALESCE(ur.rolled_value, rn.value) AS value
       FROM rune_roster rn
       JOIN user_runes ur ON ur.rune_id = rn.rune_id
      WHERE ur.rune_uid = ANY($1::varchar[])
        AND ur.discord_id = $2`,
    [uids, ownerId]
  );
  for (const row of rows) {
    const val = Number(row.value) || 0;
    const target = RUNE_STAT_TARGET[row.effect_key];
    if (target) mods[target] += val;
    else if (RUNE_EFFECT_KEYS.includes(row.effect_key)) effects.push({ effect_key: row.effect_key, value: val });
  }
  return { mods, effects };
}

/** Mob stats per C1: base + per_level × level (uniform for regular/elite/boss). */
function computeMobStats(row, level) {
  const lv = Math.max(MOB_LEVEL_MIN, Math.min(MOB_LEVEL_MAX, level));
  return {
    hp: Math.floor(row.base_hp + row.hp_per_level * lv),
    atk: Math.floor(row.base_atk + row.atk_per_level * lv),
    def: Math.floor(row.base_def + row.def_per_level * lv),
    crit: Number(row.base_crit) || 0,
  };
}

/** Mob level = player level + random(−2..+15), clamped [1, 55] (§35.6). */
function rollMobLevel(playerLevel, rng) {
  const offset = Math.floor(rng() * 18) - 2;
  return Math.max(MOB_LEVEL_MIN, Math.min(MOB_LEVEL_MAX, playerLevel + offset));
}

/**
 * Build the player fighter from live DB rows.
 * @param {object} db  pg pool or client (read-only SELECT)
 * @param {object} [opts]
 * @param {number|null} [opts.levelOverride]  [Jun-2026 patch §3] `crd duel @user level N` —
 *   temporarily recompute the CLASS-level stat component (base + scaling) at level N
 *   (clamped [1,50]); equipped weapon + active deity curr stats still apply as owned.
 *   Nothing is persisted — combat_level in the DB is untouched.
 * @returns fighter struct or null when the user has no character.
 */
async function buildPlayerFighter(db, discordId, { levelOverride = null } = {}) {
  const res = await db.query(
    `SELECT uc.class, uc.combat_level, u.username,
            w.curr_atk  AS w_atk, w.crit AS w_crit,
            w.bonus_dmg_pct,
            w.native_sockets AS w_native, w.opposite_sockets AS w_opposite,
            wr.name     AS weapon_name, wr.passive_key,
            am.curr_hp  AS a_hp, am.curr_def AS a_def,
            am.native_sockets AS a_native, am.opposite_sockets AS a_opposite,
            ar.name     AS armor_name, ar.passive_key AS armor_passive_key,
            ud.sigils   AS d1_sigils, ud.ascended AS d1_ascended, ud.enhancement AS d1_enhancement,
            dr.base_atk AS d1_batk, dr.base_hp AS d1_bhp, dr.base_def AS d1_bdef,
            dr.name     AS deity_name, dr.blessing_key, dr.mythology AS d1_myth,
            ud2.sigils  AS d2_sigils, ud2.ascended AS d2_ascended, ud2.enhancement AS d2_enhancement,
            dr2.base_atk AS d2_batk, dr2.base_hp AS d2_bhp, dr2.base_def AS d2_bdef,
            dr2.name     AS deity2_name, dr2.blessing_key AS blessing_key_2, dr2.mythology AS d2_myth,
            ud3.sigils  AS d3_sigils, ud3.ascended AS d3_ascended, ud3.enhancement AS d3_enhancement,
            dr3.base_atk AS d3_batk, dr3.base_hp AS d3_bhp, dr3.base_def AS d3_bdef,
            dr3.name     AS deity3_name, dr3.blessing_key AS blessing_key_3, dr3.mythology AS d3_myth,
            ude.user_deity_id AS echo_udid, ude.ascended AS echo_ascended,
            dre.name     AS echo_deity_name, dre.blessing_key AS echo_blessing_key
       FROM user_character uc
       JOIN users u            ON u.discord_id = uc.discord_id
       LEFT JOIN user_weapons w  ON w.weapon_id = uc.equipped_weapon_id
       LEFT JOIN weapon_roster wr ON wr.weapon_roster_id = w.weapon_roster_id
       LEFT JOIN user_armors am  ON am.armor_id = uc.equipped_armor_id
       LEFT JOIN armor_roster ar ON ar.armor_roster_id = am.armor_roster_id
       LEFT JOIN user_deities ud ON ud.user_deity_id = uc.active_deity_id
       LEFT JOIN deity_roster dr ON dr.deity_id = ud.deity_id
       LEFT JOIN user_deities ud2 ON ud2.user_deity_id = uc.active_deity_id_2
       LEFT JOIN deity_roster dr2 ON dr2.deity_id = ud2.deity_id
       LEFT JOIN user_deities ud3 ON ud3.user_deity_id = uc.active_deity_id_3
       LEFT JOIN deity_roster dr3 ON dr3.deity_id = ud3.deity_id
       LEFT JOIN user_deities ude ON ude.user_deity_id = uc.active_echo_deity_id
       LEFT JOIN deity_roster dre ON dre.deity_id = ude.deity_id
      WHERE uc.discord_id = $1`,
    [discordId]
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];

  const weapon = r.w_atk != null
    ? { curr_atk: r.w_atk, crit: r.w_crit }
    : null;
  const armor = r.a_hp != null
    ? { curr_hp: r.a_hp, curr_def: r.a_def }
    : null;
  const deity = r.deity_name != null
    ? computeDeityProgressionStats({ base_atk: r.d1_batk, base_hp: r.d1_bhp, base_def: r.d1_bdef }, {
      sigils: r.d1_sigils, ascended: r.d1_ascended, enhancement: r.d1_enhancement,
    })
    : null;

  // [v5 Phase 3] Pantheon slots 2/3 + resonance
  const slot2 = r.deity2_name != null
    ? computeDeityProgressionStats({ base_atk: r.d2_batk, base_hp: r.d2_bhp, base_def: r.d2_bdef }, {
      sigils: r.d2_sigils, ascended: r.d2_ascended, enhancement: r.d2_enhancement,
    })
    : null;
  const slot3 = r.deity3_name != null
    ? computeDeityProgressionStats({ base_atk: r.d3_batk, base_hp: r.d3_bhp, base_def: r.d3_bdef }, {
      sigils: r.d3_sigils, ascended: r.d3_ascended, enhancement: r.d3_enhancement,
    })
    : null;
  const deityInfos = [
    r.deity_name ? { name: r.deity_name, mythology: r.d1_myth } : null,
    r.deity2_name ? { name: r.deity2_name, mythology: r.d2_myth } : null,
    r.deity3_name ? { name: r.deity3_name, mythology: r.d3_myth } : null,
  ];
  const resonance = computeResonanceMods(deityInfos);
  const pantheonMods = (slot2 || slot3 || resonance.atkPct || resonance.hpPct || resonance.defPct || resonance.critPts)
    ? { slot2, slot3, resonance }
    : null;

  // Slot 1 blessing: divine key if divine deity, echo key if echo deity.
  // [Ascension §3.6] A blessing fires ONLY if that deity is Ascended —
  // un-ascended deities contribute stats only (blessing dormant).
  let slot1BlessingKey = 'none';
  if (r.deity_name && r.blessing_key && r.d1_ascended) {
    if (DIVINE_BLESSING_DEITIES.has(r.deity_name)) {
      slot1BlessingKey = r.blessing_key;
    } else {
      slot1BlessingKey = ECHO_BLESSING_KEY_MAP[r.deity_name] || r.blessing_key;
    }
  }

  // Echo blessing from slot 2/3 (chosen via crd deity echo) — same Ascension gate.
  let echoBlessingKey = 'none';
  if (r.echo_deity_name && r.echo_ascended) {
    echoBlessingKey = ECHO_BLESSING_KEY_MAP[r.echo_deity_name] || 'none';
  }

  const effLevel = levelOverride != null
    ? Math.max(MOB_LEVEL_MIN, Math.min(50, Math.floor(levelOverride)))
    : r.combat_level;
  const { mods: runeMods, effects: effectRunes } = await accumulateRuneStats(db, r, discordId);
  const stats = assemblePlayerStats(r.class, effLevel, weapon, armor, deity, runeMods, pantheonMods);

  return {
    name: r.username,
    kind: 'player',
    class: r.class,
    classPassive: CLASS_PASSIVES[r.class],
    level: effLevel,
    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,
    bonusDmgPct: Number(r.bonus_dmg_pct) || 0,
    weaponPassiveKey: weapon ? r.passive_key : 'none',
    weaponName: weapon ? r.weapon_name : null,
    armorPassiveKey: armor ? r.armor_passive_key : 'none',
    armorName: armor ? r.armor_name : null,
    deityBlessingKey: slot1BlessingKey,
    deityName: deity ? r.deity_name : null,
    echoBlessingKey,
    echoDeityName: r.echo_deity_name || null,
    deityNames: [r.deity_name || null, r.deity2_name || null, r.deity3_name || null],
    effectRunes,
  };
}

/** Build a mob fighter from a mob_roster row at the given level. */
function buildMobFighter(row, level) {
  const lv = Math.max(MOB_LEVEL_MIN, Math.min(MOB_LEVEL_MAX, level));
  const stats = computeMobStats(row, lv);
  return {
    name: row.name,
    kind: 'mob',
    mobType: row.mob_type,
    level: lv,
    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,
    skillKey: row.skill_key || 'none',
    skillName: row.skill_name || null,
    skillDescription: row.skill_description || null,
    immunityTags: Array.isArray(row.immunity_tags) ? row.immunity_tags : [],
    specialFlags: row.special_flags || {},
  };
}

/**
 * Boss stats per §16: base + per_level × level. Bosses are EXEMPT from the
 * §35.6 [1,55] clamp (that rule governs raid mobs only) — server avg 50 +
 * random(1–10) may legitimately produce a level-60 boss. Defensive floor at 1.
 */
function computeBossStats(row, level) {
  const lv = Math.max(1, level);
  return {
    hp: Math.floor(row.base_hp + row.hp_per_level * lv),
    atk: Math.floor(row.base_atk + row.atk_per_level * lv),
    def: Math.floor(row.base_def + row.def_per_level * lv),
    crit: Number(row.base_crit) || 0,
  };
}

/**
 * Build the boss fighter for one player's attack instance:
 * ATK/DEF/max HP from the boss_state spawn snapshot (DB-9), CRIT live from
 * mob_roster (DB-8), and the SHARED pool as poolHp/poolMaxHp — the engine
 * fights the player's local instance against the pool's remaining HP, so
 * "enemy HP < X%" effects read the live pool % (§35.4).
 */
function buildBossFighter(row, bossState) {
  return {
    name: row.name,
    kind: 'mob',
    mobType: 'boss',
    level: bossState.boss_level,
    atk: bossState.scaled_atk,
    hp: Number(bossState.max_hp),
    def: bossState.scaled_def,
    crit: Number(row.base_crit) || 0,
    skillKey: row.skill_key || 'none',
    skillName: row.skill_name || null,
    skillDescription: row.skill_description || null,
    immunityTags: Array.isArray(row.immunity_tags) ? row.immunity_tags : [],
    specialFlags: row.special_flags || {},
    poolHp: Number(bossState.current_hp),
    poolMaxHp: Number(bossState.max_hp),
  };
}

/**
 * Random boss row — equal chance among all seeded boss rows (mob_roster has
 * no is_available column; the RETIRE soft-delete patch covered weapon/deity
 * rosters only). rng injectable for tests; the scheduler passes Math.random.
 */
async function fetchRandomBoss(db, rng) {
  const rows = await queryMobRows(
    db,
    'mob_type:boss',
    `SELECT ${MOB_SELECT_COLUMNS} FROM mob_roster WHERE mob_type = 'boss' ORDER BY mob_id`
  );
  if (rows.length === 0) return null;
  return rows[Math.floor(rng() * rows.length)];
}

/** All boss rows (for the weighted Greater/normal tier pick at spawn — §16 [v4.4]). */
async function fetchAllBosses(db) {
  return queryMobRows(
    db,
    'mob_type:boss',
    `SELECT ${MOB_SELECT_COLUMNS} FROM mob_roster WHERE mob_type = 'boss' ORDER BY mob_id`
  );
}

/** Case-insensitive exact-name lookup in mob_roster. */
async function fetchMobByName(db, name) {
  const key = `name:${String(name || '').trim().toLowerCase()}`;
  const rows = await queryMobRows(
    db,
    key,
    `SELECT ${MOB_SELECT_COLUMNS} FROM mob_roster WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

/**
 * Random raid spawn (§13: 80% regular / 20% elite via config/raidLoot —
 * equal chance within type). Draws exactly 2 values from rng (spawn-type
 * roll, row pick) — ORDER BY mob_id keeps the pick reproducible for a given
 * seed against the same roster.
 */
async function fetchRandomMob(db, rng) {
  const type = rng() < 1 - ELITE_SPAWN_CHANCE ? 'regular' : 'elite';
  const rows = await queryMobRows(
    db,
    `mob_type:${type}`,
    `SELECT ${MOB_SELECT_COLUMNS} FROM mob_roster WHERE mob_type = $1 ORDER BY mob_id`,
    [type]
  );
  if (rows.length === 0) return null;
  return rows[Math.floor(rng() * rows.length)];
}

module.exports = {
  CLASS_PASSIVES,
  computeClassBattleStats,
  assemblePlayerStats,
  computeMobStats,
  computeBossStats,
  accumulateRuneStats,
  rollMobLevel,
  buildPlayerFighter,
  buildMobFighter,
  buildBossFighter,
  fetchMobByName,
  fetchRandomMob,
  fetchRandomBoss,
  fetchAllBosses,
  clearMobRosterCache,
};

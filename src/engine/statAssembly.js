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

const MOB_LEVEL_MIN = 1;
const MOB_LEVEL_MAX = 55;

const CLASS_PASSIVES = {
  Swordsman: 'bleed',
  Fighter: 'stun',
  Mage: 'overcharge',
  Knight: 'damage_reduction',
  Archer: 'pierce',
};

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
 * Runes (Phase 2) and pantheon slots 2/3 (Phase 3) are not summed here yet.
 * NULL slots = zero contribution, never an error.
 * weapon: { curr_atk, crit } | null   armor: { curr_hp, curr_def } | null
 * deity:  { curr_atk, curr_hp, curr_def } | null
 */
function assemblePlayerStats(className, level, weapon, armor, deity) {
  const cls = computeClassBattleStats(className, level);
  const wCrit = weapon ? Number(weapon.crit) || 0 : 0;
  return {
    atk: Math.floor(cls.atk + (weapon ? weapon.curr_atk : 0) + (deity ? deity.curr_atk : 0)),
    hp: Math.floor(cls.hp + (armor ? armor.curr_hp : 0) + (deity ? deity.curr_hp : 0)),
    def: Math.floor(cls.def + (armor ? armor.curr_def : 0) + (deity ? deity.curr_def : 0)),
    crit: cls.crit + wCrit, // uncapped (v5 §B.3)
  };
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
            wr.name     AS weapon_name, wr.passive_key,
            am.curr_hp  AS a_hp, am.curr_def AS a_def,
            ar.name     AS armor_name, ar.passive_key AS armor_passive_key,
            ud.curr_atk AS d_atk, ud.curr_hp AS d_hp, ud.curr_def AS d_def,
            dr.name     AS deity_name, dr.blessing_key
       FROM user_character uc
       JOIN users u            ON u.discord_id = uc.discord_id
       LEFT JOIN user_weapons w  ON w.weapon_id = uc.equipped_weapon_id
       LEFT JOIN weapon_roster wr ON wr.weapon_roster_id = w.weapon_roster_id
       LEFT JOIN user_armors am  ON am.armor_id = uc.equipped_armor_id
       LEFT JOIN armor_roster ar ON ar.armor_roster_id = am.armor_roster_id
       LEFT JOIN user_deities ud ON ud.user_deity_id = uc.active_deity_id
       LEFT JOIN deity_roster dr ON dr.deity_id = ud.deity_id
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
  const deity = r.d_atk != null
    ? { curr_atk: r.d_atk, curr_hp: r.d_hp, curr_def: r.d_def }
    : null;
  // [Jun-2026 patch §3] duel level-normalization recomputes ONLY the class component at N.
  const effLevel = levelOverride != null
    ? Math.max(MOB_LEVEL_MIN, Math.min(50, Math.floor(levelOverride)))
    : r.combat_level;
  const stats = assemblePlayerStats(r.class, effLevel, weapon, armor, deity);

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
    bonusDmgPct: Number(r.bonus_dmg_pct) || 0,   // unified damage % (§35.2)
    weaponPassiveKey: weapon ? r.passive_key : 'none',
    weaponName: weapon ? r.weapon_name : null,
    armorPassiveKey: armor ? r.armor_passive_key : 'none', // [v5] armor passive fires alongside weapon/deity
    armorName: armor ? r.armor_name : null,
    deityBlessingKey: deity ? r.blessing_key : 'none',
    deityName: deity ? r.deity_name : null,
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
  const res = await db.query(
    `SELECT * FROM mob_roster WHERE mob_type = 'boss' ORDER BY mob_id`
  );
  if (res.rows.length === 0) return null;
  return res.rows[Math.floor(rng() * res.rows.length)];
}

/** All boss rows (for the weighted Greater/normal tier pick at spawn — §16 [v4.4]). */
async function fetchAllBosses(db) {
  const res = await db.query(
    `SELECT * FROM mob_roster WHERE mob_type = 'boss' ORDER BY mob_id`
  );
  return res.rows;
}

/** Case-insensitive exact-name lookup in mob_roster. */
async function fetchMobByName(db, name) {
  const res = await db.query(
    `SELECT * FROM mob_roster WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [name]
  );
  return res.rows[0] || null;
}

/**
 * Random raid spawn (§13: 80% regular / 20% elite via config/raidLoot —
 * equal chance within type). Draws exactly 2 values from rng (spawn-type
 * roll, row pick) — ORDER BY mob_id keeps the pick reproducible for a given
 * seed against the same roster.
 */
async function fetchRandomMob(db, rng) {
  const type = rng() < 1 - ELITE_SPAWN_CHANCE ? 'regular' : 'elite';
  const res = await db.query(
    `SELECT * FROM mob_roster WHERE mob_type = $1 ORDER BY mob_id`,
    [type]
  );
  if (res.rows.length === 0) return null;
  return res.rows[Math.floor(rng() * res.rows.length)];
}

module.exports = {
  CLASS_PASSIVES,
  computeClassBattleStats,
  assemblePlayerStats,
  computeMobStats,
  computeBossStats,
  rollMobLevel,
  buildPlayerFighter,
  buildMobFighter,
  buildBossFighter,
  fetchMobByName,
  fetchRandomMob,
  fetchRandomBoss,
  fetchAllBosses,
};

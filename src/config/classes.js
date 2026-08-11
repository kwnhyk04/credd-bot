'use strict';

/**
 * Class data — Master §11. Per-class base stats + per-level scaling are hardcoded
 * constants ([Jun-2026 patch §1]: each class now has a DISTINCT stat identity — the
 * old uniform base HP 500 / ATK 10 / DEF 10 / CRIT 5% is gone). No `user_character`
 * stat columns exist; ATK/HP/DEF/CRIT are computed at runtime from class + level, so
 * editing these constants auto-applies to every existing player with no migration.
 *
 * NOTE: computeClassStats() is DISPLAY-ONLY. The authoritative battle stat calculator
 * lives in src/engine/statAssembly.js (Phase 6) and reads the SAME `base`/`scaling`
 * tables. v5 removes the former 40% class / 45% total CRIT ceilings.
 *
 * L50 crit: Swordsman & Archer reach 5 + 0.7×49 = 39.3%. Knight keeps a flat
 * 5% (0 CRIT growth). Higher future levels continue scaling without a clamp.
 */

// Valid class names (must match user_character.class CHECK constraint exactly).
const CLASS_NAMES = ['Swordsman', 'Fighter', 'Mage', 'Knight', 'Archer'];

const CLASS_PASSIVE_VALUES = Object.freeze({
  Swordsman: Object.freeze({
    bleedPerAttack: 0.04,
    bleedMax: 0.20,
    atkPerTurn: 0.05,
    atkMax: 0.30,
  }),
  Archer: Object.freeze({
    defenseIgnore: 0.25,
    doubleAttackChance: 0.35,
  }),
  Fighter: Object.freeze({
    damageBonus: 0.50,
    stunChance: 0.30,
    stunTurns: 1,
    bashDamage: 0.50,
    dizzyMissChance: 0.15,
  }),
  Knight: Object.freeze({
    damageReduction: 0.25,
    outgoingDamageBonus: 0.30,
    regeneration: 0.015,
  }),
});

const passivePct = (value) => Number((value * 100).toFixed(10));

const CLASSES = {
  Swordsman: {
    emoji: '⚔️',
    passiveName: 'Bleed',
    base: { hp: 700, atk: 225, def: 225, crit: 5.0 },
    scaling: { hp: 150, atk: 75, def: 75, crit: 0.7 },
    flavor:
      'A warrior forged for the battlefield. Neither the strongest nor the fastest, but the most reliable. ' +
      'The Swordsman walks the line between offense and defense, adapting to any fight. Every strike leaves a mark, and every mark bleeds.',
    passiveLine:
      `**Passive: Bleed** — Attacks inflict ${passivePct(CLASS_PASSIVE_VALUES.Swordsman.bleedPerAttack)}% Bleed, ` +
      `stacking up to ${passivePct(CLASS_PASSIVE_VALUES.Swordsman.bleedMax)}%. Gains ` +
      `+${passivePct(CLASS_PASSIVE_VALUES.Swordsman.atkPerTurn)}% ATK each turn, stacking up to ` +
      `+${passivePct(CLASS_PASSIVE_VALUES.Swordsman.atkMax)}% for the battle.`,
  },
  Fighter: {
    emoji: '👊',
    passiveName: 'Stun',
    base: { hp: 850, atk: 300, def: 150, crit: 1.0 },
    scaling: { hp: 150, atk: 100, def: 50, crit: 0.5 },
    flavor:
      'A warrior who does not wait for the fight to come — they bring it. The Fighter is built on aggression, raw power, ' +
      "and the unshakable belief that the best defense is a fist to the jaw. When a Fighter lands, the enemy feels it. And sometimes, they don't get back up.",
    passiveLine:
      `**Passive: Stun** — Attacks deal +${passivePct(CLASS_PASSIVE_VALUES.Fighter.damageBonus)}% damage and have a ` +
      `${passivePct(CLASS_PASSIVE_VALUES.Fighter.stunChance)}% chance to become a Bash. Bash adds another ` +
      `+${passivePct(CLASS_PASSIVE_VALUES.Fighter.bashDamage)}% damage, Stuns for ` +
      `${CLASS_PASSIVE_VALUES.Fighter.stunTurns} turn, and leaves the target Dizzy with a ` +
      `${passivePct(CLASS_PASSIVE_VALUES.Fighter.dizzyMissChance)}% chance to miss its next attack.`,
  },
  Mage: {
    emoji: '🔮',
    passiveName: 'Overcharge',
    base: { hp: 600, atk: 350, def: 100, crit: 1.0 },
    scaling: { hp: 100, atk: 150, def: 50, crit: 0.5 },
    flavor:
      'The Mage does not swing a sword. They do not need to. While others close the distance, the Mage is already three moves ahead, ' +
      'building energy that no armor can absorb. When the charge is ready, there is no blocking what comes next.',
    passiveLine:
      '**Passive: Overcharge** — Every third primary strike deals 2.75× damage (275% of normal damage before other bonuses), cannot crit, and applies one random 25% debuff: Paralyze, Burn, DEF Down, or ATK Down.',
  },
  Knight: {
    emoji: '🛡️',
    passiveName: 'Damage Reduction',
    base: { hp: 1000, atk: 200, def: 300, crit: 5.0 },
    scaling: { hp: 200, atk: 50, def: 80, crit: 0.0 },
    flavor:
      'The Knight does not fall easily. Where others break under pressure, the Knight absorbs it, holds the line, and keeps fighting. ' +
      'Every blow the enemy lands is one they will regret. Endurance is not passive — it is a weapon.',
    passiveLine:
      `**Passive: Damage Reduction** — Incoming damage is reduced by 25%, outgoing damage is increased by 30%, and the Knight restores ` +
      `${passivePct(CLASS_PASSIVE_VALUES.Knight.regeneration)}% of maximum HP every turn.`,
  },
  Archer: {
    emoji: '🏹',
    passiveName: 'Armor Pierce & Double Attack',
    base: { hp: 600, atk: 300, def: 150, crit: 5.0 },
    scaling: { hp: 125, atk: 125, def: 50, crit: 0.7 },
    flavor:
      'Swift, precise, and deadly from a distance. The Archer does not wait for the enemy to come — they are already gone before the enemy arrives. ' +
      'Every arrow finds its mark, and no armor is thick enough to stop what cannot be seen coming.',
    passiveLine:
      `**Passive: Armor Pierce & Double Attack** — Attacks ignore ` +
      `${passivePct(CLASS_PASSIVE_VALUES.Archer.defenseIgnore)}% of the target's Defense and have a ` +
      `${passivePct(CLASS_PASSIVE_VALUES.Archer.doubleAttackChance)}% chance to immediately perform an additional attack.`,
  },
};

/**
 * Interim display-only class stat calculation (per-class base + scaling × (level-1)).
 * floor() on hp/atk/def; CRIT remains uncapped under v5. Mirrors the
 * authoritative Phase 6 battle calculator (statAssembly.computeClassBattleStats).
 */
function computeClassStats(className, level) {
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

module.exports = {
  CLASS_NAMES,
  CLASS_PASSIVE_VALUES,
  CLASSES,
  computeClassStats,
};

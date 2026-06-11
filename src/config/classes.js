'use strict';

/**
 * Class data — Master §11. Base stats + per-level scaling are hardcoded constants.
 *
 * NOTE: computeClassStats() is DISPLAY-ONLY. The authoritative battle stat calculator
 * lives in src/engine/statAssembly.js (Phase 6): class + weapon curr + active deity
 * curr; CRIT cap 40% class / 45% total. This helper stays for the profile command
 * until the Phase 9 profile/Canvas migration (C2).
 *
 * L50 crit (R6 ruling): the formula stands — Swordsman/Archer reach 39.3% at Lv50;
 * §11's "exactly 40%" is flavor text. Class crit display-caps at 40.
 */

// All classes, Level 1 (§11)
const BASE_STATS = { hp: 100, atk: 10, def: 10, crit: 5.0 };

// Display cap for class CRIT (§35.2: class crit caps at 40%).
const CLASS_CRIT_CAP = 40.0;

// Valid class names (must match user_character.class CHECK constraint exactly).
const CLASS_NAMES = ['Swordsman', 'Fighter', 'Mage', 'Knight', 'Archer'];

const CLASSES = {
  Swordsman: {
    emoji: '⚔️',
    passiveName: 'Bleed',
    scaling: { hp: 10, atk: 10, def: 10, crit: 0.7 },
    flavor:
      'A warrior forged for the battlefield. Neither the strongest nor the fastest, but the most reliable. ' +
      'The Swordsman walks the line between offense and defense, adapting to any fight. Every strike leaves a mark, and every mark bleeds.',
    passiveLine: '**Passive: Bleed** — Every attack opens a wound. Enemies will suffer beyond the moment of impact.',
  },
  Fighter: {
    emoji: '👊',
    passiveName: 'Stun',
    scaling: { hp: 12, atk: 12, def: 6, crit: 0.5 },
    flavor:
      'A warrior who does not wait for the fight to come — they bring it. The Fighter is built on aggression, raw power, ' +
      'and the unshakable belief that the best defense is a fist to the jaw. When a Fighter lands, the enemy feels it. And sometimes, they don\'t get back up.',
    passiveLine: '**Passive: Stun** — A devastating blow can stop an enemy cold. Not every hit lands the same way.',
  },
  Mage: {
    emoji: '🔮',
    passiveName: 'Overcharge',
    scaling: { hp: 10, atk: 14, def: 6, crit: 0.5 },
    flavor:
      'The Mage does not swing a sword. They do not need to. While others close the distance, the Mage is already three moves ahead, ' +
      'building energy that no armor can absorb. When the charge is ready, there is no blocking what comes next.',
    passiveLine: '**Passive: Overcharge** — Power builds with every turn. When it peaks, the next strike carries everything.',
  },
  Knight: {
    emoji: '🛡️',
    passiveName: 'Damage Reduction',
    scaling: { hp: 15, atk: 6, def: 10, crit: 0.0 },
    flavor:
      'The Knight does not fall easily. Where others break under pressure, the Knight absorbs it, holds the line, and keeps fighting. ' +
      'Every blow the enemy lands is one they will regret. Endurance is not passive — it is a weapon.',
    passiveLine: '**Passive: Damage Reduction** — Every hit taken is softened. The Knight was built to outlast anything in front of them.',
  },
  Archer: {
    emoji: '🏹',
    passiveName: 'Armor Pierce',
    scaling: { hp: 10, atk: 14, def: 6, crit: 0.7 },
    flavor:
      'Swift, precise, and deadly from a distance. The Archer does not wait for the enemy to come — they are already gone before the enemy arrives. ' +
      'Every arrow finds its mark, and no armor is thick enough to stop what cannot be seen coming.',
    passiveLine: '**Passive: Armor Pierce** — Your arrows do not care for steel or stone. Every shot cuts through the defenses of your enemy, finding the gaps that others cannot.',
  },
};

/**
 * Interim display-only class stat calculation (base + scaling × (level-1)).
 * CRIT capped at CLASS_CRIT_CAP. Returns integers for hp/atk/def and a 1-decimal crit.
 * Superseded by the Phase 6 battle stat calculator.
 */
function computeClassStats(className, level) {
  const cls = CLASSES[className];
  if (!cls) throw new Error(`Unknown class: ${className}`);
  const lv = Math.max(1, level);
  const steps = lv - 1;
  return {
    hp:  BASE_STATS.hp  + cls.scaling.hp  * steps,
    atk: BASE_STATS.atk + cls.scaling.atk * steps,
    def: BASE_STATS.def + cls.scaling.def * steps,
    crit: Math.min(BASE_STATS.crit + cls.scaling.crit * steps, CLASS_CRIT_CAP),
  };
}

module.exports = {
  BASE_STATS,
  CLASS_CRIT_CAP,
  CLASS_NAMES,
  CLASSES,
  computeClassStats,
};

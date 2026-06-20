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
 * tables: class + weapon curr + active deity curr; CRIT cap 40% class / 45% total.
 *
 * L50 crit (R6 ruling / patch §1): Swordsman & Archer reach 5 + 0.7×49 = 39.3% at Lv50;
 * the 40% class cap is a safety clamp, never hit in the normal case. Knight keeps a flat
 * 5% (0 CRIT growth). §11's "exactly 40%" line is flavor text.
 */

// Display/battle cap for class CRIT (§35.2: class crit caps at 40%).
const CLASS_CRIT_CAP = 40.0;

// Valid class names (must match user_character.class CHECK constraint exactly).
const CLASS_NAMES = ['Swordsman', 'Fighter', 'Mage', 'Knight', 'Archer'];

const CLASSES = {
  Swordsman: {
    emoji: '⚔️',
    passiveName: 'Bleed',
    base:    { hp: 700, atk: 225, def: 225, crit: 5.0 },
    scaling: { hp: 105, atk: 55,  def: 55,  crit: 0.7 },
    flavor:
      'A warrior forged for the battlefield. Neither the strongest nor the fastest, but the most reliable. ' +
      'The Swordsman walks the line between offense and defense, adapting to any fight. Every strike leaves a mark, and every mark bleeds.',
    passiveLine: '**Passive: Bleed** — Every attack opens a wound. Enemies will suffer beyond the moment of impact.',
  },
  Fighter: {
    emoji: '👊',
    passiveName: 'Stun',
    base:    { hp: 850, atk: 300, def: 150, crit: 1.0 },
    scaling: { hp: 120, atk: 70,  def: 25,  crit: 0.5 },
    flavor:
      'A warrior who does not wait for the fight to come — they bring it. The Fighter is built on aggression, raw power, ' +
      'and the unshakable belief that the best defense is a fist to the jaw. When a Fighter lands, the enemy feels it. And sometimes, they don\'t get back up.',
    passiveLine: '**Passive: Stun** — A devastating blow can stop an enemy cold. Not every hit lands the same way.',
  },
  Mage: {
    emoji: '🔮',
    passiveName: 'Overcharge',
    base:    { hp: 600, atk: 350, def: 100, crit: 1.0 },
    scaling: { hp: 90,  atk: 100, def: 25,  crit: 0.5 },
    flavor:
      'The Mage does not swing a sword. They do not need to. While others close the distance, the Mage is already three moves ahead, ' +
      'building energy that no armor can absorb. When the charge is ready, there is no blocking what comes next.',
    passiveLine: '**Passive: Overcharge** — Power builds with every turn. When it peaks, the next strike carries everything.',
  },
  Knight: {
    emoji: '🛡️',
    passiveName: 'Damage Reduction',
    base:    { hp: 1000, atk: 200, def: 300, crit: 5.0 },
    scaling: { hp: 150, atk: 30,  def: 50,  crit: 0.0 },
    flavor:
      'The Knight does not fall easily. Where others break under pressure, the Knight absorbs it, holds the line, and keeps fighting. ' +
      'Every blow the enemy lands is one they will regret. Endurance is not passive — it is a weapon.',
    passiveLine: '**Passive: Damage Reduction** — Every hit taken is softened. The Knight was built to outlast anything in front of them.',
  },
  Archer: {
    emoji: '🏹',
    passiveName: 'Armor Pierce',
    base:    { hp: 600, atk: 300, def: 150, crit: 5.0 },
    scaling: { hp: 105, atk: 85,  def: 25,  crit: 0.7 },
    flavor:
      'Swift, precise, and deadly from a distance. The Archer does not wait for the enemy to come — they are already gone before the enemy arrives. ' +
      'Every arrow finds its mark, and no armor is thick enough to stop what cannot be seen coming.',
    passiveLine: '**Passive: Armor Pierce** — Your arrows do not care for steel or stone. Every shot cuts through the defenses of your enemy, finding the gaps that others cannot.',
  },
};

/**
 * Interim display-only class stat calculation (per-class base + scaling × (level-1)).
 * floor() on hp/atk/def, CRIT capped at CLASS_CRIT_CAP (1-decimal). Mirrors the
 * authoritative Phase 6 battle calculator (statAssembly.computeClassBattleStats).
 */
function computeClassStats(className, level) {
  const cls = CLASSES[className];
  if (!cls) throw new Error(`Unknown class: ${className}`);
  const steps = Math.max(1, level) - 1;
  return {
    hp:  Math.floor(cls.base.hp  + cls.scaling.hp  * steps),
    atk: Math.floor(cls.base.atk + cls.scaling.atk * steps),
    def: Math.floor(cls.base.def + cls.scaling.def * steps),
    crit: Math.min(cls.base.crit + cls.scaling.crit * steps, CLASS_CRIT_CAP),
  };
}

module.exports = {
  CLASS_CRIT_CAP,
  CLASS_NAMES,
  CLASSES,
  computeClassStats,
};

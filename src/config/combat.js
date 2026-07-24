'use strict';

/**
 * combat.js — the single damage-multiplier rule (Master §35.2 [v4.4]).
 *
 * ONE unified "damage %" bonus stat. There is NO separate crit-damage stat anymore —
 * every damage bonus (weapon passive, deity blessing) is a plain `damage %` that stacks
 * additively and applies to BOTH crit and non-crit hits:
 *
 *     hitMultiplier = (crit ? CRIT_MULT : 1) + Σ(damage %)/100
 *
 *   +50%            → ×1.5 normal / ×2.5 crit
 *   Supreme 50% + deity 50% (on proc) → ×2.0 normal / ×3.0 crit   (only while the
 *                                                                   deity blessing procs)
 *
 * Pure constants + one pure function — safe to import into the battle engine without
 * breaking its purity contract. Future tiers/passives only need to set a `damage %`;
 * the formula here never changes.
 */

// Base crit multiplier for players and enemies (a crit doubles the hit).
const CRIT_MULT = 2.0;

// Mage Overcharge: a fixed base multiplier on the primary attack every 3rd round
// (cannot crit). The engine keeps the existing additive damage-% rider lane.
const OVERCHARGE_MULT = 2.75;

// Idiyanale "double damage" is a GUARANTEED crit-level hit (base CRIT_MULT) that DOES
// take the damage-% rider — so Supreme + double = ×2.5, Supreme + deity 50% + double =
// ×3.0. Handled in the engine by feeding crit=true into hitMultiplier (no separate const).

// Per-tier weapon damage-% riders (the only damage bonus a drop carries now).
const TIER_DAMAGE_PCT = { Legendary: 25, Supreme: 50 };

// Katana passive: +30% damage (merged from the old crit-only ×2.30 rider).
const KATANA_DAMAGE_PCT = 30;

/**
 * Final per-hit damage multiplier under the unified rule.
 * @param {boolean} crit         whether the hit crit
 * @param {number}  damagePct    summed damage % from all sources (weapon + procced deity)
 */
function hitMultiplier(crit, damagePct) {
  return (crit ? CRIT_MULT : 1) + (Number(damagePct) || 0) / 100;
}

module.exports = {
  CRIT_MULT,
  OVERCHARGE_MULT,
  TIER_DAMAGE_PCT,
  KATANA_DAMAGE_PCT,
  hitMultiplier,
};

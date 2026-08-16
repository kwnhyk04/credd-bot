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
const OVERCHARGE_MULT = 4.0;

// Idiyanale "double damage" is a GUARANTEED crit-level hit (base CRIT_MULT) that DOES
// take the damage-% rider — so Supreme + double = ×2.5, Supreme + deity 50% + double =
// ×3.0. Handled in the engine by feeding crit=true into hitMultiplier (no separate const).

// Per-tier weapon damage-% riders (the only damage bonus a drop carries now).
const TIER_DAMAGE_PCT = { Legendary: 25, Supreme: 50 };

// Every Supreme weapon also gains this battle-local ATK stack once per turn.
const SUPREME_WEAPON_ATK_PER_TURN = 0.10;
const SUPREME_WEAPON_ATK_MAX = 0.50;

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

// ── Aegis / Medusa's Gaze ───────────────────────────────────────────────────
// Shared because the value is applied in passiveRegistry (per-stack reduction) and
// rolled back in battleEngine (grantAegisStone, when the third stack becomes a
// Petrify). Duplicating them is exactly how the two halves drift apart.
//
// Effective maximum reduction is 2 stacks = 20%, NOT 30%: the third stack is consumed
// by the Petrify and the accrued reduction is removed in the same step. Deliberate —
// 30% stacking reduction plus a Petrify would strictly dominate Mail of Brokkr's flat
// 30%.
//
// AEGIS_PETRIFY_DAMAGE_AMP is carried as the petrify debuff's `value`, which
// effectDamage reads as an override. Other petrify sources pass 0 and keep the default
// +25%, so this does not buff Medusa mobs' stone_stare by proxy.
const AEGIS_DR_PER_STACK = 0.10;
const AEGIS_STACKS_TO_PETRIFY = 3;
const AEGIS_PETRIFY_DAMAGE_AMP = 0.50;
const PETRIFY_DEFAULT_DAMAGE_AMP = 0.25;

module.exports = {
  CRIT_MULT,
  OVERCHARGE_MULT,
  TIER_DAMAGE_PCT,
  SUPREME_WEAPON_ATK_PER_TURN,
  SUPREME_WEAPON_ATK_MAX,
  KATANA_DAMAGE_PCT,
  hitMultiplier,
  AEGIS_DR_PER_STACK,
  AEGIS_STACKS_TO_PETRIFY,
  AEGIS_PETRIFY_DAMAGE_AMP,
  PETRIFY_DEFAULT_DAMAGE_AMP,
};

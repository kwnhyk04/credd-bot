'use strict';

/**
 * Sigil & Ascension constants (Ascension Patch §3.4/§3.5).
 *
 * Replaces the legacy deity enhancement system (engine/deityEnhancement.js —
 * +10 levels, double stats). Player-facing terms: constellation pieces =
 * "Sigils" (n/10), final unlock = "Ascension".
 *
 * Mechanics (§3.4):
 *   - First copy unlocks the deity at 50% of base stats, blessing dormant.
 *   - Each Sigil adds +5% of base stats: effective = base × (0.50 + 0.05 × sigils).
 *   - At 10/10 Sigils the deity is at 100% base stats.
 *   - Ascension requires 10/10 Sigils + essence + Credux; activates the blessing.
 *   - All spends use the deity's OWN tier essence.
 */

const MAX_SIGILS = 10;
const BASE_STAT_FRACTION = 0.5; // unlock at 50% of base stats
const PER_SIGIL_FRACTION = 0.05; // +5% of base stats per Sigil

// ── Sigil essence cost — [tier][sigil number 1..10] (§3.4) ──────────────────
// Bands: sigils 1–3, 4–7, 8–10. Column totals: Epic 100 · Mythic 83 ·
// Legendary 47 · Supreme 30.
const SIGIL_ESSENCE_COST = {
  Epic: { 1: 5, 2: 5, 3: 5, 4: 10, 5: 10, 6: 10, 7: 10, 8: 15, 9: 15, 10: 15 },
  Mythic: { 1: 5, 2: 5, 3: 5, 4: 8, 5: 8, 6: 8, 7: 8, 8: 12, 9: 12, 10: 12 },
  Legendary: { 1: 3, 2: 3, 3: 3, 4: 5, 5: 5, 6: 5, 7: 5, 8: 6, 9: 6, 10: 6 },
  Supreme: { 1: 2, 2: 2, 3: 2, 4: 3, 5: 3, 6: 3, 7: 3, 8: 4, 9: 4, 10: 4 },
};

// ── Ascension cost — essence (deity's tier) + Credux (§3.4) ─────────────────
const ASCENSION_COST = {
  Epic: { essence: 50, credux: 100_000 },
  Mythic: { essence: 40, credux: 250_000 },
  Legendary: { essence: 20, credux: 500_000 },
  Supreme: { essence: 15, credux: 1_000_000 },
};

/** Sigil-scaled stat multiplier for a sigil count (clamped 0..10). */
function sigilMultiplier(sigils) {
  const n = Math.max(0, Math.min(MAX_SIGILS, Number(sigils) || 0));
  return BASE_STAT_FRACTION + PER_SIGIL_FRACTION * n;
}

/**
 * Effective deity stats at read time (§3.5): base × (0.50 + 0.05 × sigils),
 * floored. Accepts a row carrying base_atk/base_hp/base_def.
 * @returns {{curr_atk:number, curr_hp:number, curr_def:number}}
 */
function computeSigilStats({ base_atk, base_hp, base_def }, sigils) {
  const m = sigilMultiplier(sigils);
  return {
    curr_atk: Math.floor(base_atk * m),
    curr_hp: Math.floor(base_hp * m),
    curr_def: Math.floor(base_def * m),
  };
}

/**
 * Cost of the NEXT Sigil for a deity currently at `sigils` (0..9).
 * Returns null at 10/10 (next step is Ascension, not a Sigil).
 * @returns {{ sigil:number, essence:number } | null}
 */
function nextSigilCost(tier, sigils) {
  const n = Number(sigils) || 0;
  if (n >= MAX_SIGILS) return null;
  const costs = SIGIL_ESSENCE_COST[tier];
  if (!costs) return null;
  return { sigil: n + 1, essence: costs[n + 1] };
}

/** Ascension cost for a tier: { essence, credux } (null for unknown tiers). */
function ascensionCost(tier) {
  return ASCENSION_COST[tier] || null;
}

module.exports = {
  MAX_SIGILS,
  BASE_STAT_FRACTION,
  PER_SIGIL_FRACTION,
  SIGIL_ESSENCE_COST,
  ASCENSION_COST,
  sigilMultiplier,
  computeSigilStats,
  nextSigilCost,
  ascensionCost,
};

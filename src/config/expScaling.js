'use strict';

/**
 * expScaling.js — [Progression v2] mob-level EXP scaling.
 *
 * Before v2 every EXP source paid a flat, level-independent amount: raid wins were
 * 200-300 / 400-600 regardless of mob level, boss participation a fixed 20k/30k/40k,
 * and auto-raid scaled window length and payout by the same factor (a level-invariant
 * 9,000 EXP/hour). With a cap of 100 and a curve reaching 3.63 BILLION lifetime EXP,
 * flat rewards put level 100 roughly 75 years away. This module is the fix: EXP now
 * scales with the level of the thing you fought.
 *
 * ── The formula ──────────────────────────────────────────────────────────────────
 *   multiplier = max(FLOOR, (clamp(level) / PIVOT) ** EXPONENT)
 *
 * PIVOT 30 — the multiplier is exactly 1.0 at level 30, which was the top of the live
 *   population when this was designed. Chosen so the curve is anchored to observed
 *   behaviour rather than an arbitrary baseline.
 *
 * EXPONENT 2 — quadratic. Linear (L/30) left level 100 about 10 years out even with a
 *   flattened tail; ^1.5 left it at 7.3. Quadratic brings it to ~5.6 years, which is
 *   the approved target for a maximum level.
 *
 * FLOOR 1.0 — no player ever earns LESS per kill than before v2. Without it the
 *   multiplier at mob level 10 is 0.11, a 9x early-game nerf stacked on top of a curve
 *   that is already ~4x steeper through level 20. Levels 1-19 are hand-tuned for a fast
 *   early game and the floor protects that. The floor is inactive above mob level 30,
 *   so it costs nothing in the mid and late game (0.02 years across the whole curve).
 *   Consequence, accepted deliberately: v2 is a strict EXP BUFF for every player,
 *   largest (~1.5x) at level 30+.
 *
 * ── Why the parameter is `levelForScaling` and not `mobLevel` ────────────────────
 * Raids scale on the MOB's level. Bosses scale on the ATTACKING PLAYER's own level,
 * not the boss's — boss level is AVG(combat_level) of active players, so scaling off it
 * would let a level 20 player in a level 60 fight earn 40,000 x 4 = 160,000 EXP, more
 * than levels 1-20 combined. The parameter is deliberately named for its role, not its
 * usual source, so a caller passing a participant level is not writing something that
 * reads like a bug.
 *
 * ── The clamp is a safety bound, not a formality ─────────────────────────────────
 * MOB_LEVEL_MAX bounds worst-case reward inflation at 4,800 EXP per kill. It lives here
 * rather than in statAssembly so the clamp and the ceiling can never drift apart; this
 * module is dependency-free precisely so any caller can import it.
 *
 * The pacing model (scripts/exp-pacing-model.js) imports this function rather than
 * restating the formula, so the model cannot silently diverge from live behaviour.
 */

// Mob levels: roll is playerLevel + (-2..+15), so the highest reachable mob level is
// 115 (cap 100 + max offset). 120 keeps a little headroom while staying a MEANINGFUL
// bound — the earlier proposal of 150 made the reward-inflation ceiling so loose it
// bounded nothing. Left at the pre-v2 value of 55, a level 100 player would fight
// level 55 mobs for 1,008 EXP/kill instead of 3,790 and level 100 would take 10.2
// years instead of 5.6, so this constant is load-bearing for the whole curve.
const MOB_LEVEL_MIN = 1;
const MOB_LEVEL_MAX = 120;

// Mob level = playerLevel + uniform integer in [MIN_OFFSET, MAX_OFFSET]. These live
// here rather than in statAssembly so rollMobLevel (which draws one) and the auto-raid
// path (which needs the expected value of the draw) cannot disagree about the spread.
const MOB_LEVEL_OFFSET_MIN = -2;
const MOB_LEVEL_OFFSET_MAX = 15;
const MOB_LEVEL_OFFSET_MEAN = (MOB_LEVEL_OFFSET_MIN + MOB_LEVEL_OFFSET_MAX) / 2; // 6.5

const SCALING_PIVOT_LEVEL = 30;
const SCALING_EXPONENT = 2;
const SCALING_FLOOR = 1.0;

/**
 * Scale a base EXP reward by the level of the thing that produced it.
 *
 * @param {number} baseExp          unscaled EXP (a raid roll, a boss reward, a loss payout)
 * @param {number} levelForScaling  mob level for raids; the participant's OWN level for bosses
 * @returns {number} integer EXP, never less than `baseExp` (see FLOOR above)
 */
function scaleExpForMobLevel(baseExp, levelForScaling) {
  const base = Math.max(0, Number(baseExp) || 0);
  const level = Math.max(
    MOB_LEVEL_MIN,
    Math.min(MOB_LEVEL_MAX, Math.floor(Number(levelForScaling) || MOB_LEVEL_MIN)),
  );
  const multiplier = Math.max(
    SCALING_FLOOR,
    (level / SCALING_PIVOT_LEVEL) ** SCALING_EXPONENT,
  );
  return Math.round(base * multiplier);
}

/**
 * Expected mob level a player of `playerLevel` faces, for reward paths that pay out a
 * DETERMINISTIC average rather than rolling individual mobs (auto-raid). Manual raids
 * know their actual mob level and must pass that instead.
 *
 * This is E[level], and the multiplier is quadratic, so scaling by it slightly
 * understates the true E[multiplier] (Jensen's gap: 2.0% at player level 30, 0.8% at
 * 50, 0.2% at 100 — it shrinks as the offset spread becomes proportionally smaller).
 * Accepted: the alternative is computing the full distribution on every claim to
 * recover under two percent.
 */
function expectedMobLevelFor(playerLevel) {
  const lv = Math.max(MOB_LEVEL_MIN, Math.floor(Number(playerLevel) || MOB_LEVEL_MIN));
  return Math.max(
    MOB_LEVEL_MIN,
    Math.min(MOB_LEVEL_MAX, Math.round(lv + MOB_LEVEL_OFFSET_MEAN)),
  );
}

module.exports = {
  MOB_LEVEL_MIN,
  MOB_LEVEL_MAX,
  MOB_LEVEL_OFFSET_MIN,
  MOB_LEVEL_OFFSET_MAX,
  MOB_LEVEL_OFFSET_MEAN,
  expectedMobLevelFor,
  SCALING_PIVOT_LEVEL,
  SCALING_EXPONENT,
  SCALING_FLOOR,
  scaleExpForMobLevel,
};

'use strict';

/**
 * cooldowns.js — per-command cooldown windows (Master, [v4.8]). One auditable place for
 * every non-default value; everything else uses DEFAULT_COOLDOWN_MS. Keyed by the CANONICAL
 * command key (middleware resolves aliases via COOLDOWN_KEY_ALIASES before looking up here).
 *
 *   raid: 15s (combat pacing — deliberately NOT reduced)
 *   ranked: 15s (combat pacing — deliberately NOT reduced)
 *   duel: 15s (combat pacing — deliberately NOT reduced)
 *   all casino: 10s (coin, dice, baccarat, blackjack, slot, crash, anti-spam)
 *   everything else: 10s (DEFAULT_COOLDOWN_MS)
 *
 * Every command keeps its OWN constant + PER_COMMAND_MS entry even where several currently
 * share the same number, so any one command can be retuned without touching the others.
 *
 * Buttons are NOT cooldown-gated (unchanged).
 */

const DEFAULT_COOLDOWN_MS = 10_000;

// ── Combat pacing (exempt from the 10s standard) ─────────────────────────────
const RAID_COOLDOWN_MS = 15_000;
const RANKED_COOLDOWN_MS = 15_000;
const DUEL_COOLDOWN_MS = 15_000;
/** @deprecated kept for any caller that imported the pre-split combat constant. */
const COMBAT_COOLDOWN_MS = RANKED_COOLDOWN_MS;

// ── Casino (canonical keys — aliases ct/dr/bac/bj/sm map to these upstream) ───
const COIN_COOLDOWN_MS = 10_000;
const DICE_COOLDOWN_MS = 10_000;
const BACCARAT_COOLDOWN_MS = 10_000;
const BLACKJACK_COOLDOWN_MS = 10_000;
const SLOT_COOLDOWN_MS = 10_000;
const CRASH_COOLDOWN_MS = 10_000;
/** @deprecated kept for any caller that imported the pre-split casino constant. */
const LONG_COOLDOWN_MS = COIN_COOLDOWN_MS;

const PER_COMMAND_MS = {
  raid: RAID_COOLDOWN_MS,
  ranked: RANKED_COOLDOWN_MS,
  duel: DUEL_COOLDOWN_MS,
  coin: COIN_COOLDOWN_MS,
  dice: DICE_COOLDOWN_MS,
  baccarat: BACCARAT_COOLDOWN_MS,
  blackjack: BLACKJACK_COOLDOWN_MS,
  slot: SLOT_COOLDOWN_MS,
  crash: CRASH_COOLDOWN_MS,
};

/** Canonical keys intentionally longer than DEFAULT_COOLDOWN_MS (combat pacing). */
const COMBAT_PACED_KEYS = Object.freeze(['raid', 'ranked', 'duel']);

/** Cooldown window (ms) for a canonical command key. */
function cooldownMs(commandKey) {
  return PER_COMMAND_MS[commandKey] ?? DEFAULT_COOLDOWN_MS;
}

module.exports = {
  cooldownMs,
  DEFAULT_COOLDOWN_MS,
  LONG_COOLDOWN_MS,
  RAID_COOLDOWN_MS,
  RANKED_COOLDOWN_MS,
  DUEL_COOLDOWN_MS,
  COMBAT_COOLDOWN_MS,
  COIN_COOLDOWN_MS,
  DICE_COOLDOWN_MS,
  BACCARAT_COOLDOWN_MS,
  BLACKJACK_COOLDOWN_MS,
  SLOT_COOLDOWN_MS,
  CRASH_COOLDOWN_MS,
  COMBAT_PACED_KEYS,
  PER_COMMAND_MS,
};

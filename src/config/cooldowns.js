'use strict';

/**
 * cooldowns.js — per-command cooldown windows (Master, [v4.8]). One auditable place for
 * every non-default value; everything else uses DEFAULT_COOLDOWN_MS. Keyed by the CANONICAL
 * command key (middleware resolves aliases via COOLDOWN_KEY_ALIASES before looking up here).
 *
 *   raid            → 10s (anti-spam)
 *   all casino      → 10s (coin, dice, baccarat, blackjack, slot, crash — anti-spam)
 *   everything else → 10s
 *
 * Buttons are NOT cooldown-gated (unchanged).
 */

const DEFAULT_COOLDOWN_MS = 10_000;
const LONG_COOLDOWN_MS = 10_000;

const PER_COMMAND_MS = {
  raid: LONG_COOLDOWN_MS,
  // Casino (canonical keys — aliases ct/dr/bac/bj/sm map to these upstream).
  coin: LONG_COOLDOWN_MS,
  dice: LONG_COOLDOWN_MS,
  baccarat: LONG_COOLDOWN_MS,
  blackjack: LONG_COOLDOWN_MS,
  slot: LONG_COOLDOWN_MS,
  crash: LONG_COOLDOWN_MS,
};

/** Cooldown window (ms) for a canonical command key. */
function cooldownMs(commandKey) {
  return PER_COMMAND_MS[commandKey] ?? DEFAULT_COOLDOWN_MS;
}

module.exports = { cooldownMs, DEFAULT_COOLDOWN_MS, LONG_COOLDOWN_MS, PER_COMMAND_MS };

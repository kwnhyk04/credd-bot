-- =====================================================================
-- CREDD v5 — Phase 6 power-budget retune (LAUNCH GATE, §V5-7)
-- Boss mob_roster rescale to the v5 MAX-build ceiling.
--
-- Why: v5 added systems that did not exist when these bosses were tuned —
--   3-slot pantheon (Main 100% + 50% + 50% = 175% deity stats), rune sockets
--   (Supreme: +15-20% ATK x2, +25-30% HP x2, +15-20% DEF x2), and UNCAPPED crit.
--   A maxed single build now outputs materially more burst, so endgame bosses
--   need more effective HP (and a touch more threat) to stay a wall rather than a
--   one-rotation kill. Greater (x2 HP) / Golden (x3 HP) multipliers in
--   src/config/bosses.js stack on top of these new bases unchanged.
--
-- Calibration (vs the pre-v5 single-deity / no-rune / capped-crit baseline):
--   HP  x1.6  - offsets the ~+50-60% effective DPS from pantheon + sharpness runes
--               + uncapped crit, restoring the intended kill-time window.
--   DEF x1.3  - keeps mitigation pacing with player ATK so the 25% DR floor still bites.
--   ATK/level x1.15 - squishy glass builds still risk death; tanky builds unaffected.
--
-- Caps unchanged (verified present, no code edit): total evade <=40%
--   (battleEngine TOTAL_EVADE_CAP + passiveRegistry summation), incoming-damage
--   floor 25% post-DEF (battleEngine INCOMING_DR_FLOOR), crit UNCAPPED (no 45% clamp).
--
-- Idempotent: a special_flags.retune_v6 marker prevents double-application.
-- NOTE: elite/regular (raid) mobs are intentionally NOT touched here - that tuning
--   is deferred to a data-driven raid pass (raids also gate the Credux faucet).
-- =====================================================================
BEGIN;

UPDATE mob_roster
   SET base_hp       = ROUND(base_hp       * 1.6),
       hp_per_level  = ROUND(hp_per_level  * 1.6),
       base_def      = ROUND(base_def      * 1.3),
       def_per_level = ROUND(def_per_level * 1.3),
       atk_per_level = ROUND(atk_per_level * 1.15),
       special_flags = special_flags || '{"retune_v6": true}'::jsonb
 WHERE mob_type = 'boss'
   AND NOT (special_flags ? 'retune_v6');

COMMIT;

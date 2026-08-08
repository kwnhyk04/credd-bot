-- ============================================================================
-- backfill_lifetime_exp_TEST_20260808.sql
--
-- ###########################################################################
-- ##  TEST DATA ONLY -- NEVER RUN THIS AGAINST PRODUCTION.                 ##
-- ###########################################################################
--
-- Every discord_id and every per-row value below was read out of a TEST
-- database on 2026-08-08. The ids do not identify production accounts and the
-- precomputed totals describe test progression, not real progression. Against
-- any other database the pre-check aborts, which is correct; if the pre-check
-- were removed it would write values that belong to nobody.
--
-- For an environment-independent backfill use scripts/backfill_lifetime_exp.sql
-- which derives every value from combat_level and combat_exp at run time and
-- hardcodes no ids. This file is retained only as a record of the test run.
--
-- PURPOSE   Repair user_character.lifetime_exp for the 20 accounts that carry
--           progression. 19 hold 0 because the progression-v2 conversion never
--           ran; 1 holds a PARTIAL total because the account predates the
--           column and has earned EXP through awardCombatExp since.
--
-- DATE      2026-08-08
-- COMMIT    de30151
-- FORMULA   lifetime_exp = CUMULATIVE_EXP[combat_level - 1] + combat_exp
--           (src/config/combatExp.js :: lifetimeExpFor)
-- BACKUP    user_character_backup_20260808   (24 rows, verified identical to live before generation)
--
-- SCOPE     Updates lifetime_exp ONLY, on exactly the 20 rows listed below.
--           combat_level and combat_exp are never written by any statement here.
--           The 4 level-1 / zero-exp rows are deliberately absent and untouched.
--
-- NOT a schema migration. Deliberately outside scripts/migrations/ so no
-- migration runner ever picks it up. Apply once, by hand, then keep for audit.
-- ============================================================================

BEGIN;

-- ── PRE-CHECK ───────────────────────────────────────────────────────────────
-- The new values below were computed from a snapshot. If any player has earned
-- EXP since then, their combat_level / combat_exp / lifetime_exp will no longer
-- match the expected values, and the precomputed total for that row would be
-- STALE AND WRONG.
--
-- This block RAISES and therefore ABORTS THE WHOLE TRANSACTION on any drift.
-- It deliberately does not skip mismatched rows: a partial backfill is harder
-- to reason about than none at all.
--
-- IF THIS ABORTS: nothing has changed. Re-generate the file against current
-- data (re-run the B1 dry run, regenerate this script) and apply the fresh one.
-- Do not edit the numbers here by hand.
DO $backfill_precheck$
DECLARE
  drift bigint;
BEGIN
  SELECT count(*) INTO drift
    FROM (VALUES
    ('1048193635319029790', 8, 833, 0, 12483),
    ('1052858592857956383', 4, 781, 0, 1631),
    ('1139889815727394876', 6, 1202, 0, 4852),
    ('1286584012927926286', 2, 50, 0, 150),
    ('1444953283306328075', 21, 88937, 0, 2725587),
    ('1475898881467355221', 7, 5, 0, 6655),
    ('1482423032713707624', 14, 23406, 0, 215056),
    ('1508745825315196979', 17, 104362, 0, 731012),
    ('369029538442641408', 14, 13382, 0, 205032),
    ('459265987225583616', 1, 50, 0, 50),
    ('720960895458476088', 13, 3723, 0, 130373),
    ('732560805006016523', 22, 121502, 0, 3503152),
    ('743099569272782890', 12, 8761, 0, 90411),
    ('743405383380500531', 26, 63276, 0, 6919926),
    ('746037947945451690', 22, 218375, 0, 3600025),
    ('757267693136117820', 25, 73898, 0, 5980548),
    ('770584603852275712', 27, 657893, 0, 8524543),
    ('780788002942615562', 12, 4032, 0, 85682),
    ('814103923027738674', 13, 2850, 0, 129500),
    ('980773258238492762', 22, 322865, 164336, 3704515)
    ) AS e(discord_id, want_level, want_exp, want_lifetime, new_lifetime)
    LEFT JOIN public.user_character u ON u.discord_id = e.discord_id
   WHERE u.discord_id IS NULL
      OR u.combat_level IS DISTINCT FROM e.want_level
      OR u.combat_exp   IS DISTINCT FROM e.want_exp
      OR u.lifetime_exp IS DISTINCT FROM e.want_lifetime;

  IF drift <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % of 20 target row(s) no longer match the snapshot this file was built from. Nothing was changed. Regenerate the backfill against current data.',
      drift;
  END IF;
END
$backfill_precheck$;

-- ── THE WRITE ───────────────────────────────────────────────────────────────
-- lifetime_exp only. No other column appears on the left of any SET.
UPDATE public.user_character AS u
   SET lifetime_exp = e.new_lifetime
  FROM (VALUES
    ('1048193635319029790', 8, 833, 0, 12483),
    ('1052858592857956383', 4, 781, 0, 1631),
    ('1139889815727394876', 6, 1202, 0, 4852),
    ('1286584012927926286', 2, 50, 0, 150),
    ('1444953283306328075', 21, 88937, 0, 2725587),
    ('1475898881467355221', 7, 5, 0, 6655),
    ('1482423032713707624', 14, 23406, 0, 215056),
    ('1508745825315196979', 17, 104362, 0, 731012),
    ('369029538442641408', 14, 13382, 0, 205032),
    ('459265987225583616', 1, 50, 0, 50),
    ('720960895458476088', 13, 3723, 0, 130373),
    ('732560805006016523', 22, 121502, 0, 3503152),
    ('743099569272782890', 12, 8761, 0, 90411),
    ('743405383380500531', 26, 63276, 0, 6919926),
    ('746037947945451690', 22, 218375, 0, 3600025),
    ('757267693136117820', 25, 73898, 0, 5980548),
    ('770584603852275712', 27, 657893, 0, 8524543),
    ('780788002942615562', 12, 4032, 0, 85682),
    ('814103923027738674', 13, 2850, 0, 129500),
    ('980773258238492762', 22, 322865, 164336, 3704515)
  ) AS e(discord_id, want_level, want_exp, want_lifetime, new_lifetime)
 WHERE u.discord_id = e.discord_id;

-- ── POST-CHECK ──────────────────────────────────────────────────────────────
-- Expect: updated_to_expected = 20, remaining_desynced = 0, untouched_level1 = 4.
SELECT
  (SELECT count(*) FROM public.user_character u
     JOIN (VALUES
    ('1048193635319029790', 8, 833, 0, 12483),
    ('1052858592857956383', 4, 781, 0, 1631),
    ('1139889815727394876', 6, 1202, 0, 4852),
    ('1286584012927926286', 2, 50, 0, 150),
    ('1444953283306328075', 21, 88937, 0, 2725587),
    ('1475898881467355221', 7, 5, 0, 6655),
    ('1482423032713707624', 14, 23406, 0, 215056),
    ('1508745825315196979', 17, 104362, 0, 731012),
    ('369029538442641408', 14, 13382, 0, 205032),
    ('459265987225583616', 1, 50, 0, 50),
    ('720960895458476088', 13, 3723, 0, 130373),
    ('732560805006016523', 22, 121502, 0, 3503152),
    ('743099569272782890', 12, 8761, 0, 90411),
    ('743405383380500531', 26, 63276, 0, 6919926),
    ('746037947945451690', 22, 218375, 0, 3600025),
    ('757267693136117820', 25, 73898, 0, 5980548),
    ('770584603852275712', 27, 657893, 0, 8524543),
    ('780788002942615562', 12, 4032, 0, 85682),
    ('814103923027738674', 13, 2850, 0, 129500),
    ('980773258238492762', 22, 322865, 164336, 3704515)
     ) AS e(discord_id, want_level, want_exp, want_lifetime, new_lifetime)
       ON e.discord_id = u.discord_id
    WHERE u.lifetime_exp = e.new_lifetime)                          AS updated_to_expected,
  (SELECT count(*) FROM public.user_character
    WHERE lifetime_exp = 0 AND (combat_level > 1 OR combat_exp > 0)) AS remaining_desynced,
  (SELECT count(*) FROM public.user_character
    WHERE combat_level = 1 AND combat_exp = 0 AND lifetime_exp = 0)  AS untouched_level1,
  (SELECT count(*) FROM public.user_character)                       AS total_rows;

COMMIT;

-- ============================================================================
-- RESTORE, if this needs undoing. Run as its own transaction.
--
-- UNSAFE to restore combat_exp or combat_level from the backup: live gameplay
-- has advanced past the snapshot, so it would delete EXP players have earned.
--
--   BEGIN;
--   UPDATE public.user_character u
--      SET lifetime_exp = b.lifetime_exp
--     FROM user_character_backup_20260808 b
--    WHERE u.discord_id = b.discord_id;
--   COMMIT;
-- ============================================================================

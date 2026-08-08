-- ============================================================================
-- backfill_lifetime_exp.sql
--
-- PURPOSE   Repair user_character.lifetime_exp on ANY environment. Accounts
--           created before the progression-v2 column existed carry 0, and
--           accounts that earned EXP after it was added but before conversion
--           carry a PARTIAL total. Both are repaired by recomputing the total
--           from the two columns that were always correct.
--
-- FORMULA   lifetime_exp = CUMULATIVE_EXP[combat_level - 1] + combat_exp
--           (src/config/combatExp.js :: lifetimeExpFor)
--
--           The curve below is GENERATED from that module, not transcribed.
--           Each row is (combat_level, exp_at_level_start) where
--           exp_at_level_start = CUMULATIVE_EXP[combat_level - 1], i.e. the
--           lifetime total a player holds on arriving at that level with an
--           empty bar. Levels 1..100, matching MAX_COMBAT_LEVEL.
--
-- ENVIRONMENT-AGNOSTIC. No discord_id and no per-row value appears anywhere in
-- this file. Every number written is derived at run time from the target
-- database's own combat_level and combat_exp. Run it against test, staging, or
-- production without regenerating anything.
--
-- TOUCHES        user_character.lifetime_exp, and only on rows where
--                (combat_level > 1 OR combat_exp > 0).
--
-- DOES NOT TOUCH combat_level, combat_exp, or any other column -- no other
--                column name appears on the left of a SET in this file.
--                Level-1 / zero-exp rows are excluded by the WHERE clause and
--                are never written. A verification block after the UPDATE
--                aborts the transaction if combat_level or combat_exp moved.
--
-- RE-RUNNABLE    Values derive from combat_level and combat_exp, never from the
--                current lifetime_exp, and the UPDATE skips rows that already
--                hold the computed value. A second run reports 0 rows updated
--                and changes nothing.
--
-- RESTORE        The first statement inside the transaction copies
--                user_character into a timestamped backup table and reports its
--                name in the post-check. To undo:
--
--                  BEGIN;
--                  UPDATE public.user_character u
--                     SET lifetime_exp = b.lifetime_exp
--                    FROM public.user_character_backup_<STAMP> b
--                   WHERE u.discord_id = b.discord_id;
--                  COMMIT;
--
--                RESTORE lifetime_exp ONLY. Restoring combat_exp or
--                combat_level from a backup is UNSAFE once live play has
--                advanced past the snapshot: it would delete EXP players
--                earned after the backup was taken. This file never modifies
--                those columns, so they never need restoring.
--
-- NOT a schema migration. Deliberately outside scripts/migrations/ so no
-- migration runner picks it up. Apply by hand.
-- ============================================================================

BEGIN;

-- ── 1. BACKUP (first statement in the transaction) ──────────────────────────
-- Self-contained: the file makes its own safety net rather than assuming one
-- exists. DDL is transactional in Postgres, so if anything later raises, the
-- backup table disappears along with every other change.
DO $backfill_backup$
DECLARE
  backup_name text := 'user_character_backup_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
  src_rows bigint;
  bak_rows bigint;
BEGIN
  EXECUTE format('CREATE TABLE public.%I AS SELECT * FROM public.user_character', backup_name);
  SELECT count(*) INTO src_rows FROM public.user_character;
  EXECUTE format('SELECT count(*) FROM public.%I', backup_name) INTO bak_rows;

  IF bak_rows <> src_rows THEN
    RAISE EXCEPTION
      'ABORT: backup % holds % row(s) but user_character holds %. Nothing was changed.',
      backup_name, bak_rows, src_rows;
  END IF;

  PERFORM set_config('backfill.backup_table', backup_name, true);
  RAISE NOTICE 'Backup created: public.% (% rows)', backup_name, bak_rows;
END
$backfill_backup$;

-- ── 2. THE EXP CURVE, generated from src/config/combatExp.js ────────────────
-- (combat_level, exp_at_level_start) where
--   exp_at_level_start = CUMULATIVE_EXP[combat_level - 1]
CREATE TEMP TABLE backfill_exp_curve (
  combat_level       integer PRIMARY KEY,
  exp_at_level_start bigint  NOT NULL
) ON COMMIT DROP;

INSERT INTO backfill_exp_curve (combat_level, exp_at_level_start) VALUES
  (1, 0), (2, 100), (3, 350), (4, 850), (5, 1850),
  (6, 3650), (7, 6650), (8, 11650), (9, 19650), (10, 31650),
  (11, 51650), (12, 81650), (13, 126650), (14, 191650), (15, 286650),
  (16, 426650), (17, 626650), (18, 916650), (19, 1336650), (20, 1936650),
  (21, 2636650), (22, 3381650), (23, 4171650), (24, 5011650), (25, 5906650),
  (26, 6856650), (27, 7866650), (28, 8941650), (29, 10086650), (30, 11301650),
  (31, 12601650), (32, 14701650), (33, 18001650), (34, 22601650), (35, 28601650),
  (36, 36101650), (37, 45201650), (38, 56001650), (39, 68601650), (40, 83101650),
  (41, 99601650), (42, 118201650), (43, 139001650), (44, 162101650), (45, 187601650),
  (46, 215601650), (47, 246201650), (48, 279501650), (49, 315601650), (50, 354601650),
  (51, 396601650), (52, 438601650), (53, 481601650), (54, 525601650), (55, 570601650),
  (56, 616601650), (57, 663601650), (58, 711601650), (59, 760601650), (60, 810601650),
  (61, 861601650), (62, 913601650), (63, 966601650), (64, 1020601650), (65, 1075601650),
  (66, 1131601650), (67, 1188601650), (68, 1246601650), (69, 1305601650), (70, 1365601650),
  (71, 1426601650), (72, 1488601650), (73, 1551601650), (74, 1615601650), (75, 1680601650),
  (76, 1746601650), (77, 1813601650), (78, 1881601650), (79, 1950601650), (80, 2020601650),
  (81, 2091601650), (82, 2163601650), (83, 2236601650), (84, 2310601650), (85, 2385601650),
  (86, 2461601650), (87, 2538601650), (88, 2616601650), (89, 2695601650), (90, 2775601650),
  (91, 2856601650), (92, 2938601650), (93, 3021601650), (94, 3105601650), (95, 3190601650),
  (96, 3276601650), (97, 3363601650), (98, 3451601650), (99, 3540601650), (100, 3630601650);

-- Pre-change snapshot, so the post-check can report what actually moved.
CREATE TEMP TABLE backfill_before ON COMMIT DROP AS
  SELECT discord_id, combat_level, combat_exp, lifetime_exp
    FROM public.user_character;

-- ── 3. GUARD ────────────────────────────────────────────────────────────────
-- A combat_level outside the curve, or a negative combat_exp, means the row is
-- anomalous. lifetimeExpFor() clamps such values in JS; this file deliberately
-- ABORTS instead, because silently clamping would write a total the player
-- never earned.
DO $backfill_guard$
DECLARE
  unknown_levels bigint;
  negative_exp   bigint;
BEGIN
  SELECT count(*) INTO unknown_levels
    FROM public.user_character u
    LEFT JOIN backfill_exp_curve c ON c.combat_level = u.combat_level
   WHERE (u.combat_level > 1 OR u.combat_exp > 0)
     AND c.combat_level IS NULL;

  IF unknown_levels <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) carry a combat_level outside 1..100. Nothing was changed.',
      unknown_levels;
  END IF;

  SELECT count(*) INTO negative_exp
    FROM public.user_character WHERE combat_exp < 0;

  IF negative_exp <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) carry a negative combat_exp. Nothing was changed.',
      negative_exp;
  END IF;
END
$backfill_guard$;

-- ── 4. PRE-CHECK ────────────────────────────────────────────────────────────
-- How many rows the UPDATE below will actually change.
SELECT
  count(*) FILTER (
    WHERE u.lifetime_exp IS DISTINCT FROM c.exp_at_level_start + u.combat_exp
  )                                                                   AS rows_to_change,
  count(*)                                                            AS target_rows,
  (SELECT count(*) FROM public.user_character
    WHERE combat_level = 1 AND combat_exp = 0)                        AS level1_excluded,
  (SELECT count(*) FROM public.user_character)                        AS total_rows
FROM public.user_character u
JOIN backfill_exp_curve c ON c.combat_level = u.combat_level
WHERE (u.combat_level > 1 OR u.combat_exp > 0);

-- ── 5. THE WRITE ────────────────────────────────────────────────────────────
-- lifetime_exp only. No other column appears on the left of any SET.
-- The final predicate makes re-runs no-ops rather than rewrites.
UPDATE public.user_character AS u
   SET lifetime_exp = c.exp_at_level_start + u.combat_exp
  FROM backfill_exp_curve c
 WHERE c.combat_level = u.combat_level
   AND (u.combat_level > 1 OR u.combat_exp > 0)
   AND u.lifetime_exp IS DISTINCT FROM c.exp_at_level_start + u.combat_exp;

-- ── 6. VERIFY NOTHING ELSE MOVED ────────────────────────────────────────────
-- Belt and braces: the UPDATE cannot touch these columns, and this proves it
-- against the pre-change snapshot before anything is committed.
DO $backfill_verify$
DECLARE
  drift bigint;
BEGIN
  SELECT count(*) INTO drift
    FROM public.user_character u
    JOIN backfill_before b ON b.discord_id = u.discord_id
   WHERE u.combat_level IS DISTINCT FROM b.combat_level
      OR u.combat_exp   IS DISTINCT FROM b.combat_exp;

  IF drift <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % row(s) had combat_level or combat_exp change. Nothing was committed.',
      drift;
  END IF;
END
$backfill_verify$;

-- ── 7. POST-CHECK ───────────────────────────────────────────────────────────
-- Expect remaining_desynced = 0. rows_updated is 0 on a repeat run.
SELECT
  current_setting('backfill.backup_table')                            AS backup_table,
  (SELECT count(*) FROM public.user_character u
     JOIN backfill_before b ON b.discord_id = u.discord_id
    WHERE u.lifetime_exp IS DISTINCT FROM b.lifetime_exp)             AS rows_updated,
  (SELECT count(*) FROM public.user_character u
     JOIN backfill_exp_curve c ON c.combat_level = u.combat_level
    WHERE (u.combat_level > 1 OR u.combat_exp > 0)
      AND u.lifetime_exp IS DISTINCT FROM c.exp_at_level_start + u.combat_exp)
                                                                      AS remaining_desynced,
  (SELECT count(*) FROM public.user_character
    WHERE combat_level = 1 AND combat_exp = 0)                        AS untouched_level1,
  (SELECT count(*) FROM public.user_character)                        AS total_rows;

COMMIT;

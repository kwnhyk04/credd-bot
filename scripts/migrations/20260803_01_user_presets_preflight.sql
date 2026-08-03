-- Read-only preflight for 20260803_01_user_presets.sql.
-- Run this first. It must complete without an exception and report stale_echo_rows = 0.
BEGIN;
SET TRANSACTION READ ONLY;

DO $user_presets_preflight$
DECLARE
    stale_echo_rows bigint;
BEGIN
    SELECT count(*)
      INTO stale_echo_rows
      FROM public.user_character
     WHERE active_echo_deity_id IS NOT NULL
       AND active_echo_deity_id IS DISTINCT FROM active_deity_id_2
       AND active_echo_deity_id IS DISTINCT FROM active_deity_id_3;

    IF stale_echo_rows <> 0 THEN
        RAISE EXCEPTION
          'Preset preflight failed: stale_echo_rows = %. Do not apply 20260803_01_user_presets.sql.',
          stale_echo_rows;
    END IF;
END;
$user_presets_preflight$;

SELECT count(*) AS stale_echo_rows
  FROM public.user_character
 WHERE active_echo_deity_id IS NOT NULL
   AND active_echo_deity_id IS DISTINCT FROM active_deity_id_2
   AND active_echo_deity_id IS DISTINCT FROM active_deity_id_3;

COMMIT;

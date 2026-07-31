-- ============================================================================
-- 20260731_02_skjaldmaer_reflect_balance.sql
-- Purpose: synchronize Skjaldmaer's displayed proc reflection with combat behavior.
-- Runtime values live in battleEngine.js/passiveRegistry.js; the roster stores text.
-- Safe to rerun: YES. The transaction aborts unless exactly one roster row matches.
-- ============================================================================

BEGIN;

DO $skjaldmaer_balance$
DECLARE
    affected INTEGER;
    expected_description CONSTANT TEXT :=
      'Reflects 20% of damage taken. Each hit also has a 10% chance to be fully negated and reflect 60% of its would-be damage instead. The two reflects never apply to the same hit.';
BEGIN
    UPDATE public.armor_roster
       SET passive_description = expected_description
     WHERE name = 'Skjaldmaer'
       AND passive_key = 'skjaldmaer';

    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one Skjaldmaer/skjaldmaer row, updated %',
          affected;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.armor_roster
         WHERE name = 'Skjaldmaer'
           AND passive_key = 'skjaldmaer'
           AND passive_description = expected_description
    ) THEN
        RAISE EXCEPTION 'Skjaldmaer passive description verification failed';
    END IF;
END;
$skjaldmaer_balance$;

COMMIT;

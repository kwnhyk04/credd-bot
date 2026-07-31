-- ============================================================================
-- 20260731_01_surt_muspells_flame_balance.sql
-- Purpose: synchronize Surt's displayed Burn values with the combat configuration.
-- Runtime behavior lives in src/engine/combatEffects.js; the roster stores text only.
-- Safe to rerun: YES. The transaction aborts unless exactly one Surt row matches.
-- ============================================================================

BEGIN;

DO $surt_balance$
DECLARE
    affected INTEGER;
    expected_description CONSTANT TEXT :=
      'Each attack adds Burn equal to 3% of the user''s base ATK per turn for 2 turns, stacking up to 15%. Attacks deal 50% more damage to enemies that are already burning.';
BEGIN
    UPDATE public.deity_roster
       SET blessing_description = expected_description
     WHERE name = 'Surt'
       AND blessing_key = 'surt_muspells_flame';

    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION
          'Expected exactly one Surt/surt_muspells_flame row, updated %',
          affected;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.deity_roster
         WHERE name = 'Surt'
           AND blessing_key = 'surt_muspells_flame'
           AND blessing_description = expected_description
    ) THEN
        RAISE EXCEPTION 'Surt blessing description verification failed';
    END IF;
END;
$surt_balance$;

COMMIT;

-- =====================================================================
-- CREDD v9 - Supporter founder number sequence
-- Additive sequence for concurrency-safe founder_number allocation.
-- The live supporters_founder_number_key unique constraint remains the
-- final duplicate-prevention safety net; this migration does not recreate it.
-- =====================================================================
BEGIN;

CREATE SEQUENCE IF NOT EXISTS supporter_founder_number_seq;

DO $$
DECLARE
    max_founder BIGINT;
    seq_last BIGINT;
    seq_called BOOLEAN;
    issued_floor BIGINT;
BEGIN
    SELECT COALESCE(MAX(founder_number), 0)
      INTO max_founder
      FROM supporters;

    SELECT last_value, is_called
      INTO seq_last, seq_called
      FROM supporter_founder_number_seq;

    issued_floor := CASE
        WHEN seq_called THEN seq_last
        ELSE seq_last - 1
    END;

    IF max_founder <= 0 AND issued_floor <= 0 THEN
        PERFORM setval('supporter_founder_number_seq', 1, false);
    ELSE
        PERFORM setval(
            'supporter_founder_number_seq',
            GREATEST(max_founder, issued_floor),
            true
        );
    END IF;
END $$;

COMMIT;

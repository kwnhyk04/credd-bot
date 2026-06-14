-- =====================================================================
-- OPTIONAL [v4.4] — tag the five Greater Bosses in mob_roster.special_flags
--
-- COSMETIC / FUTURE-PROOFING ONLY. The Greater Boss feature works WITHOUT
-- running this: the CODE set in src/config/bosses.js (GREATER_BOSSES) is the
-- source of truth for spawn weighting, 2× HP, and the richer rewards.
-- Run this only if you later want the tier to be data-driven/queryable.
--
-- special_flags is free-form JSONB (schema frozen, no DDL change). This merges
-- {"greater": true} into each row's existing flags (e.g. Sleipnir's first_strike
-- is on the NON-greater bosses, so no conflict — but the || merge is non-destructive).
--
-- NOTE: the Norse giant is seeded as "Jotun" (no diacritic). If your roster used
-- a different spelling, adjust the name list here AND in src/config/bosses.js.
-- =====================================================================

BEGIN;

UPDATE mob_roster
   SET special_flags = special_flags || '{"greater": true}'::jsonb
 WHERE mob_type = 'boss'
   AND name IN ('Jotun', 'Fenrir', 'Fafnir', 'Hydra', 'Cerberus');

COMMIT;

-- Sanity check (expect 5 rows flagged):
SELECT name, special_flags
  FROM mob_roster
 WHERE mob_type = 'boss' AND special_flags ? 'greater'
 ORDER BY name;

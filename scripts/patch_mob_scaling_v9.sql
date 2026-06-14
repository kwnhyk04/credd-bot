-- =====================================================================
-- PATCH v9 — Mob per-level scaling RESCALE (run by hand in Supabase; sandbox has no DB)
--
-- Per-level mob growth is REDUCED so mobs scale up more slowly with level.
-- BASE stats (base_hp / base_atk / base_def) are UNCHANGED — only the three
-- per-level columns move. Bosses untouched.
--
--   Regular: HP +20 / ATK +8  / DEF +5  per level  (was +40/+15/+10)
--   Elite:   HP +40 / ATK +15 / DEF +10 per level  (was +75/+30/+16)
--
-- Column names verified against credd_schema_v4.sql mob_roster:
--   hp_per_level, atk_per_level, def_per_level, mob_type
-- =====================================================================

BEGIN;

UPDATE mob_roster SET hp_per_level = 20, atk_per_level = 8,  def_per_level = 5
 WHERE mob_type = 'regular';

UPDATE mob_roster SET hp_per_level = 40, atk_per_level = 15, def_per_level = 10
 WHERE mob_type = 'elite';

-- Bosses untouched.

COMMIT;

-- Sanity check (expected: regular 20/8/5, elite 40/15/10, boss rows unchanged):
SELECT mob_type,
       COUNT(*)           AS rows,
       MIN(hp_per_level)  AS min_hp_lvl,  MAX(hp_per_level)  AS max_hp_lvl,
       MIN(atk_per_level) AS min_atk_lvl, MAX(atk_per_level) AS max_atk_lvl,
       MIN(def_per_level) AS min_def_lvl, MAX(def_per_level) AS max_def_lvl
FROM mob_roster
GROUP BY mob_type
ORDER BY mob_type;

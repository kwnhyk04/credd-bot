-- =====================================================================
-- PATCH — Mob roster rebalance (run by hand in Supabase; sandbox has no DB)
--
-- Regular mobs were too easy and there was no margin between regular and
-- elite. Elites should require great weapons + an active deity blessing.
-- Base HP values do NOT change — only ATK/DEF bases and the three
-- per-level columns. Bosses untouched. No other roster touched.
--
-- Column names verified against credd_schema_v4.sql mob_roster:
--   base_atk, base_def, hp_per_level, atk_per_level, def_per_level, mob_type
--
-- ⚠️ SUPERSEDED (per-level only) by scripts/patch_mob_scaling_v9.sql [v4.3]:
--   the per-level values set below (regular 40/15/10, elite 75/30/16) are later
--   REDUCED to regular 20/8/5, elite 40/15/10. The base_atk/base_def bumps here
--   still stand. Apply this patch first, then v9, for a fresh-DB == live-DB result.
-- =====================================================================

BEGIN;

-- Regular mobs: +80 base ATK, +50 base DEF; per-level HP 20→40, ATK 8→15, DEF 5→10
UPDATE mob_roster
SET base_atk     = base_atk + 80,
    base_def     = base_def + 50,
    hp_per_level = 40,
    atk_per_level = 15,
    def_per_level = 10
WHERE mob_type = 'regular';

-- Elite mobs: +100 base ATK, +100 base DEF; per-level HP 38→75, ATK 10→30, DEF 8→16
UPDATE mob_roster
SET base_atk     = base_atk + 100,
    base_def     = base_def + 100,
    hp_per_level = 75,
    atk_per_level = 30,
    def_per_level = 16
WHERE mob_type = 'elite';

-- Bosses untouched.

COMMIT;

-- Sanity check (expected: regular rows 40/15/10, elite rows 75/30/16,
-- boss rows unchanged/authored):
SELECT mob_type,
       COUNT(*)                AS rows,
       MIN(hp_per_level)       AS min_hp_lvl,  MAX(hp_per_level)  AS max_hp_lvl,
       MIN(atk_per_level)      AS min_atk_lvl, MAX(atk_per_level) AS max_atk_lvl,
       MIN(def_per_level)      AS min_def_lvl, MAX(def_per_level) AS max_def_lvl
FROM mob_roster
GROUP BY mob_type
ORDER BY mob_type;

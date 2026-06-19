-- Raid/boss balance patch for CREDD Master v4.2.
-- Stat scaling is roster-driven. Boss HP values are exact for the seeded roster,
-- matching base_hp + 50,000 without stacking on reruns.

BEGIN;

UPDATE mob_roster
   SET hp_per_level = 30,
       atk_per_level = 15,
       def_per_level = 10
 WHERE mob_type = 'regular';

UPDATE mob_roster
   SET hp_per_level = 50,
       atk_per_level = 35,
       def_per_level = 20
 WHERE mob_type = 'elite';

UPDATE mob_roster
   SET base_hp = CASE name
     WHEN 'Berberoka' THEN 65000
     WHEN 'Bungisngis' THEN 62000
     WHEN 'Anggitay' THEN 63000
     WHEN 'Dalaketnon' THEN 63500
     WHEN 'Jotun' THEN 68000
     WHEN 'Fenrir' THEN 63000
     WHEN 'Fafnir' THEN 66000
     WHEN 'Sleipnir' THEN 62000
     WHEN 'Cerberus' THEN 64000
     WHEN 'Hydra' THEN 67000
     WHEN 'Medusa' THEN 63500
     ELSE base_hp
   END
 WHERE mob_type = 'boss';

COMMIT;

SELECT mob_type,
       COUNT(*) AS rows_touched,
       MIN(hp_per_level) AS min_hp_per_level,
       MAX(hp_per_level) AS max_hp_per_level,
       MIN(atk_per_level) AS min_atk_per_level,
       MAX(atk_per_level) AS max_atk_per_level,
       MIN(def_per_level) AS min_def_per_level,
       MAX(def_per_level) AS max_def_per_level,
       MIN(base_hp) AS min_base_hp,
       MAX(base_hp) AS max_base_hp
  FROM mob_roster
 WHERE mob_type IN ('regular', 'elite', 'boss')
 GROUP BY mob_type
 ORDER BY mob_type;

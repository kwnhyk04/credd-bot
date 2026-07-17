-- Repair the two grant-only tester avatar assignments.
-- Safe to rerun: ownership and equipped rows are upserted by stable avatar key.

BEGIN;

DO $$
DECLARE
  assignment_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO assignment_count
    FROM (
      VALUES
        ('781417870332002336', 'tester_fighter_female'),
        ('1048193635319029790', 'tester_mage_female')
    ) AS a(discord_id, avatar_key)
    JOIN users u
      ON u.discord_id = a.discord_id
    JOIN user_character uc
      ON uc.discord_id = a.discord_id
    JOIN avatar_catalog ac
      ON ac.avatar_key = a.avatar_key
     AND ac.is_active = TRUE
     AND lower(ac.class_name) = lower(uc.class);

  IF assignment_count <> 2 THEN
    RAISE EXCEPTION 'Expected two active, class-matched tester avatar assignments; found %', assignment_count;
  END IF;
END $$;

WITH assignments(discord_id, avatar_key) AS (
  VALUES
    ('781417870332002336', 'tester_fighter_female'),
    ('1048193635319029790', 'tester_mage_female')
)
INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
SELECT a.discord_id, ac.avatar_id, 'grant', NOW()
  FROM assignments a
  JOIN users u
    ON u.discord_id = a.discord_id
  JOIN user_character uc
    ON uc.discord_id = a.discord_id
  JOIN avatar_catalog ac
    ON ac.avatar_key = a.avatar_key
   AND ac.is_active = TRUE
   AND lower(ac.class_name) = lower(uc.class)
ON CONFLICT (discord_id, avatar_id) DO UPDATE
SET source = 'grant';

WITH assignments(discord_id, avatar_key) AS (
  VALUES
    ('781417870332002336', 'tester_fighter_female'),
    ('1048193635319029790', 'tester_mage_female')
)
INSERT INTO equipped_avatars (discord_id, avatar_id, updated_at)
SELECT a.discord_id, ac.avatar_id, NOW()
  FROM assignments a
  JOIN user_character uc
    ON uc.discord_id = a.discord_id
  JOIN avatar_catalog ac
    ON ac.avatar_key = a.avatar_key
   AND ac.is_active = TRUE
   AND lower(ac.class_name) = lower(uc.class)
  JOIN user_avatars ua
    ON ua.discord_id = a.discord_id
   AND ua.avatar_id = ac.avatar_id
ON CONFLICT (discord_id) DO UPDATE
SET avatar_id = EXCLUDED.avatar_id,
    updated_at = NOW();

COMMIT;

SELECT ea.discord_id,
       ea.avatar_id,
       ac.avatar_key,
       ac.class_name,
       ac.asset_path,
       ua.source AS ownership_source,
       ea.updated_at
  FROM equipped_avatars ea
  JOIN avatar_catalog ac
    ON ac.avatar_id = ea.avatar_id
  JOIN user_avatars ua
    ON ua.discord_id = ea.discord_id
   AND ua.avatar_id = ea.avatar_id
 WHERE ea.discord_id IN ('781417870332002336', '1048193635319029790')
 ORDER BY ea.discord_id;

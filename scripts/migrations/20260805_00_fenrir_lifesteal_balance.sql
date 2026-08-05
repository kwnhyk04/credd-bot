-- Fenrir Gleipnir's Doom and Lifesteal Rune balance update.
-- Safe to rerun: the Fenrir write is keyed to one roster row and the rune write
-- is idempotent. Owned rune values are whole percentages (13 means 13%).

BEGIN;

DO $fenrir_balance$
DECLARE
    affected INTEGER;
    expected_skill_key CONSTANT TEXT := 'fenrir_gleipnirs_doom';
    expected_skill_name CONSTANT TEXT := 'Gleipnir''s Doom';
    expected_description CONSTANT TEXT :=
      'Gleipnir''s Doom: Fenrir begins battle bound by Gleipnir. As his HP falls, the seals break and increase his outgoing damage and armor penetration. At 25% HP or lower, Fenrir becomes Ragnarök Unbound, gaining +35% outgoing damage and +15% armor penetration.';
BEGIN
    UPDATE public.mob_roster
       SET skill_key = expected_skill_key,
           skill_name = expected_skill_name,
           skill_description = expected_description,
           immunity_tags = '[]'::jsonb,
           special_flags = COALESCE(special_flags, '{}'::jsonb)
             - 'bleed' - 'stun' - 'stun_resistance' - 'stun_immune'
     WHERE mob_id = 33
       AND name = 'Fenrir'
       AND mob_type = 'boss';

    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one Fenrir boss row, updated %', affected;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.mob_roster
         WHERE mob_id = 33
           AND name = 'Fenrir'
           AND (
             skill_key <> expected_skill_key
             OR skill_name <> expected_skill_name
             OR skill_description <> expected_description
             OR immunity_tags <> '[]'::jsonb
             OR special_flags ?| ARRAY['bleed', 'stun', 'stun_resistance', 'stun_immune']
           )
    ) THEN
        RAISE EXCEPTION 'Fenrir Gleipnir''s Doom verification failed';
    END IF;
END;
$fenrir_balance$;

-- Keep the original owned values so the exact data update can be rolled back.
CREATE TABLE IF NOT EXISTS public.credd_lifesteal_rune_balance_backup_20260805 (
    rune_uid character varying(8) PRIMARY KEY,
    original_rolled_value numeric,
    captured_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Some hosted SQL editors execute statements in separate autocommit
-- transactions. Do not configure this table to drop at commit: that would delete the audit
-- table immediately after this CREATE before the following statements run.
-- The explicit drop keeps repeated executions in the same session safe.
DROP TABLE IF EXISTS _lifesteal_rune_balance_audit;

CREATE TEMP TABLE _lifesteal_rune_balance_audit AS
SELECT ur.rune_uid,
       rn.tier,
       ur.rolled_value AS before_value,
       CASE rn.tier
         WHEN 'Mythic' THEN 13::numeric
         WHEN 'Legendary' THEN 30::numeric
         WHEN 'Supreme' THEN 45::numeric
       END AS target_value
  FROM public.user_runes ur
  JOIN public.rune_roster rn ON rn.rune_id = ur.rune_id
 WHERE rn.effect_key = 'vampiric'
   AND rn.tier IN ('Mythic', 'Legendary', 'Supreme');

INSERT INTO public.credd_lifesteal_rune_balance_backup_20260805
    (rune_uid, original_rolled_value)
SELECT rune_uid, before_value
  FROM _lifesteal_rune_balance_audit
ON CONFLICT (rune_uid) DO NOTHING;

-- Verification result 1: rows matched and rows that will change, by rarity.
WITH tiers(tier, target_value) AS (
    VALUES
      ('Mythic'::varchar, 13::numeric),
      ('Legendary'::varchar, 30::numeric),
      ('Supreme'::varchar, 45::numeric)
)
SELECT 'before' AS phase,
       t.tier,
       COUNT(a.rune_uid)::int AS matched_runes,
       COUNT(a.rune_uid) FILTER (WHERE a.before_value IS DISTINCT FROM t.target_value)::int AS rows_to_update,
       MIN(a.before_value) AS minimum_value,
       MAX(a.before_value) AS maximum_value
  FROM tiers t
  LEFT JOIN _lifesteal_rune_balance_audit a ON a.tier = t.tier
 GROUP BY t.tier, t.target_value
 ORDER BY CASE t.tier WHEN 'Mythic' THEN 1 WHEN 'Legendary' THEN 2 ELSE 3 END;

UPDATE public.user_runes ur
   SET rolled_value = a.target_value
  FROM _lifesteal_rune_balance_audit a
 WHERE ur.rune_uid = a.rune_uid
   AND ur.rolled_value IS DISTINCT FROM a.target_value;

DO $lifesteal_verify$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM _lifesteal_rune_balance_audit a
          JOIN public.user_runes ur ON ur.rune_uid = a.rune_uid
         WHERE ur.rolled_value IS DISTINCT FROM a.target_value
    ) THEN
        RAISE EXCEPTION 'Lifesteal Rune normalization verification failed';
    END IF;
END;
$lifesteal_verify$;

-- Verification result 2: every matched owned rune now has the exact target value.
WITH tiers(tier, target_value) AS (
    VALUES
      ('Mythic'::varchar, 13::numeric),
      ('Legendary'::varchar, 30::numeric),
      ('Supreme'::varchar, 45::numeric)
)
SELECT 'after' AS phase,
       t.tier,
       COUNT(ur.rune_uid)::int AS matched_runes,
       COUNT(ur.rune_uid) FILTER (WHERE ur.rolled_value = t.target_value)::int AS exact_target_value,
       MIN(ur.rolled_value) AS minimum_value,
       MAX(ur.rolled_value) AS maximum_value
  FROM tiers t
  LEFT JOIN _lifesteal_rune_balance_audit a ON a.tier = t.tier
  LEFT JOIN public.user_runes ur ON ur.rune_uid = a.rune_uid
 GROUP BY t.tier, t.target_value
 ORDER BY CASE t.tier WHEN 'Mythic' THEN 1 WHEN 'Legendary' THEN 2 ELSE 3 END;

COMMIT;

-- Rollback, while the backup table is retained:
-- BEGIN;
-- UPDATE public.user_runes ur
--    SET rolled_value = b.original_rolled_value
--   FROM public.credd_lifesteal_rune_balance_backup_20260805 b
--  WHERE ur.rune_uid = b.rune_uid;
-- COMMIT;
-- Verify with:
-- SELECT rn.tier, COUNT(*)::int AS restored_runes,
--        MIN(ur.rolled_value), MAX(ur.rolled_value)
--   FROM public.user_runes ur
--   JOIN public.rune_roster rn ON rn.rune_id = ur.rune_id
--   JOIN public.credd_lifesteal_rune_balance_backup_20260805 b ON b.rune_uid = ur.rune_uid
--  WHERE rn.effect_key = 'vampiric'
--  GROUP BY rn.tier
--  ORDER BY rn.tier;

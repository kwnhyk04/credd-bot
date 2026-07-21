-- ============================================================================
-- 20260721_11_genesis_dev_avatar_grants.sql
-- Purpose: grant every active Genesis avatar, across all five classes and both
--          genders, to the configured developer accounts.
-- Affected table: public.user_avatars (ownership rows only).
-- Safe to rerun: YES (composite-key conflicts are ignored).
-- Prerequisite: run 20260720_07_genesis_avatar_catalog.sql first.
-- This script does not change avatar_catalog, supporter balances, character
-- classes, equipped avatars, or the class filter used by the supporter shop.
-- ============================================================================

-- Preview the two target accounts and the active Genesis catalog count.
WITH devs(discord_id) AS (
  VALUES
    ('980773258238492762'::text),
    ('1508745825315196979'::text)
)
SELECT d.discord_id, (u.discord_id IS NOT NULL) AS is_registered
  FROM devs d
  LEFT JOIN public.users u ON u.discord_id = d.discord_id
 ORDER BY d.discord_id;

SELECT COUNT(*) AS active_genesis_avatars
  FROM public.avatar_catalog
 WHERE lower(style) = 'genesis'
   AND is_active = TRUE; -- expect 10

BEGIN;

-- Abort without granting anything if a dev is unregistered or the Genesis
-- catalog is incomplete. user_avatars has a foreign key to users. The target
-- ids are statement-local so this script never depends on a CTE/temp relation.
-- Execute this entire named DO statement, including both delimiter lines.
DO $genesis_dev_grant_validation$
DECLARE
  missing_devs text;
  genesis_count integer;
BEGIN
  SELECT string_agg(t.discord_id, ', ' ORDER BY t.discord_id)
    INTO missing_devs
    FROM (VALUES
      ('980773258238492762'::text),
      ('1508745825315196979'::text)
    ) AS t(discord_id)
    LEFT JOIN public.users u ON u.discord_id = t.discord_id
   WHERE u.discord_id IS NULL;

  IF missing_devs IS NOT NULL THEN
    RAISE EXCEPTION 'Genesis dev grant aborted; unregistered dev ids: %', missing_devs;
  END IF;

  SELECT COUNT(*)
    INTO genesis_count
    FROM public.avatar_catalog
   WHERE lower(style) = 'genesis'
     AND is_active = TRUE;

  IF genesis_count <> 10 THEN
    RAISE EXCEPTION 'Genesis dev grant aborted; expected 10 active catalog rows, found %', genesis_count;
  END IF;
END
$genesis_dev_grant_validation$;

INSERT INTO public.user_avatars (discord_id, avatar_id, source, acquired_at)
SELECT t.discord_id, ac.avatar_id, 'dev', NOW()
  FROM (VALUES
    ('980773258238492762'::text),
    ('1508745825315196979'::text)
  ) AS t(discord_id)
 CROSS JOIN public.avatar_catalog ac
 WHERE lower(ac.style) = 'genesis'
   AND ac.is_active = TRUE
ON CONFLICT (discord_id, avatar_id) DO NOTHING;

COMMIT;

-- Validation: each registered dev should own 10 active Genesis avatars.
WITH devs(discord_id) AS (
  VALUES
    ('980773258238492762'::text),
    ('1508745825315196979'::text)
)
SELECT d.discord_id, COUNT(ac.avatar_id) AS active_genesis_owned
  FROM devs d
  LEFT JOIN public.user_avatars ua ON ua.discord_id = d.discord_id
  LEFT JOIN public.avatar_catalog ac
    ON ac.avatar_id = ua.avatar_id
   AND lower(ac.style) = 'genesis'
   AND ac.is_active = TRUE
 GROUP BY d.discord_id
 ORDER BY d.discord_id; -- expect 10 for each row

-- Normal users remain class-restricted because the application shop query
-- filters avatar_catalog by user_character.class. Ownership rows do not alter
-- that query, and this script grants rows only to the explicit dev ids above.
--
-- Rollback: use section [11] in 20260720_09_rollback.sql. It removes only
-- source='dev' Genesis ownership for these two ids and does not touch catalog.

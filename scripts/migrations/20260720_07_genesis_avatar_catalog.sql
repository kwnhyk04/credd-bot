-- ============================================================================
-- 20260720_07_genesis_avatar_catalog.sql
-- Purpose: register the Genesis avatar style (spec section 9) —
--          10 catalog rows (5 classes x 2 genders), token-shop purchasable at
--          15 supporter tokens, asset paths
--          skins/avatars/genesis/{gender}/genesis_{class}_{gender}.png.
-- Affected tables: public.avatar_catalog (constraints + guarded upsert)
-- Safe to rerun: YES (constraint recreate is idempotent; seed uses
--                ON CONFLICT (avatar_key) DO UPDATE).
-- Run BEFORE deploying the Genesis avatar code.
-- ============================================================================

-- Preview: current styles and cost pairs, plus any existing genesis rows
-- (should be none).
SELECT style, token_cost, COUNT(*)
  FROM public.avatar_catalog
 GROUP BY style, token_cost
 ORDER BY style;
SELECT avatar_key FROM public.avatar_catalog WHERE style = 'genesis';

BEGIN;

-- 1) Recreate the style CHECK to include 'genesis'.
--    The repo schema declares an inline CHECK (style IN cyber/anime/webtoon);
--    production also carries grant-only 'founder' and 'tester' rows, so the
--    live constraint may already differ. This block drops EVERY check
--    constraint on avatar_catalog that references the style column except the
--    named token-cost constraint, then adds one named constraint covering the
--    full style list.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.avatar_catalog'::regclass
       AND contype = 'c'
       AND conname <> 'avatar_catalog_style_token_cost'
       AND pg_get_constraintdef(oid) ILIKE '%style%'
  LOOP
    EXECUTE format('ALTER TABLE public.avatar_catalog DROP CONSTRAINT %I', con.conname);
  END LOOP;

  ALTER TABLE public.avatar_catalog
    ADD CONSTRAINT avatar_catalog_style_check CHECK (
      style IN ('cyber', 'anime', 'webtoon', 'founder', 'tester', 'genesis')
    );
END $$;

-- 2) Recreate the style/token-cost CHECK with the genesis arm (15 tokens,
--    same as webtoon) and 0-cost arms for the grant-only styles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'avatar_catalog_style_token_cost'
       AND conrelid = 'public.avatar_catalog'::regclass
  ) THEN
    ALTER TABLE public.avatar_catalog
      DROP CONSTRAINT avatar_catalog_style_token_cost;
  END IF;

  ALTER TABLE public.avatar_catalog
    ADD CONSTRAINT avatar_catalog_style_token_cost CHECK (
      (style = 'cyber'   AND token_cost = 9)
      OR (style = 'anime'   AND token_cost = 12)
      OR (style = 'webtoon' AND token_cost = 15)
      OR (style = 'genesis' AND token_cost = 15)
      OR (style IN ('founder', 'tester') AND token_cost = 0)
    );
END $$;

-- 3) Seed the 10 Genesis rows. avatar_key follows the existing short-key
--    convention: class_folder + first letter of style + first letter of
--    gender (e.g. swordsman_gm / swordsman_gf) — no collision with the
--    cyber (_cm/_cf), anime (_am/_af), or webtoon (_wm/_wf) keys.
WITH seed(class_name, class_folder, gender) AS (
  VALUES
    ('Swordsman', 'swordsman', 'male'), ('Swordsman', 'swordsman', 'female'),
    ('Fighter',   'fighter',   'male'), ('Fighter',   'fighter',   'female'),
    ('Mage',      'mage',      'male'), ('Mage',      'mage',      'female'),
    ('Knight',    'knight',    'male'), ('Knight',    'knight',    'female'),
    ('Archer',    'archer',    'male'), ('Archer',    'archer',    'female')
)
INSERT INTO public.avatar_catalog
  (avatar_key, display_name, class_name, gender, style, token_cost, asset_path, is_active, updated_at)
SELECT
  class_folder || '_g' || left(gender, 1),
  'Genesis ' || initcap(gender) || ' Avatar',
  class_name,
  gender,
  'genesis',
  15,
  'skins/avatars/genesis/' || gender || '/genesis_' || class_folder || '_' || gender || '.png',
  TRUE,
  NOW()
FROM seed
ON CONFLICT (avatar_key)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  class_name  = EXCLUDED.class_name,
  gender      = EXCLUDED.gender,
  style       = EXCLUDED.style,
  token_cost  = EXCLUDED.token_cost,
  asset_path  = EXCLUDED.asset_path,
  is_active   = TRUE,
  updated_at  = NOW();

COMMIT;

-- Validation: exactly 10 active genesis rows with the expected paths.
SELECT avatar_key, class_name, gender, token_cost, asset_path
  FROM public.avatar_catalog
 WHERE style = 'genesis'
 ORDER BY class_name, gender;   -- expect 10 rows

SELECT COUNT(*) AS genesis_rows
  FROM public.avatar_catalog
 WHERE style = 'genesis' AND is_active = TRUE;   -- expect 10

-- Notes:
-- * If the preview showed styles beyond cyber/anime/webtoon/founder/tester,
--   STOP and extend the two CHECK lists above before running, or existing
--   rows will fail constraint validation.
-- * Asset path formula here is byte-identical to the code resolver
--   (genesisAvatarAssetPath) so catalog and code can never disagree.
-- * Rollback: see 20260720_09_rollback.sql.

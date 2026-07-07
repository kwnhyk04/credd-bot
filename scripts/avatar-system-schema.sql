-- Avatar system schema.
-- Assets are R2-relative paths under skins/avatars/{gender}/{class}/...
-- Example: skins/avatars/male/swordsman/swordsman_cyber.png

CREATE TABLE IF NOT EXISTS avatar_catalog (
  avatar_id BIGSERIAL PRIMARY KEY,
  avatar_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  style TEXT NOT NULL CHECK (style IN ('cyber', 'anime', 'webtoon')),
  token_cost INTEGER NOT NULL CONSTRAINT avatar_catalog_style_token_cost CHECK (
    (style = 'cyber' AND token_cost = 9)
    OR (style = 'anime' AND token_cost = 12)
    OR (style = 'webtoon' AND token_cost = 15)
  ),
  asset_path TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_avatars (
  discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
  avatar_id BIGINT NOT NULL REFERENCES avatar_catalog(avatar_id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'shop' CHECK (source IN ('shop', 'grant', 'dev')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discord_id, avatar_id)
);

CREATE TABLE IF NOT EXISTS equipped_avatars (
  discord_id TEXT PRIMARY KEY REFERENCES users(discord_id) ON DELETE CASCADE,
  avatar_id BIGINT NOT NULL REFERENCES avatar_catalog(avatar_id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avatar_catalog_class_style_gender
  ON avatar_catalog (lower(class_name), style, gender)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_avatars_user
  ON user_avatars (discord_id);

CREATE INDEX IF NOT EXISTS idx_equipped_avatars_avatar
  ON equipped_avatars (avatar_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'avatar_catalog_style_token_cost'
  ) THEN
    ALTER TABLE avatar_catalog
      ADD CONSTRAINT avatar_catalog_style_token_cost CHECK (
        (style = 'cyber' AND token_cost = 9)
        OR (style = 'anime' AND token_cost = 12)
        OR (style = 'webtoon' AND token_cost = 15)
      );
  END IF;
END $$;

-- Pricing rule for catalog rows:
--   cyber = 9 supporter tokens
--   anime = 12 supporter tokens
--   webtoon = 15 supporter tokens

WITH seed(class_name, class_folder, gender, style, token_cost) AS (
  VALUES
    ('Swordsman', 'swordsman', 'male', 'cyber', 9),
    ('Swordsman', 'swordsman', 'male', 'anime', 12),
    ('Swordsman', 'swordsman', 'male', 'webtoon', 15),
    ('Swordsman', 'swordsman', 'female', 'cyber', 9),
    ('Swordsman', 'swordsman', 'female', 'anime', 12),
    ('Swordsman', 'swordsman', 'female', 'webtoon', 15),
    ('Fighter', 'fighter', 'male', 'cyber', 9),
    ('Fighter', 'fighter', 'male', 'anime', 12),
    ('Fighter', 'fighter', 'male', 'webtoon', 15),
    ('Fighter', 'fighter', 'female', 'cyber', 9),
    ('Fighter', 'fighter', 'female', 'anime', 12),
    ('Fighter', 'fighter', 'female', 'webtoon', 15),
    ('Mage', 'mage', 'male', 'cyber', 9),
    ('Mage', 'mage', 'male', 'anime', 12),
    ('Mage', 'mage', 'male', 'webtoon', 15),
    ('Mage', 'mage', 'female', 'cyber', 9),
    ('Mage', 'mage', 'female', 'anime', 12),
    ('Mage', 'mage', 'female', 'webtoon', 15),
    ('Knight', 'knight', 'male', 'cyber', 9),
    ('Knight', 'knight', 'male', 'anime', 12),
    ('Knight', 'knight', 'male', 'webtoon', 15),
    ('Knight', 'knight', 'female', 'cyber', 9),
    ('Knight', 'knight', 'female', 'anime', 12),
    ('Knight', 'knight', 'female', 'webtoon', 15),
    ('Archer', 'archer', 'male', 'cyber', 9),
    ('Archer', 'archer', 'male', 'anime', 12),
    ('Archer', 'archer', 'male', 'webtoon', 15),
    ('Archer', 'archer', 'female', 'cyber', 9),
    ('Archer', 'archer', 'female', 'anime', 12),
    ('Archer', 'archer', 'female', 'webtoon', 15)
)
INSERT INTO avatar_catalog
  (avatar_key, display_name, class_name, gender, style, token_cost, asset_path, is_active, updated_at)
SELECT
  class_folder || '_' || left(style, 1) || left(gender, 1),
  initcap(style) || ' ' || initcap(gender) || ' Avatar',
  class_name,
  gender,
  style,
  token_cost,
  'skins/avatars/' || gender || '/' || class_folder || '/' || class_folder || '_' || style || '.png',
  TRUE,
  NOW()
FROM seed
ON CONFLICT (avatar_key)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  class_name = EXCLUDED.class_name,
  gender = EXCLUDED.gender,
  style = EXCLUDED.style,
  token_cost = EXCLUDED.token_cost,
  asset_path = EXCLUDED.asset_path,
  is_active = TRUE,
  updated_at = NOW();

WITH old_keys(class_folder, gender, style) AS (
  VALUES
    ('swordsman', 'male', 'cyber'), ('swordsman', 'male', 'anime'), ('swordsman', 'male', 'webtoon'),
    ('swordsman', 'female', 'cyber'), ('swordsman', 'female', 'anime'), ('swordsman', 'female', 'webtoon'),
    ('fighter', 'male', 'cyber'), ('fighter', 'male', 'anime'), ('fighter', 'male', 'webtoon'),
    ('fighter', 'female', 'cyber'), ('fighter', 'female', 'anime'), ('fighter', 'female', 'webtoon'),
    ('mage', 'male', 'cyber'), ('mage', 'male', 'anime'), ('mage', 'male', 'webtoon'),
    ('mage', 'female', 'cyber'), ('mage', 'female', 'anime'), ('mage', 'female', 'webtoon'),
    ('knight', 'male', 'cyber'), ('knight', 'male', 'anime'), ('knight', 'male', 'webtoon'),
    ('knight', 'female', 'cyber'), ('knight', 'female', 'anime'), ('knight', 'female', 'webtoon'),
    ('archer', 'male', 'cyber'), ('archer', 'male', 'anime'), ('archer', 'male', 'webtoon'),
    ('archer', 'female', 'cyber'), ('archer', 'female', 'anime'), ('archer', 'female', 'webtoon')
)
UPDATE avatar_catalog ac
   SET is_active = FALSE,
       updated_at = NOW()
  FROM old_keys ok
 WHERE ac.avatar_key = ok.class_folder || '_' || ok.gender || '_' || ok.style;

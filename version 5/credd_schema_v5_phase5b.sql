-- ============================================================================
-- CREDD v5 — Phase 5b: more boss-feat titles, per-mythology collection titles,
-- and the boss top-hit ranking metric. Run AFTER credd_schema_v5_phase5.sql.
-- ============================================================================
BEGIN;

-- §1  Highest net damage dealt in a single boss attack (leaderboard metric).
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS boss_top_damage BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_uc_boss_top_damage ON user_character (boss_top_damage DESC);

-- §2  Extended boss-feat titles (participation kills up to 1000).
INSERT INTO title_catalog (code, display, source, is_repeatable, how_to) VALUES
('feat_deicide',           'Deicide',           'boss_feat', TRUE, 'Defeat 400 bosses (participation).'),
('feat_ragnarok_bringer',  'Ragnarok Bringer',  'boss_feat', TRUE, 'Defeat 700 bosses (participation).'),
('feat_eternal_vanquisher','Eternal Vanquisher','boss_feat', TRUE, 'Defeat 1000 bosses (participation).')
ON CONFLICT (code) DO NOTHING;

-- §3  Per-mythology collection titles (own every deity of a pantheon).
INSERT INTO title_catalog (code, display, source, is_repeatable, how_to) VALUES
('coll_ph_keeper',    'Anito Sovereign',    'collection', TRUE, 'Collect every Philippine deity.'),
('coll_norse_keeper', 'Aesir Warden',       'collection', TRUE, 'Collect every Norse deity.'),
('coll_greek_keeper', 'Olympian Ascendant', 'collection', TRUE, 'Collect every Greek deity.')
ON CONFLICT (code) DO NOTHING;

COMMIT;

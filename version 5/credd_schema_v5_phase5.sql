-- ============================================================================
-- CREDD v5 — Phase 5: Seasons & Titles
-- Run AFTER credd_schema_v5b_runes_seasons.sql (seasons/title_catalog/user_titles)
-- and credd_schema_v5_phase4.sql. Safe to re-run.
-- ============================================================================
BEGIN;

-- §1  Title display flexibility — short "how to obtain" text + OPTIONAL PNG art.
--     image_filename stays NULL until you drop a PNG in assets/titles/<file>;
--     the renderer treats NULL as "text-only", so adding art later never breaks.
ALTER TABLE title_catalog
    ADD COLUMN IF NOT EXISTS how_to         VARCHAR(160),
    ADD COLUMN IF NOT EXISTS image_filename VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles (discord_id);

-- §2  Believer-milestone titles (source 'believer'). Mirrors §18 believerTitle().
INSERT INTO title_catalog (code, display, source, is_repeatable, how_to) VALUES
('believer_wanderer',          'Wanderer',          'believer', TRUE, 'Begin your journey (Believer Lv 1).'),
('believer_devotee',           'Devotee',           'believer', TRUE, 'Reach Believer Level 10.'),
('believer_disciple',          'Disciple',          'believer', TRUE, 'Reach Believer Level 25.'),
('believer_zealot',            'Zealot',            'believer', TRUE, 'Reach Believer Level 50.'),
('believer_champion_of_faith', 'Champion of Faith', 'believer', TRUE, 'Reach Believer Level 100.'),
('believer_chosen_one',        'Chosen One',        'believer', TRUE, 'Reach Believer Level 200.'),
('believer_last_believer',     'Last Believer',     'believer', TRUE, 'Reach Believer Level 500.')
ON CONFLICT (code) DO NOTHING;

-- §3  Backfill how_to for the rows seeded in v5b §C.
UPDATE title_catalog SET how_to = 'Season-end reward for reaching the Divine bracket that season.'
  WHERE source = 'rank_season' AND how_to IS NULL;
UPDATE title_catalog SET how_to = 'Defeat 50 bosses (participation).'  WHERE code = 'feat_godslayer';
UPDATE title_catalog SET how_to = 'Defeat 200 bosses (participation).' WHERE code = 'feat_world_ender';
UPDATE title_catalog SET how_to = 'Collect every available deity.'    WHERE code = 'coll_pantheon_keeper';

-- §4  A couple of event titles (granted manually via `crd dev grant title`).
INSERT INTO title_catalog (code, display, source, is_repeatable, how_to) VALUES
('event_founder', 'Founder',     'event', FALSE, 'Awarded to early supporters.'),
('event_beta',    'Beta Tester', 'event', FALSE, 'Awarded for testing during beta.')
ON CONFLICT (code) DO NOTHING;

COMMIT;

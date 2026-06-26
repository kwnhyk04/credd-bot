-- ============================================================================
-- CREDD v5 — Phase 3: Pantheon System (3 deity slots + echo blessings)
-- Run AFTER credd_schema_v5_migration.sql (Phase 0) which added
-- active_deity_id_2 and active_deity_id_3 columns.
-- ============================================================================

-- §1  Echo blessing slot — tracks which slot 2/3 deity provides the echo blessing
ALTER TABLE user_character
    ADD COLUMN IF NOT EXISTS active_echo_deity_id INTEGER
        REFERENCES user_deities (user_deity_id) ON DELETE SET NULL;

-- §2  Mark binary (once-per-battle / survive-lethal) blessings — these cannot
--     fire as echo blessings, only as slot 1 divine blessings.
UPDATE deity_roster SET blessing_scaling = 'binary'
  WHERE blessing_key IN (
    'sidapa_deaths_reprieve',
    'baldur_invulnerability',
    'idunn_golden_apple',
    'persephone_cycle_of_renewal',
    'freya_valkyries_embrace',
    'heimdall_eternal_vigilance'
  );

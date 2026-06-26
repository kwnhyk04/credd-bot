-- ============================================================================
-- CREDD v5 — Phase 4 leaderboard indexes
-- Descending B-tree indexes so each top-15 board is an index scan, not a sort.
-- Run AFTER credd_schema_v5_phase4.sql. Safe to re-run (IF NOT EXISTS).
-- ============================================================================
BEGIN;

CREATE INDEX IF NOT EXISTS idx_uc_pvp_rating     ON user_character (pvp_rating DESC);
CREATE INDEX IF NOT EXISTS idx_uc_pvp_wins       ON user_character (pvp_wins DESC);
CREATE INDEX IF NOT EXISTS idx_uc_raids_won      ON user_character (raids_won DESC);
CREATE INDEX IF NOT EXISTS idx_uc_combat_level   ON user_character (combat_level DESC);
CREATE INDEX IF NOT EXISTS idx_uc_believer_level ON user_character (believer_level DESC);
CREATE INDEX IF NOT EXISTS idx_uc_boss_kills     ON user_character (boss_kills DESC);
-- "Raids Done" sorts on (raids_won + raids_lost) — an expression index covers it.
CREATE INDEX IF NOT EXISTS idx_uc_raids_done     ON user_character ((raids_won + raids_lost) DESC);
-- Lifetime credux lives on users_bag.
CREATE INDEX IF NOT EXISTS idx_ub_lifetime_credux ON users_bag (lifetime_credux_earned DESC);

COMMIT;

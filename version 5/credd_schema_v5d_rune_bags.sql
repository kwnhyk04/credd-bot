-- =====================================================================
-- CREDD BOT — SCHEMA MIGRATION v5d  (RUNE BAG stockpile columns)
-- ADDITIVE to v5_migration + v5b_runes_seasons. Run AFTER both. Idempotent.
-- Phase 2 (runes) — rune bags are STOCKPILED items: bought via `crd essence shop`
-- (`crd exchange [id]`), held in users_bag, and consumed by `crd open lb/gb/db`.
-- =====================================================================
-- Reconciliation note: the v5b `essence_bag_def` table still supplies the OPEN
-- drop tables (its `rune_pool` weighted tier tables). Its `open_command`/cost
-- columns are superseded — the open aliases (lb/gb/db -> lesser/greater/divine)
-- and the 6 essence-shop purchase costs live in code (src/config/runes.js).
-- =====================================================================

BEGIN;

ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS lesser_rune_bag  INT NOT NULL DEFAULT 0;
ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS greater_rune_bag INT NOT NULL DEFAULT 0;
ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS divine_rune_bag  INT NOT NULL DEFAULT 0;

COMMIT;

-- Verify: users_bag now has lesser_rune_bag / greater_rune_bag / divine_rune_bag (default 0).

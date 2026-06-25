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
-- Current rune bag prices: Lesser 10 Mythic + 50,000 Credux; Greater
-- 10 Legendary + 125,000 Credux; Divine 10 Supreme + 250,000 Credux.
-- Essence upgrade prices use the same Credux ladder.
-- =====================================================================

BEGIN;

ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS lesser_rune_bag  INT NOT NULL DEFAULT 0;
ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS greater_rune_bag INT NOT NULL DEFAULT 0;
ALTER TABLE users_bag ADD COLUMN IF NOT EXISTS divine_rune_bag  INT NOT NULL DEFAULT 0;

COMMIT;

-- Verify: users_bag now has lesser_rune_bag / greater_rune_bag / divine_rune_bag (default 0).

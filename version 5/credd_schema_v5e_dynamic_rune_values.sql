-- =====================================================================
-- CREDD BOT - SCHEMA MIGRATION v5e  (DYNAMIC PER-OWNED RUNE VALUES)
-- ADDITIVE to v5_migration + v5b/v5d rune work. Run once on live DB.
-- =====================================================================

BEGIN;

-- Store the actual roll on each owned rune. The range table lives in
-- src/config/runes.js (RUNE_VALUE_RANGES); rune_roster.value remains the
-- legacy/default fallback and midpoint reference.
ALTER TABLE user_runes
    ADD COLUMN IF NOT EXISTS rolled_value DECIMAL(6,2);

-- Preserve existing owned runes at their current fixed value unless you choose
-- to wipe user_runes before launching dynamic rune rolls.
UPDATE user_runes ur
   SET rolled_value = rr.value
  FROM rune_roster rr
 WHERE ur.rune_id = rr.rune_id
   AND ur.rolled_value IS NULL;

-- Keep DB bag definitions synced with the code-side essence shop pricing.
-- The bot stockpiles rune bags in users_bag; essence_bag_def remains the
-- authoritative weighted rune tier pool for opening those bags.
UPDATE essence_bag_def
   SET essence_cost = 10,
       credux_cost = 50000,
       rune_pool = '[{"tier":"Rare","weight":100}]'::jsonb
 WHERE bag_key = 'lesser';

UPDATE essence_bag_def
   SET essence_cost = 10,
       credux_cost = 125000,
       rune_pool = '[{"tier":"Mythic","weight":85},{"tier":"Legendary","weight":15}]'::jsonb
 WHERE bag_key = 'greater';

UPDATE essence_bag_def
   SET essence_cost = 10,
       credux_cost = 250000,
       rune_pool = '[{"tier":"Legendary","weight":85},{"tier":"Supreme","weight":15}]'::jsonb
 WHERE bag_key = 'divine';

-- Optional full rune reset before launch, if you want every future rune to be
-- freshly rolled by the new config. Uncomment intentionally:
--
-- UPDATE user_weapons
--    SET native_sockets = '[]'::jsonb,
--        opposite_sockets = '[]'::jsonb;
--
-- UPDATE user_armors
--    SET native_sockets = '[]'::jsonb,
--        opposite_sockets = '[]'::jsonb;
--
-- DELETE FROM user_runes;

COMMIT;


-- ============================================================================
-- 20260720_06_pvp_celestial_rewards.sql
-- Purpose: seed the Celestial row in ranked_reward (weekly + season rewards
--          for the new highest PvP rank, spec section 15).
-- Affected tables: public.ranked_reward (one INSERT, duplicate-guarded)
-- Safe to rerun: YES (ON CONFLICT (bracket) DO NOTHING).
-- Run AFTER 20260720_05_pvp_celestial_rank.sql (the CHECK must allow
-- 'Celestial' first).
--
-- *** TUNE ME ***
-- Reward values live only in the live database (the repo never seeds them).
-- This script COPIES THE DIVINE ROW as a starting point so the new rank is
-- never worse than the old top rank. Review the inserted values afterwards
-- and UPDATE them to the intended Celestial rewards.
-- ============================================================================

-- Preview: current reward rows (Divine is the copy source; Celestial should
-- not exist yet).
SELECT bracket, weekly_credux, weekly_valor, season_valor,
       weekly_payload, season_end_payload
  FROM public.ranked_reward
 ORDER BY bracket;

BEGIN;

INSERT INTO public.ranked_reward
       (bracket, weekly_credux, weekly_payload, season_end_payload,
        weekly_valor, season_valor)
SELECT 'Celestial', weekly_credux, weekly_payload, season_end_payload,
       weekly_valor, season_valor
  FROM public.ranked_reward
 WHERE bracket = 'Divine'
ON CONFLICT (bracket) DO NOTHING;

COMMIT;

-- Validation: Celestial row exists.
SELECT bracket, weekly_credux, weekly_valor, season_valor
  FROM public.ranked_reward
 WHERE bracket = 'Celestial';

-- Example tuning UPDATE (run manually after deciding final values):
-- UPDATE public.ranked_reward
--    SET weekly_credux = <credux>, weekly_valor = <valor>,
--        weekly_payload = '<json>'::jsonb,
--        season_end_payload = '<json>'::jsonb, season_valor = <valor>
--  WHERE bracket = 'Celestial';

-- Notes:
-- * If the Divine row does not exist, the INSERT inserts nothing — seed
--   Divine first (the validation query above will return zero rows).
-- * Rollback: see 20260720_09_rollback.sql (DELETE the Celestial row).


bracket,weekly_credux,weekly_payload,season_end_payload,weekly_valor,season_valor
Celestial,1000000,"[{""qty"":1,""item"":""boss_golden""}]","[{""code"":""season_celestial_exclusive"",""type"":""title""},{""qty"":1,""item"":""genesis_chest""},{""qty"":1,""item"":""supreme_relic""}]",600,4000

update ranked_reward set weekly_payload ='[{"qty":3,"item":"boss_treasure"}]', season_end_payload = '[{"code":"season_rank","type":"title"},{"qty":1,"item":"supreme_chest"},{"qty":1,"item":"supreme_relic"}]'
where bracket = 'Divine';

update ranked_reward set weekly_payload ='[{"qty":2,"item":"boss_treasure"}]', season_end_payload = '[{"code":"season_rank","type":"title"},{"qty":1,"item":"boss_golden"}]'
where bracket = 'Ascendant';
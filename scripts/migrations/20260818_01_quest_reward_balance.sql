-- Daily difficulty rewards and weekly Credux reward balance.
-- Existing incomplete rows keep their target/progress while receiving the new
-- reward that the application will display and grant on completion.

BEGIN;

UPDATE public.daily_quests
   SET reward_credux = CASE
         WHEN quest_type IN ('elite_defeats', 'credux_spent', 'weapon_enhancements') THEN 100000
         WHEN quest_type IN ('duel_wins', 'duel_challenges', 'duel_participations') THEN 50000
         ELSE 30000
       END,
       reward_belief_shards = CASE
         WHEN quest_type IN ('elite_defeats', 'credux_spent', 'weapon_enhancements') THEN 1000
         WHEN quest_type IN ('duel_wins', 'duel_challenges', 'duel_participations') THEN 750
         ELSE 500
       END
 WHERE completed = FALSE;

UPDATE public.weekly_quests
   SET reward_credux = 100000
 WHERE completed = FALSE;

COMMIT;

-- Validation: both queries must return zero rows.
SELECT id, quest_type, reward_credux, reward_belief_shards
  FROM public.daily_quests
 WHERE completed = FALSE
   AND (reward_credux, reward_belief_shards) IS DISTINCT FROM (
     CASE
       WHEN quest_type IN ('elite_defeats', 'credux_spent', 'weapon_enhancements') THEN 100000
       WHEN quest_type IN ('duel_wins', 'duel_challenges', 'duel_participations') THEN 50000
       ELSE 30000
     END,
     CASE
       WHEN quest_type IN ('elite_defeats', 'credux_spent', 'weapon_enhancements') THEN 1000
       WHEN quest_type IN ('duel_wins', 'duel_challenges', 'duel_participations') THEN 750
       ELSE 500
     END
   );

SELECT id, quest_type, reward_credux
  FROM public.weekly_quests
 WHERE completed = FALSE
   AND reward_credux IS DISTINCT FROM 100000;

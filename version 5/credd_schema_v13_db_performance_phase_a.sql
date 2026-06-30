-- v13: DB performance quick wins.
-- Additive only. Covers boss live view top-damage reads, profile/stat streak scans,
-- and server leaderboard guild membership joins.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_boss_attack_spawn_damage
ON boss_attack_log (boss_spawn_id, total_damage DESC, attacked_at ASC)
INCLUDE (discord_id);

CREATE INDEX IF NOT EXISTS idx_raid_logs_player_type_time_id
ON raid_logs (discord_id, battle_type, timestamp DESC, id DESC)
INCLUDE (result);

CREATE INDEX IF NOT EXISTS idx_ranked_logs_player_time_id_desc
ON ranked_logs (player_id, timestamp DESC, id DESC)
INCLUDE (result);

CREATE INDEX IF NOT EXISTS idx_user_guild_activity_guild_discord
ON user_guild_activity (guild_id, discord_id);

COMMIT;

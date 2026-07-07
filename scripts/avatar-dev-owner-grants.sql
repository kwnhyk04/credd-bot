-- Grant every active avatar to the two developer accounts.
-- Requires the users rows to already exist because user_avatars.discord_id references users(discord_id).

WITH devs(discord_id) AS (
  VALUES
    ('980773258238492762'),
    ('1508745825315196979')
)
INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
SELECT d.discord_id, ac.avatar_id, 'dev', NOW()
  FROM devs d
  JOIN users u ON u.discord_id = d.discord_id
 CROSS JOIN avatar_catalog ac
 WHERE ac.is_active = TRUE
ON CONFLICT (discord_id, avatar_id) DO NOTHING;

-- Read-only verification for 20260803_02_custom_content_tickets.sql.
-- The live concurrent idempotency test remains deferred until a scratch Postgres endpoint exists.
BEGIN;
SET TRANSACTION READ ONLY;

SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('tickets', 'supporter_item_grants')
 ORDER BY table_name;

SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'users_bag'
   AND column_name IN ('custom_avatar_token', 'custom_deity_token')
 ORDER BY column_name;

SELECT conname, contype
  FROM pg_constraint
 WHERE conrelid IN ('public.users_bag'::regclass,
                    'public.tickets'::regclass,
                    'public.supporter_item_grants'::regclass)
   AND conname IN (
     'users_bag_pkey',
     'users_bag_custom_avatar_token_check',
     'users_bag_custom_deity_token_check',
     'tickets_pkey',
     'supporter_item_grants_pkey',
     'supporter_item_grants_idempotency_key'
   )
 ORDER BY conrelid::regclass::text, conname;

SELECT relname AS table_name, relrowsecurity AS row_level_security
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
 WHERE nspname = 'public'
   AND relname IN ('tickets', 'supporter_item_grants')
 ORDER BY relname;

SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname = 'idx_tickets_status_type_created';

COMMIT;

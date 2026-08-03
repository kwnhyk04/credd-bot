-- Read-only verification for the retained Monthsary event claim guards.
DO $$
DECLARE
  target_table text;
  expected_columns text[] := ARRAY['event_key', 'user_id', 'event_day', 'claimed_at'];
  actual_columns text[];
  pk_columns text[];
  total_fks integer;
  cascade_fks integer;
  check_count integer;
  rls_enabled boolean;
  duplicate_groups bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['event_attendance', 'event_quest_claims'] LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'missing public.%', target_table;
    END IF;

    SELECT array_agg(column_name::text ORDER BY ordinal_position)
      INTO actual_columns
      FROM information_schema.columns
     WHERE table_schema = 'public' AND information_schema.columns.table_name = target_table;
    IF actual_columns IS DISTINCT FROM expected_columns THEN
      RAISE EXCEPTION 'public.% columns are %, expected %', target_table, actual_columns, expected_columns;
    END IF;

    IF 4 <> (
      SELECT count(*)
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = target_table
         AND c.is_nullable = 'NO'
         AND (
           (c.column_name = 'event_key' AND c.data_type = 'text')
           OR (c.column_name = 'user_id' AND c.data_type = 'character varying'
               AND c.character_maximum_length = 20)
           OR (c.column_name = 'event_day' AND c.data_type = 'smallint')
           OR (c.column_name = 'claimed_at' AND c.data_type = 'timestamp with time zone'
               AND c.column_default LIKE '%now()%')
         )
    ) THEN
      RAISE EXCEPTION 'public.% has an unexpected column type, nullability, or claimed_at default', target_table;
    END IF;

    SELECT array_agg(a.attname::text ORDER BY k.ordinality)
      INTO pk_columns
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.conrelid = ('public.' || target_table)::regclass AND c.contype = 'p';
    IF pk_columns IS DISTINCT FROM ARRAY['event_key', 'user_id', 'event_day']::text[] THEN
      RAISE EXCEPTION 'public.% primary key is %, expected event_key/user_id/event_day', target_table, pk_columns;
    END IF;

    SELECT count(*)::int,
           count(*) FILTER (
             WHERE c.confrelid = 'public.users'::regclass
               AND c.confdeltype = 'c'
               AND src.attname = 'user_id'
               AND dst.attname = 'discord_id'
               AND array_length(c.conkey, 1) = 1
               AND array_length(c.confkey, 1) = 1
           )::int
      INTO total_fks, cascade_fks
      FROM pg_constraint c
      LEFT JOIN pg_attribute src
        ON src.attrelid = c.conrelid AND src.attnum = c.conkey[1]
      LEFT JOIN pg_attribute dst
        ON dst.attrelid = c.confrelid AND dst.attnum = c.confkey[1]
     WHERE c.conrelid = ('public.' || target_table)::regclass AND c.contype = 'f';
    IF total_fks <> 1 OR cascade_fks <> 1 THEN
      RAISE EXCEPTION 'public.% must have only user_id -> users.discord_id ON DELETE CASCADE', target_table;
    END IF;

    SELECT count(*)::int
      INTO check_count
      FROM pg_constraint
     WHERE conrelid = ('public.' || target_table)::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_day%1%7%';
    IF check_count < 1 THEN
      RAISE EXCEPTION 'public.% is missing the event_day 1..7 check', target_table;
    END IF;

    SELECT relrowsecurity INTO rls_enabled
      FROM pg_class
     WHERE oid = ('public.' || target_table)::regclass;
    IF rls_enabled IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', target_table;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM (SELECT 1 FROM public.%I GROUP BY event_key, user_id, event_day HAVING count(*) > 1) d',
      target_table
    ) INTO duplicate_groups;
    IF duplicate_groups <> 0 THEN
      RAISE EXCEPTION 'public.% has % duplicate claim groups', target_table, duplicate_groups;
    END IF;
  END LOOP;
END $$;

SELECT 'monthsary event claim tables verified' AS result;

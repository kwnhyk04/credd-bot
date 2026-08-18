-- Rename the Genesis weapon tier to Divine and recompute every owned First Arm
-- on the Divine enhancement curve. The genesis_chest inventory column and the
-- separate Genesis avatar style are intentionally unchanged.

BEGIN;

-- Live CHECK names may have drifted. Replace only checks that constrain the
-- weapon_roster.tier column, leaving type and unrelated checks untouched.
DO $divine_weapon_tier_constraints$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
      FROM pg_constraint AS c
     WHERE c.conrelid = 'public.weapon_roster'::regclass
       AND c.contype = 'c'
       AND EXISTS (
         SELECT 1
           FROM unnest(c.conkey) AS constrained_column(attnum)
           JOIN pg_attribute AS a
             ON a.attrelid = c.conrelid
            AND a.attnum = constrained_column.attnum
          WHERE a.attname = 'tier'
       )
       AND (
         c.conname = 'weapon_roster_tier_check'
         OR pg_get_constraintdef(c.oid) ILIKE '%Genesis%'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.weapon_roster DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END
$divine_weapon_tier_constraints$;

UPDATE public.weapon_roster
   SET tier = 'Divine'
 WHERE tier = 'Genesis';

-- image_filename remains filename-only by schema convention. The application
-- adds the tier-specific `weapons/divine/` R2 directory when resolving these
-- five rows. Repair stale path-bearing metadata without touching other gear.
UPDATE public.weapon_roster AS wr
   SET image_filename = expected.image_filename
  FROM (VALUES
    ('kiri', 'kiri.png'),
    ('moira', 'moira.png'),
    ('sophia', 'sophia.png'),
    ('atlas', 'atlas.png'),
    ('titan', 'titan.png')
  ) AS expected(passive_key, image_filename)
 WHERE wr.passive_key = expected.passive_key
   AND wr.image_filename IS DISTINCT FROM expected.image_filename;

-- Some manually maintained metadata snapshots prefixed these descriptions
-- with the former tier. Normalize only the five First Arms when that prefix is
-- actually present; descriptions without a tier prefix remain byte-for-byte.
UPDATE public.weapon_roster
   SET passive_description = regexp_replace(
         passive_description,
         '^\[Genesis\]',
         '[Divine]',
         'i'
       )
 WHERE passive_key IN ('kiri', 'moira', 'sophia', 'atlas', 'titan')
   AND passive_description ~* '^\[Genesis\]';

ALTER TABLE public.weapon_roster
  ADD CONSTRAINT weapon_roster_tier_check
  CHECK (tier IN ('Common', 'Rare', 'Mythic', 'Legendary', 'Supreme', 'Divine'));

-- Stored enhancement is display level + 1.
-- +0..+10: 1.00 + 0.10 per level.
-- +11..+20: 2.00 + 0.20 per level after +10.
UPDATE public.user_weapons AS uw
   SET curr_atk = floor(
         uw.base_atk::numeric * CASE
           WHEN uw.enhancement <= 11
             THEN 1.0 + (uw.enhancement - 1) * 0.10
           ELSE 2.0 + (uw.enhancement - 11) * 0.20
         END
       )::integer
  FROM public.weapon_roster AS wr
 WHERE wr.weapon_roster_id = uw.weapon_roster_id
   AND wr.tier = 'Divine'
   AND uw.enhancement BETWEEN 1 AND 21;

COMMIT;

-- Validation: all four queries must return zero rows.
SELECT weapon_roster_id, name, tier
  FROM public.weapon_roster
 WHERE tier = 'Genesis';

SELECT wr.weapon_roster_id, wr.name, wr.tier, wr.image_filename,
       expected.image_filename AS expected_image_filename
  FROM (VALUES
    ('kiri', 'kiri.png'),
    ('moira', 'moira.png'),
    ('sophia', 'sophia.png'),
    ('atlas', 'atlas.png'),
    ('titan', 'titan.png')
  ) AS expected(passive_key, image_filename)
  LEFT JOIN public.weapon_roster AS wr
    ON wr.passive_key = expected.passive_key
 WHERE wr.weapon_roster_id IS NULL
    OR wr.tier IS DISTINCT FROM 'Divine'
    OR wr.image_filename IS DISTINCT FROM expected.image_filename
    OR wr.passive_description ~* '^\[Genesis\]';

SELECT uw.weapon_id, wr.name, uw.enhancement - 1 AS display_level,
       uw.curr_atk,
       floor(
         uw.base_atk::numeric * CASE
           WHEN uw.enhancement <= 11
             THEN 1.0 + (uw.enhancement - 1) * 0.10
           ELSE 2.0 + (uw.enhancement - 11) * 0.20
         END
       )::integer AS expected_curr_atk
  FROM public.user_weapons AS uw
  JOIN public.weapon_roster AS wr
    ON wr.weapon_roster_id = uw.weapon_roster_id
 WHERE wr.tier = 'Divine'
   AND uw.curr_atk IS DISTINCT FROM floor(
     uw.base_atk::numeric * CASE
       WHEN uw.enhancement <= 11
         THEN 1.0 + (uw.enhancement - 1) * 0.10
       ELSE 2.0 + (uw.enhancement - 11) * 0.20
     END
   )::integer;

SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.weapon_roster'::regclass
   AND conname = 'weapon_roster_tier_check'
   AND pg_get_constraintdef(oid) NOT ILIKE '%Divine%';

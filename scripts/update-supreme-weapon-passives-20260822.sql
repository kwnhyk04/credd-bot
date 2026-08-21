-- Manual, targeted description synchronization for the four Supreme weapons.
-- Review and run in Supabase SQL Editor. This file was not executed by Codex.
-- It changes only weapon_roster.passive_description and is safe to rerun.

BEGIN;

UPDATE public.weapon_roster
   SET passive_description = 'Normal attacks deal +50% damage. Every 3rd turn, the primary attack gains +200% ATK instead; the +50% damage bonus does not apply to that burst.'
 WHERE name = 'Mjolnir'
   AND tier = 'Supreme'
   AND passive_key = 'mjolnir';

UPDATE public.weapon_roster
   SET passive_description = 'Each attack ignores 30% of enemy DEF and has a 20% chance to use 60% total DEF penetration for that attack.'
 WHERE name = 'Gungnir'
   AND tier = 'Supreme'
   AND passive_key = 'gungnir';

UPDATE public.weapon_roster
   SET passive_description = 'Each critical attack deals +100% bonus ATK and applies Paralyze for 1 turn.'
 WHERE name = 'Thunderbolt of Zeus'
   AND tier = 'Supreme'
   AND passive_key = 'thunderbolt_of_zeus';

UPDATE public.weapon_roster
   SET passive_description = 'Every 2nd turn, deals +100% bonus ATK and reduces enemy DEF by 20% for 1 turn, with a 30% chance to stun for 1 turn.'
 WHERE name = 'Trident of Poseidon'
   AND tier = 'Supreme'
   AND passive_key = 'trident_of_poseidon';

COMMIT;

SELECT name, tier, passive_key, passive_description
  FROM public.weapon_roster
 WHERE tier = 'Supreme'
   AND passive_key IN (
       'mjolnir',
       'gungnir',
       'thunderbolt_of_zeus',
       'trident_of_poseidon'
   )
 ORDER BY name;

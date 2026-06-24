-- Align existing v5 databases with the Mantle of Bathala runtime cap.
BEGIN;

UPDATE armor_roster
   SET passive_description = 'Increases HP and DEF by 5% every turn, stacking up to +50% each.'
 WHERE passive_key = 'mantle_of_bathala';

COMMIT;

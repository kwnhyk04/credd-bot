BEGIN;

UPDATE deity_roster
   SET blessing_name = 'Divine Vessel',
       blessing_description = 'At the start of each turn before attacking, gains 10% of base battle ATK and DEF, stacking additively up to 10 times (100%). Resets after battle.'
 WHERE blessing_key = 'bathala_divine_vessel';

UPDATE deity_roster
   SET blessing_name = 'All-Father''s Foresight',
       blessing_description = 'On even-numbered battle turns, takes 25% less damage and stores the damage prevented. On the immediately following odd-numbered turn, adds the stored amount to the next attack, then clears it. Resets after battle.'
 WHERE blessing_key = 'odin_all_fathers_wisdom';

UPDATE deity_roster
   SET blessing_name = 'Chain Lightning',
       blessing_description = 'On each attack, has a 50% chance to deal 50% additional damage and apply a 5% DEF shred. DEF shred stacks up to 6 times (30%) and resets after battle.'
 WHERE blessing_key = 'zeus_thunder_sovereign';

COMMIT;

SELECT name, blessing_key, blessing_name, blessing_description
  FROM deity_roster
 WHERE blessing_key IN (
       'bathala_divine_vessel',
       'odin_all_fathers_wisdom',
       'zeus_thunder_sovereign'
 )
 ORDER BY name;

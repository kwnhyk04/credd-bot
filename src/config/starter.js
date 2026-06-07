'use strict';

/**
 * Starter constants (Master §35.6 / §23).
 * Initiate's Blade is a REAL weapon_roster row (already seeded). On character
 * creation a user_weapons row is generated from these fixed stats and equipped.
 * weapon_roster has no stat columns, so the base stats live here.
 *
 * Creation grant (granted ONLY at character creation — NOT at registration):
 *   1,000 Belief Shards + 10 Silver Chests.
 */
module.exports = {
  STARTER_WEAPON_NAME: "Initiate's Blade",
  STARTER_WEAPON: {
    atk: 15,
    hp: 30,
    def: 12,
    crit: 1.0, // DECIMAL(4,1)
  },
  GRANT_BELIEF_SHARDS: 1000,
  GRANT_SILVER_CHESTS: 10,
};

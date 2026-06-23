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
    crit: 1.0, // DECIMAL(4,1)
    // [v5] HP/DEF removed from weapons — weapons are ATK + CRIT only.
  },
  // [v5] Starter armor granted + equipped at character creation alongside the Blade,
  // so a fresh character isn't pure glass now that HP/DEF live on armor (§F.2).
  STARTER_ARMOR_NAME: "Initiate's Garb",
  STARTER_ARMOR: {
    hp: 40,
    def: 10,
  },
  GRANT_BELIEF_SHARDS: 1000,
  GRANT_SILVER_CHESTS: 10,
};

'use strict';

const crypto = require('crypto');

// 8-char id from [0-9a-z]; column is VARCHAR(8) (§7).
// [v5] weapon_id AND armor_id must be unique across BOTH gear tables so
// `crd equip` / `crd equipment info` / `crd enhance` never hit an ambiguous id.
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateWeaponId() {
  const bytes = crypto.randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) id += ALPHABET[bytes[i] % 36];
  return id;
}

/** True if `id` is free in both user_weapons and user_armors (cross-table uniqueness). */
async function gearIdFree(client, id) {
  const { rows } = await client.query(
    `SELECT 1 FROM user_weapons WHERE weapon_id = $1
     UNION ALL
     SELECT 1 FROM user_armors WHERE armor_id = $1
     LIMIT 1`,
    [id]
  );
  return rows.length === 0;
}

/**
 * Generate an 8-char gear id guaranteed unique against user_weapons AND user_armors.
 * Uses the provided pg client (participates in the caller's transaction).
 */
async function generateUniqueGearId(client) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateWeaponId();
    if (await gearIdFree(client, id)) return id;
  }
  throw new Error('Failed to generate a unique gear id after 10 attempts');
}

// Back-compat aliases — both now enforce cross-table uniqueness.
const generateUniqueWeaponId = generateUniqueGearId;
const generateUniqueArmorId = generateUniqueGearId;

module.exports = {
  generateWeaponId,
  generateUniqueGearId,
  generateUniqueWeaponId,
  generateUniqueArmorId,
};

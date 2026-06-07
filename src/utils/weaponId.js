'use strict';

const crypto = require('crypto');

// 8-char id from [0-9a-z]; column is VARCHAR(8), globally unique (§7).
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateWeaponId() {
  const bytes = crypto.randomBytes(8);
  let id = '';
  for (let i = 0; i < 8; i++) id += ALPHABET[bytes[i] % 36];
  return id;
}

/**
 * Generate an 8-char weapon_id guaranteed unique against user_weapons.
 * Uses the provided pg client (so it participates in the caller's transaction).
 */
async function generateUniqueWeaponId(client) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateWeaponId();
    const { rows } = await client.query(
      'SELECT 1 FROM user_weapons WHERE weapon_id = $1',
      [id]
    );
    if (rows.length === 0) return id;
  }
  throw new Error('Failed to generate a unique weapon_id after 10 attempts');
}

module.exports = { generateWeaponId, generateUniqueWeaponId };

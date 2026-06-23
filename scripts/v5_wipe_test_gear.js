'use strict';

/**
 * v5 ONE-OFF — wipe all test gear so every tester starts clean on the gear
 * overhaul. Nulls both equip slots for every character, then deletes ALL
 * user_weapons + user_armors rows. Nothing else (currency/chests/deities/level/
 * quests/runes) is touched. Run ONCE after the Phase 0 migration:
 *   node scripts/v5_wipe_test_gear.js
 * Idempotent (re-running just reports 0 removed).
 */

const pool = require('../src/db/pool');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const w = await client.query('SELECT count(*)::int AS n FROM user_weapons');
    const a = await client.query('SELECT count(*)::int AS n FROM user_armors');
    await client.query('UPDATE user_character SET equipped_weapon_id = NULL, equipped_armor_id = NULL');
    await client.query('DELETE FROM user_weapons');
    await client.query('DELETE FROM user_armors');
    await client.query('COMMIT');
    console.log(`[v5 wipe] removed ${w.rows[0].n} weapons + ${a.rows[0].n} armors; cleared all equip slots.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[v5 wipe] FAILED — nothing changed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

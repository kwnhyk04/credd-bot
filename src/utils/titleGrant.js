'use strict';

/**
 * Shared title-grant helper (v5 Phase 5). Idempotent: a title a player already
 * owns is a no-op. Accepts a pool OR an in-transaction client so faucets can
 * grant inside their existing transaction.
 */

/**
 * Grant one title by code. Returns true if newly granted (caller may surface a notice).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 */
async function grantTitle(db, discordId, code) {
  const res = await db.query(
    `INSERT INTO user_titles (discord_id, title_id)
     SELECT $1, title_id FROM title_catalog WHERE code = $2
     ON CONFLICT (discord_id, title_id) DO NOTHING
     RETURNING title_id`,
    [discordId, code]
  );
  return res.rows.length > 0;
}

/** Grant several codes; returns the array of codes that were newly granted. */
async function grantTitles(db, discordId, codes) {
  const granted = [];
  for (const code of codes) {
    if (await grantTitle(db, discordId, code)) granted.push(code);
  }
  return granted;
}

module.exports = { grantTitle, grantTitles };

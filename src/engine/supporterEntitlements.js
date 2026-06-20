'use strict';

/**
 * supporterEntitlements.js — supporter + cosmetic data layer (Supporter-stage §3–§5).
 *
 * Owns the read/write helpers for `supporters`, `cosmetic_catalog`, `user_cosmetics`,
 * and `equipped_skins`. Cosmetic-only — never touches users_bag / credux.
 *
 *   getSupporter / isActiveSupporter / effectiveTier
 *   applySubscribe(userId, tier, opts)   — §4 base grant+equip, §3 stipend, founder number
 *   applyMonthlyTokens(userId, tier)     — §3 monthly stipend (invoice.paid handler)
 *   listActiveCatalog / getCatalogByKey / getCatalogById
 *   userOwnedIds / userOwns / grantCosmeticTx
 *   getEquipped / equipCosmeticTx / setOverrideTx
 *
 * The `*Tx` helpers run on a caller-supplied in-tx client so a subscribe / buy / equip
 * can be one atomic unit. Read helpers accept pool or client.
 */

const pool = require('../db/pool');
const {
  CATEGORIES, MONTHLY_TOKENS, ETERNAL_ONE_TIME_TOKENS, TIER_RANK, DEV_ACCOUNT_IDS,
} = require('../config/cosmetics');
const { grantTokensTx } = require('./supporterTokens');

// ── Supporter row ───────────────────────────────────────────────────────────
async function getSupporter(db, userId) {
  const { rows } = await db.query('SELECT * FROM supporters WHERE discord_id = $1', [userId]);
  return rows[0] || null;
}

/** Active = status 'active' and (if a period end is set) not past it. */
function isActiveSupporter(sup) {
  if (!sup || sup.status !== 'active') return false;
  const end = sup.chosen_expires_at || sup.current_period_end;
  if (end && new Date(end).getTime() < Date.now()) return false;
  return true;
}

function effectiveTier(sup) {
  return isActiveSupporter(sup) ? sup.tier : null;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
async function listActiveCatalog(db, category) {
  const { rows } = await db.query(
    'SELECT * FROM cosmetic_catalog WHERE is_active = true AND category = $1 ORDER BY is_base DESC, tier, display_name',
    [category]
  );
  return rows;
}
async function getCatalogByKey(db, key) {
  const { rows } = await db.query('SELECT * FROM cosmetic_catalog WHERE cosmetic_key = $1', [key]);
  return rows[0] || null;
}
async function getCatalogById(db, id) {
  const { rows } = await db.query('SELECT * FROM cosmetic_catalog WHERE cosmetic_id = $1', [id]);
  return rows[0] || null;
}

// ── Ownership ─────────────────────────────────────────────────────────────────
async function userOwnedIds(db, userId) {
  const { rows } = await db.query('SELECT cosmetic_id FROM user_cosmetics WHERE discord_id = $1', [userId]);
  return new Set(rows.map((r) => r.cosmetic_id));
}
async function userOwns(db, userId, cosmeticId) {
  const { rows } = await db.query(
    'SELECT 1 FROM user_cosmetics WHERE discord_id = $1 AND cosmetic_id = $2', [userId, cosmeticId]
  );
  return rows.length > 0;
}
async function grantCosmeticTx(client, userId, cosmeticId, source) {
  await client.query(
    'INSERT INTO user_cosmetics (discord_id, cosmetic_id, source) VALUES ($1,$2,$3) ON CONFLICT (discord_id, cosmetic_id) DO NOTHING',
    [userId, cosmeticId, source]
  );
}

// ── §4 (addendum2): the two dev accounts own every active catalog skin ────────
function isDevAccount(userId) {
  return DEV_ACCOUNT_IDS.includes(String(userId));
}
/** Owned-ids set, but dev accounts resolve to ALL active catalog skins (no DB rows needed). */
async function ownedIdsResolved(db, userId) {
  if (isDevAccount(userId)) {
    const { rows } = await db.query('SELECT cosmetic_id FROM cosmetic_catalog WHERE is_active = true');
    return new Set(rows.map((r) => r.cosmetic_id));
  }
  return userOwnedIds(db, userId);
}
async function ownsResolved(db, userId, cosmeticId) {
  if (isDevAccount(userId)) return true;
  return userOwns(db, userId, cosmeticId);
}
/** Resolve a shop skin by its skin_code (category is implied by the leading letter). */
async function getCatalogByCode(db, code) {
  const { rows } = await db.query(
    'SELECT * FROM cosmetic_catalog WHERE LOWER(skin_code) = LOWER($1) AND is_active = true', [code]
  );
  return rows[0] || null;
}

// ── Equip ─────────────────────────────────────────────────────────────────────
async function getEquipped(db, userId) {
  const { rows } = await db.query(
    'SELECT category, cosmetic_id, override_path FROM equipped_skins WHERE discord_id = $1', [userId]
  );
  const out = {};
  for (const r of rows) out[r.category] = { cosmetic_id: r.cosmetic_id, override_path: r.override_path };
  return out;
}
/** Equip a catalog cosmetic for a category (clears any override_path). */
async function equipCosmeticTx(client, userId, category, cosmeticId) {
  await client.query(
    `INSERT INTO equipped_skins (discord_id, category, cosmetic_id, override_path, updated_at)
     VALUES ($1,$2,$3,NULL,NOW())
     ON CONFLICT (discord_id, category)
     DO UPDATE SET cosmetic_id = EXCLUDED.cosmetic_id, override_path = NULL, updated_at = NOW()`,
    [userId, category, cosmeticId]
  );
}
/** Force a raw file path for a category (dev/tester/custom override). */
async function setOverrideTx(client, userId, category, relPath) {
  await client.query(
    `INSERT INTO equipped_skins (discord_id, category, cosmetic_id, override_path, updated_at)
     VALUES ($1,$2,NULL,$3,NOW())
     ON CONFLICT (discord_id, category)
     DO UPDATE SET cosmetic_id = NULL, override_path = EXCLUDED.override_path, updated_at = NOW()`,
    [userId, category, relPath]
  );
}

// ── §4 base set: grant the four base cosmetics + equip where nothing is set ───
async function grantBaseSetTx(client, userId) {
  const base = await client.query('SELECT cosmetic_id, category FROM cosmetic_catalog WHERE is_base = true');
  const equipped = await client.query('SELECT category FROM equipped_skins WHERE discord_id = $1', [userId]);
  const have = new Set(equipped.rows.map((r) => r.category));
  for (const row of base.rows) {
    await grantCosmeticTx(client, userId, row.cosmetic_id, 'base');
    if (!have.has(row.category)) await equipCosmeticTx(client, userId, row.category, row.cosmetic_id);
  }
}

/**
 * §4/§3 — apply a subscribe or founder grant. Upserts the supporters row, assigns a founder
 * number for eternal, auto-grants+equips the base set, and pays the initial stipend
 * (believer/chosen: monthly amount; eternal: one-time 18). Idempotency for Stripe replays is
 * the caller's job (markStripeEventOnce); this re-pays the stipend if re-run, so gate it on
 * the event id upstream.
 *
 * opts: { founder, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, chosenExpiresAt, grantStipend=true }
 */
async function applySubscribe(userId, tier, opts = {}) {
  if (!TIER_RANK[tier]) throw new Error('applySubscribe: bad tier ' + tier);
  const isFounder = !!opts.founder || tier === 'eternal';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let founderNumber = null;
    if (isFounder) {
      const existing = await client.query('SELECT founder_number FROM supporters WHERE discord_id = $1', [userId]);
      founderNumber = existing.rows[0]?.founder_number ?? null;
      if (founderNumber == null) {
        const next = await client.query('SELECT COALESCE(MAX(founder_number),0)+1 AS n FROM supporters');
        founderNumber = next.rows[0].n;
      }
    }

    await client.query(
      `INSERT INTO supporters
         (discord_id, tier, status, stripe_customer_id, stripe_subscription_id,
          current_period_end, chosen_expires_at, founder_number, founder_purchased_at, updated_at)
       VALUES ($1,$2,'active',$3,$4,$5,$6,$7,${isFounder ? 'NOW()' : 'NULL'},NOW())
       ON CONFLICT (discord_id) DO UPDATE SET
         tier = EXCLUDED.tier, status = 'active',
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, supporters.stripe_customer_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, supporters.stripe_subscription_id),
         current_period_end = COALESCE(EXCLUDED.current_period_end, supporters.current_period_end),
         chosen_expires_at = COALESCE(EXCLUDED.chosen_expires_at, supporters.chosen_expires_at),
         founder_number = COALESCE(supporters.founder_number, EXCLUDED.founder_number),
         founder_purchased_at = COALESCE(supporters.founder_purchased_at, ${isFounder ? 'NOW()' : 'NULL'}),
         updated_at = NOW()`,
      [userId, tier, opts.stripeCustomerId ?? null, opts.stripeSubscriptionId ?? null,
       opts.currentPeriodEnd ?? null, opts.chosenExpiresAt ?? null, founderNumber]
    );

    await grantBaseSetTx(client, userId);

    if (opts.grantStipend !== false) {
      if (tier === 'eternal') {
        await grantTokensTx(client, userId, ETERNAL_ONE_TIME_TOKENS, 'founder_grant', opts.stripeSubscriptionId ?? 'founder');
      } else {
        await grantTokensTx(client, userId, MONTHLY_TOKENS[tier], 'subscribe_grant', opts.stripeSubscriptionId ?? null);
      }
    }

    await client.query('COMMIT');
    return { founderNumber, tier };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** §3 monthly stipend (believer/chosen) — call from the Stripe invoice.paid handler. */
async function applyMonthlyTokens(userId, tier, ref = null) {
  if (tier === 'eternal') return null; // eternal is one-time at purchase, no monthly drip
  const amount = MONTHLY_TOKENS[tier];
  if (!amount) throw new Error('applyMonthlyTokens: bad tier ' + tier);
  const { grantTokens } = require('./supporterTokens');
  return grantTokens(userId, amount, 'monthly_grant', ref);
}

module.exports = {
  CATEGORIES,
  getSupporter, isActiveSupporter, effectiveTier,
  listActiveCatalog, getCatalogByKey, getCatalogById, getCatalogByCode,
  userOwnedIds, userOwns, grantCosmeticTx,
  isDevAccount, ownedIdsResolved, ownsResolved,
  getEquipped, equipCosmeticTx, setOverrideTx,
  grantBaseSetTx, applySubscribe, applyMonthlyTokens,
};

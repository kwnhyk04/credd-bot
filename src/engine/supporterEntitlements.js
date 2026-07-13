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
const { envBool } = require('../utils/runtimeLogs');
const { registerMemorySource } = require('../utils/memoryRegistry');
const { grantTokensTx, grantTokensOnceTx } = require('./supporterTokens');

let supporterSchemaCache = null;

registerMemorySource('database.supporter-schema', () => ({
  columnEntries: supporterSchemaCache?.columns?.size || 0,
  tierEntries: supporterSchemaCache?.tierValues?.size || 0,
  fixedSchemaSnapshot: true,
}));

const STORED_TIER_ALIASES = {
  chosen_believer: 'chosen',
  eternal_believer: 'eternal',
};
const STORAGE_TIER_CANDIDATES = {
  believer: ['believer'],
  chosen: ['chosen', 'chosen_believer'],
  eternal: ['eternal', 'eternal_believer'],
};
const SUPPORTER_COLUMNS = 'discord_id, tier, status, current_period_end, expires_at, founder_number, token_balance';
const COSMETIC_CATALOG_COLUMNS = `
  cosmetic_id, cosmetic_key, category, tier, display_name, token_cost,
  is_base, has_top_label, display_filename, render_filename,
  victory_filename, defeated_filename, is_active, skin_code
`;

function normalizeTier(tier) {
  const raw = String(tier || '').trim().toLowerCase();
  return STORED_TIER_ALIASES[raw] || raw;
}

async function getSupporterSchema(db) {
  if (supporterSchemaCache) return supporterSchemaCache;
  const columnsRes = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'supporters'`
  );
  const constraintsRes = await db.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'supporters'
        AND c.contype = 'c'`
  );
  const tierValues = new Set();
  for (const row of constraintsRes.rows) {
    const definition = String(row.definition || '');
    if (!definition.includes('tier')) continue;
    for (const match of definition.matchAll(/'([^']+)'/g)) {
      tierValues.add(match[1]);
    }
  }
  supporterSchemaCache = {
    columns: new Set(columnsRes.rows.map((r) => r.column_name)),
    tierValues,
  };
  return supporterSchemaCache;
}

function storageTierFor(appTier, tierValues) {
  const normalized = normalizeTier(appTier);
  if (!tierValues || tierValues.size === 0) return normalized;
  const candidates = STORAGE_TIER_CANDIDATES[normalized] || [normalized];
  for (const candidate of candidates) {
    if (tierValues.has(candidate)) return candidate;
  }
  for (const value of tierValues) {
    if (normalizeTier(value) === normalized) return value;
  }
  return normalized;
}

// ── Supporter row ───────────────────────────────────────────────────────────
async function getSupporter(db, userId) {
  const { rows } = await db.query(`SELECT ${SUPPORTER_COLUMNS} FROM supporters WHERE discord_id = $1`, [userId]);
  return rows[0] || null;
}

/** Active = status 'active' and (if a period end is set) not past it. */
function isActiveSupporter(sup) {
  if (!sup || sup.status !== 'active') return false;
  const end = sup.chosen_expires_at || sup.current_period_end || sup.expires_at;
  if (end && new Date(end).getTime() < Date.now()) return false;
  return true;
}

function effectiveTier(sup) {
  return isActiveSupporter(sup) ? normalizeTier(sup.tier) : null;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
async function listActiveCatalog(db, category) {
  const { rows } = await db.query(
    `SELECT ${COSMETIC_CATALOG_COLUMNS}
       FROM cosmetic_catalog
      WHERE is_active = true AND category = $1
      ORDER BY is_base DESC, tier, display_name`,
    [category]
  );
  return rows;
}
async function getCatalogByKey(db, key) {
  const { rows } = await db.query(`SELECT ${COSMETIC_CATALOG_COLUMNS} FROM cosmetic_catalog WHERE cosmetic_key = $1`, [key]);
  return rows[0] || null;
}
async function getCatalogById(db, id) {
  const { rows } = await db.query(`SELECT ${COSMETIC_CATALOG_COLUMNS} FROM cosmetic_catalog WHERE cosmetic_id = $1`, [id]);
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

function skinDevUnlocksEnabled() {
  const railwayEnv = String(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '').toLowerCase();
  const railwayNonProd = railwayEnv && !['production', 'prod'].includes(railwayEnv);
  const nodeNonProd = process.env.NODE_ENV !== 'production';
  const nonProd = railwayEnv ? railwayNonProd : (nodeNonProd || envBool('BETA_MODE', false));
  return nonProd && envBool('SKIN_DEV_UNLOCKS', true);
}

// ── §4 (addendum2): dev accounts own every active catalog skin in non-prod ────
function isDevAccount(userId) {
  return skinDevUnlocksEnabled() && DEV_ACCOUNT_IDS.includes(String(userId));
}

/**
 * Resolve the full set of cosmetic_ids a user owns, by these scopes (no schema change —
 * scope is carried by the catalog cosmetic_key prefix the seeder writes):
 *   - explicit user_cosmetics rows (store buys, base grants)
 *   - `tester_default_*`   → everyone, while the bot is in open beta
 *   - `tester_<userId>_*`  → the specific tester that folder belongs to
 *   - `founder_*`          → active founders 1..50, plus dev accounts
 *   - is_base rows         → any active supporter (base set comes with a subscription)
 *   - dev accounts         → ALL active catalog skins
 */
async function ownedIdsResolved(db, userId) {
  const uid = String(userId);
  const dev = isDevAccount(uid);
  const owned = dev ? new Set() : await userOwnedIds(db, userId);
  let active = false;
  let activeFounder = false;
  if (!dev) {
    const sup = await getSupporter(db, userId);
    active = isActiveSupporter(sup);
    const founderNumber = Number(sup?.founder_number);
    activeFounder = active && sup?.founder_number != null && Number.isFinite(founderNumber) && founderNumber <= 50;
  }
  const { rows } = await db.query(
    'SELECT cosmetic_id, cosmetic_key, is_base FROM cosmetic_catalog WHERE is_active = true'
  );
  for (const r of rows) {
    if (dev) { owned.add(r.cosmetic_id); continue; }
    const k = r.cosmetic_key;
    if (k.startsWith('tester_default_')) owned.add(r.cosmetic_id);
    else if (k.startsWith(`tester_${uid}_`)) owned.add(r.cosmetic_id);
    else if (k.startsWith('founder_') && activeFounder) owned.add(r.cosmetic_id);
    else if (r.is_base && active) owned.add(r.cosmetic_id);
  }
  return owned;
}
async function collectionOwnedIdsResolved(db, userId) {
  if (isDevAccount(userId)) {
    const { rows } = await db.query(
      'SELECT cosmetic_id FROM cosmetic_catalog WHERE is_active = true'
    );
    return new Set(rows.map((r) => r.cosmetic_id));
  }
  return userOwnedIds(db, userId);
}
async function ownsResolved(db, userId, cosmeticId) {
  if (isDevAccount(userId)) return true;
  const owned = await ownedIdsResolved(db, userId);
  return owned.has(cosmeticId);
}
/** Resolve a shop skin by its skin_code (category is implied by the leading letter). */
async function getCatalogByCode(db, code) {
  const { rows } = await db.query(
    `SELECT ${COSMETIC_CATALOG_COLUMNS}
       FROM cosmetic_catalog
      WHERE LOWER(skin_code) = LOWER($1) AND is_active = true
      LIMIT 1`,
    [code]
  );
  return rows[0] || null;
}

// Catalog rows that are NOT purchasable in the shop (owned by scope, not bought):
//   base set, tester defaults, per-tester customs, and the limited founder set.
const NON_SHOP_PREFIX = /^(tester_|founder_)/;
function isShopCatalog(row) {
  return !row.is_base && !NON_SHOP_PREFIX.test(row.cosmetic_key);
}

/**
 * Resolve a skin the user wants to equip by free-text: skin_code, exact cosmetic_key, or a
 * display-name match. Owned matches win over unowned so per-tester customs (shared display
 * names) disambiguate to the caller's own row. Returns a catalog row or null.
 */
async function resolveCatalogRef(db, userId, ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const { rows } = await db.query(
    `SELECT ${COSMETIC_CATALOG_COLUMNS} FROM cosmetic_catalog
       WHERE is_active = true
         AND (LOWER(skin_code) = LOWER($1)
              OR LOWER(cosmetic_key) = LOWER($1)
              OR LOWER(display_name) = LOWER($1)
              OR LOWER(display_name) LIKE LOWER($2))
       ORDER BY display_name
       LIMIT 25`,
    [raw, `%${raw}%`]
  );
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  const owned = await ownedIdsResolved(db, userId);
  // Prefer an exact code/key/name hit, then an owned row, then anything.
  const exact = rows.find((r) =>
    (r.skin_code && r.skin_code.toLowerCase() === raw.toLowerCase()) ||
    r.cosmetic_key.toLowerCase() === raw.toLowerCase() ||
    r.display_name.toLowerCase() === raw.toLowerCase());
  return exact || rows.find((r) => owned.has(r.cosmetic_id)) || rows[0];
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
/** Reset all of a user's equipped skins to default (clears every category row). */
async function clearAllEquipped(db, userId) {
  const { rowCount } = await db.query('DELETE FROM equipped_skins WHERE discord_id = $1', [userId]);
  return rowCount;
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

/** Materialize subscription grants for activation, manual grants, and repairs. */
async function syncSubscriptionEntitlementsTx(client, userId, tier, opts = {}) {
  const appTier = normalizeTier(tier);
  const isFounder = !!opts.founder || appTier === 'eternal';
  await grantBaseSetTx(client, userId);
  if (!isFounder) return { founderCosmetics: 0, founderAvatars: 0 };

  const cosmetics = await client.query(
    `INSERT INTO user_cosmetics (discord_id, cosmetic_id, source)
     SELECT $1, cosmetic_id, 'founder'
       FROM cosmetic_catalog
      WHERE cosmetic_key LIKE 'founder\\_%' AND is_active = TRUE
     ON CONFLICT (discord_id, cosmetic_id) DO NOTHING`,
    [userId]
  );
  const avatars = await client.query(
    `INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
     SELECT $1, avatar_id, 'grant', NOW()
       FROM avatar_catalog
      WHERE style = 'founder' AND is_active = TRUE
     ON CONFLICT (discord_id, avatar_id) DO NOTHING`,
    [userId]
  );
  return {
    founderCosmetics: cosmetics.rowCount || 0,
    founderAvatars: avatars.rowCount || 0,
  };
}

/** Repair all materialized entitlements for an existing active supporter. */
async function syncSubscriptionEntitlements(userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const supporter = await getSupporter(client, userId);
    if (!isActiveSupporter(supporter)) {
      throw new Error('No active supporter subscription to synchronize.');
    }
    const result = await syncSubscriptionEntitlementsTx(
      client, userId, effectiveTier(supporter)
    );
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * §4/§3 — apply a subscribe or founder grant. Upserts the supporters row, assigns a founder
 * number for eternal, auto-grants+equips the base set, and pays the initial stipend
 * (believer/chosen: monthly amount; eternal: one-time 18). When a stable Stripe/subscription
 * ref is present, the token grant is idempotent at the ledger layer; dev/manual calls with no
 * ref keep the original repeatable behavior.
 *
 * opts: { founder, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, chosenExpiresAt, grantStipend=true }
 */
async function applySubscribe(userId, tier, opts = {}) {
  const appTier = normalizeTier(tier);
  if (!TIER_RANK[appTier]) throw new Error('applySubscribe: bad tier ' + tier);
  const isFounder = !!opts.founder || appTier === 'eternal';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { columns, tierValues } = await getSupporterSchema(client);
    const storedTier = storageTierFor(appTier, tierValues);

    let founderNumber = null;
    if (isFounder && columns.has('founder_number')) {
      const existing = await client.query('SELECT founder_number FROM supporters WHERE discord_id = $1', [userId]);
      founderNumber = existing.rows[0]?.founder_number ?? null;
      if (founderNumber == null) {
        const next = await client.query("SELECT nextval('supporter_founder_number_seq') AS n");
        founderNumber = Number(next.rows[0].n);
      }
    }

    const insertColumns = ['discord_id', 'tier', 'status'];
    const values = [userId, storedTier];
    const insertValues = ['$1', '$2', "'active'"];
    const updateSets = ["tier = EXCLUDED.tier", "status = 'active'"];

    function addOptionalColumn(column, value, updateSql = `${column} = COALESCE(EXCLUDED.${column}, supporters.${column})`) {
      if (!columns.has(column)) return;
      values.push(value ?? null);
      insertColumns.push(column);
      insertValues.push(`$${values.length}`);
      updateSets.push(updateSql);
    }

    addOptionalColumn('stripe_customer_id', opts.stripeCustomerId);
    addOptionalColumn('stripe_subscription_id', opts.stripeSubscriptionId);
    addOptionalColumn('current_period_end', opts.currentPeriodEnd);
    addOptionalColumn('chosen_expires_at', opts.chosenExpiresAt);
    addOptionalColumn('founder_number', founderNumber, 'founder_number = COALESCE(supporters.founder_number, EXCLUDED.founder_number)');
    if (columns.has('founder_purchased_at')) {
      insertColumns.push('founder_purchased_at');
      insertValues.push(isFounder ? 'NOW()' : 'NULL');
      updateSets.push(`founder_purchased_at = COALESCE(supporters.founder_purchased_at, ${isFounder ? 'NOW()' : 'NULL'})`);
    }
    if (columns.has('updated_at')) {
      insertColumns.push('updated_at');
      insertValues.push('NOW()');
      updateSets.push('updated_at = NOW()');
    }

    const returning = columns.has('founder_number') ? 'founder_number' : 'NULL::integer AS founder_number';
    const supporter = await client.query(
      `INSERT INTO supporters
         (${insertColumns.join(', ')})
       VALUES (${insertValues.join(', ')})
       ON CONFLICT (discord_id) DO UPDATE SET
         ${updateSets.join(', ')}
       RETURNING ${returning}`,
      values
    );
    founderNumber = supporter.rows[0]?.founder_number ?? null;

    const entitlementSync = await syncSubscriptionEntitlementsTx(
      client, userId, appTier, { founder: isFounder }
    );

    let stipendGrant = null;
    if (opts.grantStipend !== false) {
      const stipendRef = opts.stripeSubscriptionId ?? null;
      if (appTier === 'eternal') {
        stipendGrant = await grantTokensOnceTx(
          client,
          userId,
          ETERNAL_ONE_TIME_TOKENS,
          'founder_grant',
          stipendRef || `eternal-founder:${userId}`
        );
      } else {
        if (stipendRef) {
          stipendGrant = await grantTokensOnceTx(client, userId, MONTHLY_TOKENS[appTier], 'subscribe_grant', stipendRef);
        } else {
          stipendGrant = await grantTokensTx(client, userId, MONTHLY_TOKENS[appTier], 'subscribe_grant', null);
        }
      }
    }

    await client.query('COMMIT');
    return { founderNumber, tier: appTier, entitlementSync, stipendGrant };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** §3 monthly stipend (believer/chosen) — call from the Stripe invoice.paid handler. */
async function applyMonthlyTokens(userId, tier, ref = null) {
  const appTier = normalizeTier(tier);
  if (appTier === 'eternal') return null; // eternal is one-time at purchase, no monthly drip
  const amount = MONTHLY_TOKENS[appTier];
  if (!amount) throw new Error('applyMonthlyTokens: bad tier ' + tier);
  const { grantTokens, grantTokensOnce } = require('./supporterTokens');
  if (ref) return grantTokensOnce(userId, amount, 'monthly_grant', ref);
  return grantTokens(userId, amount, 'monthly_grant', null);
}

module.exports = {
  CATEGORIES,
  getSupporter, isActiveSupporter, effectiveTier,
  listActiveCatalog, getCatalogByKey, getCatalogById, getCatalogByCode,
  userOwnedIds, userOwns, grantCosmeticTx,
  isDevAccount, ownedIdsResolved, collectionOwnedIdsResolved, ownsResolved, isShopCatalog, resolveCatalogRef,
  getEquipped, equipCosmeticTx, setOverrideTx, clearAllEquipped,
  grantBaseSetTx, syncSubscriptionEntitlementsTx, syncSubscriptionEntitlements,
  applySubscribe, applyMonthlyTokens,
};

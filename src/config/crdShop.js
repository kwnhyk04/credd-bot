'use strict';

/**
 * crdShop — CRD Shop product registry + PHT reset-period helpers
 * (Genesis update, spec section 5).
 *
 * Shop ids are numeric and sequential and are NOT CRD Bag item ids (the bag
 * uses string codes like `cc`). `column` = users_bag grant column (whitelist —
 * only ever interpolated from this table). `limit` is null (no cap) or
 * { cap, period } with period 'daily' | 'weekly' | 'monthly'.
 *
 * All periods follow the project timezone convention: Asia/Manila (PHT).
 *   daily   → resets at midnight PHT        (period key YYYYMMDD)
 *   weekly  → resets Monday 00:00 PHT       (period key = phtWeek(), year*100+ISO week)
 *   monthly → resets 1st of month 00:00 PHT (period key YYYYMM)
 */

const { phtWeek } = require('./ranked');

const CRD_SHOP = Object.freeze([
  Object.freeze({ id: 1, name: 'Character Class Change', emojiName: 'change_class',  price: 5_000_000, column: 'change_class',      limit: null }),
  Object.freeze({ id: 2, name: 'Lesser Bag',             emojiName: 'lesser_bag',    price: 1_000_000,  column: 'lesser_rune_bag',   limit: Object.freeze({ cap: 10, period: 'monthly' }) }),
  Object.freeze({ id: 3, name: 'Greater Bag',            emojiName: 'greater_bag',   price: 5_000_000,  column: 'greater_rune_bag',  limit: Object.freeze({ cap: 5,  period: 'monthly' }) }),
  Object.freeze({ id: 4, name: 'Divine Bag',             emojiName: 'divine_bag',    price: 10_000_000, column: 'divine_rune_bag',   limit: Object.freeze({ cap: 3,  period: 'monthly' }) }),
  Object.freeze({ id: 5, name: 'Silver Chest',           emojiName: 'silver_chest',  price: 5_000,     column: 'silver_chest',      limit: Object.freeze({ cap: 10, period: 'daily' }) }),
  Object.freeze({ id: 6, name: 'Gold Chest',             emojiName: 'gold_chest',    price: 50_000,     column: 'gold_chest',        limit: Object.freeze({ cap: 5,  period: 'daily' }) }),
  Object.freeze({ id: 7, name: 'Diamond Chest',          emojiName: 'diamond_chest', price: 2_500_000,  column: 'diamond_chest',     limit: Object.freeze({ cap: 1,  period: 'weekly' }) }),
]);

const PHT_OFFSET_MS = 8 * 3600 * 1000; // Asia/Manila is UTC+8, no DST

/** PHT wall-clock parts for a given instant. */
function phtParts(date = new Date()) {
  const pht = new Date(date.getTime() + PHT_OFFSET_MS);
  return { y: pht.getUTCFullYear(), m: pht.getUTCMonth(), d: pht.getUTCDate(), isoDay: pht.getUTCDay() || 7 };
}

/** Integer period key for a limit period (PHT). */
function periodKey(period, date = new Date()) {
  const { y, m, d } = phtParts(date);
  switch (period) {
    case 'daily':   return y * 10000 + (m + 1) * 100 + d; // YYYYMMDD
    case 'weekly':  return phtWeek(date);                 // year*100 + ISO week (Monday PHT)
    case 'monthly': return y * 100 + (m + 1);             // YYYYMM
    default: throw new Error(`periodKey: unknown period ${period}`);
  }
}

/** Next reset instant (UTC Date) for a limit period — for <t:…:R> displays. */
function nextReset(period, date = new Date()) {
  const { y, m, d, isoDay } = phtParts(date);
  let utcMs;
  switch (period) {
    case 'daily':   utcMs = Date.UTC(y, m, d + 1) - PHT_OFFSET_MS; break;
    case 'weekly':  utcMs = Date.UTC(y, m, d + (8 - isoDay)) - PHT_OFFSET_MS; break;
    case 'monthly': utcMs = Date.UTC(y, m + 1, 1) - PHT_OFFSET_MS; break;
    default: throw new Error(`nextReset: unknown period ${period}`);
  }
  return new Date(utcMs);
}

const PERIOD_LABELS = Object.freeze({ daily: 'daily', weekly: 'weekly', monthly: 'monthly' });

module.exports = { CRD_SHOP, periodKey, nextReset, PERIOD_LABELS };

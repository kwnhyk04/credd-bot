'use strict';

/**
 * crdShop.js — `crd shop` + `crd shop buy <id> [qty]` (Genesis update, S5).
 *
 * The Credux sink. Structural clone of pvpShop.js: same Components-V2
 * text-row container, same `reply()` style, same atomic buy transaction
 * (bag FOR UPDATE → tracking FOR UPDATE → cap/afford checks → cap-guarded
 * upsert → single deduct+grant UPDATE → COMMIT; any failure ⇒ ROLLBACK and
 * "nothing was spent").
 *
 * Limits are DATABASE-backed (crd_shop_purchases, aggregated qty per PHT
 * period — never in-memory) and count total quantity, not command count.
 * `crd shop supporter` still forwards to the legacy supporter shop.
 */

const {
  ContainerBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { CRD_SHOP, periodKey, nextReset } = require('../../config/crdShop');
const supporterShop = require('./shop');

const BRAND = 0x9b59b6; // Credux-economy purple (create/bag family)
const SHOP_QUOTE = '-# *"Every believer\'s coin finds its way home."*';
const CREDUX = emoji('credux_coin');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/** Discord relative timestamp for a period's next PHT reset. */
function resetStamp(period) {
  return `<t:${Math.floor(nextReset(period).getTime() / 1000)}:R>`;
}

/** Credux balance + purchased qty per limited product for the CURRENT periods. */
async function fetchState(discordId) {
  const keys = [...new Set(CRD_SHOP.filter((p) => p.limit).map((p) => periodKey(p.limit.period)))];
  const { rows } = await pool.query(
    `SELECT ub.credux, p.product_id, p.period_key, p.qty
       FROM (SELECT $1::varchar AS discord_id) viewer
       LEFT JOIN users_bag ub ON ub.discord_id = viewer.discord_id
       LEFT JOIN crd_shop_purchases p
         ON p.discord_id = viewer.discord_id AND p.period_key = ANY($2::int[])`,
    [discordId, keys]
  );
  const credux = Number(rows[0]?.credux || 0);
  const purchased = {};
  for (const r of rows) {
    if (r.product_id == null) continue;
    const product = CRD_SHOP.find((p) => p.id === Number(r.product_id));
    // Only count the row that matches the product's own current period key.
    if (product?.limit && Number(r.period_key) === periodKey(product.limit.period)) {
      purchased[product.id] = Number(r.qty);
    }
  }
  return { credux, purchased };
}

async function buildShop(viewerId) {
  const { credux, purchased } = await fetchState(viewerId);

  const rowsText = CRD_SHOP.map((it) => {
    const price = `${CREDUX} **${it.price.toLocaleString()}**`;
    if (!it.limit) {
      return `\`${it.id}\` ${emoji(it.emojiName)} **${it.name}** - ${price} - no limit`;
    }
    const bought = purchased[it.id] || 0;
    return (
      `\`${it.id}\` ${emoji(it.emojiName)} **${it.name}** - ${price} - ` +
      `${it.limit.period} **${bought}/${it.limit.cap}** - resets ${resetStamp(it.limit.period)}`
    );
  }).join('\n');

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${CREDUX} CRD Shop`));
  container.addTextDisplayComponents((td) => td.setContent(
    '-# Spend Credux — buy with `crd shop buy <id> [qty]`. Limits reset on PHT time (daily 00:00 · weekly Monday · monthly 1st).'
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(rowsText));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# Your balance — ${CREDUX} **${credux.toLocaleString()}** Credux`
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(SHOP_QUOTE));

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** `crd shop buy <id> [qty]` — atomic Credux spend with PHT-period cap enforcement. */
async function buy(message, args) {
  // Strict validation (spec S5): id and qty must be positive integers —
  // zero, negative, decimal, and non-numeric are all rejected before any DB work.
  const idRaw = String(args[0] ?? '');
  if (!/^\d+$/.test(idRaw)) {
    return reply(message, 'Usage: `crd shop buy <id> [qty]` — see `crd shop` for ids (1-7).');
  }
  const item = CRD_SHOP.find((i) => i.id === parseInt(idRaw, 10));
  if (!item) {
    return reply(message, `Unknown product id \`${idRaw}\` — see \`crd shop\` for ids (1-7).`);
  }
  const qtyRaw = String(args[1] ?? '1');
  if (!/^\d+$/.test(qtyRaw) || parseInt(qtyRaw, 10) < 1) {
    return reply(message, `Invalid quantity \`${qtyRaw}\` — use a whole number of 1 or more.`);
  }
  const qty = parseInt(qtyRaw, 10);
  const discordId = message.author.id;
  const key = item.limit ? periodKey(item.limit.period) : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query(
      'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'You have no bag yet — `crd register` first.');
    }
    const credux = Number(bagRes.rows[0].credux);

    let bought = 0;
    if (item.limit) {
      const purRes = await client.query(
        'SELECT qty FROM crd_shop_purchases WHERE discord_id = $1 AND product_id = $2 AND period_key = $3 FOR UPDATE',
        [discordId, item.id, key]
      );
      bought = Number(purRes.rows[0]?.qty || 0);
      if (bought + qty > item.limit.cap) {
        await client.query('ROLLBACK');
        const left = Math.max(0, item.limit.cap - bought);
        return reply(message,
          `🚫 ${item.limit.period} limit for **${item.name}** is ${item.limit.cap} — you've bought ${bought}, ` +
          `can buy **${left}** more. Resets ${resetStamp(item.limit.period)}.`);
      }
    }

    const cost = item.price * qty;
    if (credux < cost) {
      await client.query('ROLLBACK');
      const afford = Math.floor(credux / item.price);
      return reply(message,
        `Not enough Credux for ${qty}× — need ${cost.toLocaleString()}, have ${credux.toLocaleString()}.` +
        (afford > 0 ? ` You can afford **${afford}**.` : ''));
    }

    if (item.limit) {
      // Cap-guarded upsert — the WHERE re-check makes concurrent buys unable
      // to slip past the cap (same mechanism as pvp_shop_purchases).
      const purchaseRes = await client.query(
        `INSERT INTO crd_shop_purchases (discord_id, product_id, period_key, qty, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (discord_id, product_id, period_key) DO UPDATE
         SET qty = crd_shop_purchases.qty + EXCLUDED.qty, updated_at = NOW()
         WHERE crd_shop_purchases.qty + EXCLUDED.qty <= $5
         RETURNING qty`,
        [discordId, item.id, key, qty, item.limit.cap]
      );
      if (purchaseRes.rows.length === 0) {
        const latestRes = await client.query(
          'SELECT qty FROM crd_shop_purchases WHERE discord_id = $1 AND product_id = $2 AND period_key = $3',
          [discordId, item.id, key]
        );
        const current = Number(latestRes.rows[0]?.qty || bought);
        await client.query('ROLLBACK');
        const left = Math.max(0, item.limit.cap - current);
        return reply(message,
          `🚫 ${item.limit.period} limit for **${item.name}** is ${item.limit.cap} — you've bought ${current}, ` +
          `can buy **${left}** more. Resets ${resetStamp(item.limit.period)}.`);
      }
      bought = Number(purchaseRes.rows[0].qty);
    }

    // Deduct + grant in one statement (item.column comes from the CRD_SHOP
    // whitelist only). If this fails, everything above rolls back — no spend.
    const upd = await client.query(
      `UPDATE users_bag SET credux = credux - $2, ${item.column} = ${item.column} + $3
        WHERE discord_id = $1 RETURNING credux, ${item.column} AS item_count`,
      [discordId, cost, qty]
    );
    const after = upd.rows[0];

    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_credux, updated_credux)
       VALUES ($1, 'CRD Shop', $2, $3, $4)`,
      [discordId, item.column, Number(after.credux) + cost, Number(after.credux)]
    );
    await client.query('COMMIT');

    const lines = [
      `✅ Bought **${qty}× ${item.name}** ${emoji(item.emojiName)}`,
      `-# Price ${CREDUX} ${item.price.toLocaleString()} each · total **${cost.toLocaleString()}** · balance **${Number(after.credux).toLocaleString()}** Credux`,
    ];
    if (item.limit) {
      const left = Math.max(0, item.limit.cap - bought);
      lines.push(`-# ${item.limit.period} allowance: **${left}** left (${bought}/${item.limit.cap}) · resets ${resetStamp(item.limit.period)}`);
    }
    return reply(message, lines.join('\n'));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[crd shop buy]', err.message);
    return reply(message, 'Purchase failed — nothing was spent.');
  } finally {
    client.release();
  }
}

async function execute(message, { args } = { args: [] }) {
  const sub = (args?.[0] || '').toLowerCase();
  // Legacy path stays untouched: `crd shop supporter` → supporter skin shop.
  if (sub === 'supporter') return supporterShop.execute(message, { args });
  if (sub === 'buy') return buy(message, args.slice(1));
  const payload = await buildShop(message.author.id);
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

module.exports = { execute, buildShop, buy };

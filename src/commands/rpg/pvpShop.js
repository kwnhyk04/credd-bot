'use strict';

/**
 * pvpShop.js — `crd pvp shop` + `crd pvp buy <id> [qty]` (Phase 6, §D).
 *
 * The Valor Medal sink. Same canvas/Components-V2 styling as `crd essence shop`
 * (renderBagItemsImage rows). Three items, each with a PER-SEASON purchase cap
 * tracked in pvp_shop_purchases (keyed by the active season_id, so caps reset every
 * season). Buying is `crd pvp buy <id> [qty]`, validated + applied atomically.
 *
 * Prices are tuned so a steady ranked player needs ~2-3 months of Valor inflow
 * (combat win/loss drops + weekly + season payouts) to afford a Supreme item.
 */

const {
  ContainerBuilder, SeparatorSpacingSize, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { emoji } = require('../../utils/emojis');
const { renderBagItemsImage } = require('../../engine/renderBagItems');
const { activeSeason } = require('../../engine/seasonEngine');

const BRAND = 0xf0b232;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);
const SHOP_QUOTE = '-# *"Valor is the only coin the war-gods honor."*';

// id → catalog entry. column = users_bag grant column; cap = max per pvp season.
const SHOP = [
  { id: 1, key: 'sacred_relic',  name: 'Sacred Relic',  emojiName: 'sacred_relic',  price: 800,  cap: 10, column: 'sacred_relics' },
  { id: 2, key: 'supreme_chest', name: 'Supreme Chest', emojiName: 'supreme_chest', price: 6000, cap: 1,  column: 'supreme_chest' },
  { id: 3, key: 'supreme_relic', name: 'Supreme Relic', emojiName: 'supreme_relic', price: 9000, cap: 1,  column: 'supreme_relics' },
];

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/** Valor balance + per-item purchased counts for the active season. */
async function fetchState(discordId, seasonId) {
  const balRes = await pool.query('SELECT valor_medals FROM users_bag WHERE discord_id = $1', [discordId]);
  const valor = Number(balRes.rows[0]?.valor_medals || 0);
  const purchased = {};
  if (seasonId != null) {
    const pres = await pool.query(
      'SELECT item_key, qty FROM pvp_shop_purchases WHERE discord_id = $1 AND season_id = $2',
      [discordId, seasonId]
    );
    for (const r of pres.rows) purchased[r.item_key] = Number(r.qty);
  }
  return { valor, purchased };
}

async function buildShop(viewerId) {
  const season = await activeSeason(pool);
  const { valor, purchased } = await fetchState(viewerId, season?.season_id);
  const medal = emoji('valor_medal');

  const items = SHOP.map((it) => {
    const bought = purchased[it.key] || 0;
    return {
      idLabel: String(it.id),
      emojiName: it.emojiName,
      name: it.name,
      cmd: `season ${bought}/${it.cap}`,
      rightSegments: [
        { text: `${it.price.toLocaleString()} ` },
        { emojiName: 'valor_medal' },
      ],
    };
  });
  const buffer = await renderBagItemsImage(items);
  const file = new AttachmentBuilder(buffer, { name: 'pvp_shop.png' });

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${medal} PvP Shop`));
  container.addTextDisplayComponents((td) => td.setContent(
    '-# Spend Valor Medals — buy with `crd pvp buy <id> [qty]`. Caps reset each season.'
  ));
  container.addSeparatorComponents(sep);
  container.addMediaGalleryComponents((g) => g.addItems((i) => i.setURL('attachment://pvp_shop.png')));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# Your balance — ${medal} **${valor.toLocaleString()}** Valor Medals`
    + (season ? ` · Season ${season.season_id}` : ' · *no active season*')
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(SHOP_QUOTE));

  return { components: [container], files: [file], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** `crd pvp buy <id> [qty]` — atomic Valor spend with per-season cap enforcement. */
async function buy(message, args) {
  const id = parseInt(args[0], 10);
  const item = SHOP.find((i) => i.id === id);
  if (!item) {
    return reply(message, 'Usage: `crd pvp buy <id> [qty]` — see `crd pvp shop` for ids (1-3).');
  }
  const qty = Math.max(1, parseInt(args[1], 10) || 1);
  const discordId = message.author.id;

  const season = await activeSeason(pool);
  if (!season) {
    return reply(message, '⚔️ No active PvP season — the shop opens when a season is running.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query(
      'SELECT valor_medals FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'You have no bag yet — `crd register` first.');
    }
    const valor = Number(bagRes.rows[0].valor_medals);

    const purRes = await client.query(
      'SELECT qty FROM pvp_shop_purchases WHERE discord_id = $1 AND season_id = $2 AND item_key = $3 FOR UPDATE',
      [discordId, season.season_id, item.key]
    );
    const bought = Number(purRes.rows[0]?.qty || 0);
    if (bought + qty > item.cap) {
      await client.query('ROLLBACK');
      const left = Math.max(0, item.cap - bought);
      return reply(message, `🚫 Season cap for **${item.name}** is ${item.cap} — you've bought ${bought}, can buy **${left}** more this season.`);
    }

    const cost = item.price * qty;
    if (valor < cost) {
      await client.query('ROLLBACK');
      const afford = Math.floor(valor / item.price);
      return reply(message, `Not enough Valor for ${qty}× — need ${cost.toLocaleString()}, have ${valor.toLocaleString()}. You can afford **${afford}**.`);
    }

    await client.query(
      `UPDATE users_bag SET valor_medals = valor_medals - $2, ${item.column} = ${item.column} + $3 WHERE discord_id = $1`,
      [discordId, cost, qty]
    );
    await client.query(
      `INSERT INTO pvp_shop_purchases (discord_id, season_id, item_key, qty)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id, season_id, item_key) DO UPDATE SET qty = pvp_shop_purchases.qty + $4`,
      [discordId, season.season_id, item.key, qty]
    );
    await client.query('COMMIT');

    return reply(message, `✅ Bought **${qty}× ${item.name}** ${emoji(item.emojiName)} for **${cost.toLocaleString()}** ${emoji('valor_medal')} Valor.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[pvp buy]', err.message);
    return reply(message, 'Purchase failed — nothing was spent.');
  } finally {
    client.release();
  }
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'buy') return buy(message, args.slice(1));
  // `crd pvp` and `crd pvp shop` both open the shop.
  const payload = await buildShop(message.author.id);
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

module.exports = { execute, buildShop };

'use strict';

/**
 * `crd equipment info <id>` (alias `crd eq info`; `crd weapon info` = deprecated alias).
 *
 * Looks up the id in user_weapons then user_armors and displays a native
 * OwO-style info embed: text on the left, item art as a Discord thumbnail on
 * the right. This intentionally avoids canvas/card rendering for normal info.
 */

const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { resolveName } = require('../../utils/emojis');
const { runeEmojiName, runeEmoji } = require('../../config/runes');
const { SELL_PRICES } = require('../../config/sellPrices');
const { assetPath, isRemoteAssetsEnabled } = require('../../utils/assets');

const SOCKET_LANES = {
  weapon: { native: 'offense', opposite: 'defense' },
  armor: { native: 'defense', opposite: 'offense' },
};

async function socketSlots(g) {
  const native = Array.isArray(g.native_sockets) ? g.native_sockets : [];
  const opposite = [];
  if (native.length === 0 && opposite.length === 0) return [];
  const lanes = SOCKET_LANES[g.kind];
  const ownerId = g.discord_id;

  const uids = [...native, ...opposite]
    .map((s) => s && s.rune_uid)
    .filter(Boolean);
  const runeBy = new Map();
  if (uids.length && ownerId) {
    const { rows } = await pool.query(
      `SELECT ur.rune_uid, rn.name, rn.tier,
              COALESCE(ur.rolled_value, rn.value) AS value,
              rn.effect_key
         FROM user_runes ur JOIN rune_roster rn ON ur.rune_id = rn.rune_id
        WHERE ur.rune_uid = ANY($1::varchar[])
          AND ur.discord_id = $2`,
      [uids, ownerId],
    );
    for (const r of rows) runeBy.set(r.rune_uid, r);
  }

  const slots = [];
  for (const [arr, lane] of [
    [native, lanes.native],
    [opposite, lanes.opposite],
  ]) {
    for (const slot of arr) {
      const rune = slot && slot.rune_uid ? runeBy.get(slot.rune_uid) : null;
      slots.push(
        rune
          ? {
              imagePath: assetPath(`items/runes/${runeEmojiName(rune.effect_key)}.png`),
              label: rune.name,
              emoji: runeEmoji(rune.effect_key),
              tier: rune.tier,
              lane,
            }
          : { imagePath: null, label: null, tier: null, lane },
      );
    }
  }
  return slots;
}

const AI_DISCLAIMER =
  '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

const TIER_COLOR = {
  Common: 0x95a5a6,
  Rare: 0x3498db,
  Mythic: 0x9b59b6,
  Legendary: 0xffd700,
  Supreme: 0xe74c3c,
};

const WEAPONS_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'weapons');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

function artworkPath(baseDir, name) {
  const derived = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const slugs = [resolveName(name), derived].filter(Boolean);
  if (isRemoteAssetsEnabled()) {
    return slugs.flatMap((slug) => ['png', 'jpg'].map((ext) => assetPath(`weapons/${slug}.${ext}`)));
  }
  for (const slug of slugs) {
    for (const ext of ['png', 'jpg']) {
      const p = path.join(baseDir, `${slug}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function thumbnailUrlFor(name) {
  if (!isRemoteAssetsEnabled()) return null;
  const candidates = artworkPath(WEAPONS_DIR, name);
  return Array.isArray(candidates) ? candidates[0] || null : candidates;
}

function statBlock(g) {
  const defensive = [];
  const offensive = [];
  if (g.curr_hp != null) defensive.push(`HP: ${Number(g.curr_hp).toLocaleString()}`);
  if (g.curr_def != null) defensive.push(`Defense: ${Number(g.curr_def).toLocaleString()}`);
  if (g.curr_atk != null) offensive.push(`Attack: ${Number(g.curr_atk).toLocaleString()}`);
  if (g.crit != null && Number(g.crit) > 0) offensive.push(`Critical Rate: ${Number(g.crit).toFixed(1)}%`);
  if (g.bonus_dmg_pct != null && Number(g.bonus_dmg_pct) > 0) offensive.push(`Bonus Damage: ${Number(g.bonus_dmg_pct)}%`);
  return [defensive.join('\n'), offensive.join('\n')].filter(Boolean).join('\n\n') || 'No stats.';
}

function formatRuneSlots(sockets) {
  const runeLines = [];
  const total = Math.max(2, sockets.length);
  for (let i = 0; i < total; i++) {
    const slot = sockets[i];
    runeLines.push(slot && slot.label
      ? ('Rune slot ' + (i + 1) + ': ' + (slot.emoji || '') + ' ' + slot.label).trim()
      : 'Rune slot ' + (i + 1) + ': empty');
  }
  return runeLines.join('\n');
}

async function buildInfoPayload(g, gearId, ownerId) {
  const hasPassive = g.passive_name && g.passive_name.toLowerCase() !== 'none';
  const sockets = await socketSlots(g);
  const headerName = ownerId ? `<@${ownerId}>'s` : '';
  const sellValue = SELL_PRICES[g.tier] || 0;
  const loreBlock = typeof g.lore === 'string' && g.lore.trim().length > 0
    ? `*${g.lore.trim()}*`
    : 'No lore recorded yet.';

  const embed = new EmbedBuilder()
    .setColor(TIER_COLOR[g.tier] ?? TIER_COLOR.Common)
    .setTitle(`${headerName} ${g.name}`.trim())
    .setDescription([
      `**Tier:** ${g.tier}`,
      `**Type:** ${g.type || (g.kind === 'weapon' ? 'Weapon' : 'Armor')}`,
      `**Enhancement:** +${Math.max(0, (Number(g.enhancement) || 1) - 1)}`,
    ].join('\n'))
    .addFields(
      { name: 'Stats', value: statBlock(g) },
      {
        name: hasPassive ? `Passive - ${g.passive_name}` : 'Passive',
        value: hasPassive ? (g.passive_description || 'No passive.') : 'No passive.',
      },
      { name: 'Rune Slots', value: formatRuneSlots(sockets) },
      { name: 'Lore', value: `${loreBlock}\n\n${AI_DISCLAIMER}` },
      {
        name: 'Details',
        value: `${g.kind === 'weapon' ? '⚔️' : '🛡️'} **ID:** \`${gearId}\`\n` +
          `💰 **Sell Value:** ${sellValue.toLocaleString()} Credux\n` +
          `-# 💡 \`crd enhance ${gearId}\` ・ \`crd equip ${gearId}\``,
      },
    );

  const thumbnailUrl = thumbnailUrlFor(g.name);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  return { embeds: [embed] };
}

async function fetchGear(discordId, gearId) {
  const { rows } = await pool.query(
    `SELECT kind, discord_id, curr_atk, crit, enhancement, bonus_dmg_pct,
            curr_hp, curr_def, native_sockets, opposite_sockets,
            name, type, tier, passive_name, passive_description, lore
       FROM (
         SELECT 0 AS priority, 'weapon' AS kind,
                uw.discord_id, uw.curr_atk, uw.crit, uw.enhancement, uw.bonus_dmg_pct,
                NULL::integer AS curr_hp, NULL::integer AS curr_def,
                uw.native_sockets, uw.opposite_sockets,
                wr.name, wr.type, wr.tier, wr.passive_name, wr.passive_description, wr.lore
           FROM user_weapons uw
           JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
          WHERE uw.weapon_id = $1 AND uw.discord_id = $2
         UNION ALL
         SELECT 1 AS priority, 'armor' AS kind,
                ua.discord_id, NULL::integer AS curr_atk, NULL::numeric AS crit,
                ua.enhancement, NULL::numeric AS bonus_dmg_pct,
                ua.curr_hp, ua.curr_def,
                ua.native_sockets, ua.opposite_sockets,
                ar.name, ar.type, ar.tier, ar.passive_name, ar.passive_description, ar.lore
           FROM user_armors ua
           JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
          WHERE ua.armor_id = $1 AND ua.discord_id = $2
       ) gear
      ORDER BY priority
      LIMIT 1`,
    [gearId, discordId],
  );
  if (rows.length > 0) return rows[0];
  return null;
}

async function info(message, rawId) {
  const gearId = (rawId || '').trim().toLowerCase();
  if (!gearId) {
    await reply(message, { content: 'Usage: `crd equipment info <id>`' });
    return;
  }

  const g = await fetchGear(message.author.id, gearId);
  if (!g) {
    await reply(message, { content: "You don't own equipment with that ID." });
    return;
  }

  await reply(message, await buildInfoPayload(g, gearId, message.author.id));
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd equipment info <id>`' });
}

module.exports = { execute, info, buildInfoPayload, fetchGear };

'use strict';

/**
 * `crd equipment info <id>` (alias `crd eq info`; `crd weapon info` = deprecated alias).
 *
 * Looks up the id in user_weapons then user_armors and displays a native
 * OwO-style info embed: text on the left, item art as a Discord thumbnail on
 * the right. This intentionally avoids canvas/card rendering for normal info.
 */

const {
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { resolveName } = require('../../utils/emojis');
const { runeEmojiName, runeEmoji } = require('../../config/runes');
const { SELL_PRICES } = require('../../config/sellPrices');
const { assetPath, isRemoteAssetsEnabled, remoteAssetAvailable, relativeAssetPath } = require('../../utils/assets');
const { bandwidthLog } = require('../../utils/runtimeLogs');
const { smallDivider: sep } = require('../../utils/componentsV2');

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

const THUMBNAIL_EXTENSIONS = ['webp', 'png', 'jpg'];

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

function displayNameFor(message, userId) {
  const member = message.guild?.members?.cache?.get(String(userId)) || null;
  const user = member?.user || (message.author?.id === String(userId) ? message.author : null);
  return member?.displayName || user?.globalName || user?.username || null;
}

function publicAssetSource(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host.includes('r2.dev') || host.includes('cloudflarestorage.com')
      ? 'r2-url'
      : 'cloudflare-url';
  } catch {
    return 'cloudflare-url';
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.url || seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function thumbnailCandidatesFor(name) {
  if (!isRemoteAssetsEnabled()) return null;
  const derived = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const slugs = [resolveName(name), derived].filter(Boolean);
  const candidates = [];
  for (const slug of slugs) {
    for (const ext of THUMBNAIL_EXTENSIONS) {
      candidates.push(
        { url: assetPath(`weapons/thumbnails/${slug}.${ext}`), thumbnailVariant: true },
        { url: assetPath(`weapons/thumbs/${slug}.${ext}`), thumbnailVariant: true },
        { url: assetPath(`weapons/${slug}_thumb.${ext}`), thumbnailVariant: true },
        { url: assetPath(`weapons/${slug}_thumbnail.${ext}`), thumbnailVariant: true },
      );
    }
    for (const ext of ['webp', 'png', 'jpg']) {
      candidates.push({ url: assetPath(`weapons/${slug}.${ext}`), thumbnailVariant: false });
    }
  }
  return uniqueCandidates(candidates);
}

async function thumbnailUrlFor(name, logContext = {}) {
  if (!isRemoteAssetsEnabled()) {
    bandwidthLog('equipment thumbnail source', {
      ...logContext,
      source: 'missing',
      thumbnailVariant: false,
      reason: 'remote-assets-disabled',
    });
    return null;
  }
  const list = thumbnailCandidatesFor(name);
  for (const candidate of list) {
    if (await remoteAssetAvailable(relativeAssetPath(candidate.url))) {
      bandwidthLog('equipment thumbnail source', {
        ...logContext,
        source: publicAssetSource(candidate.url),
        thumbnailVariant: candidate.thumbnailVariant,
      });
      return candidate.url;
    }
  }
  bandwidthLog('equipment thumbnail source', {
    ...logContext,
    source: 'missing',
    thumbnailVariant: false,
    reason: 'no-public-image',
  });
  return null;
}

function statBlock(g) {
  if (g.kind === 'weapon') {
    const lines = [
      `Attack: ${Number(g.curr_atk || 0).toLocaleString()}`,
      `Critical Rate: ${Number(g.crit || 0).toFixed(1)}%`,
    ];
    const bonus = Number(g.bonus_dmg_pct || 0);
    if (bonus > 0) lines.push(`Bonus: +${bonus}% DMG`);
    return lines.join('\n');
  }
  return [
    `HP: ${Number(g.curr_hp || 0).toLocaleString()}`,
    `Defense: ${Number(g.curr_def || 0).toLocaleString()}`,
  ].join('\n');
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

async function buildInfoPayload(g, gearId, ownerId, ownerDisplayName = null) {
  const hasPassive = g.passive_name && g.passive_name.toLowerCase() !== 'none';
  const sockets = await socketSlots(g);
  const headerName = ownerDisplayName ? `${ownerDisplayName}'s` : '';
  const sellValue = SELL_PRICES[g.tier] || 0;
  const loreBlock = typeof g.lore === 'string' && g.lore.trim().length > 0
    ? `*${g.lore.trim()}*`
    : 'No lore recorded yet.';
  const enhancement = Math.max(0, (Number(g.enhancement) || 1) - 1);
  const passiveName = hasPassive ? g.passive_name : 'None';
  const passiveDescription = hasPassive ? (g.passive_description || 'No passive.') : 'No passive.';
  const thumbnailUrl = await thumbnailUrlFor(g.name, {
    system: 'equipment',
    command: 'equipment',
    imageType: 'equipment_thumbnail',
    userId: ownerId,
  });

  // Header block (item name + owner mention, Tier, Enhancement). The item art
  // sits top-right as a real Components V2 thumbnail accessory when a public
  // image resolves; otherwise the header degrades to plain text (no thumbnail),
  // preserving the previous "remote-only thumbnail" behavior.
  const kindIcon = g.kind === 'weapon' ? '⚔️' : '🛡️';
  const titleLine = `## ${kindIcon} ${g.name}`;
  const ownerLine = ownerId
    ? `-# ${headerName ? `${headerName} — ` : ''}<@${ownerId}>`
    : (headerName ? `-# ${headerName}` : null);

  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[g.tier] ?? TIER_COLOR.Common);

  if (thumbnailUrl) {
    container.addSectionComponents((section) => {
      section
        .addTextDisplayComponents((td) => td.setContent(
          ownerLine ? `${titleLine}\n${ownerLine}` : titleLine
        ))
        .addTextDisplayComponents((td) => td.setContent(`**Tier**\n${g.tier}`))
        .addTextDisplayComponents((td) => td.setContent(`**Enhancement**\n+${enhancement}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
      return section;
    });
  } else {
    container
      .addTextDisplayComponents((td) => td.setContent(
        ownerLine ? `${titleLine}\n${ownerLine}` : titleLine
      ))
      .addTextDisplayComponents((td) => td.setContent(`**Tier**\n${g.tier}`))
      .addTextDisplayComponents((td) => td.setContent(`**Enhancement**\n+${enhancement}`));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`**Stats**\n${statBlock(g)}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`**Passive - ${passiveName}**\n${passiveDescription}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`**Rune Slots**\n${formatRuneSlots(sockets)}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`**Lore**\n${loreBlock}\n\n${AI_DISCLAIMER}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Details**\n${ownerId ? `Owner: <@${ownerId}>\n` : ''}` +
      `${kindIcon} ID: \`${gearId}\`\n` +
      `💰 Sell Value: ${sellValue.toLocaleString()} Credux`
    ))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Help**\n💡 \`crd enhance ${gearId}\` ・ \`crd equip ${gearId}\``
    ));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
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

  await reply(message, await buildInfoPayload(
    g,
    gearId,
    message.author.id,
    displayNameFor(message, message.author.id)
  ));
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd equipment info <id>`' });
}

module.exports = { execute, info, buildInfoPayload, fetchGear };

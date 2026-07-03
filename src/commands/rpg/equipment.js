'use strict';

/**
 * `crd equipment info <id>` (alias `crd eq info`; `crd weapon info` = deprecated alias)
 * — UNIFIED Canvas info card for BOTH weapons and armor ([v5] Blueprint 1.4).
 *
 * Looks up the id in user_weapons then user_armors and renders the matching card.
 * Shared layout (tier color, type icon, enhancement, passive, lore, art); the ONLY
 * branch is the stat line: weapon → ATK · CRIT, armor → HP · DEF · type. Miss in
 * both tables → "You don't own equipment with that ID."
 */

const {
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { resolveName } = require('../../utils/emojis');
const { renderPortraitCard } = require('../../engine/renderPortraitCard');
const { makeOptimizedAttachment } = require('../../utils/imageOutput');
const { runeEmojiName } = require('../../config/runes');
const { SELL_PRICES } = require('../../config/sellPrices');
const { assetPath, isRemoteAssetsEnabled } = require('../../utils/assets');

// Lane of each socket array by gear kind (Naming Conv §5).
const SOCKET_LANES = {
  weapon: { native: 'offense', opposite: 'defense' },
  armor: { native: 'defense', opposite: 'offense' },
};

/**
 * Build the ordered socket-slot list for the card panel. Global slot numbering:
 * native 1..N then opposite N+1..N+M. Each entry: { imagePath, value, lane } —
 * filled slots resolve the rune art (assets/items/runes/<key>_rune.png) + value.
 * Returns [] when the gear has no sockets.
 */
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
const TIER_HEX = {
  Common: '#95a5a6',
  Rare: '#3498db',
  Mythic: '#9b59b6',
  Legendary: '#FFD700',
  Supreme: '#e74c3c',
};

const WEAPONS_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'weapons');

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

/**
 * Artwork path for a gear display name within a base dir. Filenames equal the
 * registry emoji names (incl. their typos), so resolve through the registry first,
 * then fall back to the name-derived slug. null = no art (renderer text-only).
 */
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

/** Build the unified info payload from a normalized gear row (kind = weapon|armor). */
async function buildInfoPayload(g, gearId, ownerId) {
  const hasPassive = g.passive_name && g.passive_name.toLowerCase() !== 'none';

  const statLines =
    g.kind === 'weapon'
      ? [`ATK   ${g.curr_atk}`]
      : [`HP    ${g.curr_hp}`, `DEF   ${g.curr_def}`];
  if (g.kind === 'weapon') {
    if (Number(g.crit) > 0)
      statLines.push(`CRIT  ${Number(g.crit).toFixed(1)}%`);
    if (g.bonus_dmg_pct)
      statLines.push(`Bonus +${Number(g.bonus_dmg_pct)}% DMG`);
  }

  // [v5 tweak] Armor type ("(Medium)") is no longer shown in displays.
  const subtitle = g.tier;
  const sections = [
    { heading: 'Stats', body: statLines.join('\n') },
    hasPassive
      ? { heading: `Passive — ${g.passive_name}`, body: g.passive_description }
      : { heading: 'Passive', body: 'No passive.', dim: true },
  ];
  // [v5 Phase 2] Sockets render as a boxed panel under the text (renderPortraitCard).
  const sockets = await socketSlots(g);

  const image = await makeOptimizedAttachment(await renderPortraitCard({
    // v5 keeps weapon and armor artwork in the shared assets/weapons registry.
    imagePath: artworkPath(WEAPONS_DIR, g.name),
    accent: TIER_HEX[g.tier] || TIER_HEX.Common,
    title: `${g.name} +${g.enhancement - 1}`,
    subtitle,
    sections,
    sockets,
  }), 'equipment_card');

  const headerName = ownerId ? `<@${ownerId}>'s` : '';
  const sellValue = SELL_PRICES[g.tier] || 0;
  const sellDisplay = sellValue.toLocaleString();

  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[g.tier] ?? TIER_COLOR.Common);
  container.addTextDisplayComponents((td) => td.setContent(`## ${headerName} ${g.name}`));
  container.addSeparatorComponents(sep);
  container
    .addMediaGalleryComponents((gal) =>
      gal.addItems((item) => item.setURL(image.url)),
    )
    .addSeparatorComponents(sep);

  const hasLore = typeof g.lore === 'string' && g.lore.trim().length > 0;
  const loreBlock = hasLore ? `*${g.lore.trim()}*` : '-# No lore recorded yet.';
  container
    .addTextDisplayComponents((td) =>
      td.setContent(`${loreBlock}\n\n${AI_DISCLAIMER}`),
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`${g.kind === 'weapon' ? '⚔️' : '🛡️'} **ID:** \`${gearId}\`\n💰 **Sell Value:** ${sellDisplay} Credux`),
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(
        `-# 💡 \`crd enhance ${gearId}\` ・ \`crd equip ${gearId}\``,
      ),
    );

  return {
    components: [container],
    files: [image.file],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Fetch a gear row by id (weapon first, then armor), normalized for the card. */
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

// ── crd equipment info <id> ─────────────────────────────────────────────────
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

// ── dispatcher: crd equipment info <id> ─────────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd equipment info <id>`' });
}

module.exports = { execute, info, buildInfoPayload, fetchGear };

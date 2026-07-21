'use strict';

const {
  ContainerBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { registerMemorySource } = require('../../utils/memoryRegistry');
const { TIER_ALIAS, TIER_COLOR, TIER_ESSENCE_COLUMN } = require('../../config/gachaRates');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay, emoji } = require('../../utils/emojis');
const { formatEnhancedName } = require('../../utils/enhancementFormat');
const { makeOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');

// Bump when renderPortraitCard / the deities-grid visuals change (busts cached cards).
const DEITY_RENDER_REV = 3;
const {
  assetPath,
  isRemoteAssetsEnabled,
  loadAssetImage: loadAssetImageSource,
  remoteAssetAvailable,
  relativeAssetPath,
} = require('../../utils/assets');
const { bandwidthLog } = require('../../utils/runtimeLogs');
const { RARITY_SYMBOLS } = require('../../engine/renderSummon');
const {
  MAX_SIGILS, nextSigilCost, ascensionCost,
} = require('../../config/ascension');
const {
  computeDeityStats, computeDeityProgressionStats, nextDeityAttempt,
} = require('../../engine/deityEnhancement');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { releaseCanvas } = require('../../utils/canvasEncode');
const {
  DIVINE_BLESSING_DEITIES, ECHO_BLESSING_DEITIES, ECHO_BLESSING_KEY_MAP,
  SLOT_UNLOCK_GATES, computeResonanceMods, DOMAIN_RESONANCES, MYTHOLOGY_RESONANCES,
} = require('../../config/blessings');

const BRAND = 0x9b59b6;

// Tier ordering for lists (Supreme → Epic).
const TIER_ORDER_SQL = `CASE dr.tier
  WHEN 'Supreme' THEN 4 WHEN 'Legendary' THEN 3 WHEN 'Mythic' THEN 2 WHEN 'Epic' THEN 1 ELSE 0 END`;

const TIER_ESSENCE_LABEL = [
  ['Epic', 'epic_essence'],
  ['Mythic', 'mythic_essence'],
  ['Legendary', 'legendary_essence'],
  ['Supreme', 'supreme_essence'],
];

// mythology column value → full display name + portrait subfolder.
const MYTHOLOGY_LABEL = { PH: 'Philippine Mythology', Norse: 'Norse Mythology', Greek: 'Greek Mythology' };
const MYTHOLOGY_DIR = { PH: 'philippine', Norse: 'norse', Greek: 'greek' };

const DEITIES_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'deities');
const THUMBNAIL_EXTENSIONS = ['webp', 'png', 'jpg'];
let mythologyPageCache = null;

registerMemorySource('database.deity-mythologies', () => ({
  entries: mythologyPageCache?.length || 0,
  fixedQueryResult: true,
}));

async function loadAssetImage(source) {
  return loadAssetImageSource(loadImage, source);
}

function safeDeityImagePath(...parts) {
  const cleanParts = [];
  for (const part of parts) {
    if (part == null) continue;
    const raw = String(part).trim();
    if (!raw || path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) return null;
    const split = raw.replace(/\\/g, '/').split('/').filter(Boolean);
    if (split.some((segment) => segment === '.' || segment === '..')) return null;
    cleanParts.push(...split);
  }
  if (cleanParts.length === 0) return null;

  const abs = path.resolve(DEITIES_DIR, ...cleanParts);
  const rel = path.relative(DEITIES_DIR, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return isRemoteAssetsEnabled() ? assetPath(`deities/${cleanParts.join('/')}`) : abs;
}

function reply(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [], ...(payload.allowedMentions ?? {}) },
  });
}

function displayNameFor(message, userId) {
  const member = message.guild?.members?.cache?.get(String(userId)) || null;
  const user = member?.user || (message.author?.id === String(userId) ? message.author : null);
  return member?.displayName || user?.globalName || user?.username || null;
}

async function mythologyPages() {
  if (mythologyPageCache) return mythologyPageCache;
  const mythRes = await pool.query(
    'SELECT mythology FROM deity_roster GROUP BY mythology ORDER BY MIN(deity_id)'
  );
  mythologyPageCache = mythRes.rows.map((r) => r.mythology);
  return mythologyPageCache;
}

// ── crd deity list (one page per mythology — roster order) ─────────────────
// page is 0-based (matches the deities:<action>:<owner>:<page> customId state).
async function fetchDeities(discordId, page) {
  // Stable page order: one page per mythology, in seed (roster) order.
  const mythologies = await mythologyPages();
  const totalPages = Math.max(1, mythologies.length);
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const mythology = mythologies[p] ?? null;

  const deityQuery = mythology == null ? Promise.resolve({ rows: [] }) : pool.query(
    `SELECT dr.name, dr.tier, (ud.user_deity_id IS NOT NULL) AS owned
       FROM deity_roster dr
       LEFT JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE dr.mythology = $2
      ORDER BY ${TIER_ORDER_SQL} DESC, dr.name ASC`,
    [discordId, mythology]
  );
  const essenceQuery = pool.query(
    'SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence FROM users_bag WHERE discord_id = $1',
    [discordId]
  );
  const [{ rows: deities }, essenceRes] = await Promise.all([deityQuery, essenceQuery]);
  return { deities, mythology, page: p, totalPages, essence: essenceRes.rows[0] || {} };
}

// Design standard (see CLAUDE.md): header → separator → body → separator →
// footer (essence summary + help) → separator → buttons.
async function buildListPage({ user, deities, mythology, page, totalPages, essence }) {
  const container = new ContainerBuilder().setAccentColor(BRAND);

  const mythologyLabel = mythology == null
    ? '—'
    : (MYTHOLOGY_LABEL[mythology] ?? `${mythology} Mythology`);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      `## 🕯️ <@${user.id}>'s Deities\n` +
      `-# Page **${page + 1}/${totalPages}** — ${mythologyLabel}`
    )
  );
  container.addSeparatorComponents(sep);

  if (deities.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No deities are available yet.*'));
  } else {
    const rows = deities.map((d) => {
      const alias = TIER_ALIAS[d.tier];
      const symbol = RARITY_SYMBOLS[alias] ?? '◆';
      const icon = emojiForDisplay(d.name, '🕯️');
      const btype = DIVINE_BLESSING_DEITIES.has(d.name) ? 'Divine' : 'Echo';
      return d.owned
        ? `${symbol} ${alias} ${icon} **${d.name}** — ${btype} Blessing`
        : `${symbol} ${alias} 🔒 *${d.name}* — ${btype} Blessing`;
    });
    container.addTextDisplayComponents((td) => td.setContent(rows.join('\n')));
  }

  container.addSeparatorComponents(sep);

  // Footer: essence balances (moved from the old page footer) above the help text.
  const essenceLine = TIER_ESSENCE_LABEL
    .map(([tier, col]) => `${emoji(col)} ${TIER_ALIAS[tier]}: **${essence?.[col] ?? 0}**`)
    .join(' ・ ');
  container
    .addTextDisplayComponents((td) => td.setContent(`-# ${essenceLine}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent('-# 💡 `crd deity info <name>` ・ `crd deity equip <name>`')
    );

  container.addSeparatorComponents(sep);
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`deities:prev:${user.id}:${page}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`deities:next:${user.id}:${page}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    )
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

async function collection(message) {
  const fetched = await fetchDeities(message.author.id, 0);
  await reply(message, await buildListPage({ user: message.author, ...fetched }));
}

// Button: deities:<prev|next>:<ownerId>:<page>
async function handleListButton(interaction) {
  const [, action, ownerId, pageStr] = interaction.customId.split(':');

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This isn\'t your collection — run `crd deity list` yourself!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const currentPage = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);

  // fetchDeities clamps the page to the mythology count server-side.
  const fetched = await fetchDeities(ownerId, page);
  await interaction.editReply(await buildListPage({ user: interaction.user, ...fetched }));
}

// ── crd deity info <name> ─────────────────────────────────────────────────
const DEITY_INFO_COLUMNS = `dr.name, dr.mythology, dr.tier, dr.blessing_name, dr.blessing_description,
            dr.lore, dr.base_atk, dr.base_hp, dr.base_def,
            ud.user_deity_id, ud.enhancement, ud.sigils, ud.ascended`;

/** Portrait candidates for a deity row (remote list or first existing local file). */
function resolveDeityPortraitPath(d) {
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const dir = MYTHOLOGY_DIR[d.mythology] ?? d.mythology?.toLowerCase();
  if (isRemoteAssetsEnabled()) return deityThumbnailCandidates(dir, slug);
  for (const ext of ['png', 'jpg']) {
    const p = safeDeityImagePath(dir, `${slug}.${ext}`);
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** Owned-deity info row by user_deity_id (button refresh path). */
async function fetchDeityInfoRow(discordId, userDeityId) {
  const { rows } = await pool.query(
    `SELECT ${DEITY_INFO_COLUMNS}
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = $1 AND ud.discord_id = $2`,
    [userDeityId, discordId]
  );
  return rows[0] || null;
}

async function info(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity info <deity name>`' });
    return;
  }
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT ${DEITY_INFO_COLUMNS}
       FROM deity_roster dr
       LEFT JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE LOWER(dr.name) = LOWER($2)`,
    [discordId, name]
  );

  if (rows.length === 0) {
    await reply(message, { content: `No deity named **${name}** exists.` });
    return;
  }
  const d = rows[0];
  if (d.user_deity_id == null) {
    // Roster match but the player doesn't own it.
    await reply(message, { content: `You haven't summoned ${d.name} yet.` });
    return;
  }

  await reply(message, await buildDeityInfoPayload(d, {
    ownerId: message.author.id,
    ownerDisplayName: displayNameFor(message, message.author.id),
  }));
}

const AI_DISCLAIMER = '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

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

function deityThumbnailCandidates(dir, slug) {
  const candidates = [];
  for (const ext of THUMBNAIL_EXTENSIONS) {
    candidates.push(
      { url: safeDeityImagePath(dir, `thumbnails/${slug}.${ext}`), thumbnailVariant: true },
      { url: safeDeityImagePath(dir, `thumbs/${slug}.${ext}`), thumbnailVariant: true },
      { url: safeDeityImagePath(dir, `${slug}_thumb.${ext}`), thumbnailVariant: true },
      { url: safeDeityImagePath(dir, `${slug}_thumbnail.${ext}`), thumbnailVariant: true },
    );
  }
  for (const ext of ['webp', 'png', 'jpg']) {
    candidates.push({ url: safeDeityImagePath(dir, `${slug}.${ext}`), thumbnailVariant: false });
  }
  return uniqueCandidates(candidates);
}

function normalizeThumbnailCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') return { url: candidate, thumbnailVariant: false };
  return candidate;
}

async function firstAvailablePublicImage(paths, logContext = {}) {
  if (!isRemoteAssetsEnabled()) {
    bandwidthLog('deity thumbnail source', {
      ...logContext,
      source: 'missing',
      thumbnailVariant: false,
      reason: 'remote-assets-disabled',
    });
    return null;
  }
  const list = Array.isArray(paths) ? paths : [paths].filter(Boolean);
  for (const rawCandidate of list) {
    const candidate = normalizeThumbnailCandidate(rawCandidate);
    if (!candidate?.url) continue;
    if (await remoteAssetAvailable(relativeAssetPath(candidate.url))) {
      bandwidthLog('deity thumbnail source', {
        ...logContext,
        source: publicAssetSource(candidate.url),
        thumbnailVariant: candidate.thumbnailVariant,
      });
      return candidate.url;
    }
  }
  bandwidthLog('deity thumbnail source', {
    ...logContext,
    source: 'missing',
    thumbnailVariant: false,
    reason: 'no-public-image',
  });
  return null;
}

/**
 * Deity-info payload (Ascension §3.7 — Components V2, real separators; mirrors
 * the equipment info card): thumbnail top-right, header (name/tier/mythology),
 * then Sigils → Stats → Blessing → Lore sections, plus ONE dynamic button:
 *   sigils < 10          → Unlock Sigil (cost: N <Tier> Essence)
 *   10/10, not ascended  → Ascend (N Essence + N Credux)
 *   ascended             → no button.
 */
async function buildDeityInfoPayload(d, { ownerId, ownerDisplayName = null }) {
  const alias = TIER_ALIAS[d.tier];
  const mythologyLabel = MYTHOLOGY_LABEL[d.mythology] ?? `${d.mythology} Mythology`;
  const btype = DIVINE_BLESSING_DEITIES.has(d.name) ? 'Divine' : 'Echo';
  const sigils = Math.max(0, Math.min(MAX_SIGILS, Number(d.sigils) || 0));
  const ascended = Boolean(d.ascended);
  const sigilEmoji = emoji(`${String(d.tier).toLowerCase()}_sigil`);
  const essenceEmoji = emoji(`${String(d.tier).toLowerCase()}_essence`);
  const buttonEmoji = /^<a?:[a-z0-9_]+:\d+>$/i.test(essenceEmoji) ? essenceEmoji : null;
  const stats = computeDeityProgressionStats(d, {
    sigils,
    ascended,
    enhancement: d.enhancement,
  });
  const loreBlock = typeof d.lore === 'string' && d.lore.trim().length > 0
    ? `*${d.lore.trim()}*`
    : 'No lore recorded yet.';
  const thumbnailUrl = await firstAvailablePublicImage(resolveDeityPortraitPath(d), {
    system: 'deity',
    command: 'deity',
    imageType: 'deity_thumbnail',
    userId: ownerId,
  });

  // Sigils section + button state share the same cost lookups.
  const sigilCost = nextSigilCost(d.tier, sigils);
  const ascCost = ascensionCost(d.tier);
  let sigilBlock;
  if (ascended) {
    sigilBlock =
      `**Sigils ${sigilEmoji}**\n${MAX_SIGILS}/${MAX_SIGILS} — Ascended ✦\n` +
      `Enhancement: **+${Math.max(0, (Number(d.enhancement) || 1) - 1)}** — use \`crd deity enhance ${d.name.toLowerCase()}\``;
  } else if (sigils >= MAX_SIGILS) {
    sigilBlock =
      `**Sigils ${sigilEmoji}**\n${sigils}/${MAX_SIGILS} — Ready to Ascend\n` +
      `Ascension: ${essenceEmoji} **${ascCost.essence}** ${d.tier} Essence + **${ascCost.credux.toLocaleString()}** Credux`;
  } else {
    sigilBlock =
      `**Sigils ${sigilEmoji}**\n${sigils}/${MAX_SIGILS}\n` +
      `Next Sigil: ${essenceEmoji} **${sigilCost.essence}** ${d.tier} Essence`;
  }

  const statsBlock =
    '**Stats**\n' +
    `HP: ${stats.curr_hp.toLocaleString()}\n` +
    `Attack: ${stats.curr_atk.toLocaleString()}\n` +
    `Defense: ${stats.curr_def.toLocaleString()}`;

  // §3.7: never show the blessing text before Ascension.
  const blessingBlock = ascended
    ? `**${btype} Blessing — ${d.blessing_name}**\n${d.blessing_description || 'No blessing description.'}`
    : '**Blessing**\nBlessing dormant — ascend this deity to awaken it.';

  const titleLine = `## 🕯️ ${formatEnhancedName(d.name, d.enhancement)}`;
  const ownerLine = ownerId ? `-# Owner: <@${ownerId}>` : null;
  const headerText = ownerLine ? `${titleLine}\n${ownerLine}` : titleLine;

  const container = new ContainerBuilder().setAccentColor(TIER_COLOR[d.tier] ?? BRAND);
  if (thumbnailUrl) {
    container.addSectionComponents((section) => section
      .addTextDisplayComponents((td) => td.setContent(headerText))
      .addTextDisplayComponents((td) => td.setContent(`**Tier**\n${alias}`))
      .addTextDisplayComponents((td) => td.setContent(`**Mythology**\n${mythologyLabel}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl)));
  } else {
    container
      .addTextDisplayComponents((td) => td.setContent(headerText))
      .addTextDisplayComponents((td) => td.setContent(`**Tier**\n${alias}`))
      .addTextDisplayComponents((td) => td.setContent(`**Mythology**\n${mythologyLabel}`));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(sigilBlock))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(statsBlock))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(blessingBlock))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`**Lore**\n${loreBlock}\n\n${AI_DISCLAIMER}`));

  // Dynamic button (§3.7) — hidden once ascended. custom_id carries deity + owner;
  // the handler rejects clicks from anyone but the owner.
  if (!ascended && ownerId) {
    const label = sigils < MAX_SIGILS
      ? `Unlock Sigil: ${sigilCost.essence} ${d.tier} Essence`
      : `Ascend (${ascCost.essence} Essence + ${ascCost.credux.toLocaleString()} Credux)`;
    container.addSeparatorComponents(sep);
    container.addActionRowComponents((row) => row.setComponents(
      (() => {
        const button = new ButtonBuilder()
          .setCustomId(`dsigil:act:${d.user_deity_id}:${ownerId}`)
          .setLabel(label)
          .setStyle(sigils < MAX_SIGILS ? ButtonStyle.Primary : ButtonStyle.Success);
        if (buttonEmoji) button.setEmoji(buttonEmoji);
        return button;
      })()
    ));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

// ── Sigil unlock / Ascension (Ascension §3.5/§3.7) ─────────────────────────
const RED = 0xe74c3c;

function notePayload(text, color = RED) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents((td) => td.setContent(text));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * One atomic Sigil or Ascension step behind the deity info button:
 *   sigils < 10           → unlock the next Sigil (tier essence)
 *   sigils = 10, !ascended → Ascend (tier essence + Credux)
 *   ascended              → no-op ('ascended')
 * State is re-checked INSIDE the transaction with row locks on users_bag and
 * the user_deities row, so double-clicks cannot double-spend or over-increment.
 * Lock order: users_bag → user_deities (standardized with the weapon forge).
 */
async function attemptSigilStep(client, discordId, userDeityId) {
  await client.query('BEGIN');

  const bagRes = await client.query(
    `SELECT credux, epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (bagRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }

  const dRes = await client.query(
    `SELECT ud.sigils, ud.ascended, dr.tier, dr.name
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = $1 AND ud.discord_id = $2
      FOR UPDATE OF ud`,
    [userDeityId, discordId]
  );
  if (dRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }
  const d = dRes.rows[0];

  if (d.ascended) {
    await client.query('ROLLBACK');
    return { status: 'ascended', name: d.name };
  }

  const essCol = TIER_ESSENCE_COLUMN[d.tier]; // whitelisted from our constant map
  const essBefore = Number(bagRes.rows[0][essCol]);

  if (d.sigils < MAX_SIGILS) {
    // ── Sigil unlock ──
    const cost = nextSigilCost(d.tier, d.sigils);
    if (essBefore < cost.essence) {
      await client.query('ROLLBACK');
      return { status: 'insufficient_essence', need: cost.essence, have: essBefore, tier: d.tier, name: d.name };
    }
    await client.query(
      `UPDATE users_bag SET ${essCol} = ${essCol} - $2 WHERE discord_id = $1`,
      [discordId, cost.essence]
    );
    await client.query(
      'UPDATE user_deities SET sigils = sigils + 1 WHERE user_deity_id = $1',
      [userDeityId]
    );
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_essence_count, updated_essence_count)
       VALUES ($1, 'Deity Sigil', $2, $3, $4)`,
      [discordId, essCol, essBefore, essBefore - cost.essence]
    );
    await client.query('COMMIT');
    return { status: 'sigil', name: d.name, sigils: d.sigils + 1, cost: cost.essence, tier: d.tier };
  }

  // ── Ascension ──
  const ac = ascensionCost(d.tier);
  const creduxBefore = Number(bagRes.rows[0].credux);
  if (essBefore < ac.essence) {
    await client.query('ROLLBACK');
    return { status: 'insufficient_essence', need: ac.essence, have: essBefore, tier: d.tier, name: d.name };
  }
  if (creduxBefore < ac.credux) {
    await client.query('ROLLBACK');
    return { status: 'insufficient_credux', need: ac.credux, have: creduxBefore, tier: d.tier, name: d.name };
  }
  await client.query(
    `UPDATE users_bag SET ${essCol} = ${essCol} - $2, credux = credux - $3 WHERE discord_id = $1`,
    [discordId, ac.essence, ac.credux]
  );
  await client.query(
    'UPDATE user_deities SET ascended = TRUE WHERE user_deity_id = $1',
    [userDeityId]
  );
  await client.query(
    `INSERT INTO game_logs
       (discord_id, action, item_type, previous_essence_count, updated_essence_count, previous_credux, updated_credux)
     VALUES ($1, 'Deity Ascend', $2, $3, $4, $5, $6)`,
    [discordId, essCol, essBefore, essBefore - ac.essence, creduxBefore, creduxBefore - ac.credux]
  );
  await client.query('COMMIT');
  return { status: 'ascend', name: d.name, tier: d.tier, cost: ac };
}

/** Run attemptSigilStep on a pooled client with rollback safety. */
async function runSigilStep(discordId, userDeityId) {
  let client;
  try {
    client = await pool.connect();
    return await attemptSigilStep(client, discordId, userDeityId);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

function sigilStepFailureText(result) {
  if (result.status === 'insufficient_essence') {
    return `❌ Not enough ${result.tier} Essence — need **${result.need}**, you have **${result.have}**.`;
  }
  if (result.status === 'insufficient_credux') {
    return `❌ Not enough Credux — need **${result.need.toLocaleString()}**, you have **${result.have.toLocaleString()}**.`;
  }
  return null;
}

/**
 * `crd deity enhance <name>` opens the forge after Ascension. Before that,
 * Sigils and Ascension remain managed from the deity info card.
 */
async function enhance(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity enhance <deity name>`' });
    return;
  }
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, ud.sigils, ud.ascended, dr.name AS roster_name
       FROM deity_roster dr
       LEFT JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE LOWER(dr.name) = LOWER($2)`,
    [discordId, name]
  );
  if (rows.length === 0) {
    await reply(message, { content: `No deity named **${name}** exists.` });
    return;
  }
  const row = rows[0];
  if (row.user_deity_id == null) {
    await reply(message, { content: `You haven't summoned ${row.roster_name} yet.` });
    return;
  }
  if (!row.ascended) {
    await reply(message, {
      content:
        `**${row.roster_name}** must Ascend before it can be enhanced.\n` +
        `Current progress: **${row.sigils}/${MAX_SIGILS} Sigils**. Use \`crd deity info ${row.roster_name.toLowerCase()}\` to continue.`,
    });
    return;
  }

  const forge = await fetchDeityForgeData(discordId, row.user_deity_id);
  if (!forge) {
    await reply(message, { content: `You haven't summoned ${row.roster_name} yet.` });
    return;
  }
  await reply(message, await buildDeityForgePayload(forge, discordId));
}

async function fetchDeityForgeData(discordId, userDeityId) {
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, ud.enhancement, ud.curr_atk, ud.curr_hp, ud.curr_def,
            dr.name, dr.mythology, dr.tier, dr.base_atk, dr.base_hp, dr.base_def
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = $1 AND ud.discord_id = $2`,
    [userDeityId, discordId]
  );
  const deity = rows[0];
  if (!deity) return null;
  Object.assign(deity, computeDeityStats(deity, Number(deity.enhancement) || 1));
  const essenceColumn = TIER_ESSENCE_COLUMN[deity.tier];
  const bag = await pool.query(
    `SELECT ${essenceColumn} AS amount FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  deity.essence = Number(bag.rows[0]?.amount) || 0;
  return deity;
}

async function buildDeityForgePayload(deity, ownerId, resultLine = null) {
  const next = nextDeityAttempt(deity.tier, deity.enhancement);
  const currentLevel = Math.max(0, (Number(deity.enhancement) || 1) - 1);
  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[deity.tier] ?? BRAND);
  const thumbnailUrl = await firstAvailablePublicImage(resolveDeityPortraitPath(deity), {
    system: 'deity',
    command: 'deity_enhance',
    imageType: 'deity_thumbnail',
    userId: ownerId,
  });
  if (thumbnailUrl) {
    container.addSectionComponents((section) => section
      .addTextDisplayComponents((td) => td.setContent(`## Forge — ${deity.name} +${currentLevel}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl)));
  } else {
    container.addTextDisplayComponents((td) => td.setContent(`## Forge — ${deity.name} +${currentLevel}`));
  }
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Current Stats**\nATK: ${deity.curr_atk.toLocaleString()}\nHP: ${deity.curr_hp.toLocaleString()}\nDEF: ${deity.curr_def.toLocaleString()}`
    ));

  if (next) {
    const preview = computeDeityStats(deity, Number(deity.enhancement) + 1);
    container
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(
        `**Next: +${next.targetLevel}**\nCost: **${next.cost}** ${deity.tier} Essence\n` +
        `ATK: ${preview.curr_atk.toLocaleString()} · HP: ${preview.curr_hp.toLocaleString()} · DEF: ${preview.curr_def.toLocaleString()}`
      ));
  } else {
    container.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent('Maximum enhancement reached (+10).'));
  }
  if (resultLine) container.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(resultLine));
  const essenceEmoji = emoji(`${String(deity.tier).toLowerCase()}_essence`);
  container.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(`-# ${essenceEmoji} ${deity.tier} Essence: ${deity.essence.toLocaleString()}`));

  const enabled = Boolean(next && deity.essence >= next.cost);
  return {
    components: [container, new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`denhance:attempt:${deity.user_deity_id}:${ownerId}`)
        .setLabel('Enhance')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!enabled),
      new ButtonBuilder()
        .setCustomId(`denhance:cancel:${deity.user_deity_id}:${ownerId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    )],
    flags: MessageFlags.IsComponentsV2,
  };
}

async function attemptDeityEnhance(client, discordId, userDeityId) {
  await client.query('BEGIN');
  const bagRes = await client.query(
    `SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  const deityRes = await client.query(
    `SELECT ud.enhancement, ud.ascended, dr.tier, dr.name, dr.base_atk, dr.base_hp, dr.base_def
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = $1 AND ud.discord_id = $2
      FOR UPDATE OF ud`,
    [userDeityId, discordId]
  );
  if (!bagRes.rows[0] || !deityRes.rows[0]) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }
  const deity = deityRes.rows[0];
  if (!deity.ascended) {
    await client.query('ROLLBACK');
    return { status: 'not_ascended', name: deity.name };
  }
  const next = nextDeityAttempt(deity.tier, deity.enhancement);
  if (!next) {
    await client.query('ROLLBACK');
    return { status: 'maxed', name: deity.name };
  }
  const essenceColumn = TIER_ESSENCE_COLUMN[deity.tier];
  const essence = Number(bagRes.rows[0][essenceColumn]) || 0;
  if (essence < next.cost) {
    await client.query('ROLLBACK');
    return { status: 'insufficient', name: deity.name, tier: deity.tier, need: next.cost, have: essence };
  }
  const enhancement = Number(deity.enhancement) + 1;
  const stats = computeDeityStats(deity, enhancement);
  await client.query(`UPDATE users_bag SET ${essenceColumn} = ${essenceColumn} - $2 WHERE discord_id = $1`, [discordId, next.cost]);
  await client.query(
    `UPDATE user_deities
        SET enhancement = $2, curr_atk = $3, curr_hp = $4, curr_def = $5
      WHERE user_deity_id = $1`,
    [userDeityId, enhancement, stats.curr_atk, stats.curr_hp, stats.curr_def]
  );
  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type, previous_essence_count, updated_essence_count)
     VALUES ($1, 'Deity Enhance', $2, $3, $4)`,
    [discordId, essenceColumn, essence, essence - next.cost]
  );
  await client.query('COMMIT');
  return { status: 'done', name: deity.name, previousLevel: enhancement - 2, level: enhancement - 1, cost: next.cost };
}

async function handleEnhanceAttempt(interaction, userDeityId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge is not yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  let client;
  try {
    client = await pool.connect();
    const result = await attemptDeityEnhance(client, ownerId, userDeityId);
    if (result.status === 'notfound') {
      await interaction.editReply(notePayload('This deity is no longer in your collection.'));
      return;
    }
    const forge = await fetchDeityForgeData(ownerId, userDeityId);
    if (!forge) {
      await interaction.editReply(notePayload('This deity is no longer in your collection.'));
      return;
    }
    const resultLine = result.status === 'done'
      ? `Enhanced ${result.name}: +${result.previousLevel} to +${result.level}.`
      : result.status === 'maxed'
        ? `${result.name} is already at maximum enhancement.`
        : result.status === 'insufficient'
          ? `Not enough ${result.tier} Essence: need ${result.need}, have ${result.have}.`
          : `${result.name} must Ascend before it can be enhanced.`;
    await interaction.editReply(await buildDeityForgePayload(forge, ownerId, resultLine));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[deity enhance] failed:', err.message);
    await interaction.followUp({ content: 'Something went wrong. No Essence was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
  } finally {
    if (client) client.release();
  }
}

async function handleEnhanceCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge is not yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update({ components: [], flags: MessageFlags.IsComponentsV2 });
}

/**
 * Button: dsigil:act:<userDeityId>:<ownerId> — the §3.7 dynamic button.
 * Runs the shared transaction, then edits the info message in place with the
 * refreshed embed/button state.
 */
async function handleSigilButton(interaction, userDeityId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This deity isn\'t yours — run `crd deity info` yourself!', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  let result;
  try {
    result = await runSigilStep(ownerId, userDeityId);
  } catch (err) {
    console.error('[deity sigil] button failed:', err.message);
    await interaction.followUp({ content: 'Something went wrong. Nothing was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  try {
    if (result.status === 'notfound') {
      await interaction.editReply(notePayload('This deity is no longer in your collection.'));
      return;
    }

    const failure = sigilStepFailureText(result);
    if (failure) {
      await interaction.followUp({ content: failure, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // Success (sigil unlocked / ascended / already ascended) → refresh in place.
    const d = await fetchDeityInfoRow(ownerId, userDeityId);
    if (!d) {
      await interaction.editReply(notePayload('This deity is no longer in your collection.'));
      return;
    }
    await interaction.editReply(await buildDeityInfoPayload(d, {
      ownerId,
      ownerDisplayName: displayNameFor(interaction, ownerId),
    }));
    if (result.status === 'ascend') {
      await interaction.followUp({
        content: `✦ **${result.name}** has Ascended! Its blessing is now active.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[deity sigil] refresh failed:', err.message);
    await interaction.followUp({
      content: 'The view could not refresh — run `crd deity info <name>` again to see the current state.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

// ── crd deity equip <name> [slot] ─────────────────────────────────────────
const SLOT_COLUMNS = { 1: 'active_deity_id', 2: 'active_deity_id_2', 3: 'active_deity_id_3' };

async function equip(message, rest) {
  if (!rest) {
    await reply(message, { content: 'Usage: `crd deity equip <deity name> [1|2|3]`' });
    return;
  }
  const discordId = message.author.id;
  const parts = rest.split(/\s+/);
  let slot = 1;
  const lastPart = parts[parts.length - 1];
  if (/^[123]$/.test(lastPart) && parts.length > 1) {
    slot = Number(lastPart);
    parts.pop();
  }
  const name = parts.join(' ');

  // Check believer level gate for slots 2/3
  if (slot > 1) {
    const charRes = await pool.query(
      'SELECT believer_level FROM user_character WHERE discord_id = $1', [discordId]
    );
    if (charRes.rows.length === 0) { await reply(message, { content: 'No character found.' }); return; }
    const blvl = charRes.rows[0].believer_level || 0;
    const required = SLOT_UNLOCK_GATES[slot];
    if (blvl < required) {
      await reply(message, { content: `Slot ${slot} requires **Believer Level ${required}**. You are level ${blvl}.` });
      return;
    }
  }

  // Find owned deity
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, dr.name, dr.tier
       FROM deity_roster dr
       JOIN user_deities ud ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE LOWER(dr.name) = LOWER($2)`,
    [discordId, name]
  );
  if (rows.length === 0) {
    await reply(message, { content: `You haven't summoned **${name}** yet.` });
    return;
  }
  const { user_deity_id, name: deityName, tier } = rows[0];

  // Check deity not already in another slot
  const slotRes = await pool.query(
    `SELECT active_deity_id, active_deity_id_2, active_deity_id_3 FROM user_character WHERE discord_id = $1`,
    [discordId]
  );
  const current = slotRes.rows[0];
  const occupied = [
    { s: 1, id: current.active_deity_id },
    { s: 2, id: current.active_deity_id_2 },
    { s: 3, id: current.active_deity_id_3 },
  ];
  const dup = occupied.find(o => o.id === user_deity_id && o.s !== slot);
  if (dup) {
    await reply(message, { content: `**${deityName}** is already in Slot ${dup.s}. Unequip first.` });
    return;
  }

  // If removing from the slot that was the echo source, clear echo
  const col = SLOT_COLUMNS[slot];
  const echoCol = slot === 2 || slot === 3 ? '' : '';
  // Check if the old deity in this slot was the echo source
  let clearEcho = '';
  if (slot === 2 || slot === 3) {
    const echoRes = await pool.query(
      'SELECT active_echo_deity_id FROM user_character WHERE discord_id = $1', [discordId]
    );
    const echoId = echoRes.rows[0]?.active_echo_deity_id;
    const oldSlotId = slot === 2 ? current.active_deity_id_2 : current.active_deity_id_3;
    if (echoId && echoId === oldSlotId) {
      clearEcho = ', active_echo_deity_id = NULL';
    }
  }

  await pool.query(
    `UPDATE user_character SET ${col} = $1${clearEcho} WHERE discord_id = $2`,
    [user_deity_id, discordId]
  );
  await reply(message, { content: `**${deityName}** (${TIER_ALIAS[tier]}) equipped to **Slot ${slot}**.` });
}

// ── crd deity unequip [slot] ─────────────────────────────────────────────
async function unequip(message, rest) {
  const slot = Number(rest) || 0;
  if (slot < 1 || slot > 3) {
    await reply(message, { content: 'Usage: `crd deity unequip <1|2|3>`' });
    return;
  }
  const discordId = message.author.id;
  const col = SLOT_COLUMNS[slot];

  // If this slot was the echo source, clear echo too
  let clearEcho = '';
  if (slot === 2 || slot === 3) {
    const res = await pool.query(
      `SELECT ${col}, active_echo_deity_id FROM user_character WHERE discord_id = $1`, [discordId]
    );
    const row = res.rows[0];
    if (row && row.active_echo_deity_id && row.active_echo_deity_id === row[col]) {
      clearEcho = ', active_echo_deity_id = NULL';
    }
  }

  await pool.query(`UPDATE user_character SET ${col} = NULL${clearEcho} WHERE discord_id = $1`, [discordId]);
  await reply(message, { content: `Slot ${slot} cleared.` });
}

// ── crd deity echo <name> ────────────────────────────────────────────────
async function echo(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity echo <deity name>` — choose an Echo Blessing from Slot 2 or 3.' });
    return;
  }
  const discordId = message.author.id;

  // Check slot 3 unlocked
  const charRes = await pool.query(
    'SELECT believer_level, active_deity_id_2, active_deity_id_3 FROM user_character WHERE discord_id = $1',
    [discordId]
  );
  if (charRes.rows.length === 0) { await reply(message, { content: 'No character found.' }); return; }
  const char = charRes.rows[0];
  if ((char.believer_level || 0) < SLOT_UNLOCK_GATES[3]) {
    await reply(message, { content: `Echo Blessings unlock at **Believer Level ${SLOT_UNLOCK_GATES[3]}**.` });
    return;
  }

  // Find the deity in slot 2 or 3
  const slotIds = [char.active_deity_id_2, char.active_deity_id_3].filter(Boolean);
  if (slotIds.length === 0) {
    await reply(message, { content: 'You need a deity in Slot 2 or 3 to set an Echo Blessing.' });
    return;
  }

  const deityRes = await pool.query(
    `SELECT ud.user_deity_id, dr.name, dr.tier
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = ANY($1::int[]) AND LOWER(dr.name) = LOWER($2)`,
    [slotIds, name]
  );
  if (deityRes.rows.length === 0) {
    await reply(message, { content: `**${name}** is not in Slot 2 or 3.` });
    return;
  }
  const deity = deityRes.rows[0];

  // Must be an echo-type deity
  if (!ECHO_BLESSING_DEITIES.has(deity.name)) {
    await reply(message, { content: `**${deity.name}** has a Divine Blessing, not an Echo Blessing. Only Echo-type deities can activate echo blessings.` });
    return;
  }

  await pool.query(
    'UPDATE user_character SET active_echo_deity_id = $1 WHERE discord_id = $2',
    [deity.user_deity_id, discordId]
  );
  const echoKey = ECHO_BLESSING_KEY_MAP[deity.name] || deity.name;
  await reply(message, { content: `**Echo Blessing** set: **${deity.name}** (${TIER_ALIAS[deity.tier]}).` });
}

// ── crd deities ──────────────────────────────────────────────────────────
const TIER_SLOT_COLOR = {
  Epic: '#8B5CF6', Mythic: '#3B82F6', Legendary: '#F59E0B', Supreme: '#EF4444',
};
const SLOT_LAYOUT = [
  { slot: 2, x: 25,  label: 'Slot 2' },
  { slot: 1, x: 220, label: 'Slot 1' },
  { slot: 3, x: 415, label: 'Slot 3' },
];
const SLOT_UNLOCK_TEXT = {
  2: `Unlocks at Believer Lvl ${SLOT_UNLOCK_GATES[2]}`,
  3: `Unlock at Believer Lvl ${SLOT_UNLOCK_GATES[3]}`,
};

function slotUnlocked(slot, believerLevel) {
  const required = SLOT_UNLOCK_GATES[slot];
  return required == null || believerLevel >= required;
}

function drawCenteredFitText(ctx, text, x, y, maxWidth, size, weight = 'bold') {
  let fontSize = size;
  do {
    ctx.font = `${weight} ${fontSize}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth || fontSize <= 9) break;
    fontSize -= 1;
  } while (fontSize > 9);
  ctx.fillText(text, x, y);
}

async function deities(message) {
  const discordId = message.author.id;
  const res = await pool.query(
    `SELECT uc.active_deity_id, uc.active_deity_id_2, uc.active_deity_id_3,
            uc.active_echo_deity_id, uc.believer_level,
            d1.ascended AS a1, de.ascended AS echo_ascended,
            d1r.name AS n1, d1r.tier AS t1, d1r.mythology AS m1, d1r.image_filename AS img1,
            d1r.blessing_name AS bn1, d1r.blessing_description AS bd1,
            d2r.name AS n2, d2r.tier AS t2, d2r.mythology AS m2, d2r.image_filename AS img2,
            d3r.name AS n3, d3r.tier AS t3, d3r.mythology AS m3, d3r.image_filename AS img3,
            der.name AS echo_name, der.blessing_name AS echo_bn, der.blessing_description AS echo_bd
       FROM user_character uc
       LEFT JOIN user_deities d1  ON d1.user_deity_id = uc.active_deity_id
       LEFT JOIN deity_roster d1r ON d1r.deity_id = d1.deity_id
       LEFT JOIN user_deities d2  ON d2.user_deity_id = uc.active_deity_id_2
       LEFT JOIN deity_roster d2r ON d2r.deity_id = d2.deity_id
       LEFT JOIN user_deities d3  ON d3.user_deity_id = uc.active_deity_id_3
       LEFT JOIN deity_roster d3r ON d3r.deity_id = d3.deity_id
       LEFT JOIN user_deities de  ON de.user_deity_id = uc.active_echo_deity_id
       LEFT JOIN deity_roster der ON der.deity_id = de.deity_id
      WHERE uc.discord_id = $1`,
    [discordId]
  );
  if (res.rows.length === 0) { await reply(message, { content: 'No character found.' }); return; }
  const r = res.rows[0];
  const believerLevel = Number(r.believer_level) || 0;

  const slots = [
    { name: r.n1, tier: r.t1, mythology: r.m1, img: r.img1 },
    { name: r.n2, tier: r.t2, mythology: r.m2, img: r.img2 },
    { name: r.n3, tier: r.t3, mythology: r.m3, img: r.img3 },
  ];

  // Canvas: 3 slot boxes — image fills each box exactly
  const W = 590, H = 250;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const BOX_W = 150, BOX_H = 170, BOX_Y = 30, RAD = 8;

  for (const layout of SLOT_LAYOUT) {
    const idx = layout.slot - 1;
    const s = slots[idx];
    const x = layout.x;
    const unlocked = slotUnlocked(layout.slot, believerLevel);

    // Slot label on top
    ctx.fillStyle = '#9CA3AF';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(layout.label, x + BOX_W / 2, BOX_Y - 8);

    // Fill dark bg
    ctx.fillStyle = 'rgba(30, 30, 40, 0.8)';
    ctx.beginPath();
    ctx.roundRect(x, BOX_Y, BOX_W, BOX_H, RAD);
    ctx.fill();

    if (unlocked && s.name) {
      // Portrait fills box
      const mythDir = MYTHOLOGY_DIR[s.mythology] || s.mythology?.toLowerCase();
      const imgName = s.img || `${s.name.toLowerCase().replace(/\s+/g, '_')}.png`;
      const imgPath = safeDeityImagePath(mythDir || '', imgName);
      try {
        if (imgPath && (isRemoteAssetsEnabled() || fs.existsSync(imgPath))) {
          const portrait = await loadAssetImage(imgPath);
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, BOX_Y, BOX_W, BOX_H, RAD);
          ctx.clip();
          // Cover-fit: scale to fill, center crop
          const scale = Math.max(BOX_W / portrait.width, BOX_H / portrait.height);
          const sw = portrait.width * scale;
          const sh = portrait.height * scale;
          ctx.drawImage(portrait, x + (BOX_W - sw) / 2, BOX_Y + (BOX_H - sh) / 2, sw, sh);
          ctx.restore();
        }
      } catch { /* no portrait */ }

      // Box outline (on top of image)
      ctx.strokeStyle = TIER_SLOT_COLOR[s.tier] || '#6B7280';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x, BOX_Y, BOX_W, BOX_H, RAD);
      ctx.stroke();

      // Deity name below box
      ctx.fillStyle = TIER_SLOT_COLOR[s.tier] || '#FFFFFF';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, x + BOX_W / 2, BOX_Y + BOX_H + 20);
    } else {
      // Empty or locked slot outline + marker
      ctx.strokeStyle = '#4B5563';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, BOX_Y, BOX_W, BOX_H, RAD);
      ctx.stroke();
      ctx.fillStyle = '#6B7280';
      ctx.textAlign = 'center';
      if (unlocked) {
        ctx.font = '36px sans-serif';
        ctx.fillText('—', x + BOX_W / 2, BOX_Y + BOX_H / 2 + 12);
      } else {
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('LOCKED', x + BOX_W / 2, BOX_Y + BOX_H / 2 + 6);
        ctx.fillStyle = '#FBBF24';
        drawCenteredFitText(ctx, SLOT_UNLOCK_TEXT[layout.slot], x + BOX_W / 2, BOX_Y + BOX_H + 20, BOX_W, 12);
      }
    }
  }

  // [egress] The equipped-deities grid is a pure function of equipped slots and
  // lock state. Use lock booleans instead of raw believer level so the cache
  // changes exactly when level 15/30 unlocks alter the canvas.
  const unlockState = {
    slot2: slotUnlocked(2, believerLevel),
    slot3: slotUnlocked(3, believerLevel),
  };
  const logContext = {
    system: 'deity',
    command: 'deities',
    imageType: 'deities',
    guildId: message.guild?.id,
    userId: message.author?.id,
  };
  let gridPng = null;
  const renderGrid = async () => {
    if (!gridPng) gridPng = canvas.toBuffer('image/png');
    return gridPng;
  };
  let attachment;
  try {
    const gridCached = await getCachedCanvasUrl(
      ['deities-collection', DEITY_RENDER_REV, slots, unlockState],
      renderGrid,
      { preserveTransparency: true },
      { returnImageOnFailure: true, logContext }
    );
    attachment = gridCached?.url
      ? { url: gridCached.url, file: null }
      : gridCached?.image
        ? attachmentFromOptimizedImage(gridCached.image, 'deities', { ...logContext, reusedBuffer: true })
        : await makeOptimizedAttachment(await renderGrid(), 'deities', {
          logContext,
          preserveTransparency: true,
        });
  } finally {
    releaseCanvas(canvas);
    gridPng = null;
  }

  // Build resonance info
  const deityInfos = slots.map((s, idx) =>
    slotUnlocked(idx + 1, believerLevel) && s.name ? { name: s.name, mythology: s.mythology } : null
  );
  const resMods = computeResonanceMods(deityInfos);
  const resLines = [];
  if (resMods.atkPct) resLines.push(`ATK +${resMods.atkPct}%`);
  if (resMods.hpPct) resLines.push(`HP +${resMods.hpPct}%`);
  if (resMods.defPct) resLines.push(`DEF +${resMods.defPct}%`);
  if (resMods.critPts) resLines.push(`CRIT +${resMods.critPts}`);

  // Blessing info — [Ascension §3.6] a blessing fires only if that deity is
  // Ascended; un-ascended deities show it as dormant.
  let blessingText = '';
  if (r.n1) {
    const btype = DIVINE_BLESSING_DEITIES.has(r.n1) ? 'Divine' : 'Echo';
    if (r.a1) {
      blessingText += `**${btype} Blessing:** ${r.bn1 || r.n1}`;
      if (r.bd1) blessingText += `\n-# ${r.bd1}`;
    } else {
      blessingText += `**${btype} Blessing:** Dormant — ascend ${r.n1} to awaken it.`;
    }
  } else {
    blessingText += '**Divine Blessing:** None';
  }
  const echoSlot =
    r.active_echo_deity_id && r.active_echo_deity_id === r.active_deity_id_2 ? 2 :
    r.active_echo_deity_id && r.active_echo_deity_id === r.active_deity_id_3 ? 3 :
    null;
  if (r.echo_name && echoSlot != null && slotUnlocked(echoSlot, believerLevel)) {
    if (r.echo_ascended) {
      blessingText += `\n**Echo Blessing:** ${r.echo_bn || r.echo_name}`;
      if (r.echo_bd) blessingText += `\n-# ${r.echo_bd}`;
    } else {
      blessingText += `\n**Echo Blessing:** Dormant — ascend ${r.echo_name} to awaken it.`;
    }
  } else {
    blessingText += '\n**Echo Blessing:** None';
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(td => td.setContent(`## <@${message.author.id}>'s Equipped Deities`));
  container.addSeparatorComponents(sep);
  container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(attachment.url)));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents(td => td.setContent(blessingText));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents(td => td.setContent(
    resLines.length > 0
      ? `✨ **Divine Resonance:** ${resLines.join(' · ')}`
      : '✨ **Divine Resonance:** None'
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents(td => td.setContent(
    '-# 💡 `crd deity equip <name> [1|2|3]` · `crd deity echo <name>` · `crd deity unequip <1|2|3>`'
  ));

  await reply(message, {
    components: [container],
    files: attachment.file ? [attachment.file] : [],
    flags: MessageFlags.IsComponentsV2,
  });
}

// ── dispatcher: crd deity [collection|list|info|equip|enhance|echo|deities|unequip] ──
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  if (sub === 'collection' || sub === 'list' || sub === '') return collection(message);
  if (sub === 'info') return info(message, rest);
  if (sub === 'equip') return equip(message, rest);
  if (sub === 'enhance') return enhance(message, rest);
  if (sub === 'echo') return echo(message, rest);
  if (sub === 'deities' || sub === 'party') return deities(message);
  if (sub === 'unequip') return unequip(message, rest);

  await reply(message, { content: 'Usage: `crd deity collection` · `crd deity info <name>` · `crd deity equip <name> [1|2|3]` · `crd deity enhance <name>` · `crd deity echo <name>` · `crd deities`' });
}

module.exports = {
  execute, deities, handleListButton, handleSigilButton,
  handleEnhanceAttempt, handleEnhanceCancel, attemptDeityEnhance, buildDeityInfoPayload,
  buildListPage,
};

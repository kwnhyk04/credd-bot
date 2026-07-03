'use strict';

const {
  ContainerBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  ComponentType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { TIER_ALIAS, TIER_COLOR, TIER_ESSENCE_COLUMN } = require('../../config/gachaRates');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay, emoji } = require('../../utils/emojis');
const { makeOptimizedAttachment } = require('../../utils/imageOutput');
const { assetPath, isRemoteAssetsEnabled, loadAssetImage: loadAssetImageSource } = require('../../utils/assets');
const { RARITY_SYMBOLS } = require('../../engine/renderSummon');
const { renderPortraitCard } = require('../../engine/renderPortraitCard');
const { computeDeityStats, nextDeityAttempt, MAX_ENHANCEMENT } = require('../../engine/deityEnhancement');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
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
let mythologyPageCache = null;

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
async function info(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity info <deity name>`' });
    return;
  }
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT dr.name, dr.mythology, dr.tier, dr.blessing_name, dr.blessing_description, dr.lore,
            ud.curr_atk, ud.curr_hp, ud.curr_def, ud.enhancement
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
  if (d.curr_atk == null) {
    // Roster match but the player doesn't own it.
    await reply(message, { content: `You haven't summoned ${d.name} yet.` });
    return;
  }

  const alias = TIER_ALIAS[d.tier];
  const mythologyLabel = MYTHOLOGY_LABEL[d.mythology] ?? `${d.mythology} Mythology`;

  // Portrait: assets/deities/<mythology dir>/<name_lowercase_underscored>.(png|jpg)
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const dir = MYTHOLOGY_DIR[d.mythology] ?? d.mythology?.toLowerCase();
  let portraitPath = null;
  if (isRemoteAssetsEnabled()) {
    portraitPath = ['png', 'jpg'].map((ext) => safeDeityImagePath(dir, `${slug}.${ext}`)).filter(Boolean);
  } else {
    for (const ext of ['png', 'jpg']) {
      const p = safeDeityImagePath(dir, `${slug}.${ext}`);
      if (p && fs.existsSync(p)) { portraitPath = p; break; }
    }
  }

  await reply(message, await buildDeityInfoPayload(d, { alias, mythologyLabel, portraitPath, ownerId: message.author.id }));
}

const AI_DISCLAIMER = '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

/**
 * Deity-info payload: portrait card (art LEFT, name/mythology/blessing/stats RIGHT)
 * then lore + AI disclaimer + enhance hint as text. Mirrors the weapon-info card.
 */
async function buildDeityInfoPayload(d, { alias, mythologyLabel, portraitPath, ownerId }) {
  const accentHex = `#${(TIER_COLOR[d.tier] ?? BRAND).toString(16).padStart(6, '0')}`;
  const btype = DIVINE_BLESSING_DEITIES.has(d.name) ? 'Divine' : 'Echo';
  const sections = [
    { heading: `${btype} Blessing — ${d.blessing_name}`, body: d.blessing_description },
    { heading: 'Stats', body: `ATK   ${d.curr_atk}\nHP    ${d.curr_hp}\nDEF   ${d.curr_def}` },
  ];

  let file = null;
  try {
    file = await makeOptimizedAttachment(await renderPortraitCard({
      imagePath: portraitPath,
      accent: accentHex,
      title: `${d.name} +${d.enhancement - 1}`,
      subtitle: `${mythologyLabel} · ${alias}`,
      sections,
    }), 'deity_card');
  } catch (err) {
    console.error('[deity] card render failed:', err.message);
  }

  const hasLore = typeof d.lore === 'string' && d.lore.trim().length > 0;
  const loreBlock = hasLore ? `*${d.lore.trim()}*` : '-# No lore recorded yet.';
  const headerName = ownerId ? `<@${ownerId}>'s` : '';

  const container = new ContainerBuilder().setAccentColor(TIER_COLOR[d.tier] ?? BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${headerName} ${d.name}`));
  container.addSeparatorComponents(sep);
  if (file) {
    container
      .addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(file.url)))
      .addSeparatorComponents(sep);
  } else {
    container
      .addTextDisplayComponents((td) =>
        td.setContent(
          `-# ${mythologyLabel} (${alias})\n\n` +
          `**${btype} Blessing — ${d.blessing_name}**\n${d.blessing_description}\n\n` +
          `ATK **${d.curr_atk}** · HP **${d.curr_hp}** · DEF **${d.curr_def}**`
        )
      )
      .addSeparatorComponents(sep);
  }
  container
    .addTextDisplayComponents((td) => td.setContent(`${loreBlock}\n\n${AI_DISCLAIMER}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`-# 💡 \`crd deity enhance ${d.name.toLowerCase()}\``));

  return {
    components: [container],
    files: file ? [file.file] : [],
    flags: MessageFlags.IsComponentsV2,
  };
}

// ── crd deity enhance <name> (forge — Part E template, essence currency) ───
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

/** Live forge data by user_deity_id (or by name when looked up first). */
async function fetchDeityForgeData(discordId, userDeityId) {
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, ud.enhancement, ud.curr_atk, ud.curr_hp, ud.curr_def,
            dr.name, dr.tier, dr.base_atk, dr.base_hp, dr.base_def
       FROM user_deities ud
       JOIN deity_roster dr ON dr.deity_id = ud.deity_id
      WHERE ud.user_deity_id = $1 AND ud.discord_id = $2`,
    [userDeityId, discordId]
  );
  const d = rows[0];
  if (!d) return null;
  const essCol = TIER_ESSENCE_COLUMN[d.tier]; // whitelisted from our constant map
  const essRes = await pool.query(
    `SELECT ${essCol} AS amount FROM users_bag WHERE discord_id = $1`,
    [discordId]
  );
  d.essence = essRes.rows[0]?.amount ?? 0;
  return d;
}

function essenceFooter(d) {
  return `-# ${emoji(TIER_ESSENCE_COLUMN[d.tier])} ${d.tier} Essence: **${d.essence}**`;
}

/**
 * Append the next-level section (or maxed note). Returns whether Enhance
 * should be ENABLED: false when maxed; affordability also disables it (the
 * section stays visible). Render-side only — clicks re-validate in the txn.
 */
function addDeityNextSection(container, d) {
  const next = nextDeityAttempt(d.tier, d.enhancement);
  if (next == null) {
    container.addTextDisplayComponents((td) => td.setContent('-# Maximum enhancement reached'));
    return false;
  }
  const preview = computeDeityStats(d, d.enhancement + 1);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      `**Next: +${next.targetLevel}**\n` +
      `Cost: **${next.cost}** ${d.tier} Essence · Success: **100%**\n` +
      `-# On success → ATK ${preview.curr_atk} · HP ${preview.curr_hp} · DEF ${preview.curr_def}`
    )
  );
  return d.essence >= next.cost;
}

function deityForgeButtonsRow(userDeityId, discordId, enhanceEnabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`denhance:attempt:${userDeityId}:${discordId}`)
      .setLabel('🔨 Enhance')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enhanceEnabled),
    new ButtonBuilder()
      .setCustomId(`denhance:cancel:${userDeityId}:${discordId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Forge view — identical structure to the weapon forge (Part E). */
function buildDeityForgePayload(d, discordId, { resultLine = null, color = null, buttons = true } = {}) {
  const alias = TIER_ALIAS[d.tier];
  const icon = emojiForDisplay(d.name, '🕯️');

  const container = new ContainerBuilder()
    .setAccentColor(color ?? (TIER_COLOR[d.tier] ?? BRAND))
    .addTextDisplayComponents((td) =>
      td.setContent(`## 🔨 Forge — ${icon} ${d.name} (${alias}) +${d.enhancement - 1}`)
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`**Current Stats**\nATK **${d.curr_atk}** · HP **${d.curr_hp}** · DEF **${d.curr_def}**`)
    )
    .addSeparatorComponents(sep);

  const enhanceEnabled = addDeityNextSection(container, d);

  if (resultLine) {
    container.addSeparatorComponents(sep);
    container.addTextDisplayComponents((td) => td.setContent(resultLine));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(essenceFooter(d)));

  const components = [container];
  if (buttons) components.push(deityForgeButtonsRow(d.user_deity_id, discordId, enhanceEnabled));
  return { components, flags: MessageFlags.IsComponentsV2 };
}

/**
 * Verdict + next-step preview in one (continuous forging — deterministic, so
 * always the ✅ card). Buttons stay live; Enhance disabled when maxed or the
 * remaining essence can't afford the next level.
 */
function buildDeityResolvedPayload(d, discordId, result) {
  const icon = emojiForDisplay(d.name, '🕯️');
  const container = new ContainerBuilder()
    .setAccentColor(GREEN)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ✅ Forge Success — ${icon} ${d.name} +${result.newEnhancement - 2} → +${result.newEnhancement - 1}`)
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`**Resulting Stats**\nATK **${d.curr_atk}** · HP **${d.curr_hp}** · DEF **${d.curr_def}**`)
    )
    .addSeparatorComponents(sep);

  const enhanceEnabled = addDeityNextSection(container, d);

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(essenceFooter(d)));

  return {
    components: [container, deityForgeButtonsRow(d.user_deity_id, discordId, enhanceEnabled)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function notePayload(text, color = RED) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents((td) => td.setContent(text));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * One atomic deity enhancement. DETERMINISTIC (Master §9 — no success-rate
 * table): always succeeds when the essence requirement is met. Lock order:
 * users_bag → user_deities (standardized with the weapon forge / sell).
 */
async function attemptDeityEnhance(client, discordId, userDeityId) {
  await client.query('BEGIN');

  const bagRes = await client.query(
    `SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
    [discordId]
  );
  if (bagRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }

  const dRes = await client.query(
    `SELECT ud.enhancement, dr.tier, dr.name, dr.base_atk, dr.base_hp, dr.base_def
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

  const next = nextDeityAttempt(d.tier, d.enhancement);
  if (next == null) {
    await client.query('ROLLBACK');
    return { status: 'maxed' };
  }
  const essCol = TIER_ESSENCE_COLUMN[d.tier]; // whitelisted from our constant map
  const essBefore = bagRes.rows[0][essCol];
  if (essBefore < next.cost) {
    await client.query('ROLLBACK');
    return { status: 'insufficient', cost: next.cost, essence: essBefore, tier: d.tier };
  }
  const essAfter = essBefore - next.cost;

  await client.query(
    `UPDATE users_bag SET ${essCol} = ${essCol} - $2 WHERE discord_id = $1`,
    [discordId, next.cost]
  );

  const newEnhancement = d.enhancement + 1;
  const stats = computeDeityStats(d, newEnhancement);
  await client.query(
    `UPDATE user_deities
        SET enhancement = $2, curr_atk = $3, curr_hp = $4, curr_def = $5
      WHERE user_deity_id = $1`,
    [userDeityId, newEnhancement, stats.curr_atk, stats.curr_hp, stats.curr_def]
  );

  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type, previous_essence_count, updated_essence_count)
     VALUES ($1, 'Deity Enhance', $2, $3, $4)`,
    [discordId, essCol, essBefore, essAfter]
  );

  await client.query('COMMIT');
  return { status: 'done', success: true, name: d.name, targetLevel: next.targetLevel, cost: next.cost, newEnhancement };
}

async function enhance(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity enhance <deity name>`' });
    return;
  }
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, dr.name AS roster_name
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
  if (rows[0].user_deity_id == null) {
    await reply(message, { content: `You haven't summoned ${rows[0].roster_name} yet.` });
    return;
  }

  const d = await fetchDeityForgeData(discordId, rows[0].user_deity_id);
  if (!d) {
    await reply(message, { content: `You haven't summoned ${name} yet.` });
    return;
  }
  await reply(message, buildDeityForgePayload(d, discordId));
}

/** Button: denhance:attempt:<userDeityId>:<uid> */
async function handleEnhanceAttempt(interaction, userDeityId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  let client;
  let result;
  try {
    client = await pool.connect();
    result = await attemptDeityEnhance(client, ownerId, userDeityId);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[deity enhance] attempt failed:', err.message);
    await interaction.followUp({ content: 'Something went wrong. No Essence was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  } finally {
    if (client) client.release();
  }

  try {
  if (result.status === 'notfound') {
    await interaction.editReply(notePayload('This deity is no longer in your collection.'));
    return;
  }

  const d = await fetchDeityForgeData(ownerId, userDeityId);
  if (!d) {
    await interaction.editReply(notePayload('This deity is no longer in your collection.'));
    return;
  }

  if (result.status === 'insufficient') {
    const resultLine = `❌ Not enough ${result.tier} Essence — need **${result.cost}**, you have **${result.essence}**.`;
    await interaction.editReply(buildDeityForgePayload(d, ownerId, { resultLine, color: RED }));
    return;
  }
  if (result.status === 'maxed') {
    await interaction.editReply(buildDeityForgePayload(d, ownerId, { resultLine: 'This deity is already maxed (+10).' }));
    return;
  }

  // status === 'done' → verdict + next-step preview, buttons stay live (chaining).
  await interaction.editReply(buildDeityResolvedPayload(d, ownerId, result));
  } catch (err) {
    console.error('[deity enhance] result refresh failed:', err.message);
    const note = result.status === 'done'
      ? 'Deity enhancement result was processed, but the forge view could not refresh. Run `crd deity enhance <name>` again to continue.'
      : 'Deity forge view could not refresh. Run `crd deity enhance <name>` again to reload it.';
    await interaction.editReply(notePayload(note)).catch(() => {});
    await interaction.followUp({
      content: 'Deity forge view refresh failed. Run `crd deity enhance <name>` again before making another attempt.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

/** Button: denhance:cancel:<userDeityId>:<uid> — drop the buttons, keep the last view as-is. */
async function handleEnhanceCancel(interaction, userDeityId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  // Strip action rows from the CURRENT message so the last verdict stays visible.
  const keep = interaction.message.components
    .filter((c) => c.type !== ComponentType.ActionRow)
    .map((c) => c.toJSON());
  await interaction.editReply({ components: keep, flags: MessageFlags.IsComponentsV2 });
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
  2: 'Unlocks at Believer Lvl 10',
  3: 'Unlock at Believer Lvl 25',
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

  const attachment = await makeOptimizedAttachment(canvas.toBuffer('image/png'), 'deities');

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

  // Blessing info
  let blessingText = '';
  if (r.n1) {
    const btype = DIVINE_BLESSING_DEITIES.has(r.n1) ? 'Divine' : 'Echo';
    blessingText += `**${btype} Blessing:** ${r.bn1 || r.n1}`;
    if (r.bd1) blessingText += `\n-# ${r.bd1}`;
  } else {
    blessingText += '**Divine Blessing:** None';
  }
  const echoSlot =
    r.active_echo_deity_id && r.active_echo_deity_id === r.active_deity_id_2 ? 2 :
    r.active_echo_deity_id && r.active_echo_deity_id === r.active_deity_id_3 ? 3 :
    null;
  if (r.echo_name && echoSlot != null && slotUnlocked(echoSlot, believerLevel)) {
    blessingText += `\n**Echo Blessing:** ${r.echo_bn || r.echo_name}`;
    if (r.echo_bd) blessingText += `\n-# ${r.echo_bd}`;
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
    files: [attachment.file],
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

module.exports = { execute, deities, handleListButton, handleEnhanceAttempt, handleEnhanceCancel, buildDeityInfoPayload };

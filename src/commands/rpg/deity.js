'use strict';

const {
  ContainerBuilder,
  SeparatorSpacingSize,
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
const { emojiForDisplay, emoji } = require('../../utils/emojis');
const { renderDeityCard, RARITY_SYMBOLS } = require('../../engine/renderSummon');
const { computeDeityStats, nextDeityAttempt, MAX_ENHANCEMENT } = require('../../engine/deityEnhancement');

// TODO Phase-rep: grant reputation on deity enhance (§18), 5,000/day cap — wire when awardReputation
//   is extracted to a shared util (do not duplicate cap/rollover logic)

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

const DEITIES_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'deities');

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [], ...(payload.allowedMentions ?? {}) },
  });
}

// ── crd deity list (one page per mythology — roster order) ─────────────────
// page is 0-based (matches the deities:<action>:<owner>:<page> customId state).
async function fetchDeities(discordId, page) {
  // Stable page order: one page per mythology, in seed (roster) order.
  const mythRes = await pool.query(
    'SELECT mythology FROM deity_roster GROUP BY mythology ORDER BY MIN(deity_id)'
  );
  const mythologies = mythRes.rows.map((r) => r.mythology);
  const totalPages = Math.max(1, mythologies.length);
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const mythology = mythologies[p] ?? null;

  const { rows: deities } = mythology == null ? { rows: [] } : await pool.query(
    `SELECT dr.name, dr.tier, (ud.user_deity_id IS NOT NULL) AS owned
       FROM deity_roster dr
       LEFT JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE dr.mythology = $2
      ORDER BY ${TIER_ORDER_SQL} DESC, dr.name ASC`,
    [discordId, mythology]
  );
  return { deities, mythology, page: p, totalPages };
}

// Design standard (see CLAUDE.md): header → separator → body → separator →
// footer (essence summary + help) → separator → buttons.
async function buildListPage({ user, deities, mythology, page, totalPages }) {
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
      return d.owned
        ? `${icon} **${d.name}** — ${symbol} ${alias} *(${d.tier})*`
        : `🔒 ${icon} *${d.name}* — ${symbol} ${alias}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(rows.join('\n')));
  }

  container.addSeparatorComponents(sep);

  // Footer: essence balances (moved from the old page footer) above the help text.
  const bagRes = await pool.query(
    'SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence FROM users_bag WHERE discord_id = $1',
    [user.id]
  );
  const bag = bagRes.rows[0] || {};
  const essenceLine = TIER_ESSENCE_LABEL
    .map(([tier, col]) => `${emoji(col)} ${TIER_ALIAS[tier]}: **${bag[col] ?? 0}**`)
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

  const currentPage = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);

  // fetchDeities clamps the page to the mythology count server-side.
  const fetched = await fetchDeities(ownerId, page);
  await interaction.update(await buildListPage({ user: interaction.user, ...fetched }));
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

  // Card image: portrait composited into the tier frame (renderSummon assets).
  // Portraits: assets/deities/<mythology dir>/<name_lowercase_underscored>.(png|jpg)
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const dir = MYTHOLOGY_DIR[d.mythology] ?? d.mythology.toLowerCase();
  let portraitPath = null;
  for (const ext of ['png', 'jpg']) {
    const p = path.join(DEITIES_DIR, dir, `${slug}.${ext}`);
    if (fs.existsSync(p)) { portraitPath = p; break; }
  }

  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[d.tier] ?? BRAND)
    .addTextDisplayComponents((td) =>
      td.setContent(
        `## ${emojiForDisplay(d.name, '🕯️')} ${d.name} +${d.enhancement - 1}\n` +
        `-# ${mythologyLabel} (${alias})`
      )
    )
    .addSeparatorComponents(sep);

  try {
    const buffer = await renderDeityCard({ name: d.name, rarity: alias, portraitPath });
    const file = new AttachmentBuilder(buffer, { name: 'deity_card.png' });
    container.addMediaGalleryComponents((g) =>
      g.addItems((item) => item.setURL('attachment://deity_card.png'))
    );
    container.addSeparatorComponents(sep);
    appendInfoSections(container, d);
    await reply(message, { components: [container], files: [file], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    // Render failure → same container without the gallery (info still delivered).
    console.error('[deity] card render failed:', err.message);
    appendInfoSections(container, d);
    await reply(message, { components: [container], flags: MessageFlags.IsComponentsV2 });
  }
}

const AI_DISCLAIMER = '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

function appendInfoSections(container, d) {
  // Lore section ALWAYS renders — muted placeholder when the column is empty
  // (a DB value replaces it automatically); the AI disclaimer sits below the
  // lore, blank-line separated, in subtext.
  const hasLore = typeof d.lore === 'string' && d.lore.trim().length > 0;
  const loreBlock = hasLore ? `*${d.lore.trim()}*` : '-# No lore recorded yet.';
  container
    .addTextDisplayComponents((td) =>
      td.setContent(
        `**Blessing — ${d.blessing_name}**\n${d.blessing_description}\n\n` +
        `ATK **${d.curr_atk}** · HP **${d.curr_hp}** · DEF **${d.curr_def}**`
      )
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`${loreBlock}\n\n${AI_DISCLAIMER}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`-# 💡 \`crd deity enhance ${d.name.toLowerCase()}\``)
    );
  return container;
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

  const client = await pool.connect();
  let result;
  try {
    result = await attemptDeityEnhance(client, ownerId, userDeityId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[deity enhance] attempt failed:', err.message);
    await interaction.reply({ content: 'Something went wrong. No Essence was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  } finally {
    client.release();
  }

  if (result.status === 'notfound') {
    await interaction.update(notePayload('This deity is no longer in your collection.'));
    return;
  }

  const d = await fetchDeityForgeData(ownerId, userDeityId);
  if (!d) {
    await interaction.update(notePayload('This deity is no longer in your collection.'));
    return;
  }

  if (result.status === 'insufficient') {
    const resultLine = `❌ Not enough ${result.tier} Essence — need **${result.cost}**, you have **${result.essence}**.`;
    await interaction.update(buildDeityForgePayload(d, ownerId, { resultLine, color: RED }));
    return;
  }
  if (result.status === 'maxed') {
    await interaction.update(buildDeityForgePayload(d, ownerId, { resultLine: 'This deity is already maxed (+10).' }));
    return;
  }

  // status === 'done' → verdict + next-step preview, buttons stay live (chaining).
  await interaction.update(buildDeityResolvedPayload(d, ownerId, result));
}

/** Button: denhance:cancel:<userDeityId>:<uid> — drop the buttons, keep the last view as-is. */
async function handleEnhanceCancel(interaction, userDeityId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Strip action rows from the CURRENT message so the last verdict stays visible.
  const keep = interaction.message.components
    .filter((c) => c.type !== ComponentType.ActionRow)
    .map((c) => c.toJSON());
  await interaction.update({ components: keep, flags: MessageFlags.IsComponentsV2 });
}

// ── crd deity equip <name> ────────────────────────────────────────────────
async function equip(message, name) {
  if (!name) {
    await reply(message, { content: 'Usage: `crd deity equip <deity name>`' });
    return;
  }
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT ud.user_deity_id, dr.name, dr.tier
       FROM deity_roster dr
       JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE LOWER(dr.name) = LOWER($2)`,
    [discordId, name]
  );
  if (rows.length === 0) {
    await reply(message, { content: `You haven't summoned ${name} yet.` });
    return;
  }
  const { user_deity_id, name: deityName, tier } = rows[0];
  await pool.query(
    'UPDATE user_character SET active_deity_id = $1 WHERE discord_id = $2',
    [user_deity_id, discordId]
  );
  await reply(message, { content: `**${deityName}** (${TIER_ALIAS[tier]}) is now your active deity.` });
}

// ── dispatcher: crd deity [collection|list|info|equip|enhance] ─────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  if (sub === 'collection' || sub === 'list' || sub === '') return collection(message);
  if (sub === 'info') return info(message, rest);
  if (sub === 'equip') return equip(message, rest);
  if (sub === 'enhance') return enhance(message, rest);

  await reply(message, { content: 'Usage: `crd deity collection` · `crd deity info <name>` · `crd deity equip <name>` · `crd deity enhance <name>`' });
}

module.exports = { execute, handleListButton, handleEnhanceAttempt, handleEnhanceCancel, appendInfoSections };

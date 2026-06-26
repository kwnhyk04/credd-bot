'use strict';

/**
 * `crd title` (alias `crd t`) — browse/equip titles (v5 Phase 5).
 * Category dropdown (header) + 10 rows/page + Prev/Next. Equip via
 * `crd title equip <name>` / `crd title unequip`. PNG art (title_catalog.image_filename)
 * is optional and ignored here (text display) — adding art later won't break this view.
 */

const {
  ContainerBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { TITLE_CATEGORIES } = require('../../config/titles');

const BRAND = 0x9b59b6;
const PAGE = 10;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

function catByKey(key) {
  return TITLE_CATEGORIES.find((c) => c.key === key) || TITLE_CATEGORIES[0];
}

/** Rows of one category for a user + the user's equipped title id. */
async function fetchTitles(discordId, cat) {
  const { rows } = await pool.query(
    `SELECT tc.title_id, tc.code, tc.display, tc.how_to,
            (ut.discord_id IS NOT NULL) AS owned
       FROM title_catalog tc
       LEFT JOIN user_titles ut ON ut.title_id = tc.title_id AND ut.discord_id = $1
      WHERE tc.source = ANY($2)
      ORDER BY tc.title_id`,
    [discordId, cat.sources]
  );
  const eq = await pool.query('SELECT equipped_title_id FROM user_character WHERE discord_id = $1', [discordId]);
  return { rows, equippedId: eq.rows[0]?.equipped_title_id ?? null };
}

async function buildPayload(discordId, username, catKey, page) {
  const cat = catByKey(catKey);
  const { rows, equippedId } = await fetchTitles(discordId, cat);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE);

  const catMenu = new StringSelectMenuBuilder()
    .setCustomId(`title:cat:${discordId}:0`)
    .setPlaceholder('Category')
    .addOptions(TITLE_CATEGORIES.map((c) => ({ label: c.label, value: c.key, default: c.key === cat.key })));

  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent(`## 🎖️ ${username}'s Titles`));
  container.addActionRowComponents(() => new ActionRowBuilder().addComponents(catMenu));
  container.addSeparatorComponents(sep);

  if (slice.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No titles in this category.*'));
  } else {
    const lines = slice.map((r) => {
      const mark = r.title_id === equippedId ? '⭐' : (r.owned ? '✅' : '🔒');
      const name = r.owned ? `**${r.display}**` : `*${r.display}*`;
      return `${mark} ${name} — -# ${r.how_to || ''}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(lines.join('\n')));
  }

  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# Page ${p + 1}/${totalPages} · ⭐ equipped · ✅ owned · 🔒 locked\n-# 💡 \`crd title equip <name>\` · \`crd title unequip\``
  ));
  container.addActionRowComponents(() => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`title:prev:${discordId}:${cat.key}:${p}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(`title:next:${discordId}:${cat.key}:${p}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
  ));

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// ── crd title equip <name> ─────────────────────────────────────────────────
async function equip(message, name) {
  if (!name) return reply(message, 'Usage: `crd title equip <title name>`');
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT tc.title_id, tc.display
       FROM title_catalog tc
       JOIN user_titles ut ON ut.title_id = tc.title_id AND ut.discord_id = $1
      WHERE LOWER(tc.display) = LOWER($2) OR LOWER(tc.code) = LOWER($2)`,
    [discordId, name]
  );
  if (rows.length === 0) return reply(message, `You don't own a title called **${name}**.`);
  await pool.query('UPDATE user_character SET equipped_title_id = $1 WHERE discord_id = $2', [rows[0].title_id, discordId]);
  return reply(message, `🎖️ Equipped title: **${rows[0].display}**.`);
}

async function unequip(message) {
  await pool.query('UPDATE user_character SET equipped_title_id = NULL WHERE discord_id = $1', [message.author.id]);
  return reply(message, 'Title unequipped.');
}

async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'equip') return equip(message, args.slice(1).join(' ').trim());
  if (sub === 'unequip') return unequip(message);
  const payload = await buildPayload(message.author.id, message.author.username, TITLE_CATEGORIES[0].key, 0);
  return message.reply({ ...payload });
}

// Select: title:cat:<owner>:<page>
async function handleSelect(interaction) {
  const parts = interaction.customId.split(':');
  const ownerId = parts[2];
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd title` yourself to browse.', flags: MessageFlags.Ephemeral });
  }
  const catKey = interaction.values[0];
  const payload = await buildPayload(ownerId, interaction.user.username, catKey, 0);
  return interaction.update(payload);
}

// Button: title:<prev|next>:<owner>:<catKey>:<page>
async function handleButton(interaction) {
  const parts = interaction.customId.split(':');
  const [, action, ownerId, catKey, pageStr] = parts;
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: 'Run `crd title` yourself to browse.', flags: MessageFlags.Ephemeral });
  }
  const cur = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? cur + 1 : Math.max(0, cur - 1);
  const payload = await buildPayload(ownerId, interaction.user.username, catKey, page);
  return interaction.update(payload);
}

module.exports = { execute, handleSelect, handleButton };

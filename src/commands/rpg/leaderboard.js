'use strict';

/**
 * `crd leaderboards` (alias `crd lb`) — v5 Phase 4 §4.4.
 * Single command: header + two dropdowns (category, scope). Top 15 only.
 * Selections re-render in place via the `lb` select-menu namespace.
 */

const {
  ContainerBuilder, SeparatorSpacingSize, ActionRowBuilder, StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { bracketOf } = require('../../config/ranked');

const BRAND = 0xf0b232;
const LIMIT = 15;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);
const MEDALS = ['🥇', '🥈', '🥉'];

// key → { label, col (SELECT value), fmt }
const CATEGORIES = {
  rating:   { label: 'PvP Rating',      col: 'uc.pvp_rating', fmt: (v) => `${v} (${bracketOf(v).name})` },
  credux:   { label: 'Lifetime Credux', col: 'ub.lifetime_credux_earned', fmt: (v) => Number(v).toLocaleString() },
  raids:    { label: 'Raids Done',      col: '(uc.raids_won + uc.raids_lost)', fmt: (v) => `${v}` },
  raidwins: { label: 'Raid Wins',       col: 'uc.raids_won', fmt: (v) => `${v}` },
  duels:    { label: 'Duel Wins',       col: 'uc.pvp_wins', fmt: (v) => `${v}` },
  combat:   { label: 'Combat Level',    col: 'uc.combat_level', fmt: (v) => `Lv ${v}` },
  believer: { label: 'Believer Level',  col: 'uc.believer_level', fmt: (v) => `Lv ${v}` },
  boss:     { label: 'Boss Kills',      col: 'uc.boss_kills', fmt: (v) => `${v}` },
};
const CAT_KEYS = Object.keys(CATEGORIES);

/** Run the ranked query for a category + scope. memberIds=null → global. */
async function queryBoard(catKey, memberIds) {
  const cat = CATEGORIES[catKey];
  const params = [];
  let where = '';
  if (memberIds) { params.push(memberIds); where = 'WHERE uc.discord_id = ANY($1)'; }
  // credux is the only metric on users_bag — only JOIN it when needed (keeps the
  // common user_character-only boards index-friendly).
  const needsBag = cat.col.startsWith('ub.');
  const { rows } = await pool.query(
    `SELECT u.username, ${cat.col} AS value
       FROM user_character uc
       JOIN users u ON u.discord_id = uc.discord_id
       ${needsBag ? 'JOIN users_bag ub ON ub.discord_id = uc.discord_id' : ''}
       ${where}
      ORDER BY value DESC NULLS LAST
      LIMIT ${LIMIT}`,
    params
  );
  return rows;
}

/** Resolve guild member ids for server scope (cache-first — avoids a slow API fetch). */
function serverMemberIds(guild) {
  if (!guild) return null;
  const ids = [...guild.members.cache.keys()];
  return ids.length ? ids : null;
}

function buildSelects(catKey, scope, ownerId) {
  const catMenu = new StringSelectMenuBuilder()
    .setCustomId(`lb:cat:${ownerId}:${scope}`)
    .setPlaceholder('Category')
    .addOptions(CAT_KEYS.map((k) => ({
      label: CATEGORIES[k].label, value: k, default: k === catKey,
    })));
  const scopeMenu = new StringSelectMenuBuilder()
    .setCustomId(`lb:scope:${ownerId}:${catKey}`)
    .setPlaceholder('Scope')
    .addOptions(
      { label: 'Server', value: 'server', default: scope === 'server' },
      { label: 'Global', value: 'global', default: scope === 'global' },
    );
  return [new ActionRowBuilder().addComponents(catMenu), new ActionRowBuilder().addComponents(scopeMenu)];
}

async function buildPayload(catKey, scope, guild, ownerId) {
  const cat = CATEGORIES[catKey];
  const memberIds = scope === 'server' ? serverMemberIds(guild) : null;
  const rows = await queryBoard(catKey, memberIds);

  const [catRow, scopeRow] = buildSelects(catKey, scope, ownerId);
  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent('## 🏆 Leaderboards'));
  // Dropdowns live in the header: scope (server/global) first, then category.
  container.addActionRowComponents(() => scopeRow);
  container.addActionRowComponents(() => catRow);
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    `-# ${cat.label} · ${scope === 'global' ? '🌐 Global' : '🏠 Server'}`
  ));

  if (rows.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No ranked players yet.*'));
  } else {
    const lines = rows.map((r, i) => {
      const rank = i < 3 ? MEDALS[i] : `**${i + 1}.**`;
      return `${rank} ${r.username} — ${cat.fmt(r.value)}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(lines.join('\n')));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function execute(message) {
  const payload = await buildPayload('rating', 'server', message.guild, message.author.id);
  return message.reply({ ...payload });
}

// Select menu: lb:cat:<owner>:<scope>  |  lb:scope:<owner>:<cat>
async function handleSelect(interaction) {
  const parts = interaction.customId.split(':');
  const [, which, ownerId] = parts;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Run `crd leaderboards` yourself to browse.', flags: MessageFlags.Ephemeral });
    return;
  }
  let catKey;
  let scope;
  if (which === 'cat') {
    catKey = interaction.values[0];
    scope = parts[3];
  } else { // scope
    scope = interaction.values[0];
    catKey = parts[3];
  }
  if (!CATEGORIES[catKey]) catKey = 'rating';
  if (scope !== 'global' && scope !== 'server') scope = 'server';
  const payload = await buildPayload(catKey, scope, interaction.guild, ownerId);
  await interaction.update(payload);
}

module.exports = { execute, handleSelect };

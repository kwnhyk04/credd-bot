'use strict';

/**
 * `crd leaderboard [category] [global]` (alias `crd lb`) — v5 Phase 4 §4.4.
 * Server scope by default (guild members only); `global` keyword widens to all users.
 * Components V2 container per the CLAUDE.md UI standard.
 */

const { ContainerBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const pool = require('../../db/pool');
const { bracketOf } = require('../../config/ranked');

const BRAND = 0xf0b232;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);
const MEDALS = ['🥇', '🥈', '🥉'];

// category alias → { label, col (SELECT value), fmt }
const CATEGORIES = {
  credux:   { label: 'Lifetime Credux', col: 'ub.lifetime_credux_earned', fmt: (v) => Number(v).toLocaleString() },
  raids:    { label: 'Raids Done',      col: '(uc.raids_won + uc.raids_lost)', fmt: (v) => `${v}` },
  raidwins: { label: 'Raid Wins',       col: 'uc.raids_won', fmt: (v) => `${v}` },
  duels:    { label: 'Duel Wins',       col: 'uc.pvp_wins', fmt: (v) => `${v}` },
  rating:   { label: 'PvP Rating',      col: 'uc.pvp_rating', fmt: (v) => `${v} (${bracketOf(v).name})` },
  combat:   { label: 'Combat Level',    col: 'uc.combat_level', fmt: (v) => `Lv ${v}` },
  believer: { label: 'Believer Level',  col: 'uc.believer_level', fmt: (v) => `Lv ${v}` },
  boss:     { label: 'Boss Kills',      col: 'uc.boss_kills', fmt: (v) => `${v}` },
};
const ALIASES = { pvp: 'rating', elo: 'rating', raidwin: 'raidwins', duel: 'duels', bosskills: 'boss' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

async function execute(message, { args }) {
  const tokens = (args || []).map((a) => a.toLowerCase());
  const isGlobal = tokens.includes('global');
  const catKey = tokens.find((t) => t !== 'global') || 'rating';
  const resolved = CATEGORIES[catKey] ? catKey : (ALIASES[catKey] || null);
  if (!resolved) {
    return reply(message, `Unknown category. Try: \`${Object.keys(CATEGORIES).join('`, `')}\`.`);
  }
  const cat = CATEGORIES[resolved];

  // Server scope: restrict to this guild's members.
  let memberIds = null;
  if (!isGlobal && message.guild) {
    try {
      const members = await message.guild.members.fetch();
      memberIds = [...members.keys()];
    } catch {
      memberIds = [...(message.guild.members.cache.keys())];
    }
  }

  const params = [];
  let whereClause = '';
  if (memberIds) {
    params.push(memberIds);
    whereClause = `WHERE uc.discord_id = ANY($1)`;
  }

  const { rows } = await pool.query(
    `SELECT uc.discord_id, u.username, ${cat.col} AS value
       FROM user_character uc
       JOIN users u ON u.discord_id = uc.discord_id
       JOIN users_bag ub ON ub.discord_id = uc.discord_id
       ${whereClause}
      ORDER BY value DESC NULLS LAST
      LIMIT 10`,
    params
  );

  const scopeLabel = isGlobal ? '🌐 Global' : '🏠 Server';
  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent(`## 🏆 Leaderboard — ${cat.label}\n-# ${scopeLabel}`))
    .addSeparatorComponents(sep);

  if (rows.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No ranked players yet.*'));
  } else {
    const lines = rows.map((r, i) => {
      const rank = i < 3 ? MEDALS[i] : `**${i + 1}.**`;
      const self = r.discord_id === message.author.id ? ' ◀' : '';
      return `${rank} ${r.username} — ${cat.fmt(r.value)}${self}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(lines.join('\n')));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent('-# 💡 `crd lb <category> [global]` · categories: rating, credux, raids, raidwins, duels, combat, believer, boss')
    );

  return message.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

module.exports = { execute };

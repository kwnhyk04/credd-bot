'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const pool = require('../../db/pool');
const { CHESTS } = require('../../config/dropRates');

const BRAND = 0x9b59b6;
const PAGE_SIZE = 10;
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };

// Tier ordering for the weapons list (Supreme → Common).
const TIER_ORDER_SQL = `CASE wr.tier
  WHEN 'Supreme' THEN 5 WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 3
  WHEN 'Rare' THEN 2 WHEN 'Common' THEN 1 ELSE 0 END`;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

// ── crd bag (overview) ──────────────────────────────────────────────────
async function overview(message) {
  const { rows } = await pool.query(
    `SELECT credux, belief_shards, sacred_relics, supreme_relics,
            silver_chest, gold_chest, boss_treasure_chest, boss_golden_chest, supreme_chest,
            epic_essence, mythic_essence, legendary_essence, supreme_essence
       FROM users_bag WHERE discord_id = $1`,
    [message.author.id]
  );
  if (rows.length === 0) {
    await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
    return;
  }
  const b = rows[0];
  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${message.author.username}'s Bag`)
    .addFields(
      { name: 'Currencies', value: `Credux: **${Number(b.credux).toLocaleString()}** · Belief Shards: **${b.belief_shards.toLocaleString()}**`, inline: false },
      { name: 'Chests', value:
          `Silver: ${b.silver_chest} · Gold: ${b.gold_chest} · Boss Treasure: ${b.boss_treasure_chest} · Boss Golden: ${b.boss_golden_chest} · Supreme: ${b.supreme_chest}`,
        inline: false },
      { name: 'Essence', value:
          `Epic: ${b.epic_essence} · Mythic: ${b.mythic_essence} · Legendary: ${b.legendary_essence} · Supreme: ${b.supreme_essence}`,
        inline: false },
    )
    .setFooter({ text: `Sacred Relic: ${b.sacred_relics} · Supreme Relic: ${b.supreme_relics}  |  crd bag chests · crd bag weapons` });
  await reply(message, { embeds: [embed] });
}

// ── crd bag chests ──────────────────────────────────────────────────────
async function chests(message) {
  const { rows } = await pool.query(
    `SELECT silver_chest, gold_chest, boss_treasure_chest, boss_golden_chest, supreme_chest
       FROM users_bag WHERE discord_id = $1`,
    [message.author.id]
  );
  if (rows.length === 0) {
    await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
    return;
  }
  const b = rows[0];
  // alias → column already in CHESTS; render in display order.
  const lines = [
    ['Silver Chest', b.silver_chest, 'sc'],
    ['Gold Chest', b.gold_chest, 'gc'],
    ['Boss Treasure Chest', b.boss_treasure_chest, 'btc'],
    ['Boss Golden Chest', b.boss_golden_chest, 'bgtc'],
    ['Supreme Chest', b.supreme_chest, 'supc'],
  ].map(([name, count, alias]) => `**${name}**: ${count} — \`crd open ${alias}\``);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${message.author.username}'s Chests`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Open up to 10 at once, e.g. crd open sc 10' });
  await reply(message, { embeds: [embed] });
}

// ── crd bag weapons (paginated) ─────────────────────────────────────────
async function buildWeaponsPage(discordId, username, page) {
  const countRes = await pool.query('SELECT count(*)::int AS n FROM user_weapons WHERE discord_id = $1', [discordId]);
  const total = countRes.rows[0].n;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), totalPages);
  const offset = (p - 1) * PAGE_SIZE;

  const { rows } = await pool.query(
    `SELECT uw.weapon_id, wr.name, wr.tier, wr.type, uw.enhancement, uw.is_locked,
            uw.curr_atk, uw.curr_hp, uw.curr_def, uw.crit,
            (uw.weapon_id = uc.equipped_weapon_id) AS equipped
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
       LEFT JOIN user_character uc ON uc.discord_id = uw.discord_id
      WHERE uw.discord_id = $1
      ORDER BY ${TIER_ORDER_SQL} DESC, uw.enhancement DESC, uw.obtained_at ASC
      LIMIT $2 OFFSET $3`,
    [discordId, PAGE_SIZE, offset]
  );

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${username}'s Weapons`)
    .setFooter({ text: `Page ${p}/${totalPages} · ${total} weapon${total !== 1 ? 's' : ''} · crd equip <id>` });

  if (rows.length === 0) {
    embed.setDescription('You don\'t own any weapons.');
  } else {
    embed.setDescription(rows.map(w => {
      const emoji = TYPE_EMOJI[w.type] || '•';
      const badges = `${w.equipped ? ' ✅Equipped' : ''}${w.is_locked ? ' 🔒' : ''}`;
      const critTxt = Number(w.crit) > 0 ? ` · CRIT ${Number(w.crit).toFixed(1)}%` : '';
      return `${emoji} **${w.name}** (${w.tier}) +${w.enhancement - 1}${badges}\n\`${w.weapon_id}\` · ATK ${w.curr_atk} · HP ${w.curr_hp} · DEF ${w.curr_def}${critTxt}`;
    }).join('\n\n'));
  }

  const components = [];
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bagw:${p - 1}:${discordId}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p <= 1),
      new ButtonBuilder().setCustomId(`bagw:${p + 1}:${discordId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages),
    ));
  }
  return { embed, components };
}

async function weapons(message) {
  const { embed, components } = await buildWeaponsPage(message.author.id, message.author.username, 1);
  await reply(message, { embeds: [embed], components });
}

// Button: bagw:<page>:<uid>
async function handlePage(interaction, page, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  const { embed, components } = await buildWeaponsPage(ownerId, interaction.user.username, page);
  await interaction.update({ embeds: [embed], components });
}

// ── dispatcher: crd bag [chests|weapons] ────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'chests') return chests(message);
  if (sub === 'weapons') return weapons(message);
  return overview(message);
}

module.exports = { execute, handlePage };

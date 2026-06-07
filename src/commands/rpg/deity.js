'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const pool = require('../../db/pool');
const { TIER_ALIAS, TIER_COLOR } = require('../../config/gachaRates');

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

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

// ── crd deity collection / list (paginated by mythology) ──────────────────
async function buildCollectionPage(discordId, username, page) {
  // Stable page order: one page per mythology, in seed order.
  const mythRes = await pool.query(
    'SELECT mythology FROM deity_roster GROUP BY mythology ORDER BY MIN(deity_id)'
  );
  const mythologies = mythRes.rows.map(r => r.mythology);
  const totalPages = Math.max(1, mythologies.length);

  // Loop infinitely: wrap out-of-range pages.
  let p = ((page - 1) % totalPages + totalPages) % totalPages + 1;
  const mythology = mythologies[p - 1];

  const embed = new EmbedBuilder().setColor(BRAND).setTitle(`${username}'s Deities`);

  if (!mythology) {
    embed.setDescription('No deities are available yet.');
    return { embed, components: [] };
  }

  const { rows } = await pool.query(
    `SELECT dr.name, dr.tier, (ud.user_deity_id IS NOT NULL) AS owned
       FROM deity_roster dr
       LEFT JOIN user_deities ud
         ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE dr.mythology = $2
      ORDER BY ${TIER_ORDER_SQL} DESC, dr.name ASC`,
    [discordId, mythology]
  );

  const lines = rows.map(d => d.owned
    ? `**${d.name}** — ${TIER_ALIAS[d.tier]} *(${d.tier})*`
    : `🔒 *${d.name}* — ${TIER_ALIAS[d.tier]}`);

  // Tier essence balances in the footer (Master §9, line 483).
  const bagRes = await pool.query(
    'SELECT epic_essence, mythic_essence, legendary_essence, supreme_essence FROM users_bag WHERE discord_id = $1',
    [discordId]
  );
  const bag = bagRes.rows[0] || {};
  const essenceText = TIER_ESSENCE_LABEL
    .map(([tier, col]) => `${TIER_ALIAS[tier]}: ${bag[col] ?? 0}`)
    .join(' · ');

  embed
    .setAuthor({ name: `${mythology} Myths` })
    .setDescription(lines.join('\n') || 'No deities in this mythology.')
    .setFooter({ text: `Page ${p}/${totalPages} · Essence — ${essenceText}` });

  const components = [];
  if (totalPages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`deityc:${p - 1}:${discordId}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`deityc:${p + 1}:${discordId}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embed, components };
}

async function collection(message) {
  const { embed, components } = await buildCollectionPage(message.author.id, message.author.username, 1);
  await reply(message, { embeds: [embed], components });
}

// Button: deityc:<page>:<uid>
async function handlePage(interaction, page, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  const { embed, components } = await buildCollectionPage(ownerId, interaction.user.username, page);
  await interaction.update({ embeds: [embed], components });
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

  // Tier essence available for this deity's own tier.
  const essCol = { Epic: 'epic_essence', Mythic: 'mythic_essence', Legendary: 'legendary_essence', Supreme: 'supreme_essence' }[d.tier];
  const essRes = await pool.query(`SELECT ${essCol} AS amount FROM users_bag WHERE discord_id = $1`, [discordId]);
  const essAmount = essRes.rows[0]?.amount ?? 0;

  const embed = new EmbedBuilder()
    .setColor(TIER_COLOR[d.tier])
    .setTitle(`${d.name} — ${TIER_ALIAS[d.tier]}`)
    .setDescription(`*${d.mythology} Myths*`)
    .addFields(
      { name: 'Stats', value: `ATK ${d.curr_atk} · HP ${d.curr_hp} · DEF ${d.curr_def}`, inline: false },
      { name: `Enhancement`, value: `+${d.enhancement - 1}`, inline: true },
      { name: `${TIER_ALIAS[d.tier]} Essence`, value: `${essAmount}`, inline: true },
      { name: `Blessing — ${d.blessing_name}`, value: d.blessing_description, inline: false },
    )
    .setFooter({ text: 'Want to enhance this deity? Use crd deity enhance <name>' });

  if (d.lore) embed.addFields({ name: 'Lore', value: d.lore, inline: false });

  await reply(message, { embeds: [embed] });
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

// ── dispatcher: crd deity [collection|list|info|equip] ────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  if (sub === 'collection' || sub === 'list' || sub === '') return collection(message);
  if (sub === 'info') return info(message, rest);
  if (sub === 'equip') return equip(message, rest);

  await reply(message, { content: 'Usage: `crd deity collection` · `crd deity info <name>` · `crd deity equip <name>`' });
}

module.exports = { execute, handlePage };

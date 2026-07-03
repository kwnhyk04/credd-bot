'use strict';

/**
 * rune.js - Phase 2 §2.6 rune inventory views.
 *   crd rune bag  - the 3 stockpiled rune bags + counts (0 default), open hints.
 *   crd runes     - owned runes, filtered by lane and paginated at 10 rows.
 */

const {
  ContainerBuilder,
  AttachmentBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emoji } = require('../../utils/emojis');
const { assetPath } = require('../../utils/assets');
const { renderBagItemsImage } = require('../../engine/renderBagItems');
const { BAGS, runeEmoji, runeDescription } = require('../../config/runes');

const LANE_WORD = { offense: 'Offensive', defense: 'Defensive' };

const BRAND = 0x9b59b6;
const RUNES_PER_PAGE = 10;
const TIER_RANK_SQL = `CASE rn.tier
  WHEN 'Supreme' THEN 4
  WHEN 'Legendary' THEN 3
  WHEN 'Mythic' THEN 2
  WHEN 'Rare' THEN 1
  WHEN 'Common' THEN 0
  ELSE -1
END`;

function reply(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [], ...(payload.allowedMentions ?? {}) },
  });
}

function normalizeLane(lane) {
  return lane === 'defense' ? 'defense' : 'offense';
}

// -- crd rune bag ------------------------------------------------------------
async function runeBag(message) {
  const discordId = message.author.id;
  const { rows } = await pool.query(
    'SELECT lesser_rune_bag, greater_rune_bag, divine_rune_bag FROM users_bag WHERE discord_id = $1',
    [discordId]
  );
  const bag = rows[0] || {};

  const items = Object.entries(BAGS).map(([key, b]) => ({
    emojiName: b.emojiName,
    iconPath: assetPath(`items/rune bag/${key}_bag.png`),
    name: b.display,
    cmd: `crd open ${b.alias}`,
    count: bag[b.column] ?? 0,
  }));
  const buffer = await renderBagItemsImage(items);
  const file = new AttachmentBuilder(buffer, { name: 'rune_bags.png' });

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${emoji('rune_icon')} <@${discordId}>'s Rune Bags`));
  container.addTextDisplayComponents((td) => td.setContent('-# Buy bags in `crd essence shop`. Open with `crd open lb/gb/db [amount]` (max 10).'));
  container.addSeparatorComponents(sep);
  container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL('attachment://rune_bags.png')));

  return reply(message, { components: [container], files: [file], flags: MessageFlags.IsComponentsV2 });
}

async function fetchRunes(discordId, requestedPage, rawLane = 'offense') {
  const lane = normalizeLane(rawLane);
  const countRes = await pool.query(
    `SELECT count(*)::int AS total
      FROM user_runes ur
      JOIN rune_roster rn ON ur.rune_id = rn.rune_id
      WHERE ur.discord_id = $1
        AND rn.lane = $2`,
    [discordId, lane]
  );
  const total = countRes.rows[0].total;
  const totalPages = Math.max(1, Math.ceil(total / RUNES_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const offset = page * RUNES_PER_PAGE;

  const { rows: runes } = await pool.query(
    `SELECT ur.rune_uid, ur.socketed_into, ur.is_locked,
            rn.name, rn.lane, rn.tier, rn.effect_key,
            COALESCE(ur.rolled_value, rn.value) AS value,
            rn.description
      FROM user_runes ur
      JOIN rune_roster rn ON ur.rune_id = rn.rune_id
      WHERE ur.discord_id = $1
        AND rn.lane = $2
      ORDER BY ${TIER_RANK_SQL} DESC, rn.name ASC, ur.rune_uid ASC
      LIMIT $3 OFFSET $4`,
    [discordId, lane, RUNES_PER_PAGE, offset]
  );

  return { runes, total, page, totalPages, lane };
}

function runeDisplayRow(r) {
  const lock = r.is_locked ? ' [locked]' : '';
  const laneWord = LANE_WORD[r.lane] || r.lane;
  const where = r.socketed_into ? `Socketed in \`${r.socketed_into}\`` : 'Unsocketed';
  const desc = runeDescription(r.effect_key, r.value, r.description);
  return `${runeEmoji(r.effect_key)} **${r.name}** ${r.tier} - ${laneWord} Rune${lock}\n`
    + `-# \`${r.rune_uid}\` - ${desc} - ${where}`;
}

function laneSelect(userId, lane, page) {
  return new StringSelectMenuBuilder()
    .setCustomId(`runes:filter:${userId}:${page}:${lane}`)
    .setPlaceholder('Rune lane')
    .addOptions(
      {
        label: 'Offensive Runes',
        value: 'offense',
        description: 'Show only offensive runes',
        emoji: '⚔️',
        default: lane === 'offense',
      },
      {
        label: 'Defensive Runes',
        value: 'defense',
        description: 'Show only defensive runes',
        emoji: '🛡️',
        default: lane === 'defense',
      }
    );
}

function buildRunesPage({ user, runes, total, page, totalPages, lane }) {
  const container = new ContainerBuilder().setAccentColor(BRAND);
  const laneLabel = LANE_WORD[lane] || 'Offensive';

  container.addTextDisplayComponents((td) =>
    td.setContent(
      `## ${emoji('rune_icon')} <@${user.id}>'s Runes\n`
      + `-# ${laneLabel} · Showing **${runes.length}** of **${total}** · Page **${page + 1}/${totalPages}**`
    )
  );
  container.addActionRowComponents((row) => row.setComponents(laneSelect(user.id, lane, page)));
  container.addSeparatorComponents(sep);

  if (runes.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No runes match this filter. Open rune bags with `crd open lb/gb/db`.*'));
  } else {
    container.addTextDisplayComponents((td) => td.setContent(runes.map(runeDisplayRow).join('\n\n')));
  }

  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent('-# 💡 `crd socket <gear_id> <rune_uid> <slot#>` · `crd lock <rune_uid>` · `crd sell <rune_uid>`'));

  if (totalPages > 1) {
    container.addSeparatorComponents(sep);
    container.addActionRowComponents((row) =>
      row.setComponents(
        new ButtonBuilder()
          .setCustomId(`runes:prev:${user.id}:${page}:${lane}`)
          .setLabel('Previous')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(`runes:next:${user.id}:${page}:${lane}`)
          .setLabel('Next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      )
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

// -- crd runes ---------------------------------------------------------------
async function runesList(message) {
  const data = await fetchRunes(message.author.id, 0, 'offense');
  return reply(message, buildRunesPage({ user: message.author, ...data }));
}

// Select/button: runes:<filter|prev|next>:<ownerId>:<page>:<lane>
async function handleRunesInteraction(interaction) {
  const [, action, ownerId, pageStr, laneFromId] = interaction.customId.split(':');

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: 'This is not your rune view - run `crd runes` yourself.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  const currentPage = parseInt(pageStr, 10) || 0;
  const lane = action === 'filter'
    ? normalizeLane(interaction.values?.[0])
    : normalizeLane(laneFromId);
  const requestedPage = action === 'next'
    ? currentPage + 1
    : action === 'prev'
      ? currentPage - 1
      : 0;

  const data = await fetchRunes(ownerId, requestedPage, lane);
  return interaction.editReply(buildRunesPage({ user: interaction.user, ...data }));
}

// crd rune bag -> runeBag. (bare `crd rune` shows usage.)
async function execute(message, { args }) {
  if ((args[0] || '').toLowerCase() === 'bag') return runeBag(message);
  return message.reply({ content: 'Usage: `crd rune bag` · `crd runes`', allowedMentions: { repliedUser: false } });
}

module.exports = {
  execute,
  list: runesList,
  runeBag,
  runesList,
  handleRunesInteraction,
};

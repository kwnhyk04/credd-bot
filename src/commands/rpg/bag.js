'use strict';

const {
  ContainerBuilder,
  SeparatorSpacingSize,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { buildBagOverview, buildChestsView, getChestCounts } = require('../../engine/bagViews');
const { emojiForDisplay } = require('../../utils/emojis');

const WEAPONS_PER_PAGE = 10;
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };

// Tier ordering for the weapons list (Supreme → Common).
const TIER_ORDER_SQL = `CASE wr.tier
  WHEN 'Supreme' THEN 5 WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 3
  WHEN 'Rare' THEN 2 WHEN 'Common' THEN 1 ELSE 0 END`;

function reply(message, payload) {
  // parse: [] — header user-mentions must render without pinging anyone.
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [], ...(payload.allowedMentions ?? {}) },
  });
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
  const data = {
    credux: Number(b.credux),
    beliefShards: b.belief_shards,
    chests: {
      sc: b.silver_chest, gc: b.gold_chest, btc: b.boss_treasure_chest,
      bgtc: b.boss_golden_chest, supc: b.supreme_chest,
    },
    essence: {
      epic: b.epic_essence, mythic: b.mythic_essence,
      legendary: b.legendary_essence, supreme: b.supreme_essence,
    },
    relics: { sacred: b.sacred_relics, supreme: b.supreme_relics },
  };
  await reply(message, buildBagOverview(message.author, data));
}

// ── crd bag chests ──────────────────────────────────────────────────────
async function chests(message) {
  const exists = await pool.query('SELECT 1 FROM users_bag WHERE discord_id = $1', [message.author.id]);
  if (exists.rows.length === 0) {
    await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
    return;
  }
  const counts = await getChestCounts(message.author.id);
  await reply(message, await buildChestsView(message.author, counts));
}

// ── crd bag weapons (paginated, Components V2) ──────────────────────────
// page is 0-based (matches the weapons:<action>:<owner>:<page> customId state).
async function fetchWeapons(discordId, page) {
  const offset = page * WEAPONS_PER_PAGE;

  const { rows: weapons } = await pool.query(
    `SELECT uw.weapon_id, wr.name, wr.tier, wr.type, uw.enhancement, uw.is_locked,
            uw.curr_atk, uw.curr_hp, uw.curr_def, uw.crit,
            (uw.weapon_id = uc.equipped_weapon_id) AS equipped
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
       LEFT JOIN user_character uc ON uc.discord_id = uw.discord_id
      WHERE uw.discord_id = $1
      ORDER BY ${TIER_ORDER_SQL} DESC, uw.enhancement DESC, uw.obtained_at ASC
      LIMIT $2 OFFSET $3`,
    [discordId, WEAPONS_PER_PAGE, offset]
  );

  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM user_weapons WHERE discord_id = $1',
    [discordId]
  );

  return { weapons, total: countRes.rows[0].total };
}

// Design standard (see CLAUDE.md): header → separator → body → separator →
// help → separator → buttons, all inside one container.
function buildWeaponsPage({ user, weapons, total, page }) {
  const totalPages = Math.max(1, Math.ceil(total / WEAPONS_PER_PAGE));

  const container = new ContainerBuilder().setAccentColor(0x5865f2);

  // ── Header (real mention; callers send with allowedMentions parse: []) ──
  container.addTextDisplayComponents((td) =>
    td.setContent(
      `## 🗡️ <@${user.id}>'s Weapons\n` +
      `-# Showing **${weapons.length}** of **${total}** weapons • Page **${page + 1}/${totalPages}**`
    )
  );

  container.addSeparatorComponents((sep) =>
    sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // ── Body: weapon rows ──
  if (weapons.length === 0) {
    container.addTextDisplayComponents((td) =>
      td.setContent('*No weapons found. Open some chests!*')
    );
  } else {
    const rows = weapons.map((w) => {
      // Custom emoji from game_items.txt (display name → key); type icon fallback.
      const icon = emojiForDisplay(w.name, TYPE_EMOJI[w.type] ?? '⚔️');
      const badges = `${w.equipped ? ' ✅' : ''}${w.is_locked ? ' 🔒' : ''}`;
      const critTxt = Number(w.crit) > 0 ? ` · CRIT ${Number(w.crit).toFixed(1)}%` : '';
      // ID leads as inline code (tap-to-copy); enhancement lives on line 1.
      return (
        `\`${w.weapon_id}\` ${icon} **${w.name}** +${w.enhancement - 1}${badges}\n` +
        `-# ${w.tier} • ATK ${w.curr_atk} · HP ${w.curr_hp} · DEF ${w.curr_def}${critTxt}`
      );
    });

    container.addTextDisplayComponents((td) => td.setContent(rows.join('\n\n')));
  }

  container.addSeparatorComponents((sep) =>
    sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // ── Help section ──
  container.addTextDisplayComponents((td) =>
    td.setContent(
      '-# 💡 `crd equip <id>` to equip • `crd enhance <id>` to forge • `crd sell <id>` to sell'
    )
  );

  container.addSeparatorComponents((sep) =>
    sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // ── Pagination buttons (state lives in the customId) ──
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`weapons:prev:${user.id}:${page}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`weapons:next:${user.id}:${page}`)
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

async function weapons(message) {
  const page = 0;
  const { weapons: rows, total } = await fetchWeapons(message.author.id, page);
  await reply(message, buildWeaponsPage({ user: message.author, weapons: rows, total, page }));
}

// Button: weapons:<prev|next>:<ownerId>:<page>
async function handleWeaponsButton(interaction) {
  const [, action, ownerId, pageStr] = interaction.customId.split(':');

  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: 'This isn\'t your inventory view — run `crd bag weapons` yourself!',
      flags: MessageFlags.Ephemeral,
    });
  }

  const currentPage = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? currentPage + 1 : Math.max(0, currentPage - 1);

  const { weapons: rows, total } = await fetchWeapons(ownerId, page);
  await interaction.update(buildWeaponsPage({ user: interaction.user, weapons: rows, total, page }));
}

// ── dispatcher: crd bag [chests|weapons] ────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'chests') return chests(message);
  if (sub === 'weapons') return weapons(message);
  return overview(message);
}

module.exports = { execute, handleWeaponsButton };

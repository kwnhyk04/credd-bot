'use strict';

const {
  ContainerBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { buildBagOverview, buildChestsView, buildItemsView, getChestCounts } = require('../../engine/bagViews');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay, emoji } = require('../../utils/emojis');

// Rune-slot indicator for inventory rows (custom emoji, 💠 fallback).
function slotIcon() { const e = emoji('rune_slot'); return e === '▫️' ? '💠' : e; }

const WEAPONS_PER_PAGE = 10;
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };
// [v5] armor types
const ARMOR_TYPE_EMOJI = { Heavy: '🛡️', Medium: '🥋', Light: '🧥' };

function clampPageForTotal(page, total) {
  const totalPages = Math.max(1, Math.ceil(total / WEAPONS_PER_PAGE));
  const p = page | 0;
  return ((p % totalPages) + totalPages) % totalPages; // circular carousel wrap
}

// Strongest-first order shared by weapon and armor inventories. Genesis is
// currently weapon-only, but keeping one list prevents the two queries from
// drifting if Genesis armor is ever introduced.
const GEAR_TIER_STRENGTH = Object.freeze([
  'Genesis', 'Supreme', 'Legendary', 'Mythic', 'Rare', 'Common',
]);

function tierOrderSql(column) {
  const clauses = GEAR_TIER_STRENGTH
    .map((tier, index) => `WHEN '${tier}' THEN ${GEAR_TIER_STRENGTH.length - index}`)
    .join(' ');
  return `CASE ${column} ${clauses} ELSE 0 END`;
}

const TIER_ORDER_SQL = tierOrderSql('wr.tier');
const ARMOR_TIER_ORDER_SQL = tierOrderSql('ar.tier');

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
            epic_essence, mythic_essence, legendary_essence, supreme_essence,
            lesser_rune_bag, greater_rune_bag, divine_rune_bag,
            (SELECT count(*)::int FROM user_weapons WHERE discord_id = $1) AS weapons,
            (SELECT count(*)::int FROM user_armors  WHERE discord_id = $1) AS armors,
            (SELECT count(*)::int FROM user_runes   WHERE discord_id = $1) AS runes,
            COALESCE(silver_chest+gold_chest+boss_treasure_chest+boss_golden_chest+supreme_chest,0) AS chests_total,
            COALESCE(lesser_rune_bag+greater_rune_bag+divine_rune_bag,0) AS rune_bags_total
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
    runeBags: {
      lesser: b.lesser_rune_bag, greater: b.greater_rune_bag, divine: b.divine_rune_bag,
    },
    counts: {
      weapons: b.weapons,
      armors: b.armors,
      runes: b.runes,
      chests: b.chests_total,
      runeBags: b.rune_bags_total,
    },
  };
  await reply(message, await buildBagOverview(message.author, data));
}

// ── crd bag chests ──────────────────────────────────────────────────────
async function chests(message) {
  const counts = await getChestCounts(message.author.id);
  if (!counts) {
    await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
    return;
  }
  await reply(message, await buildChestsView(message.author, counts));
}

// ── crd bag items — CRD Bag Items category (Genesis update S7) ──────────
async function items(message) {
  const counts = await getChestCounts(message.author.id);
  if (!counts) {
    await reply(message, { content: 'You don\'t have a bag yet. Use `crd register` first.' });
    return;
  }
  await reply(message, await buildItemsView(message.author, counts));
}

// ── crd bag weapons (paginated, Components V2) ──────────────────────────
// page is 0-based (matches the weapons:<action>:<owner>:<page> customId state).
async function fetchWeapons(discordId, page) {
  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM user_weapons WHERE discord_id = $1',
    [discordId]
  );
  const total = countRes.rows[0].total;
  const clampedPage = clampPageForTotal(page, total);
  const offset = clampedPage * WEAPONS_PER_PAGE;

  const { rows: weapons } = await pool.query(
    `SELECT uw.weapon_id, wr.name, wr.tier, wr.type, uw.enhancement, uw.is_locked,
            uw.curr_atk, uw.crit,
            COALESCE(jsonb_array_length(uw.native_sockets), 0) AS socket_count,
            (uw.weapon_id = uc.equipped_weapon_id) AS equipped
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
       LEFT JOIN user_character uc ON uc.discord_id = uw.discord_id
      WHERE uw.discord_id = $1
      ORDER BY ${TIER_ORDER_SQL} DESC, uw.enhancement DESC, uw.obtained_at ASC
      LIMIT $2 OFFSET $3`,
    [discordId, WEAPONS_PER_PAGE, offset]
  );

  return { weapons, total, page: clampedPage };
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

  container.addSeparatorComponents(sep);

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
      const sockets = w.socket_count > 0 ? ` · ${slotIcon()} ${w.socket_count}` : '';
      // ID leads as inline code (tap-to-copy); enhancement lives on line 1.
      return (
        `\`${w.weapon_id}\` ${icon} **${w.name}** +${w.enhancement - 1}${badges}\n` +
        `-# ${w.tier} • ATK ${w.curr_atk}${critTxt}${sockets}`
      );
    });

    container.addTextDisplayComponents((td) => td.setContent(rows.join('\n\n')));
  }

  container.addSeparatorComponents(sep);

  // ── Help section ──
  container.addTextDisplayComponents((td) =>
    td.setContent(
      '-# 💡 `crd equip <id>` to equip • `crd enhance <id>` to forge • `crd sell <id>` to sell'
    )
  );

  container.addSeparatorComponents(sep);

  // ── Pagination buttons (state lives in the customId) ──
  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`weapons:prev:${user.id}:${page}`)
        .setLabel('Previous')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1),
      new ButtonBuilder()
        .setCustomId(`weapons:next:${user.id}:${page}`)
        .setLabel('Next')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(totalPages <= 1)
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
  const { weapons: rows, total, page: actualPage } = await fetchWeapons(message.author.id, page);
  await reply(message, buildWeaponsPage({ user: message.author, weapons: rows, total, page: actualPage }));
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

  await interaction.deferUpdate();
  const currentPage = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? currentPage + 1 : currentPage - 1; // clampPageForTotal wraps

  const { weapons: rows, total, page: actualPage } = await fetchWeapons(ownerId, page);
  await interaction.editReply(buildWeaponsPage({ user: interaction.user, weapons: rows, total, page: actualPage }));
}

// ── crd bag armors (paginated, Components V2 — mirrors bag weapons) ──────
async function fetchArmors(discordId, page) {
  const countRes = await pool.query(
    'SELECT count(*)::int AS total FROM user_armors WHERE discord_id = $1',
    [discordId]
  );
  const total = countRes.rows[0].total;
  const clampedPage = clampPageForTotal(page, total);
  const offset = clampedPage * WEAPONS_PER_PAGE;

  const { rows: armors } = await pool.query(
    `SELECT ua.armor_id, ar.name, ar.tier, ar.type, ua.enhancement, ua.is_locked,
            ua.curr_hp, ua.curr_def,
            COALESCE(jsonb_array_length(ua.native_sockets), 0) AS socket_count,
            (ua.armor_id = uc.equipped_armor_id) AS equipped
       FROM user_armors ua
       JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
       LEFT JOIN user_character uc ON uc.discord_id = ua.discord_id
      WHERE ua.discord_id = $1
      ORDER BY ${ARMOR_TIER_ORDER_SQL} DESC, ua.enhancement DESC, ua.obtained_at ASC
      LIMIT $2 OFFSET $3`,
    [discordId, WEAPONS_PER_PAGE, offset]
  );

  return { armors, total, page: clampedPage };
}

function buildArmorsPage({ user, armors, total, page }) {
  const totalPages = Math.max(1, Math.ceil(total / WEAPONS_PER_PAGE));

  const container = new ContainerBuilder().setAccentColor(0x5865f2);

  container.addTextDisplayComponents((td) =>
    td.setContent(
      `## 🛡️ <@${user.id}>'s Armor\n` +
      `-# Showing **${armors.length}** of **${total}** pieces • Page **${page + 1}/${totalPages}**`
    )
  );
  container.addSeparatorComponents(sep);

  if (armors.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No armor found. Open some chests!*'));
  } else {
    const rows = armors.map((a) => {
      const icon = emojiForDisplay(a.name, ARMOR_TYPE_EMOJI[a.type] ?? '🛡️');
      const badges = `${a.equipped ? ' ✅' : ''}${a.is_locked ? ' 🔒' : ''}`;
      const sockets = a.socket_count > 0 ? ` · ${slotIcon()} ${a.socket_count}` : '';
      return (
        `\`${a.armor_id}\` ${icon} **${a.name}** +${a.enhancement - 1}${badges}\n` +
        `-# ${a.tier} • HP ${a.curr_hp} · DEF ${a.curr_def}${sockets}`
      );
    });
    container.addTextDisplayComponents((td) => td.setContent(rows.join('\n\n')));
  }

  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) =>
    td.setContent('-# 💡 `crd equip <id>` to equip • `crd enhance <id>` to forge • `crd sell <id>` to sell')
  );
  container.addSeparatorComponents(sep);

  container.addActionRowComponents((row) =>
    row.setComponents(
      new ButtonBuilder()
        .setCustomId(`armors:prev:${user.id}:${page}`)
        .setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
      new ButtonBuilder()
        .setCustomId(`armors:next:${user.id}:${page}`)
        .setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1)
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function armors(message) {
  const page = 0;
  const { armors: rows, total, page: actualPage } = await fetchArmors(message.author.id, page);
  await reply(message, buildArmorsPage({ user: message.author, armors: rows, total, page: actualPage }));
}

// Button: armors:<prev|next>:<ownerId>:<page>
async function handleArmorsButton(interaction) {
  const [, action, ownerId, pageStr] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: 'This isn\'t your inventory view — run `crd bag armors` yourself!',
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferUpdate();
  const currentPage = parseInt(pageStr, 10) || 0;
  const page = action === 'next' ? currentPage + 1 : currentPage - 1; // clampPageForTotal wraps
  const { armors: rows, total, page: actualPage } = await fetchArmors(ownerId, page);
  await interaction.editReply(buildArmorsPage({ user: interaction.user, armors: rows, total, page: actualPage }));
}

// ── dispatcher: crd bag [chests|weapons|armors] ─────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'chests') return chests(message);
  if (sub === 'items' || sub === 'item') return items(message);
  if (sub === 'weapons') return weapons(message);
  if (sub === 'armors' || sub === 'armor') return armors(message);
  return overview(message);
}

module.exports = {
  execute,
  handleWeaponsButton,
  handleArmorsButton,
  fetchWeapons,
  fetchArmors,
  GEAR_TIER_STRENGTH,
};

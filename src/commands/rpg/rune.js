'use strict';

/**
 * rune.js — Phase 2 §2.6 rune inventory views.
 *   crd rune bag  — the 3 stockpiled rune bags + counts (0 default), open hints.
 *   crd runes     — owned runes (family, tier, value, socketed-into/free, 🔒).
 *
 * Components-V2 containers (project UI standard). Runes list is single-page
 * (cap 40 rows); pagination can be layered on later via the bag-view pattern.
 */

const path = require('path');
const {
  ContainerBuilder, SeparatorSpacingSize, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { emoji } = require('../../utils/emojis');
const { renderBagItemsImage } = require('../../engine/renderBagItems');
const { BAGS, runeEmoji } = require('../../config/runes');

const BAG_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'items', 'rune bag');

const LANE_WORD = { offense: 'Offensive', defense: 'Defensive' };

const BRAND = 0x9b59b6;
const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

// ── crd rune bag ────────────────────────────────────────────────────────────
async function runeBag(message) {
  const discordId = message.author.id;
  const { rows } = await pool.query(
    'SELECT lesser_rune_bag, greater_rune_bag, divine_rune_bag FROM users_bag WHERE discord_id = $1',
    [discordId]
  );
  const bag = rows[0] || {};

  // Boxed-row canvas (same as `crd bag chests`); bag art in assets/items/runes.
  const items = Object.entries(BAGS).map(([key, b]) => ({
    emojiName: b.emojiName,
    iconPath: path.join(BAG_DIR, `${key}_bag.png`),
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

// ── crd runes ───────────────────────────────────────────────────────────────
async function runesList(message) {
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT ur.rune_uid, ur.socketed_into, ur.is_locked,
            rn.name, rn.lane, rn.tier, rn.effect_key, rn.value, rn.description
       FROM user_runes ur JOIN rune_roster rn ON ur.rune_id = rn.rune_id
      WHERE ur.discord_id = $1
      ORDER BY CASE rn.tier WHEN 'Supreme' THEN 0 WHEN 'Legendary' THEN 1 WHEN 'Mythic' THEN 2 ELSE 3 END,
               rn.name ASC
      LIMIT 40`,
    [discordId]
  );

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${emoji('rune_icon')} <@${discordId}>'s Runes`));
  container.addSeparatorComponents(sep);

  if (rows.length === 0) {
    container.addTextDisplayComponents((td) => td.setContent('*No runes yet. Open rune bags with `crd open lb/gb/db`.*'));
  } else {
    const lines = rows.map((r) => {
      const lock = r.is_locked ? ' 🔒' : '';
      const laneWord = LANE_WORD[r.lane] || r.lane;
      // "Unsocketed" = not slotted into any gear (free to socket); else where it sits.
      const where = r.socketed_into ? `Socketed in \`${r.socketed_into}\`` : 'Unsocketed';
      return `${runeEmoji(r.effect_key)} **${r.name}** ${r.tier} · ${laneWord} Rune${lock}\n`
        + `-# \`${r.rune_uid}\` · ${r.description} · ${where}`;
    });
    container.addTextDisplayComponents((td) => td.setContent(lines.join('\n')));
  }
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent('-# 💡 `crd socket <gear_id> <rune_uid> <slot#>` ・ `crd lock <rune_uid>` ・ `crd sell <rune_uid>`'));

  return reply(message, { components: [container], flags: MessageFlags.IsComponentsV2 });
}

// crd rune bag → runeBag. (bare `crd rune` shows usage.)
async function execute(message, { args }) {
  if ((args[0] || '').toLowerCase() === 'bag') return runeBag(message);
  return message.reply({ content: 'Usage: `crd rune bag` ・ `crd runes`', allowedMentions: { repliedUser: false } });
}

module.exports = { execute, list: runesList, runeBag, runesList };

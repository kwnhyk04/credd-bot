'use strict';

const {
  ContainerBuilder,
  SeparatorSpacingSize,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { emojiForDisplay, resolveName } = require('../../utils/emojis');
const { renderCenteredArt } = require('../../engine/renderSummon');

const AI_DISCLAIMER = '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };

const WEAPONS_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'weapons');

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/**
 * Artwork path for a weapon display name. Filenames equal the registry emoji
 * names (including their typos, e.g. dipylon_shied.jpg), so resolve through
 * the registry first, then fall back to the name-derived slug. null = no art.
 */
function artworkPath(weaponName) {
  const derived = weaponName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const slugs = [resolveName(weaponName), derived].filter(Boolean);
  for (const slug of slugs) {
    for (const ext of ['png', 'jpg']) {
      const p = path.join(WEAPONS_DIR, `${slug}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Build the weapon-info container (exported for tests). `artName` = attachment
 * filename to reference in the gallery, or null to skip the gallery section.
 */
function buildInfoContainer(w, weaponId, artName) {
  const icon = emojiForDisplay(w.name, TYPE_EMOJI[w.type] ?? '⚔️');
  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[w.tier] ?? TIER_COLOR.Common)
    .addTextDisplayComponents((td) =>
      td.setContent(`## ${icon} ${w.name} +${w.enhancement - 1}\n-# ${w.tier}`)
    )
    .addSeparatorComponents(sep);

  if (artName) {
    container
      .addMediaGalleryComponents((g) =>
        g.addItems((item) => item.setURL(`attachment://${artName}`))
      )
      .addSeparatorComponents(sep);
  }

  // Stats first, then the Passive section. Lore section ALWAYS renders —
  // muted placeholder when the column is empty (a DB value replaces it
  // automatically); the AI disclaimer sits below the lore, blank-line separated.
  const hasPassive = w.passive_name && w.passive_name.toLowerCase() !== 'none';
  const passiveBlock = hasPassive
    ? `**Passive — ${w.passive_name}**\n${w.passive_description}`
    : '**Passive**\n*No passive.*';
  const critTxt = Number(w.crit) > 0 ? ` · CRIT **${Number(w.crit).toFixed(1)}%**` : '';
  const bonusLine = w.bonus_dmg_pct
    ? `\n-# Bonus: +${Number(w.bonus_dmg_pct)}% DMG · +${Number(w.bonus_crit_dmg_pct)}% CRIT DMG`
    : '';
  const statsBlock =
    `ATK **${w.curr_atk}** · HP **${w.curr_hp}** · DEF **${w.curr_def}**${critTxt}${bonusLine}` +
    `\n\n${passiveBlock}`;

  container
    .addTextDisplayComponents((td) => td.setContent(statsBlock))
    .addSeparatorComponents(sep);

  const hasLore = typeof w.lore === 'string' && w.lore.trim().length > 0;
  const loreBlock = hasLore ? `*${w.lore.trim()}*` : '-# No lore recorded yet.';
  container
    .addTextDisplayComponents((td) => td.setContent(`${loreBlock}\n\n${AI_DISCLAIMER}`))
    .addSeparatorComponents(sep);

  container.addTextDisplayComponents((td) =>
    td.setContent(`-# 💡 \`crd enhance ${weaponId}\` ・ \`crd equip ${weaponId}\``)
  );
  return container;
}

// ── crd weapon info <weapon_id> ─────────────────────────────────────────────
async function info(message, weaponId) {
  if (!weaponId) {
    await reply(message, { content: 'Usage: `crd weapon info <weapon_id>`' });
    return;
  }
  weaponId = weaponId.toLowerCase();

  const { rows } = await pool.query(
    `SELECT uw.curr_atk, uw.curr_hp, uw.curr_def, uw.crit, uw.enhancement,
            uw.bonus_dmg_pct, uw.bonus_crit_dmg_pct,
            wr.name, wr.type, wr.tier, wr.passive_name, wr.passive_description, wr.lore
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
    [weaponId, message.author.id]
  );
  if (rows.length === 0) {
    // §7: same message whether the id is unknown or owned by someone else.
    await reply(message, { content: 'You don\'t own a weapon with that ID.' });
    return;
  }
  const w = rows[0];

  // Artwork centered on the wide grid canvas (skipped when missing/unloadable).
  const files = [];
  let artName = null;
  const art = artworkPath(w.name);
  if (art) {
    const buffer = await renderCenteredArt(art);
    if (buffer) {
      artName = 'weapon_art.png';
      files.push(new AttachmentBuilder(buffer, { name: artName }));
    }
  }

  const container = buildInfoContainer(w, weaponId, artName);
  await reply(message, { components: [container], files, flags: MessageFlags.IsComponentsV2 });
}

// ── dispatcher: crd weapon info <id> ────────────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd weapon info <weapon_id>`' });
}

module.exports = { execute, buildInfoContainer };

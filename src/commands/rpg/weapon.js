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
const { resolveName } = require('../../utils/emojis');
const { renderPortraitCard } = require('../../engine/renderPortraitCard');

const AI_DISCLAIMER = '-# Images are AI-generated interpretations and may not be accurate; used for in-game illustration only.';

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TIER_HEX = {
  Common: '#95a5a6', Rare: '#3498db', Mythic: '#9b59b6', Legendary: '#FFD700', Supreme: '#e74c3c',
};

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
 * Build the weapon-info payload: a single portrait card (art LEFT, name/tier/stats/
 * passive RIGHT) followed by lore + the AI disclaimer + action hints as text.
 */
async function buildInfoPayload(w, weaponId) {
  const hasPassive = w.passive_name && w.passive_name.toLowerCase() !== 'none';
  const statLines = [
    `ATK   ${w.curr_atk}`,
    `HP    ${w.curr_hp}`,
    `DEF   ${w.curr_def}`,
  ];
  if (Number(w.crit) > 0) statLines.push(`CRIT  ${Number(w.crit).toFixed(1)}%`);
  if (w.bonus_dmg_pct) {
    statLines.push(`Bonus +${Number(w.bonus_dmg_pct)}% DMG`);
  }

  const sections = [
    { heading: 'Stats', body: statLines.join('\n') },
    hasPassive
      ? { heading: `Passive — ${w.passive_name}`, body: w.passive_description }
      : { heading: 'Passive', body: 'No passive.', dim: true },
  ];

  const buffer = await renderPortraitCard({
    imagePath: artworkPath(w.name),
    accent: TIER_HEX[w.tier] || TIER_HEX.Common,
    title: `${w.name} +${w.enhancement - 1}`,
    subtitle: w.tier,
    sections,
  });
  const file = new AttachmentBuilder(buffer, { name: 'weapon_card.png' });

  const container = new ContainerBuilder()
    .setAccentColor(TIER_COLOR[w.tier] ?? TIER_COLOR.Common)
    .addMediaGalleryComponents((g) => g.addItems((item) => item.setURL('attachment://weapon_card.png')))
    .addSeparatorComponents(sep);

  const hasLore = typeof w.lore === 'string' && w.lore.trim().length > 0;
  const loreBlock = hasLore ? `*${w.lore.trim()}*` : '-# No lore recorded yet.';
  container
    .addTextDisplayComponents((td) => td.setContent(`${loreBlock}\n\n${AI_DISCLAIMER}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`-# 💡 \`crd enhance ${weaponId}\` ・ \`crd equip ${weaponId}\``)
    );

  return { components: [container], files: [file], flags: MessageFlags.IsComponentsV2 };
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

  const payload = await buildInfoPayload(rows[0], weaponId);
  await reply(message, payload);
}

// ── dispatcher: crd weapon info <id> ────────────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'info') return info(message, (args[1] || '').trim());
  await reply(message, { content: 'Usage: `crd weapon info <weapon_id>`' });
}

module.exports = { execute, buildInfoPayload };

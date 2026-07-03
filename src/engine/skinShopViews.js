'use strict';

/**
 * skinShopViews.js — shared Components-V2 views for the supporter skin UI
 * (Supporter-stage addendum2 + addendum3). Mirrors the deity-collection style:
 * paginated container, one category per page, locks/owned/equipped markers, emoji icons.
 *
 * Three contexts share one builder:
 *   ctx 'shop' → `crd shop`            (real, supporter-gated by the command)
 *   ctx 'dev'  → `crd dev supporter shop` (bypass gates, DEV marker; dev owns all via §4)
 *   ctx 'coll' → `crd skin collection`  (everyone; locks for unowned)
 *
 * Buying/equipping happens via commands (`crd buy <code>`, `crd use skin <code>`), so the
 * views carry only ◀ ▶ paging + a Preview button (addendum3) that opens an image carousel.
 *
 * customId schemes (owner-gated):
 *   sshop:<prev|next|preview>:<owner>:<page>:<ctx>
 *   sprev:<prev|next|back|toggle>:<owner>:<page>:<idx>:<ctx>:<var>   (var v|d|x)
 */

const {
  ContainerBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, MessageFlags,
} = require('discord.js');
const fs = require('fs');
const pool = require('../db/pool');
const { skinFilePath } = require('../config/cosmetics');
const ent = require('./supporterEntitlements');
const { skinEmojiByCode, iconToken, iconShop, iconSkins } = require('./skinEmojis');
const { smallDivider: sep } = require('../utils/componentsV2');
const { HELP_ICON } = require('./bagViews');
const { assetPath, attachmentSource, isRemoteAssetsEnabled } = require('../utils/assets');

const BRAND = 0x9b59b6;
const PAGES = ['profile', 'battle', 'battle_result', 'summon'];
const CAT_LABEL = { profile: 'Profile', battle: 'Battle', battle_result: 'Battle Result', summon: 'Summon' };

function clampPage(p) { return Math.min(Math.max(0, p | 0), PAGES.length - 1); }

// Collection ordering: Founder → Beta (tester default) → Base → shop skins
// (ascending by code) → other tester customs.
function collectionRank(s) {
  const k = s.cosmetic_key || '';
  if (k.startsWith('founder_')) return 0;
  if (k.startsWith('tester_default_')) return 1;
  if (s.is_base) return 2;
  if (ent.isShopCatalog(s)) return 3;
  return 4; // per-tester customs
}
function sortCollection(skins) {
  return skins.slice().sort((a, b) => {
    const ra = collectionRank(a), rb = collectionRank(b);
    if (ra !== rb) return ra - rb;
    const ca = (a.skin_code || a.display_name || '').toLowerCase();
    const cb = (b.skin_code || b.display_name || '').toLowerCase();
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

async function gather(db, viewerId, page, ctx = 'shop') {
  const category = PAGES[clampPage(page)];
  let skins = await ent.listActiveCatalog(db, category);
  // Shop/dev contexts only list purchasable store skins (+ free base); the collection shows
  // everything owned, including scope-owned tester defaults, per-tester customs, and founder set.
  if (ctx !== 'coll') skins = skins.filter((s) => s.is_base || ent.isShopCatalog(s));
  else skins = sortCollection(skins);
  const owned = await ent.ownedIdsResolved(db, viewerId);
  const equipped = await ent.getEquipped(db, viewerId);
  const sup = await ent.getSupporter(db, viewerId);
  return {
    category, skins, owned,
    equippedId: equipped[category]?.cosmetic_id ?? null,
    balance: sup ? sup.token_balance : 0,
  };
}

function skinRow(s, owned, equippedId, ctx) {
  const isOwned = owned.has(s.cosmetic_id);
  const emo = skinEmojiByCode(s.skin_code, s.category, s.cosmetic_key);
  const code = s.skin_code ? ` \`${s.skin_code}\`` : '';
  const lock = isOwned ? '' : ' 🔒';                 // ownership shown ONLY by the lock's absence
  const name = isOwned ? `**${s.display_name}**` : `*${s.display_name}*`;
  if (ctx === 'coll') {
    const eq = equippedId === s.cosmetic_id ? ' ✅' : ''; // ✅ marks the equipped skin only
    return `${emo} ${name}${code}${lock}${eq}`;
  }
  // shop / dev: display-only, ordered coin · price · id · skin-emoji · name (+lock).
  // Base skins are free → no coin/price segment.
  const price = s.is_base ? '' : `${iconToken()} ${s.token_cost} `;
  const idTxt = s.skin_code ? `\`${s.skin_code}\` ` : '';
  return `${price}${idTxt}${emo} ${name}${lock}`;
}

/** Paginated shop/collection page (one category). */
async function buildShopPage(db, viewerId, { page = 0, ctx = 'shop' } = {}) {
  page = clampPage(page);
  const { category, skins, owned, equippedId, balance } = await gather(db, viewerId, page, ctx);

  const container = new ContainerBuilder().setAccentColor(BRAND);
  const titleLine = ctx === 'coll'
    ? `## ${iconSkins()} <@${viewerId}>'s Skin Collection`
    : `## ${iconShop()} Supporter Shop`;
  const header = ctx === 'dev' ? `${titleLine}\n-# DEV MODE — access bypassed` : titleLine;
  container.addTextDisplayComponents((td) => td.setContent(header));
  container.addTextDisplayComponents((td) => td.setContent(
    ctx === 'coll'
      ? '-# Browse your skins. 🔒 = not owned yet — claim it in `crd shop`. ✅ = currently equipped.'
      : '-# Browse all supporter skins. 🔒 = not owned. Spend tokens to claim, then equip it.'
  ));
  container.addTextDisplayComponents((td) => td.setContent(`-# Page **${page + 1}/${PAGES.length}** · ${CAT_LABEL[category]} Skins`));
  container.addSeparatorComponents(sep);

  // Every collection page leads with the always-available Default (the shared default template /
  // built-in art). It's owned by everyone and is the reset target for `crd set all skin default`.
  // ✅ shows when this category is currently on default (nothing equipped here).
  const rows = skins.map((s) => skinRow(s, owned, equippedId, ctx));
  if (ctx === 'coll') {
    rows.unshift(`${iconSkins()} **Default** \`default\`${equippedId == null ? ' ✅' : ''}`);
  }
  container.addTextDisplayComponents((td) => td.setContent(
    rows.length ? rows.join('\n') : '*No skins in this category yet.*'
  ));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(`${iconToken()} Tokens: **${balance}**`));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    ctx === 'coll'
      ? '-# 💡 Equip: `crd equip skin p1` ・ Tester `pt1` ・ Base `pb` ・ Reset `crd set all skin default`'
      : '-# 💡 Buy: `crd buy p1` ・ Equip after: `crd equip skin p1` ・ Your skins: `crd skin collection`'
  ));
  container.addSeparatorComponents(sep);
  container.addActionRowComponents((row) => row.setComponents(
    new ButtonBuilder().setCustomId(`sshop:prev:${viewerId}:${page}:${ctx}`)
      .setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`sshop:next:${viewerId}:${page}:${ctx}`)
      .setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= PAGES.length - 1),
    new ButtonBuilder().setCustomId(`sshop:preview:${viewerId}:${page}:${ctx}`)
      .setEmoji(HELP_ICON).setLabel('Preview').setStyle(ButtonStyle.Primary).setDisabled(skins.length === 0),
  ));

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** Pick the image file for the preview (variant matters only for battle_result). */
function previewFile(skin, variant) {
  let rel;
  if (skin.category === 'battle_result') {
    rel = variant === 'v' ? skin.victory_filename
      : variant === 'd' ? skin.defeated_filename
        : (skin.display_filename || skin.victory_filename);
  } else {
    rel = skin.display_filename || skin.render_filename;
  }
  if (isRemoteAssetsEnabled()) {
    return rel && /\.(png|jpe?g|webp|gif)$/i.test(rel) ? assetPath(`skins/${rel}`) : null;
  }
  const abs = skinFilePath(rel);
  if (!abs || !fs.existsSync(abs) || !/\.(png|jpe?g|webp|gif)$/i.test(abs)) return null;
  return abs;
}

/** Image preview carousel for the current category (addendum3 §2). */
async function buildPreview(db, viewerId, { page = 0, idx = 0, ctx = 'shop', variant = 'x' } = {}) {
  page = clampPage(page);
  const { category, skins, owned, equippedId } = await gather(db, viewerId, page, ctx);
  if (skins.length === 0) return buildShopPage(db, viewerId, { page, ctx });
  idx = ((idx % skins.length) + skins.length) % skins.length; // wrap
  const skin = skins[idx];

  const emo = skinEmojiByCode(skin.skin_code, skin.category, skin.cosmetic_key);
  const codeTxt = skin.skin_code ? ` · \`${skin.skin_code}\`` : '';
  const isOwned = owned.has(skin.cosmetic_id);
  const ownedMark = ctx === 'coll'
    ? (equippedId === skin.cosmetic_id ? '✅ Equipped' : (isOwned ? '' : '🔒 locked'))
    : (isOwned ? '' : '🔒 locked');

  const help = ctx === 'coll'
    ? `Equip: \`crd equip skin ${skin.skin_code}\``
    : `Buy: \`crd buy ${skin.skin_code}\`  ·  Equip: \`crd equip skin ${skin.skin_code}\``;

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(`## ${emo} ${skin.display_name}${codeTxt}  ${ownedMark}`));
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(`-# ${help}`));
  container.addSeparatorComponents(sep);

  const files = [];
  const abs = previewFile(skin, variant);
  if (abs) {
    const name = `skinpv_${skin.cosmetic_id}_${variant}.${abs.split('.').pop()}`;
    files.push(new AttachmentBuilder(await attachmentSource(abs), { name }));
    container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(`attachment://${name}`)));
  } else {
    container.addTextDisplayComponents((td) => td.setContent('*No preview image available.*'));
  }

  // Buttons: Prev / Next (cycle category) / Back · result skins also get a Victory⇄Defeated toggle.
  const rowBtns = [
    new ButtonBuilder().setCustomId(`sprev:prev:${viewerId}:${page}:${idx}:${ctx}:${variant}`)
      .setEmoji('◀️').setLabel('Prev').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sprev:next:${viewerId}:${page}:${idx}:${ctx}:${variant}`)
      .setEmoji('▶️').setLabel('Next').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sprev:back:${viewerId}:${page}:${idx}:${ctx}:${variant}`)
      .setEmoji('↩️').setLabel('Back to list').setStyle(ButtonStyle.Primary),
  ];
  if (skin.category === 'battle_result') {
    const nextVar = variant === 'd' ? 'v' : 'd';
    rowBtns.push(new ButtonBuilder()
      .setCustomId(`sprev:toggle:${viewerId}:${page}:${idx}:${ctx}:${nextVar}`)
      .setLabel(variant === 'd' ? 'Show Victory' : 'Show Defeated').setStyle(ButtonStyle.Secondary));
  }
  container.addActionRowComponents((row) => row.setComponents(...rowBtns));

  return { components: [container], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function ownerGate(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    interaction.reply({ content: 'This isn\'t yours — run the command yourself!', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

// sshop:<prev|next|preview>:<owner>:<page>:<ctx>
async function handleShopButton(interaction) {
  const [, action, owner, pageStr, ctx] = interaction.customId.split(':');
  if (!ownerGate(interaction, owner)) return;
  await interaction.deferUpdate();
  const page = clampPage(parseInt(pageStr, 10) || 0);
  if (action === 'preview') {
    await interaction.editReply(await buildPreview(pool, owner, { page, idx: 0, ctx }));
    return;
  }
  const next = action === 'next' ? page + 1 : page - 1;
  await interaction.editReply(await buildShopPage(pool, owner, { page: next, ctx }));
}

// sprev:<prev|next|back|toggle>:<owner>:<page>:<idx>:<ctx>:<var>
async function handlePreviewButton(interaction) {
  const [, action, owner, pageStr, idxStr, ctx, variant] = interaction.customId.split(':');
  if (!ownerGate(interaction, owner)) return;
  await interaction.deferUpdate();
  const page = clampPage(parseInt(pageStr, 10) || 0);
  const idx = parseInt(idxStr, 10) || 0;
  if (action === 'back') {
    await interaction.editReply(await buildShopPage(pool, owner, { page, ctx }));
    return;
  }
  if (action === 'toggle') {
    await interaction.editReply(await buildPreview(pool, owner, { page, idx, ctx, variant }));
    return;
  }
  const nextIdx = action === 'next' ? idx + 1 : idx - 1;
  await interaction.editReply(await buildPreview(pool, owner, { page, idx: nextIdx, ctx, variant: 'x' }));
}

module.exports = { buildShopPage, buildPreview, handleShopButton, handlePreviewButton, PAGES };

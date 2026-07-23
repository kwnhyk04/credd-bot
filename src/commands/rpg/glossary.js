'use strict';

/**
 * `crd glossary` — reference codex (Ascension Patch §4). Embed/text only, NO
 * canvas: deity/gear art is served via the custom-emoji registry.
 *
 * Header dropdown picks the category (Deities / Weapons / Armors / Runes);
 * Previous/Next buttons page within it. Interaction namespace `gloss`:
 *   gloss:cat:<ownerId>              (select — value = category key)
 *   gloss:<prev|next>:<ownerId>:<cat>:<page>
 *
 * Deities: ONE MYTHOLOGY PER PAGE (same grouping as `crd deity collection`),
 * showing the FULLY-ASCENDED reference stats (100% base) and the blessing —
 * this is a codex, independent of what the viewer owns.
 * Weapons/Armors/Runes: up to 10 per page, tier-descending. Long entries reduce
 * the page size dynamically. Only is_available rows.
 */

const {
  ContainerBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { registerMemorySource } = require('../../utils/memoryRegistry');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');
const { TIER_ALIAS } = require('../../config/gachaRates');
const { RARITY_SYMBOLS } = require('../../engine/renderSummon');
const {
  TIER_RANGES, TYPE_PROFILES, BAND_FRACTIONS, SUPREME_STATS, GENESIS_STATS,
  ARMOR_TIER_RANGES, ARMOR_TYPE_PROFILES, SUPREME_ARMOR,
} = require('../../config/dropRates');
const { runeEmoji, runeDescription } = require('../../config/runes');

const BRAND = 0x9b59b6;
const PAGE_ENTRY_LIMIT = 10;
const PAGE_BODY_LIMIT = 3600;

const CATEGORIES = {
  deities: 'Deities',
  weapons: 'Weapons',
  armors: 'Armors',
  runes: 'Runes',
};

// Gear tier ordering (Genesis → Common); deity tiers order via the same CASE.
const GEAR_TIER_ORDER_SQL = `CASE tier
  WHEN 'Genesis' THEN 6 WHEN 'Supreme' THEN 5 WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 3
  WHEN 'Rare' THEN 2 WHEN 'Common' THEN 1 ELSE 0 END`;

const MYTHOLOGY_LABEL = { PH: 'Philippine Mythology', Norse: 'Norse Mythology', Greek: 'Greek Mythology' };

function reply(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [] },
  });
}

function splitBoundary(text, limit) {
  if (text.length <= limit) return text.length;
  const sample = text.slice(0, limit + 1);
  const boundaries = [];

  const paragraph = sample.lastIndexOf('\n\n', limit - 2);
  if (paragraph >= 0) boundaries.push(paragraph + 2);

  let sentence = 0;
  for (const match of sample.matchAll(/[.!?](?:["')\]]*)[ \t\r\n]+/g)) {
    const end = match.index + match[0].length;
    if (end <= limit) sentence = end;
  }
  if (sentence) boundaries.push(sentence);

  const newline = sample.lastIndexOf('\n', limit - 1);
  if (newline >= 0) boundaries.push(newline + 1);

  let whitespace = 0;
  for (const match of sample.matchAll(/\s+/g)) {
    const end = match.index + match[0].length;
    if (end <= limit) whitespace = end;
  }
  if (whitespace) boundaries.push(whitespace);

  const punctuation = Math.max(
    sample.lastIndexOf('-', limit - 1),
    sample.lastIndexOf('/', limit - 1),
    sample.lastIndexOf('_', limit - 1),
  );
  if (punctuation >= 0) boundaries.push(punctuation + 1);

  return boundaries.length ? Math.max(...boundaries) : limit;
}

function takeDescriptionChunk(text, limit) {
  if (limit < 1) throw new RangeError('Glossary description limit is too small');
  return text.slice(0, splitBoundary(text, limit));
}

function completeEntry(entry) {
  if (entry.description == null) return entry.leading;
  const label = entry.passiveName ? `${entry.passiveName}: ` : '';
  return `${entry.leading}\n-# ${label}${entry.description}`;
}

function splitOversizedEntry(entry, limit) {
  const pages = [];
  let remaining = entry.description;
  let continuation = false;

  while (remaining.length > 0) {
    const heading = entry.descriptionHeading || 'Passive Description';
    const subject = entry.passiveName ? ` (${entry.passiveName})` : '';
    const label = continuation
      ? `-# **${heading} — Continued${subject}**\n`
      : `-# **${heading}${subject}**\n`;
    const prefix = `${entry.leading}${continuation ? ' *(continued)*' : ''}\n${label}`;
    const chunk = takeDescriptionChunk(remaining, limit - prefix.length);
    pages.push(`${prefix}${chunk}`);
    remaining = remaining.slice(chunk.length);
    continuation = true;
  }
  return pages;
}

function paginateEntries(entries, {
  bodyLimit = PAGE_BODY_LIMIT,
  entryLimit = PAGE_ENTRY_LIMIT,
} = {}) {
  const pages = [];
  let current = [];
  let currentLength = 0;

  const flush = () => {
    if (!current.length) return;
    pages.push(current.join('\n\n'));
    current = [];
    currentLength = 0;
  };

  for (const entry of entries) {
    const text = completeEntry(entry);
    if (text.length > bodyLimit && entry.description != null) {
      flush();
      pages.push(...splitOversizedEntry(entry, bodyLimit));
      continue;
    }

    const separatorLength = current.length ? 2 : 0;
    if (current.length >= entryLimit
      || currentLength + separatorLength + text.length > bodyLimit) {
      flush();
    }
    current.push(text);
    currentLength += (current.length > 1 ? 2 : 0) + text.length;
  }
  flush();
  return pages.length ? pages : ['*Nothing recorded here yet.*'];
}

function circularPage(pages, page) {
  const totalPages = Math.max(1, pages.length);
  const p = ((page % totalPages) + totalPages) % totalPages;
  return { body: pages[p]?.body || pages[p] || '*Nothing recorded here yet.*', page: p, totalPages };
}

/** Banded [lo, hi] sub-window of a tier stat range (mirrors dropRates.bandedValue). */
function bandWindow(range, band) {
  const [min, max] = range;
  const [lo, hi] = BAND_FRACTIONS[band];
  return [Math.floor(min + lo * (max - min)), Math.floor(min + hi * (max - min))];
}

function fmtRange([lo, hi], suffix = '') {
  return lo === hi ? `${lo.toLocaleString()}${suffix}` : `${lo.toLocaleString()}–${hi.toLocaleString()}${suffix}`;
}

// ── page data ───────────────────────────────────────────────────────────────
// Deity pages remain grouped by mythology. A mythology only gains continuation
// pages when its complete blessing text cannot fit safely on one page.
let mythologyCache = null;
registerMemorySource('database.glossary-mythologies', () => ({
  entries: mythologyCache?.length || 0,
  fixedQueryResult: true,
}));
async function mythologies() {
  if (mythologyCache) return mythologyCache;
  const res = await pool.query(
    `SELECT mythology
       FROM deity_roster
      WHERE is_available = TRUE
      GROUP BY mythology
      ORDER BY MIN(deity_id)`
  );
  mythologyCache = res.rows.map((row) => row.mythology).filter(Boolean);
  return mythologyCache;
}

function deityEntries(rows) {
  return rows.map((d) => {
    const symbol = RARITY_SYMBOLS[TIER_ALIAS[d.tier]] ?? '◆';
    return {
      leading: `${symbol} ${emojiForDisplay(d.name, '🕯️')} **${d.name}** — ${TIER_ALIAS[d.tier]}\n` +
        `HP ${Number(d.base_hp).toLocaleString()} · ATK ${Number(d.base_atk).toLocaleString()} · DEF ${Number(d.base_def).toLocaleString()}`,
      passiveName: d.blessing_name,
      description: String(d.blessing_description || '').trim(),
    };
  });
}

async function deityPages() {
  const myths = await mythologies();
  const pages = [];
  for (const mythology of myths) {
    const { rows } = await pool.query(
      `SELECT name, tier, base_hp, base_atk, base_def, blessing_name, blessing_description
        FROM deity_roster
        WHERE is_available = TRUE AND mythology = $1
        ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC`,
      [mythology]
    );
    const label = MYTHOLOGY_LABEL[mythology] ?? `${mythology} Mythology`;
    const bodies = paginateEntries(deityEntries(rows), { entryLimit: Number.POSITIVE_INFINITY });
    pages.push(...bodies.map((body) => ({
      body,
      subtitle: `${label} — fully-ascended reference stats`,
    })));
  }
  return pages.length ? pages : [{ body: '*Nothing recorded here yet.*', subtitle: '—' }];
}

async function gearPages(kind) {
  const table = kind === 'weapons' ? 'weapon_roster' : 'armor_roster';
  const { rows } = await pool.query(
    `SELECT name, type, tier, passive_name, passive_description
       FROM ${table}
      WHERE is_available = TRUE
      ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC`
  );

  const entries = rows.map((g) => {
    const icon = emojiForDisplay(g.name, kind === 'weapons' ? '⚔️' : '🛡️');
    let statLine;
    if (kind === 'weapons') {
      if (g.tier === 'Genesis') {
        statLine = `ATK ${GENESIS_STATS.atk.toLocaleString()} · CRIT ${GENESIS_STATS.crit}% · +${GENESIS_STATS.bonus_dmg_pct}% DMG`;
      } else if (g.tier === 'Supreme') {
        statLine = `ATK ${SUPREME_STATS.atk.toLocaleString()} · CRIT ${SUPREME_STATS.crit}% · +${SUPREME_STATS.bonus_dmg_pct}% DMG`;
      } else {
        const range = TIER_RANGES[g.tier];
        const profile = TYPE_PROFILES[g.type];
        statLine = range && profile
          ? `ATK ${fmtRange(bandWindow(range.atk, profile.atk))} · CRIT ${fmtRange(bandWindow(range.crit, profile.crit), '%')}`
          : 'ATK — · CRIT —';
      }
    } else if (g.tier === 'Supreme') {
      const fixed = SUPREME_ARMOR[g.type];
      statLine = fixed
        ? `HP ${fixed.hp.toLocaleString()} · DEF ${fixed.def.toLocaleString()}`
        : 'HP — · DEF —';
    } else {
      const range = ARMOR_TIER_RANGES[g.tier];
      const profile = ARMOR_TYPE_PROFILES[g.type];
      statLine = range && profile
        ? `HP ${fmtRange(bandWindow(range.hp, profile.hp))} · DEF ${fmtRange(bandWindow(range.def, profile.def))}`
        : 'HP — · DEF —';
    }
    const leading = `${icon} **${g.name}** — ${g.tier}\n${statLine}`;
    return g.passive_name && g.passive_name.toLowerCase() !== 'none'
      ? {
        leading,
        passiveName: g.passive_name,
        description: String(g.passive_description || '').trim(),
      }
      : { leading: `${leading}\n-# No passive.`, description: null };
  });
  return paginateEntries(entries).map((body) => ({
    body,
    subtitle: 'Sorted by tier (highest first)',
  }));
}

async function runePages() {
  const { rows } = await pool.query(
    `SELECT name, effect_key, tier, value, description
       FROM rune_roster
      WHERE is_available = TRUE
      ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC`
  );
  const entries = rows.map((r) => ({
    leading: `${runeEmoji(r.effect_key)} **${r.name}** — ${r.tier}`,
    passiveName: null,
    descriptionHeading: 'Rune Description',
    description: runeDescription(r.effect_key, r.value, String(r.description || '').trim()),
  }));
  return paginateEntries(entries).map((body) => ({
    body,
    subtitle: 'Sorted by tier (highest first)',
  }));
}

async function fetchPage(cat, page) {
  const pages = cat === 'deities'
    ? await deityPages()
    : cat === 'runes'
      ? await runePages()
      : await gearPages(cat);
  const selected = circularPage(pages, page);
  return { ...selected, subtitle: pages[selected.page]?.subtitle || '—' };
}

// ── payload ─────────────────────────────────────────────────────────────────
function buildControls(cat, page, totalPages, ownerId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`gloss:cat:${ownerId}`)
    .setPlaceholder('Category')
    .addOptions(Object.entries(CATEGORIES).map(([value, label]) => ({
      label, value, default: value === cat,
    })));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gloss:prev:${ownerId}:${cat}:${page}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1),
    new ButtonBuilder()
      .setCustomId(`gloss:next:${ownerId}:${cat}:${page}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1),
  );
  return [new ActionRowBuilder().addComponents(select), buttons];
}

async function buildPayload(cat, page, ownerId) {
  const { body, subtitle, page: p, totalPages } = await fetchPage(cat, page);
  const [selectRow, buttonRow] = buildControls(cat, p, totalPages, ownerId);

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(
    `## 📖 Glossary — ${CATEGORIES[cat]}\n-# Page **${p + 1}/${totalPages}** — ${subtitle}`
  ));
  container.addActionRowComponents(() => selectRow);
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    body
  ));
  container.addSeparatorComponents(sep);
  container.addActionRowComponents(() => buttonRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

// ── command + interactions ──────────────────────────────────────────────────
async function execute(message, { args }) {
  const sub = (args[0] || '').toLowerCase();
  const cat = CATEGORIES[sub] ? sub : 'deities';
  await reply(message, await buildPayload(cat, 0, message.author.id));
}

/**
 * Select `gloss:cat:<ownerId>` and buttons `gloss:<prev|next>:<ownerId>:<cat>:<page>`.
 * Routed for both select-menu and button interactions.
 */
async function handleInteraction(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const ownerId = parts[2];

  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This glossary isn\'t yours — run `crd glossary` yourself!',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferUpdate();

  let cat = 'deities';
  let page = 0;
  if (action === 'cat') {
    cat = interaction.values?.[0] in CATEGORIES ? interaction.values[0] : 'deities';
  } else {
    cat = CATEGORIES[parts[3]] ? parts[3] : 'deities';
    const current = parseInt(parts[4], 10) || 0;
    // Carousel: pass the raw neighbor index; fetchPage wraps it with modulo so
    // Previous on page 0 lands on the last page and Next on the last wraps to 0.
    page = action === 'next' ? current + 1 : current - 1;
  }
  await interaction.editReply(await buildPayload(cat, page, ownerId));
}

module.exports = { execute, handleInteraction };
Object.assign(module.exports, {
  paginateEntries,
  splitBoundary,
  circularPage,
  PAGE_BODY_LIMIT,
  PAGE_ENTRY_LIMIT,
});

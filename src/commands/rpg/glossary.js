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
 * Weapons/Armors/Runes: 10 per page, tier-descending. Only is_available rows.
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
  TIER_RANGES, TYPE_PROFILES, BAND_FRACTIONS, SUPREME_STATS,
  ARMOR_TIER_RANGES, ARMOR_TYPE_PROFILES, SUPREME_ARMOR,
} = require('../../config/dropRates');
const { runeEmoji, runeDescription } = require('../../config/runes');

const BRAND = 0x9b59b6;
const PAGE_SIZE = 10;
const DESC_CAP = 180; // per-entry text cap keeps a full page inside Discord's CV2 budget

const CATEGORIES = {
  deities: 'Deities',
  weapons: 'Weapons',
  armors: 'Armors',
  runes: 'Runes',
};

// Gear tier ordering (Supreme → Common); deity tiers order via the same CASE.
const GEAR_TIER_ORDER_SQL = `CASE tier
  WHEN 'Supreme' THEN 5 WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 3
  WHEN 'Rare' THEN 2 WHEN 'Common' THEN 1 ELSE 0 END`;

const MYTHOLOGY_LABEL = { PH: 'Philippine Mythology', Norse: 'Norse Mythology', Greek: 'Greek Mythology' };

function reply(message, payload) {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false, parse: [] },
  });
}

function clip(text, cap = DESC_CAP) {
  const t = String(text || '').trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
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
let mythologyCache = null;
registerMemorySource('database.glossary-mythologies', () => ({
  entries: mythologyCache?.length || 0,
  fixedQueryResult: true,
}));
async function mythologies() {
  if (mythologyCache) return mythologyCache;
  const res = await pool.query(
    'SELECT mythology FROM deity_roster WHERE is_available = TRUE GROUP BY mythology ORDER BY MIN(deity_id)'
  );
  mythologyCache = res.rows.map((r) => r.mythology);
  return mythologyCache;
}

async function deityPage(page) {
  const myths = await mythologies();
  const totalPages = Math.max(1, myths.length);
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const mythology = myths[p] ?? null;
  if (mythology == null) return { entries: [], subtitle: '—', page: p, totalPages };

  const { rows } = await pool.query(
    `SELECT name, tier, base_hp, base_atk, base_def, blessing_name, blessing_description
       FROM deity_roster
      WHERE is_available = TRUE AND mythology = $1
      ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC`,
    [mythology]
  );
  // Fully-ascended reference stats = 100% base (§4).
  const entries = rows.map((d) => {
    const symbol = RARITY_SYMBOLS[TIER_ALIAS[d.tier]] ?? '◆';
    return `${symbol} ${emojiForDisplay(d.name, '🕯️')} **${d.name}** — ${TIER_ALIAS[d.tier]}\n` +
      `HP ${Number(d.base_hp).toLocaleString()} · ATK ${Number(d.base_atk).toLocaleString()} · DEF ${Number(d.base_def).toLocaleString()}\n` +
      `-# ${d.blessing_name}: ${clip(d.blessing_description)}`;
  });
  return {
    entries,
    subtitle: `${MYTHOLOGY_LABEL[mythology] ?? `${mythology} Mythology`} — fully-ascended reference stats`,
    page: p,
    totalPages,
  };
}

async function gearPage(kind, page) {
  const table = kind === 'weapons' ? 'weapon_roster' : 'armor_roster';
  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE is_available = TRUE`);
  const totalPages = Math.max(1, Math.ceil(countRes.rows[0].n / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const { rows } = await pool.query(
    `SELECT name, type, tier, passive_name, passive_description
       FROM ${table}
      WHERE is_available = TRUE
      ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC
      LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, p * PAGE_SIZE]
  );

  const entries = rows.map((g) => {
    const icon = emojiForDisplay(g.name, kind === 'weapons' ? '⚔️' : '🛡️');
    let statLine;
    if (kind === 'weapons') {
      if (g.tier === 'Supreme') {
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
    const passive = g.passive_name && g.passive_name.toLowerCase() !== 'none'
      ? `-# ${g.passive_name}: ${clip(g.passive_description)}`
      : '-# No passive.';
    return `${icon} **${g.name}** — ${g.tier}\n${statLine}\n${passive}`;
  });
  return { entries, subtitle: 'Sorted by tier (highest first)', page: p, totalPages };
}

async function runePage(page) {
  const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM rune_roster WHERE is_available = TRUE');
  const totalPages = Math.max(1, Math.ceil(countRes.rows[0].n / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const { rows } = await pool.query(
    `SELECT name, effect_key, tier, value, description
       FROM rune_roster
      WHERE is_available = TRUE
      ORDER BY ${GEAR_TIER_ORDER_SQL} DESC, name ASC
      LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, p * PAGE_SIZE]
  );
  const entries = rows.map((r) =>
    `${runeEmoji(r.effect_key)} **${r.name}** — ${r.tier}\n` +
    `-# ${runeDescription(r.effect_key, r.value, clip(r.description))}`
  );
  return { entries, subtitle: 'Sorted by tier (highest first)', page: p, totalPages };
}

async function fetchPage(cat, page) {
  if (cat === 'deities') return deityPage(page);
  if (cat === 'runes') return runePage(page);
  return gearPage(cat, page);
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
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`gloss:next:${ownerId}:${cat}:${page}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
  return [new ActionRowBuilder().addComponents(select), buttons];
}

async function buildPayload(cat, page, ownerId) {
  const { entries, subtitle, page: p, totalPages } = await fetchPage(cat, page);
  const [selectRow, buttonRow] = buildControls(cat, p, totalPages, ownerId);

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent(
    `## 📖 Glossary — ${CATEGORIES[cat]}\n-# Page **${p + 1}/${totalPages}** — ${subtitle}`
  ));
  container.addActionRowComponents(() => selectRow);
  container.addSeparatorComponents(sep);
  container.addTextDisplayComponents((td) => td.setContent(
    entries.length > 0 ? entries.join('\n\n') : '*Nothing recorded here yet.*'
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
    page = action === 'next' ? current + 1 : Math.max(0, current - 1);
  }
  await interaction.editReply(await buildPayload(cat, page, ownerId));
}

module.exports = { execute, handleInteraction };

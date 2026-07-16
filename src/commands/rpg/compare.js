'use strict';

/**
 * `crd compare weapon <id> <id> [id]` / `crd compare deity <name> <name> [name]`
 *
 * Side-by-side compare of 2–3 OWNED weapons or deities. Ownership-gated: if any listed item
 * isn't owned, the whole command is rejected and the offending item(s) are named. Duplicate
 * ids/names in one call are rejected. Emoji/tier/stats/passive come from the same roster
 * columns the glossary and info commands read (weapon_roster.passive_description /
 * deity_roster.blessing_description) — single source of truth — rendered in the glossary
 * 3-line entry style for visual consistency.
 */

const { MessageFlags, ContainerBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay, emoji } = require('../../utils/emojis');
const { displayEnhancement } = require('../../utils/enhancementFormat');
const { TIER_ALIAS } = require('../../config/gachaRates');
const { MAX_SIGILS } = require('../../config/ascension');
const { computeDeityProgressionStats } = require('../../engine/deityEnhancement');
const { DIVINE_BLESSING_DEITIES } = require('../../config/blessings');
const { fetchGear } = require('./equipment');

const BRAND = 0x5865f2;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

/** deity_roster ⟕ user_deities for one name; ud.* is null when the caller doesn't own it. */
async function fetchDeityRow(discordId, name) {
  const { rows } = await pool.query(
    `SELECT dr.deity_id, dr.name, dr.mythology, dr.tier, dr.base_hp, dr.base_atk, dr.base_def,
            dr.blessing_name, dr.blessing_description,
            ud.user_deity_id, ud.sigils, ud.ascended, ud.enhancement
       FROM deity_roster dr
       LEFT JOIN user_deities ud ON ud.deity_id = dr.deity_id AND ud.discord_id = $1
      WHERE LOWER(dr.name) = LOWER($2)`,
    [discordId, name],
  );
  return rows[0] || null;
}

/** 3-line entry body for an owned weapon (glossary gear-entry style). */
function weaponEntry(g) {
  const icon = emojiForDisplay(g.name, '⚔️');
  const line1 = `${icon} **${g.name}** — +${displayEnhancement(g.enhancement)} — ${g.tier}`;
  const stats = [
    `ATK ${Number(g.curr_atk || 0).toLocaleString()}`,
    `CRIT ${Number(g.crit || 0).toFixed(1)}%`,
  ];
  if (Number(g.bonus_dmg_pct || 0) > 0) stats.push(`+${Number(g.bonus_dmg_pct)}% DMG`);
  const hasPassive = g.passive_name && g.passive_name.toLowerCase() !== 'none';
  const passive = hasPassive
    ? `-# ${g.passive_name}: ${g.passive_description || 'No passive.'}`
    : '-# No passive.';
  return `${line1}\n${stats.join(' · ')}\n${passive}`;
}

/** 3-line entry body for an owned deity (glossary deity-entry style, owned stats). */
function deityEntry(d) {
  const icon = emojiForDisplay(d.name, '🕯️');
  const alias = TIER_ALIAS[d.tier] ?? d.tier;
  const sigils = Math.max(0, Math.min(MAX_SIGILS, Number(d.sigils) || 0));
  const ascended = Boolean(d.ascended);
  const ownTag = ascended
    ? 'Ascended ✦'
    : `${emoji(`${String(d.tier).toLowerCase()}_sigil`)} ${sigils}/${MAX_SIGILS}`;
  const line1 = `${icon} **${d.name}** — ${ownTag} — ${alias}`;
  const stats = computeDeityProgressionStats(d, { sigils, ascended, enhancement: d.enhancement });
  const statLine = `HP ${Number(stats.curr_hp).toLocaleString()} · ATK ${Number(stats.curr_atk).toLocaleString()} · DEF ${Number(stats.curr_def).toLocaleString()}`;
  const btype = DIVINE_BLESSING_DEITIES.has(d.name) ? 'Divine' : 'Echo';
  const passive = `-# ${btype} Blessing — ${d.blessing_name}: ${d.blessing_description || 'No blessing description.'}`;
  return `${line1}\n${statLine}\n${passive}`;
}

async function execute(message, { args }) {
  const mode = (args[0] || '').toLowerCase();
  const kind = (mode === 'weapon' || mode === 'weapons') ? 'weapon'
    : (mode === 'deity' || mode === 'deities') ? 'deity'
      : null;
  if (!kind) {
    return reply(message, {
      content: 'Usage: `crd compare weapon <id> <id> [id]` or `crd compare deity <name> <name> [name]`.',
    });
  }

  const rest = args.slice(1).filter((a) => a && a.length);
  if (rest.length < 2 || rest.length > 3) {
    return reply(message, { content: `Compare 2 or 3 ${kind}s — you listed ${rest.length}.` });
  }

  // Reject duplicates (case-insensitive) before any DB work.
  const seen = new Set();
  for (const token of rest) {
    const norm = token.toLowerCase();
    if (seen.has(norm)) {
      return reply(message, { content: `Duplicate ${kind} \`${token}\` — list each ${kind} only once.` });
    }
    seen.add(norm);
  }

  const discordId = message.author.id;
  const entries = [];
  const missing = [];
  for (const token of rest) {
    if (kind === 'weapon') {
      const g = await fetchGear(discordId, token.toLowerCase());
      if (!g || g.kind !== 'weapon') { missing.push(token); continue; }
      entries.push(weaponEntry(g));
    } else {
      const d = await fetchDeityRow(discordId, token);
      if (!d || d.user_deity_id == null) { missing.push(token); continue; }
      entries.push(deityEntry(d));
    }
  }

  // Reject the whole command if any item isn't owned, naming the offenders.
  if (missing.length) {
    const verb = kind === 'weapon' ? 'own' : 'have';
    const named = missing.map((m) => `\`${m}\``).join(', ');
    return reply(message, {
      content: `You don't ${verb} ${named} — comparison cancelled (you must ${verb} every ${kind} listed).`,
    });
  }

  const container = new ContainerBuilder().setAccentColor(BRAND);
  container.addTextDisplayComponents((td) => td.setContent('## Comparison'));
  for (const body of entries) {
    container.addSeparatorComponents(sep).addTextDisplayComponents((td) => td.setContent(body));
  }
  return reply(message, { components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = { execute };

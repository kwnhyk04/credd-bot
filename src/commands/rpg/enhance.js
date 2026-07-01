'use strict';

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, ComponentType,
} = require('discord.js');
const pool = require('../../db/pool');
const {
  ENHANCEABLE_TIERS,
  computeWeaponStats,
  computeArmorStats,
  nextAttempt,
} = require('../../engine/enhancement');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay, emoji } = require('../../utils/emojis');
const { progressQuests } = require('../../utils/questProgress');

// TODO Phase-rep: grant +50 reputation on enhance (§18), 5,000/day cap — wire when awardReputation
//   is extracted to a shared util (do not duplicate cap/rollover logic)

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Bow: '🏹' };
const ARMOR_TYPE_EMOJI = { Heavy: '🛡️', Medium: '🥋', Light: '🧥' };
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/** Type icon for a normalized gear row (weapon or armor). */
function gearIcon(g) {
  const fallback = g.kind === 'armor' ? (ARMOR_TYPE_EMOJI[g.type] ?? '🛡️') : (TYPE_EMOJI[g.type] ?? '⚔️');
  return emojiForDisplay(g.name, fallback);
}

/** Stat line for the CURRENT stored stats — weapon → ATK, armor → HP · DEF. */
function statLine(g) {
  return g.kind === 'armor'
    ? `HP **${g.curr_hp}** · DEF **${g.curr_def}**`
    : `ATK **${g.curr_atk}**`;
}

/** Stat line for a previewed enhancement level (computed). */
function previewLine(g, level) {
  if (g.kind === 'armor') {
    const s = computeArmorStats(g, level);
    return `HP ${s.curr_hp} · DEF ${s.curr_def}`;
  }
  const s = computeWeaponStats(g, level);
  return `ATK ${s.curr_atk}`;
}

/**
 * Live forge data: gear (weapon then armor) + owner credux, or null if not owned.
 * Returns a normalized row with `kind` and the relevant base/curr stat columns.
 */
async function fetchForgeData(discordId, gearId) {
  const w = await pool.query(
    `SELECT uw.enhancement, uw.base_atk, uw.curr_atk, uw.crit,
            wr.name, wr.tier, wr.type, ub.credux
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
       JOIN users_bag ub ON ub.discord_id = uw.discord_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
    [gearId, discordId]
  );
  if (w.rows[0]) return { kind: 'weapon', ...w.rows[0] };

  const a = await pool.query(
    `SELECT ua.enhancement, ua.base_hp, ua.base_def, ua.curr_hp, ua.curr_def,
            ar.name, ar.tier, ar.type, ub.credux
       FROM user_armors ua
       JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
       JOIN users_bag ub ON ub.discord_id = ua.discord_id
      WHERE ua.armor_id = $1 AND ua.discord_id = $2`,
    [gearId, discordId]
  );
  if (a.rows[0]) return { kind: 'armor', ...a.rows[0] };

  return null;
}

function footerCredux(credux) {
  return `-# ${emoji('credux_coin')} Credux: **${Number(credux).toLocaleString()}**`;
}

/**
 * Append the next-level section (or maxed / not-enhanceable note).
 * Returns whether the Enhance button should be ENABLED.
 */
function addNextSection(container, g) {
  if (!ENHANCEABLE_TIERS.includes(g.tier)) {
    container.addTextDisplayComponents((td) => td.setContent(`${g.tier} gear cannot be enhanced.`));
    return false;
  }
  const next = nextAttempt(g.tier, g.enhancement);
  if (next == null) {
    container.addTextDisplayComponents((td) => td.setContent('-# Maximum enhancement reached'));
    return false;
  }
  container.addTextDisplayComponents((td) =>
    td.setContent(
      `**Next: +${next.targetLevel}**\n` +
      `Cost: **${next.cost.toLocaleString()}** Credux · Success: **${Math.round(next.successRate * 100)}%**\n` +
      `-# On success → ${previewLine(g, g.enhancement + 1)}`
    )
  );
  return Number(g.credux) >= next.cost;
}

function forgeButtonsRow(gearId, discordId, enhanceEnabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`enhance:attempt:${gearId}:${discordId}`)
      .setLabel('🔨 Enhance')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enhanceEnabled),
    new ButtonBuilder()
      .setCustomId(`enhance:cancel:${gearId}:${discordId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Forge view (CLAUDE.md container standard): header → separator → current
 * stats → separator → next-level block → separator → Credux footer (+ buttons).
 */
function buildForgePayload(g, gearId, discordId, { resultLine = null, color = null, buttons = true } = {}) {
  const display = g.enhancement - 1;
  const icon = gearIcon(g);

  const container = new ContainerBuilder()
    .setAccentColor(color ?? (TIER_COLOR[g.tier] || TIER_COLOR.Common))
    .addTextDisplayComponents((td) =>
      td.setContent(`## 🔨 Forge — ${icon} ${g.name} (${g.tier}) +${display}`)
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`**Current Stats**\n${statLine(g)}`)
    )
    .addSeparatorComponents(sep);

  const enhanceEnabled = addNextSection(container, g);

  if (resultLine) {
    container.addSeparatorComponents(sep);
    container.addTextDisplayComponents((td) => td.setContent(resultLine));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(footerCredux(g.credux)));

  const components = [container];
  if (buttons) components.push(forgeButtonsRow(gearId, discordId, enhanceEnabled));
  return { components, flags: MessageFlags.IsComponentsV2 };
}

/**
 * Verdict + next-step preview in one (continuous forging): buttons stay live
 * so attempts can chain on the same message.
 */
function buildResolvedPayload(g, gearId, discordId, result) {
  const icon = gearIcon(g);
  const header = result.success
    ? `## ✅ Forge Success — ${icon} ${g.name} +${result.newEnhancement - 2} → +${result.newEnhancement - 1}`
    : `## ❌ Forge Failed — ${icon} ${g.name} remains +${g.enhancement - 1}`;
  const stats = result.success
    ? `**Resulting Stats**\n${statLine(g)}`
    : `**Current Stats**\n${statLine(g)}\n` +
      `-# Materials consumed: ${emoji('credux_coin')} −${result.cost.toLocaleString()} Credux`;

  const container = new ContainerBuilder()
    .setAccentColor(result.success ? GREEN : RED)
    .addTextDisplayComponents((td) => td.setContent(header))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(stats))
    .addSeparatorComponents(sep);

  const enhanceEnabled = addNextSection(container, g);

  if (result.questNotices && result.questNotices.length) {
    container
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(result.questNotices.map((n) => `-# ${n}`).join('\n')));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(footerCredux(g.credux)));

  return {
    components: [container, forgeButtonsRow(gearId, discordId, enhanceEnabled)],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Minimal container for terminal notices on a CV2 message (content is not allowed). */
function notePayload(text, color = RED) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents((td) => td.setContent(text));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * `crd enhance <id>` — open a forge view for a weapon OR armor (Master §7 / [v5]).
 * Each Enhance click is one atomic txn; the message resolves to a result card.
 */
async function execute(message, { args }) {
  const gearId = (args[0] || '').trim().toLowerCase();
  if (!gearId) {
    await reply(message, { content: 'Usage: `crd enhance <id>`' });
    return;
  }

  const g = await fetchForgeData(message.author.id, gearId);
  if (!g) {
    await reply(message, { content: 'You don\'t own equipment with that ID.' });
    return;
  }
  await reply(message, buildForgePayload(g, gearId, message.author.id));
}

/**
 * One atomic enhancement attempt. Deducts Credux on BOTH success and failure (§7).
 * id-detects weapon (scales ATK) vs armor (scales HP/DEF); both use the boost table.
 * Lock order: users_bag → gear table (standardized across enhance/sell).
 */
async function attemptEnhance(client, discordId, gearId) {
  await client.query('BEGIN');

  const bagRes = await client.query(
    'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE',
    [discordId]
  );
  if (bagRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }
  const creduxBefore = Number(bagRes.rows[0].credux);

  // Weapon first.
  let kind = 'weapon';
  let gRes = await client.query(
    `SELECT uw.enhancement, uw.base_atk, wr.tier, wr.name
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2
      FOR UPDATE OF uw`,
    [gearId, discordId]
  );
  if (gRes.rows.length === 0) {
    kind = 'armor';
    gRes = await client.query(
      `SELECT ua.enhancement, ua.base_hp, ua.base_def, ar.tier, ar.name
         FROM user_armors ua
         JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
        WHERE ua.armor_id = $1 AND ua.discord_id = $2
        FOR UPDATE OF ua`,
      [gearId, discordId]
    );
  }
  if (gRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }
  const g = gRes.rows[0];

  if (!ENHANCEABLE_TIERS.includes(g.tier)) {
    await client.query('ROLLBACK');
    return { status: 'not_enhanceable', tier: g.tier };
  }
  const next = nextAttempt(g.tier, g.enhancement);
  if (next == null) {
    await client.query('ROLLBACK');
    return { status: 'maxed' };
  }
  if (creduxBefore < next.cost) {
    await client.query('ROLLBACK');
    return { status: 'insufficient', cost: next.cost, credux: creduxBefore };
  }

  const success = Math.random() < next.successRate;
  const creduxAfter = creduxBefore - next.cost;

  await client.query(
    'UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1',
    [discordId, next.cost]
  );

  let newEnhancement = g.enhancement;
  if (success) {
    newEnhancement = g.enhancement + 1;
    if (kind === 'weapon') {
      const s = computeWeaponStats(g, newEnhancement);
      await client.query(
        'UPDATE user_weapons SET enhancement = $2, curr_atk = $3 WHERE weapon_id = $1',
        [gearId, newEnhancement, s.curr_atk]
      );
    } else {
      const s = computeArmorStats(g, newEnhancement);
      await client.query(
        'UPDATE user_armors SET enhancement = $2, curr_hp = $3, curr_def = $4 WHERE armor_id = $1',
        [gearId, newEnhancement, s.curr_hp, s.curr_def]
      );
    }
  }

  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type, previous_credux, updated_credux)
     VALUES ($1, 'Enhance', $2, $3, $4)`,
    [discordId, g.tier, creduxBefore, creduxAfter]
  );

  // daily-quest progress (§20) — every attempt counts (credux_spent stored in thousands;
  // cost is always a clean ×1,000) and gear enhancements by one.
  const questNotices = await progressQuests(client, discordId, {
    credux_spent: next.cost / 1000,
    weapon_enhancements: 1,
  });

  await client.query('COMMIT');
  return {
    status: 'done',
    success,
    name: g.name,
    targetLevel: next.targetLevel,
    cost: next.cost,
    newEnhancement,
    questNotices,
  };
}

/** Button: enhance:attempt:<gearId>:<uid> */
async function handleAttempt(interaction, gearId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  let client;
  let result;
  try {
    client = await pool.connect();
    result = await attemptEnhance(client, ownerId, gearId);
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[enhance] attempt failed:', err.message);
    await interaction.followUp({ content: 'Something went wrong. No Credux was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  } finally {
    if (client) client.release();
  }

  try {
  if (result.status === 'notfound') {
    await interaction.editReply(notePayload('This equipment is no longer in your bag.'));
    return;
  }
  if (result.status === 'not_enhanceable') {
    await interaction.followUp({ content: `${result.tier} gear cannot be enhanced.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const g = await fetchForgeData(ownerId, gearId);
  if (!g) {
    await interaction.editReply(notePayload('This equipment is no longer in your bag.'));
    return;
  }

  if (result.status === 'insufficient') {
    const resultLine = `❌ Not enough Credux — need **${result.cost.toLocaleString()}**, you have **${result.credux.toLocaleString()}**.`;
    await interaction.editReply(buildForgePayload(g, gearId, ownerId, { resultLine, color: RED }));
    return;
  }
  if (result.status === 'maxed') {
    await interaction.editReply(buildForgePayload(g, gearId, ownerId, { resultLine: 'This equipment is already maxed (+10).' }));
    return;
  }

  await interaction.editReply(buildResolvedPayload(g, gearId, ownerId, result));
  } catch (err) {
    console.error('[enhance] result refresh failed:', err.message);
    const note = result.status === 'done'
      ? 'Enhancement result was processed, but the forge view could not refresh. Run `crd enhance <id>` again to continue.'
      : 'Forge view could not refresh. Run `crd enhance <id>` again to reload it.';
    await interaction.editReply(notePayload(note)).catch(() => {});
    await interaction.followUp({
      content: 'Forge view refresh failed. Run `crd enhance <id>` again before making another attempt.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

/** Button: enhance:cancel:<gearId>:<uid> — drop the buttons, keep the last view as-is. */
async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const keep = interaction.message.components
    .filter((c) => c.type !== ComponentType.ActionRow)
    .map((c) => c.toJSON());
  await interaction.editReply({ components: keep, flags: MessageFlags.IsComponentsV2 });
}

module.exports = { execute, handleAttempt, handleCancel, buildForgePayload, buildResolvedPayload };

'use strict';

const {
  ContainerBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags, ComponentType,
} = require('discord.js');
const pool = require('../../db/pool');
const {
  MAX_ENHANCEMENT,
  ENHANCEABLE_TIERS,
  computeWeaponStats,
  nextAttempt,
} = require('../../engine/enhancement');
const { emojiForDisplay, emoji } = require('../../utils/emojis');

// TODO Phase-rep: grant +50 reputation on enhance (§18), 5,000/day cap — wire when awardReputation
//   is extracted to a shared util (do not duplicate cap/rollover logic)

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/** Live forge data: weapon + owner credux, or null if not owned. */
async function fetchForgeData(discordId, weaponId) {
  const { rows } = await pool.query(
    `SELECT uw.enhancement, uw.base_atk, uw.base_hp, uw.base_def,
            uw.curr_atk, uw.curr_hp, uw.curr_def, uw.crit,
            wr.name, wr.tier, wr.type,
            ub.credux
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
       JOIN users_bag ub ON ub.discord_id = uw.discord_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
    [weaponId, discordId]
  );
  return rows[0] ?? null;
}

function footerCredux(credux) {
  return `-# ${emoji('credux_coin')} Credux: **${Number(credux).toLocaleString()}**`;
}

/**
 * Append the next-level section (or maxed / not-enhanceable note).
 * Returns whether the Enhance button should be ENABLED: false when maxed or
 * not enhanceable; affordability also disables it (section stays visible).
 * Render-side only — every click still re-validates server-side in the txn.
 */
function addNextSection(container, w) {
  if (!ENHANCEABLE_TIERS.includes(w.tier)) {
    container.addTextDisplayComponents((td) => td.setContent(`${w.tier} weapons cannot be enhanced.`));
    return false;
  }
  const next = nextAttempt(w.tier, w.enhancement);
  if (next == null) {
    container.addTextDisplayComponents((td) => td.setContent('-# Maximum enhancement reached'));
    return false;
  }
  const preview = computeWeaponStats(w, w.enhancement + 1);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      `**Next: +${next.targetLevel}**\n` +
      `Cost: **${next.cost.toLocaleString()}** Credux · Success: **${Math.round(next.successRate * 100)}%**\n` +
      `-# On success → ATK ${preview.curr_atk} · HP ${preview.curr_hp} · DEF ${preview.curr_def}`
    )
  );
  return Number(w.credux) >= next.cost;
}

function forgeButtonsRow(weaponId, discordId, enhanceEnabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`enhance:attempt:${weaponId}:${discordId}`)
      .setLabel('🔨 Enhance')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!enhanceEnabled),
    new ButtonBuilder()
      .setCustomId(`enhance:cancel:${weaponId}:${discordId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Forge view (CLAUDE.md container standard): header → separator → current
 * stats → separator → next-level block → separator → Credux footer (+ buttons).
 */
function buildForgePayload(w, weaponId, discordId, { resultLine = null, color = null, buttons = true } = {}) {
  const display = w.enhancement - 1;
  const icon = emojiForDisplay(w.name, TYPE_EMOJI[w.type] ?? '⚔️');

  const container = new ContainerBuilder()
    .setAccentColor(color ?? (TIER_COLOR[w.tier] || TIER_COLOR.Common))
    .addTextDisplayComponents((td) =>
      td.setContent(`## 🔨 Forge — ${icon} ${w.name} (${w.tier}) +${display}`)
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent(`**Current Stats**\nATK **${w.curr_atk}** · HP **${w.curr_hp}** · DEF **${w.curr_def}**`)
    )
    .addSeparatorComponents(sep);

  const enhanceEnabled = addNextSection(container, w);

  if (resultLine) {
    container.addSeparatorComponents(sep);
    container.addTextDisplayComponents((td) => td.setContent(resultLine));
  }

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(footerCredux(w.credux)));

  const components = [container];
  if (buttons) components.push(forgeButtonsRow(weaponId, discordId, enhanceEnabled));
  return { components, flags: MessageFlags.IsComponentsV2 };
}

/**
 * Verdict + next-step preview in one (continuous forging): buttons stay live
 * so attempts can chain on the same message.
 *   ✅ Forge Success — <Name> +n → +n+1   body: resulting stats
 *   ❌ Forge Failed — <Name> remains +n   body: current stats + consumed note
 * then the SAME next-level section as the initial view (for the new level),
 * Credux footer with the updated balance, Enhance disabled when maxed or
 * unaffordable.
 */
function buildResolvedPayload(w, weaponId, discordId, result) {
  const icon = emojiForDisplay(w.name, TYPE_EMOJI[w.type] ?? '⚔️');
  const header = result.success
    ? `## ✅ Forge Success — ${icon} ${w.name} +${result.newEnhancement - 2} → +${result.newEnhancement - 1}`
    : `## ❌ Forge Failed — ${icon} ${w.name} remains +${w.enhancement - 1}`;
  const stats = result.success
    ? `**Resulting Stats**\nATK **${w.curr_atk}** · HP **${w.curr_hp}** · DEF **${w.curr_def}**`
    : `**Current Stats**\nATK **${w.curr_atk}** · HP **${w.curr_hp}** · DEF **${w.curr_def}**\n` +
      `-# Materials consumed: ${emoji('credux_coin')} −${result.cost.toLocaleString()} Credux`;

  const container = new ContainerBuilder()
    .setAccentColor(result.success ? GREEN : RED)
    .addTextDisplayComponents((td) => td.setContent(header))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(stats))
    .addSeparatorComponents(sep);

  const enhanceEnabled = addNextSection(container, w);

  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(footerCredux(w.credux)));

  return {
    components: [container, forgeButtonsRow(weaponId, discordId, enhanceEnabled)],
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
 * `crd enhance <weapon_id>` — open a forge view (Master §7).
 * Each Enhance click is one atomic txn; the message resolves to a result card.
 */
async function execute(message, { args }) {
  const weaponId = (args[0] || '').trim().toLowerCase();
  if (!weaponId) {
    await reply(message, { content: 'Usage: `crd enhance <weapon_id>`' });
    return;
  }

  const w = await fetchForgeData(message.author.id, weaponId);
  if (!w) {
    await reply(message, { content: 'You don\'t own a weapon with that ID.' });
    return;
  }
  await reply(message, buildForgePayload(w, weaponId, message.author.id));
}

/**
 * One atomic enhancement attempt. Deducts Credux on BOTH success and failure
 * (§7). On success: bump enhancement + recompute curr_* via the boost table.
 * Lock order: users_bag → user_weapons (standardized across enhance/sell).
 * Returns a tagged result object; throws only on unexpected DB failure (→ ROLLBACK).
 */
async function attemptEnhance(client, discordId, weaponId) {
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

  const wRes = await client.query(
    `SELECT uw.enhancement, uw.base_atk, uw.base_hp, uw.base_def, wr.tier, wr.name
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2
      FOR UPDATE OF uw`,
    [weaponId, discordId]
  );
  if (wRes.rows.length === 0) {
    await client.query('ROLLBACK');
    return { status: 'notfound' };
  }
  const w = wRes.rows[0];

  if (!ENHANCEABLE_TIERS.includes(w.tier)) {
    await client.query('ROLLBACK');
    return { status: 'not_enhanceable', tier: w.tier };
  }
  const next = nextAttempt(w.tier, w.enhancement);
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

  let newEnhancement = w.enhancement;
  if (success) {
    newEnhancement = w.enhancement + 1;
    const stats = computeWeaponStats(w, newEnhancement);
    await client.query(
      `UPDATE user_weapons
          SET enhancement = $2, curr_atk = $3, curr_hp = $4, curr_def = $5
        WHERE weapon_id = $1`,
      [weaponId, newEnhancement, stats.curr_atk, stats.curr_hp, stats.curr_def]
    );
  }

  await client.query(
    `INSERT INTO game_logs (discord_id, action, item_type, previous_credux, updated_credux)
     VALUES ($1, 'Enhance', $2, $3, $4)`,
    [discordId, w.tier, creduxBefore, creduxAfter]
  );

  await client.query('COMMIT');
  return {
    status: 'done',
    success,
    name: w.name,
    targetLevel: next.targetLevel,
    cost: next.cost,
    newEnhancement,
  };
}

/** Button: enhance:attempt:<weaponId>:<uid> */
async function handleAttempt(interaction, weaponId, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }

  const client = await pool.connect();
  let result;
  try {
    result = await attemptEnhance(client, ownerId, weaponId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[enhance] attempt failed:', err.message);
    await interaction.reply({ content: 'Something went wrong. No Credux was spent.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  } finally {
    client.release();
  }

  // Weapon vanished (sold/deleted mid-session) → close the forge.
  if (result.status === 'notfound') {
    await interaction.update(notePayload('This weapon is no longer in your bag.'));
    return;
  }
  if (result.status === 'not_enhanceable') {
    await interaction.reply({ content: `${result.tier} weapons cannot be enhanced.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const w = await fetchForgeData(ownerId, weaponId);
  if (!w) {
    await interaction.update(notePayload('This weapon is no longer in your bag.'));
    return;
  }

  // Insufficient Credux → red forge view in place, buttons stay live.
  if (result.status === 'insufficient') {
    const resultLine = `❌ Not enough Credux — need **${result.cost.toLocaleString()}**, you have **${result.credux.toLocaleString()}**.`;
    await interaction.update(buildForgePayload(w, weaponId, ownerId, { resultLine, color: RED }));
    return;
  }
  if (result.status === 'maxed') {
    await interaction.update(buildForgePayload(w, weaponId, ownerId, { resultLine: 'This weapon is already maxed (+10).' }));
    return;
  }

  // status === 'done' → verdict + next-step preview, buttons stay live (chaining).
  await interaction.update(buildResolvedPayload(w, weaponId, ownerId, result));
}

/** Button: enhance:cancel:<weaponId>:<uid> — drop the buttons, keep the last view as-is. */
async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Strip action rows from the CURRENT message so the last verdict stays visible.
  const keep = interaction.message.components
    .filter((c) => c.type !== ComponentType.ActionRow)
    .map((c) => c.toJSON());
  await interaction.update({ components: keep, flags: MessageFlags.IsComponentsV2 });
}

module.exports = { execute, handleAttempt, handleCancel, buildForgePayload, buildResolvedPayload };

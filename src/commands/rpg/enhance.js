'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const pool = require('../../db/pool');
const {
  MAX_ENHANCEMENT,
  ENHANCEABLE_TIERS,
  computeWeaponStats,
  nextAttempt,
} = require('../../engine/enhancement');

// TODO Phase-rep: grant +50 reputation on enhance (§18), 5,000/day cap — wire when awardReputation
//   is extracted to a shared util (do not duplicate cap/rollover logic)

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};

function reply(message, payload) {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}

/**
 * Read a weapon + owner credux and build the forge view (embed + buttons).
 * Returns { found:false } if the weapon no longer belongs to the player.
 * `resultLine` is an optional banner from the last attempt.
 */
async function buildForgeView(discordId, weaponId, { resultLine = null, color = null } = {}) {
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
  if (rows.length === 0) return { found: false };

  const w = rows[0];
  const display = w.enhancement - 1;
  const credux = Number(w.credux);
  const embed = new EmbedBuilder()
    .setColor(color ?? (TIER_COLOR[w.tier] || TIER_COLOR.Common))
    .setTitle(`🔨 Forge — ${w.name} (${w.tier}) +${display}`)
    .addFields({
      name: 'Current Stats',
      value: `ATK ${w.curr_atk} · HP ${w.curr_hp} · DEF ${w.curr_def}`,
      inline: false,
    });

  const maxed = w.enhancement >= MAX_ENHANCEMENT;
  const enhanceable = ENHANCEABLE_TIERS.includes(w.tier);
  const next = enhanceable ? nextAttempt(w.tier, w.enhancement) : null;

  if (!enhanceable) {
    embed.addFields({ name: 'Enhancement', value: `${w.tier} weapons cannot be enhanced.`, inline: false });
  } else if (maxed) {
    embed.addFields({ name: 'Enhancement', value: 'Fully enhanced (+10) — this weapon is maxed.', inline: false });
  } else {
    const preview = computeWeaponStats(w, w.enhancement + 1);
    embed.addFields({
      name: `Next: +${next.targetLevel}`,
      value:
        `Cost: **${next.cost.toLocaleString()}** Credux · Success: **${Math.round(next.successRate * 100)}%**\n` +
        `On success → ATK ${preview.curr_atk} · HP ${preview.curr_hp} · DEF ${preview.curr_def}`,
      inline: false,
    });
  }

  if (resultLine) embed.addFields({ name: 'Result', value: resultLine, inline: false });
  embed.setFooter({ text: `Your Credux: ${credux.toLocaleString()}` });

  const canEnhance = enhanceable && !maxed;
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`enhance:attempt:${weaponId}:${discordId}`)
      .setLabel('🔨 Enhance')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canEnhance),
    new ButtonBuilder()
      .setCustomId(`enhance:cancel:${weaponId}:${discordId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  )];

  return { found: true, embed, components };
}

/**
 * `crd enhance <weapon_id>` — open a continuous forge session (Master §7).
 * Buttons persist after each attempt; each Enhance click is one atomic txn.
 */
async function execute(message, { args }) {
  const weaponId = (args[0] || '').trim().toLowerCase();
  if (!weaponId) {
    await reply(message, { content: 'Usage: `crd enhance <weapon_id>`' });
    return;
  }

  const view = await buildForgeView(message.author.id, weaponId);
  if (!view.found) {
    await reply(message, { content: 'You don\'t own a weapon with that ID.' });
    return;
  }
  await reply(message, { embeds: [view.embed], components: view.components });
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
    await interaction.reply({ content: 'This forge isn\'t yours.', ephemeral: true });
    return;
  }

  const client = await pool.connect();
  let result;
  try {
    result = await attemptEnhance(client, ownerId, weaponId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[enhance] attempt failed:', err.message);
    await interaction.reply({ content: 'Something went wrong. No Credux was spent.', ephemeral: true }).catch(() => {});
    return;
  } finally {
    client.release();
  }

  // Insufficient Credux → update the forge IN PLACE (red + Result), buttons stay
  // live so the user can Cancel or retry. No spend, no game_logs (already rolled back).
  if (result.status === 'insufficient') {
    const resultLine = `❌ Not enough Credux — need **${result.cost.toLocaleString()}**, you have **${result.credux.toLocaleString()}**.`;
    const view = await buildForgeView(ownerId, weaponId, { resultLine, color: 0xe74c3c });
    if (!view.found) {
      await interaction.update({ content: 'This weapon is no longer in your bag.', embeds: [], components: [] });
      return;
    }
    await interaction.update({ embeds: [view.embed], components: view.components });
    return;
  }
  if (result.status === 'not_enhanceable') {
    await interaction.reply({ content: `${result.tier} weapons cannot be enhanced.`, ephemeral: true });
    return;
  }

  // Weapon vanished (sold/deleted mid-session) → close the forge.
  if (result.status === 'notfound') {
    await interaction.update({
      content: 'This weapon is no longer in your bag.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (result.status === 'maxed') {
    const view = await buildForgeView(ownerId, weaponId, { resultLine: 'This weapon is already maxed (+10).' });
    if (!view.found) {
      await interaction.update({ content: 'This weapon is no longer in your bag.', embeds: [], components: [] });
      return;
    }
    await interaction.update({ embeds: [view.embed], components: view.components });
    return;
  }

  // status === 'done'
  const resultLine = result.success
    ? `✅ **Success!** ${result.name} is now **+${result.newEnhancement - 1}**. (−${result.cost.toLocaleString()} Credux)`
    : `❌ **Failed** at +${result.targetLevel}. Weapon unchanged. (−${result.cost.toLocaleString()} Credux)`;

  const view = await buildForgeView(ownerId, weaponId, { resultLine });
  if (!view.found) {
    await interaction.update({ content: 'This weapon is no longer in your bag.', embeds: [], components: [] });
    return;
  }
  await interaction.update({ embeds: [view.embed], components: view.components });
}

/** Button: enhance:cancel:<weaponId>:<uid> */
async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This forge isn\'t yours.', ephemeral: true });
    return;
  }
  const original = interaction.message.embeds[0];
  await interaction.update({
    embeds: original ? [original] : [],
    components: [],
  });
}

module.exports = { execute, handleAttempt, handleCancel };

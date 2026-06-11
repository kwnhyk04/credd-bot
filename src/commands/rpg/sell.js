'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const pool = require('../../db/pool');
const { SELL_PRICES, TIER_ALIASES, ALL_EXCLUDED_TIERS } = require('../../config/sellPrices');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

function sumPrices(rows) {
  return rows.reduce((s, r) => s + (SELL_PRICES[r.tier] || 0), 0);
}

/**
 * Resolve the exact set of weapons a sell would delete. Excludes locked and
 * equipped weapons always; `all` additionally excludes Legendary + Supreme.
 * Reads equipped first, then user_weapons — callers that need users_bag locked
 * MUST lock it before invoking this (lock order: users_bag → user_weapons).
 * @param executor pool (read-only prompt) or in-txn client (forUpdate:true)
 * @returns {{equipped:string|null, rows:{weapon_id:string,tier:string}[]}}
 */
async function resolveSellSet(executor, discordId, { mode, arg, forUpdate = false }) {
  const eqRes = await executor.query(
    'SELECT equipped_weapon_id FROM user_character WHERE discord_id = $1',
    [discordId]
  );
  const equipped = eqRes.rows[0]?.equipped_weapon_id ?? null;

  const params = [discordId, equipped];
  let clause;
  if (mode === 'id') {
    params.push(arg);
    clause = `AND uw.weapon_id = $${params.length}`;
  } else if (mode === 'tier') {
    params.push(arg);
    clause = `AND wr.tier = $${params.length}`;
  } else { // all
    params.push(ALL_EXCLUDED_TIERS);
    clause = `AND wr.tier <> ALL($${params.length}::text[])`;
  }

  const { rows } = await executor.query(
    `SELECT uw.weapon_id, wr.tier
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.discord_id = $1
        AND uw.is_locked = FALSE
        AND uw.weapon_id IS DISTINCT FROM $2
        ${clause}
      ${forUpdate ? 'FOR UPDATE OF uw' : ''}`,
    params
  );
  return { equipped, rows };
}

/**
 * `crd sell <weapon_id | tier | all>` (Master §22) — permanent deletion.
 * Shows a plain-text Confirm/Cancel safeguard; the actual delete + Credux
 * credit runs atomically on Confirm (recomputing the set).
 */
async function execute(message, { args }) {
  const target = (args[0] || '').trim().toLowerCase();
  if (!target) {
    await reply(message, 'Usage: `crd sell <weapon_id | common|rare|mythic|legendary|supreme | all>`');
    return;
  }

  const discordId = message.author.id;
  let mode, arg;
  if (target === 'all') {
    mode = 'all'; arg = '-';
  } else if (TIER_ALIASES[target]) {
    mode = 'tier'; arg = TIER_ALIASES[target];
  } else {
    mode = 'id'; arg = target;
  }

  let count, total, descLine;

  if (mode === 'id') {
    // Specific, friendly rejections for the single-weapon path.
    const { rows } = await pool.query(
      `SELECT uw.is_locked, uw.enhancement, wr.name, wr.tier,
              (uw.weapon_id = uc.equipped_weapon_id) AS equipped
         FROM user_weapons uw
         JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
         JOIN user_character uc ON uc.discord_id = uw.discord_id
        WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
      [arg, discordId]
    );
    if (rows.length === 0) {
      await reply(message, 'You don\'t own a weapon with that ID.');
      return;
    }
    const w = rows[0];
    if (w.equipped) {
      await reply(message, 'That weapon is equipped. Unequip it first.');
      return;
    }
    if (w.is_locked) {
      await reply(message, 'That weapon is locked. Unlock it first.');
      return;
    }
    count = 1;
    total = SELL_PRICES[w.tier] || 0;
    descLine = `**${w.name}** (${w.tier}) +${w.enhancement - 1}`;
  } else {
    const { rows } = await resolveSellSet(pool, discordId, { mode, arg });
    if (rows.length === 0) {
      await reply(message, mode === 'tier'
        ? `You have no unlocked, unequipped ${arg} weapons to sell.`
        : 'You have no weapons to sell (Legendary and Supreme must be sold by ID).');
      return;
    }
    count = rows.length;
    total = sumPrices(rows);
    const noun = count === 1 ? 'weapon' : 'weapons';
    descLine = mode === 'tier' ? `**${count}** ${arg} ${noun}` : `**${count}** ${noun}`;
  }

  const subject = count === 1 ? 'it' : 'them';
  const content =
    `⚠️ Sell ${descLine} for **${total.toLocaleString()} Credux**? ` +
    `This will **permanently delete** ${subject} and cannot be undone. Locked and equipped weapons are excluded.`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sell:confirm:${mode}:${arg}:${discordId}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`sell:cancel:${discordId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary),
  );

  await message.reply({ content, components: [row], allowedMentions: { repliedUser: false } });
}

/** Button: sell:confirm:<mode>:<arg>:<uid> — recompute the set, then delete atomically. */
async function handleConfirm(interaction, mode, arg, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This confirmation isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }

  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');

    // Lock order: users_bag → user_weapons (standardized across enhance/sell).
    const bagRes = await client.query(
      'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [ownerId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      outcome = { status: 'nobag' };
    } else {
      const { rows } = await resolveSellSet(client, ownerId, { mode, arg, forUpdate: true });
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        outcome = { status: 'empty' };
      } else {
        const creduxBefore = Number(bagRes.rows[0].credux);
        const total = sumPrices(rows);
        const creduxAfter = creduxBefore + total;
        const ids = rows.map(r => r.weapon_id);
        // item_type: sold weapon's tier for id, the tier for tier, 'all' for all.
        const itemType = mode === 'all' ? 'all' : (mode === 'tier' ? arg : rows[0].tier);

        await client.query('DELETE FROM user_weapons WHERE weapon_id = ANY($1::varchar[])', [ids]);
        await client.query('UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1', [ownerId, total]);
        await client.query(
          `INSERT INTO game_logs (discord_id, action, item_type, previous_credux, updated_credux)
           VALUES ($1, 'Sell Weapon', $2, $3, $4)`,
          [ownerId, itemType, creduxBefore, creduxAfter]
        );

        await client.query('COMMIT');
        outcome = { status: 'done', count: rows.length, total };
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[sell] confirm failed:', err.message);
    outcome = { status: 'error' };
  } finally {
    client.release();
  }

  if (outcome.status === 'done') {
    const noun = outcome.count === 1 ? 'weapon' : 'weapons';
    await interaction.update({
      content: `✅ Sold **${outcome.count}** ${noun} for **${outcome.total.toLocaleString()} Credux**.`,
      components: [],
    });
    return;
  }
  if (outcome.status === 'empty') {
    await interaction.update({ content: 'Nothing to sell — your bag changed since the prompt.', components: [] });
    return;
  }
  if (outcome.status === 'nobag') {
    await interaction.update({ content: 'You don\'t have a bag.', components: [] });
    return;
  }
  await interaction.update({ content: 'Something went wrong. No weapons were sold.', components: [] }).catch(() => {});
}

/** Button: sell:cancel:<uid> */
async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This confirmation isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update({ content: 'Cancelled — nothing was sold.', components: [] });
}

module.exports = { execute, handleConfirm, handleCancel };

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const pool = require('../../db/pool');
const { SELL_PRICES, TIER_ALIASES, ALL_EXCLUDED_TIERS } = require('../../config/sellPrices');
const { RUNE_SELL_PRICE } = require('../../config/runes');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * [v5 §2.6] Sell a single rune by uid (immediate, no confirm dialog — a rune is
 * one item). Blocks locked or socketed runes. Returns true if it handled `arg`.
 */
async function trySellRune(message, discordId, arg) {
  const r = await pool.query(
    `SELECT ur.is_locked, ur.socketed_into, rn.name, rn.tier
       FROM user_runes ur JOIN rune_roster rn ON ur.rune_id = rn.rune_id
      WHERE ur.rune_uid = $1 AND ur.discord_id = $2`,
    [arg, discordId]
  );
  if (r.rows.length === 0) return false;
  const rune = r.rows[0];
  if (rune.is_locked) { await reply(message, 'That rune is locked. Unlock it first.'); return true; }
  if (rune.socketed_into) { await reply(message, `That rune is socketed into \`${rune.socketed_into}\`. Unsocket it first.`); return true; }
  const price = RUNE_SELL_PRICE[rune.tier] || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]);
    const del = await client.query(
      'DELETE FROM user_runes WHERE rune_uid = $1 AND discord_id = $2 AND is_locked = FALSE AND socketed_into IS NULL',
      [arg, discordId]
    );
    if (del.rowCount === 0) { await client.query('ROLLBACK'); await reply(message, 'That rune is no longer sellable.'); return true; }
    await client.query('UPDATE users_bag SET credux = credux + $2, lifetime_credux_earned = lifetime_credux_earned + $2 WHERE discord_id = $1', [discordId, price]);
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type) VALUES ($1, 'Sell Rune', $2)`,
      [discordId, rune.tier]
    );
    await client.query('COMMIT');
    await reply(message, `✅ Sold **${rune.name}** rune (${rune.tier}) for **${price.toLocaleString()} Credux**.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[sell rune]', err.message);
    await reply(message, 'Something went wrong selling the rune.');
  } finally {
    client.release();
  }
  return true;
}

function sumPrices(rows) {
  return rows.reduce((s, r) => s + (SELL_PRICES[r.tier] || 0), 0);
}

/**
 * [v5] Resolve the exact set of GEAR (weapons + armor) a sell would delete.
 * Excludes locked and equipped gear always; `all` additionally excludes Legendary +
 * Supreme. Reads equipped first, then both gear tables — callers that need users_bag
 * locked MUST lock it before invoking this (lock order: users_bag → gear tables).
 * @param executor pool (read-only prompt) or in-txn client (forUpdate:true)
 * @returns {{equippedW:string|null, equippedA:string|null,
 *            rows:{gear_id:string,tier:string,kind:'weapon'|'armor'}[]}}
 */
async function resolveSellSet(executor, discordId, { mode, arg, forUpdate = false }) {
  const eqRes = await executor.query(
    'SELECT equipped_weapon_id, equipped_armor_id FROM user_character WHERE discord_id = $1',
    [discordId]
  );
  const equippedW = eqRes.rows[0]?.equipped_weapon_id ?? null;
  const equippedA = eqRes.rows[0]?.equipped_armor_id ?? null;

  const rows = [];

  // weapons
  {
    const params = [discordId, equippedW];
    let clause;
    if (mode === 'id') { params.push(arg); clause = `AND uw.weapon_id = $${params.length}`; }
    else if (mode === 'tier') { params.push(arg); clause = `AND wr.tier = $${params.length}`; }
    else { params.push(ALL_EXCLUDED_TIERS); clause = `AND wr.tier <> ALL($${params.length}::text[])`; }
    const r = await executor.query(
      `SELECT uw.weapon_id AS gear_id, wr.tier, 'weapon' AS kind
         FROM user_weapons uw
         JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
        WHERE uw.discord_id = $1
          AND uw.is_locked = FALSE
          AND uw.weapon_id IS DISTINCT FROM $2
          ${clause}
        ${forUpdate ? 'FOR UPDATE OF uw' : ''}`,
      params
    );
    rows.push(...r.rows);
  }

  // armors
  {
    const params = [discordId, equippedA];
    let clause;
    if (mode === 'id') { params.push(arg); clause = `AND ua.armor_id = $${params.length}`; }
    else if (mode === 'tier') { params.push(arg); clause = `AND ar.tier = $${params.length}`; }
    else { params.push(ALL_EXCLUDED_TIERS); clause = `AND ar.tier <> ALL($${params.length}::text[])`; }
    const r = await executor.query(
      `SELECT ua.armor_id AS gear_id, ar.tier, 'armor' AS kind
         FROM user_armors ua
         JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
        WHERE ua.discord_id = $1
          AND ua.is_locked = FALSE
          AND ua.armor_id IS DISTINCT FROM $2
          ${clause}
        ${forUpdate ? 'FOR UPDATE OF ua' : ''}`,
      params
    );
    rows.push(...r.rows);
  }

  return { equippedW, equippedA, rows };
}

/**
 * `crd sell <weapon_id | tier | all>` (Master §22) — permanent deletion.
 * Shows a plain-text Confirm/Cancel safeguard; the actual delete + Credux
 * credit runs atomically on Confirm (recomputing the set).
 */
async function execute(message, { args }) {
  const target = (args[0] || '').trim().toLowerCase();
  if (!target) {
    await reply(message, 'Usage: `crd sell <id | common|rare|mythic|legendary|supreme | all>`');
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
    // Rune first (own namespace, immediate sell). Then gear (weapon then armor).
    if (await trySellRune(message, discordId, arg)) return;
    // Specific, friendly rejections for the single-gear path (weapon then armor).
    const wq = await pool.query(
      `SELECT uw.is_locked, uw.enhancement, wr.name, wr.tier,
              (uw.weapon_id = uc.equipped_weapon_id) AS equipped
         FROM user_weapons uw
         JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
         JOIN user_character uc ON uc.discord_id = uw.discord_id
        WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
      [arg, discordId]
    );
    const aq = wq.rows.length === 0 ? await pool.query(
      `SELECT ua.is_locked, ua.enhancement, ar.name, ar.tier,
              (ua.armor_id = uc.equipped_armor_id) AS equipped
         FROM user_armors ua
         JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
         JOIN user_character uc ON uc.discord_id = ua.discord_id
        WHERE ua.armor_id = $1 AND ua.discord_id = $2`,
      [arg, discordId]
    ) : { rows: [] };
    const g = wq.rows[0] || aq.rows[0];
    if (!g) {
      await reply(message, 'You don\'t own equipment with that ID.');
      return;
    }
    if (g.equipped) {
      await reply(message, 'That equipment is equipped. Unequip it first.');
      return;
    }
    if (g.is_locked) {
      await reply(message, 'That equipment is locked. Unlock it first.');
      return;
    }
    count = 1;
    total = SELL_PRICES[g.tier] || 0;
    descLine = `**${g.name}** (${g.tier}) +${g.enhancement - 1}`;
  } else {
    const { rows } = await resolveSellSet(pool, discordId, { mode, arg });
    if (rows.length === 0) {
      await reply(message, mode === 'tier'
        ? `You have no unlocked, unequipped ${arg} gear to sell.`
        : 'You have no gear to sell (Legendary and Supreme must be sold by ID).');
      return;
    }
    count = rows.length;
    total = sumPrices(rows);
    const noun = count === 1 ? 'item' : 'items';
    descLine = mode === 'tier' ? `**${count}** ${arg} ${noun}` : `**${count}** ${noun}`;
  }

  const subject = count === 1 ? 'it' : 'them';
  const content =
    `⚠️ Sell ${descLine} for **${total.toLocaleString()} Credux**? ` +
    `This will **permanently delete** ${subject} and cannot be undone. Locked and equipped gear is excluded.`;

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

  await interaction.deferUpdate();
  let client;
  let outcome;
  try {
    client = await pool.connect();
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
        const weaponIds = rows.filter((r) => r.kind === 'weapon').map((r) => r.gear_id);
        const armorIds = rows.filter((r) => r.kind === 'armor').map((r) => r.gear_id);
        // item_type: sold gear's tier for id, the tier for tier, 'all' for all.
        const itemType = mode === 'all' ? 'all' : (mode === 'tier' ? arg : rows[0].tier);

        if (weaponIds.length) await client.query('DELETE FROM user_weapons WHERE weapon_id = ANY($1::varchar[])', [weaponIds]);
        if (armorIds.length) await client.query('DELETE FROM user_armors WHERE armor_id = ANY($1::varchar[])', [armorIds]);
        await client.query('UPDATE users_bag SET credux = credux + $2, lifetime_credux_earned = lifetime_credux_earned + $2 WHERE discord_id = $1', [ownerId, total]);
        await client.query(
          `INSERT INTO game_logs (discord_id, action, item_type, previous_credux, updated_credux)
           VALUES ($1, 'Sell Gear', $2, $3, $4)`,
          [ownerId, itemType, creduxBefore, creduxAfter]
        );

        await client.query('COMMIT');
        outcome = { status: 'done', count: rows.length, total };
      }
    }
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[sell] confirm failed:', err.message);
    outcome = { status: 'error' };
  } finally {
    if (client) client.release();
  }

  try {
  if (outcome.status === 'done') {
    const noun = outcome.count === 1 ? 'item' : 'items';
    await interaction.editReply({
      content: `✅ Sold **${outcome.count}** ${noun} for **${outcome.total.toLocaleString()} Credux**.`,
      components: [],
    });
    return;
  }
  if (outcome.status === 'empty') {
    await interaction.editReply({ content: 'Nothing to sell — your bag changed since the prompt.', components: [] });
    return;
  }
  if (outcome.status === 'nobag') {
    await interaction.editReply({ content: 'You don\'t have a bag.', components: [] });
    return;
  }
  await interaction.editReply({ content: 'Something went wrong. No weapons were sold.', components: [] });
  } catch (err) {
    console.error('[sell] confirm refresh failed:', err.message);
    await interaction.followUp({
      content: outcome.status === 'done'
        ? 'Sale completed, but the confirmation message could not refresh.'
        : 'Sale confirmation failed to refresh. Check your bag before trying again.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

/** Button: sell:cancel:<uid> */
async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This confirmation isn\'t yours.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply({ content: 'Cancelled — nothing was sold.', components: [] });
}

module.exports = { execute, handleConfirm, handleCancel };

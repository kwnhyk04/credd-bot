'use strict';

/**
 * socket.js - Phase 2 §2.4 socketing commands.
 *   crd socket <gear_id> <rune_uid> <slot#> - slot a rune into a native slot
 *   crd unsocket <gear_id> <slot#>          - remove a rune, including legacy opposite slots
 *
 * Opposite socket unlocks/socketing are disabled for now. Existing opposite
 * slots can still be unsocketed so player runes are not trapped.
 */

const pool = require('../../db/pool');
const { UNSOCKET_COST, runeDescription } = require('../../config/runes');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

const LANES = {
  weapon: { native: 'offense', opposite: 'defense' },
  armor: { native: 'defense', opposite: 'offense' },
};

async function loadGear(client, discordId, gearId) {
  const w = await client.query(
    `SELECT uw.weapon_id AS id, 'weapon' AS kind, wr.name, wr.tier,
            uw.native_sockets, uw.opposite_sockets
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2
      FOR UPDATE OF uw`,
    [gearId, discordId]
  );
  if (w.rows.length) return w.rows[0];

  const a = await client.query(
    `SELECT ua.armor_id AS id, 'armor' AS kind, ar.name, ar.tier,
            ua.native_sockets, ua.opposite_sockets
       FROM user_armors ua
       JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
      WHERE ua.armor_id = $1 AND ua.discord_id = $2
      FOR UPDATE OF ua`,
    [gearId, discordId]
  );
  return a.rows[0] || null;
}

function gearTable(kind) {
  return kind === 'weapon' ? 'user_weapons' : 'user_armors';
}

function gearIdCol(kind) {
  return kind === 'weapon' ? 'weapon_id' : 'armor_id';
}

function locateSlot(gear, slotNum) {
  const native = Array.isArray(gear.native_sockets) ? gear.native_sockets : [];
  const opposite = Array.isArray(gear.opposite_sockets) ? gear.opposite_sockets : [];
  const lanes = LANES[gear.kind];

  if (slotNum >= 1 && slotNum <= native.length) {
    return { array: 'native', index: slotNum - 1, lane: lanes.native };
  }

  const oppNum = slotNum - native.length;
  if (oppNum >= 1 && oppNum <= opposite.length) {
    return { array: 'opposite', index: oppNum - 1, lane: lanes.opposite };
  }

  return null;
}

async function writeSockets(client, gear, which, arr) {
  const col = which === 'native' ? 'native_sockets' : 'opposite_sockets';
  await client.query(
    `UPDATE ${gearTable(gear.kind)}
        SET ${col} = $2::jsonb
      WHERE ${gearIdCol(gear.kind)} = $1`,
    [gear.id, JSON.stringify(arr)]
  );
}

async function socket(message, { args }) {
  const gearId = (args[0] || '').trim().toLowerCase();
  const runeUid = (args[1] || '').trim().toLowerCase();
  const slotNum = parseInt(args[2], 10);
  if (!gearId || !runeUid || !Number.isInteger(slotNum)) {
    return reply(message, 'Usage: `crd socket <gear_id> <rune_uid> <slot#>`');
  }

  const discordId = message.author.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const gear = await loadGear(client, discordId, gearId);
    if (!gear) {
      await client.query('ROLLBACK');
      return reply(message, 'You do not own equipment with that ID.');
    }

    const loc = locateSlot(gear, slotNum);
    if (!loc) {
      await client.query('ROLLBACK');
      return reply(message, `Slot ${slotNum} does not exist on this gear.`);
    }
    if (loc.array === 'opposite') {
      await client.query('ROLLBACK');
      return reply(message, 'Opposite rune sockets are disabled for now. Use a native socket slot.');
    }

    const arr = gear.native_sockets || [];
    if (arr[loc.index].rune_uid) {
      await client.query('ROLLBACK');
      return reply(message, `Slot ${slotNum} is already filled. \`crd unsocket ${gearId} ${slotNum}\` first.`);
    }

    const rr = await client.query(
      `SELECT ur.rune_uid, ur.socketed_into, ur.is_locked,
              rn.name, rn.lane, rn.tier, rn.effect_key,
              COALESCE(ur.rolled_value, rn.value) AS value,
              rn.description
         FROM user_runes ur
         JOIN rune_roster rn ON ur.rune_id = rn.rune_id
        WHERE ur.rune_uid = $1 AND ur.discord_id = $2
        FOR UPDATE OF ur`,
      [runeUid, discordId]
    );
    if (rr.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'You do not own a rune with that uid.');
    }

    const rune = rr.rows[0];
    if (rune.socketed_into) {
      await client.query('ROLLBACK');
      return reply(message, `That rune is already socketed into \`${rune.socketed_into}\`.`);
    }
    if (rune.lane !== loc.lane) {
      await client.query('ROLLBACK');
      return reply(message, `Lane mismatch: slot ${slotNum} is **${loc.lane}**, but ${rune.name} is **${rune.lane}**.`);
    }

    arr[loc.index].rune_uid = runeUid;
    await writeSockets(client, gear, 'native', arr);
    await client.query(
      'UPDATE user_runes SET socketed_into = $2 WHERE rune_uid = $1 AND discord_id = $3',
      [runeUid, gear.id, discordId]
    );
    await client.query('COMMIT');
    return reply(message, `Socketed **${rune.name}** (${rune.tier}, ${runeDescription(rune.effect_key, rune.value, rune.description)}) into **${gear.name}** slot ${slotNum}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[socket]', err.message);
    return reply(message, 'Socketing failed; nothing changed.');
  } finally {
    client.release();
  }
}

async function unsocket(message, { args }) {
  const gearId = (args[0] || '').trim().toLowerCase();
  const slotNum = parseInt(args[1], 10);
  if (!gearId || !Number.isInteger(slotNum)) {
    return reply(message, 'Usage: `crd unsocket <gear_id> <slot#>`');
  }

  const discordId = message.author.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const bag = await client.query('SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]);
    if (bag.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'You need a bag before unsocketing runes.');
    }

    const gear = await loadGear(client, discordId, gearId);
    if (!gear) {
      await client.query('ROLLBACK');
      return reply(message, 'You do not own equipment with that ID.');
    }

    const loc = locateSlot(gear, slotNum);
    if (!loc) {
      await client.query('ROLLBACK');
      return reply(message, `Slot ${slotNum} does not exist on this gear.`);
    }

    const arr = loc.array === 'native'
      ? (gear.native_sockets || [])
      : (gear.opposite_sockets || []);
    const runeUid = arr[loc.index].rune_uid;
    if (!runeUid) {
      await client.query('ROLLBACK');
      return reply(message, `Slot ${slotNum} is already empty.`);
    }

    const rr = await client.query(
      `SELECT rn.name, rn.tier
         FROM user_runes ur
         JOIN rune_roster rn ON ur.rune_id = rn.rune_id
        WHERE ur.rune_uid = $1
          AND ur.discord_id = $2
        FOR UPDATE OF ur`,
      [runeUid, discordId]
    );
    if (rr.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, 'This socket references a rune you do not own. Nothing changed.');
    }

    const rune = rr.rows[0];
    const cost = UNSOCKET_COST[rune.tier] ?? 5000;

    if (Number(bag.rows[0].credux) < cost) {
      await client.query('ROLLBACK');
      return reply(message, `Unsocketing a ${rune.tier} rune costs ${cost.toLocaleString()} Credux; you do not have enough.`);
    }

    arr[loc.index].rune_uid = null;
    await writeSockets(client, gear, loc.array, arr);
    await client.query('UPDATE user_runes SET socketed_into = NULL WHERE rune_uid = $1 AND discord_id = $2', [runeUid, discordId]);
    await client.query('UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1', [discordId, cost]);
    await client.query('COMMIT');
    return reply(message, `Removed **${rune.name}** from slot ${slotNum} (-${cost.toLocaleString()} Credux). Rune returned to your bag.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[unsocket]', err.message);
    return reply(message, 'Unsocketing failed; nothing changed.');
  } finally {
    client.release();
  }
}

async function unlockSocket(message, args) {
  const gearId = (args[1] || '').trim().toLowerCase();
  if (!gearId) return reply(message, 'Usage: `crd unlock socket <gear_id>`');
  return reply(message, 'Opposite rune socket unlocks are disabled for now. They will return in a future update.');
}

module.exports = { socket, unsocket, unlockSocket };

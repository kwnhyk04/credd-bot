'use strict';

/**
 * socket.js — Phase 2 §2.4/§2.5 socketing commands.
 *   crd socket <gear_id> <rune_uid> <slot#>   — slot a rune (lane must match)
 *   crd unsocket <gear_id> <slot#>             — remove (Credux cost, rune returned)
 *   crd unlock socket <gear_id>                — buy next opposite slot (called from lock.js)
 *
 * Slot numbering is GLOBAL per gear: native slots are 1..N, opposite slots are
 * N+1..N+M (in array order). Lane is implicit by which array a slot lives in
 * (Naming Conv §5): weapon native=offense/opposite=defense; armor native=defense
 * /opposite=offense. Socketing validates rune.lane === slot lane.
 */

const pool = require('../../db/pool');
const { UNSOCKET_COST } = require('../../config/runes');

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

// Gear kind → { native lane, opposite lane }.
const LANES = {
  weapon: { native: 'offense', opposite: 'defense' },
  armor:  { native: 'defense', opposite: 'offense' },
};

/** Load a gear row (weapon then armor) owned by discordId, with socket arrays + tier. */
async function loadGear(client, discordId, gearId) {
  const w = await client.query(
    `SELECT uw.weapon_id AS id, 'weapon' AS kind, wr.name, wr.tier,
            uw.native_sockets, uw.opposite_sockets
       FROM user_weapons uw JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2 FOR UPDATE OF uw`,
    [gearId, discordId]
  );
  if (w.rows.length) return w.rows[0];
  const a = await client.query(
    `SELECT ua.armor_id AS id, 'armor' AS kind, ar.name, ar.tier,
            ua.native_sockets, ua.opposite_sockets
       FROM user_armors ua JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
      WHERE ua.armor_id = $1 AND ua.discord_id = $2 FOR UPDATE OF ua`,
    [gearId, discordId]
  );
  return a.rows[0] || null;
}

function gearTable(kind) { return kind === 'weapon' ? 'user_weapons' : 'user_armors'; }
function gearIdCol(kind) { return kind === 'weapon' ? 'weapon_id' : 'armor_id'; }

/** Map a global slot# → { array:'native'|'opposite', index, lane }. null if out of range. */
function locateSlot(gear, slotNum) {
  const native = gear.native_sockets || [];
  const opposite = gear.opposite_sockets || [];
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
    `UPDATE ${gearTable(gear.kind)} SET ${col} = $2::jsonb WHERE ${gearIdCol(gear.kind)} = $1`,
    [gear.id, JSON.stringify(arr)]
  );
}

// ── crd socket <gear_id> <rune_uid> <slot#> ─────────────────────────────────
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
    if (!gear) { await client.query('ROLLBACK'); return reply(message, 'You don\'t own equipment with that ID.'); }

    const loc = locateSlot(gear, slotNum);
    if (!loc) { await client.query('ROLLBACK'); return reply(message, `Slot ${slotNum} doesn't exist on this gear.`); }

    const arr = (loc.array === 'native' ? gear.native_sockets : gear.opposite_sockets) || [];
    if (arr[loc.index].rune_uid) { await client.query('ROLLBACK'); return reply(message, `Slot ${slotNum} is already filled. \`crd unsocket ${gearId} ${slotNum}\` first.`); }

    const rr = await client.query(
      `SELECT ur.rune_uid, ur.socketed_into, ur.is_locked, rn.name, rn.lane, rn.tier, rn.effect_key, rn.value
         FROM user_runes ur JOIN rune_roster rn ON ur.rune_id = rn.rune_id
        WHERE ur.rune_uid = $1 AND ur.discord_id = $2 FOR UPDATE OF ur`,
      [runeUid, discordId]
    );
    if (rr.rows.length === 0) { await client.query('ROLLBACK'); return reply(message, 'You don\'t own a rune with that uid.'); }
    const rune = rr.rows[0];
    if (rune.socketed_into) { await client.query('ROLLBACK'); return reply(message, `That rune is already socketed into \`${rune.socketed_into}\`.`); }
    if (rune.lane !== loc.lane) { await client.query('ROLLBACK'); return reply(message, `Lane mismatch — slot ${slotNum} is **${loc.lane}**, but ${rune.name} is **${rune.lane}**.`); }

    arr[loc.index].rune_uid = runeUid;
    await writeSockets(client, gear, loc.array, arr);
    await client.query('UPDATE user_runes SET socketed_into = $2 WHERE rune_uid = $1', [runeUid, gear.id]);
    await client.query('COMMIT');
    return reply(message, `✅ Socketed **${rune.name}** (${rune.tier}, ${rune.effect_key} ${rune.value}) into **${gear.name}** slot ${slotNum}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[socket]', err.message);
    return reply(message, 'Socketing failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd unsocket <gear_id> <slot#> ──────────────────────────────────────────
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
    const gear = await loadGear(client, discordId, gearId);
    if (!gear) { await client.query('ROLLBACK'); return reply(message, 'You don\'t own equipment with that ID.'); }
    const loc = locateSlot(gear, slotNum);
    if (!loc) { await client.query('ROLLBACK'); return reply(message, `Slot ${slotNum} doesn't exist on this gear.`); }
    const arr = (loc.array === 'native' ? gear.native_sockets : gear.opposite_sockets) || [];
    const runeUid = arr[loc.index].rune_uid;
    if (!runeUid) { await client.query('ROLLBACK'); return reply(message, `Slot ${slotNum} is already empty.`); }

    const rr = await client.query(
      `SELECT rn.name, rn.tier FROM user_runes ur JOIN rune_roster rn ON ur.rune_id = rn.rune_id
        WHERE ur.rune_uid = $1`, [runeUid]
    );
    const rune = rr.rows[0] || { name: 'rune', tier: 'Rare' };
    const cost = UNSOCKET_COST[rune.tier] ?? 5000;

    const bag = await client.query('SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]);
    if (bag.rows.length === 0 || Number(bag.rows[0].credux) < cost) {
      await client.query('ROLLBACK');
      return reply(message, `Unsocketing a ${rune.tier} rune costs ${cost.toLocaleString()} Credux — you don't have enough.`);
    }

    arr[loc.index].rune_uid = null;
    await writeSockets(client, gear, loc.array, arr);
    await client.query('UPDATE user_runes SET socketed_into = NULL WHERE rune_uid = $1', [runeUid]);
    await client.query('UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1', [discordId, cost]);
    await client.query('COMMIT');
    return reply(message, `✅ Removed **${rune.name}** from slot ${slotNum} (−${cost.toLocaleString()} Credux). Rune returned to your bag.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[unsocket]', err.message);
    return reply(message, 'Unsocketing failed — nothing changed.');
  } finally {
    client.release();
  }
}

// ── crd unlock socket <gear_id> — buy the next opposite slot (§2.5) ─────────
// Called from lock.js unlock() when args[0] === 'socket'. args here = ['socket', gearId].
async function unlockSocket(message, args) {
  const gearId = (args[1] || '').trim().toLowerCase();
  if (!gearId) return reply(message, 'Usage: `crd unlock socket <gear_id>`');
  const discordId = message.author.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const gear = await loadGear(client, discordId, gearId);
    if (!gear) { await client.query('ROLLBACK'); return reply(message, 'You don\'t own equipment with that ID.'); }

    const opposite = gear.opposite_sockets || [];
    const nextIndex = opposite.length + 1; // 1-based slot_index for socket_unlock_cost
    const costRes = await client.query(
      'SELECT essence_tier, essence_cost, credux_cost FROM socket_unlock_cost WHERE tier = $1 AND slot_index = $2',
      [gear.tier, nextIndex]
    );
    if (costRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply(message, `**${gear.name}** (${gear.tier}) can't unlock another opposite slot (tier cap reached, or tier has none).`);
    }
    const { essence_tier, essence_cost, credux_cost } = costRes.rows[0];
    const essCol = `${essence_tier}_essence`; // essence_tier is a whitelisted CHECK value

    const bag = await client.query(
      `SELECT credux, ${essCol} AS ess FROM users_bag WHERE discord_id = $1 FOR UPDATE`, [discordId]
    );
    if (bag.rows.length === 0 || bag.rows[0].ess < essence_cost || Number(bag.rows[0].credux) < Number(credux_cost)) {
      await client.query('ROLLBACK');
      return reply(message, `Need ${essence_cost} ${essence_tier} essence + ${Number(credux_cost).toLocaleString()} Credux to unlock opposite slot ${nextIndex}.`);
    }

    opposite.push({ slot: nextIndex, rune_uid: null });
    await writeSockets(client, gear, 'opposite', opposite);
    await client.query(
      `UPDATE users_bag SET ${essCol} = ${essCol} - $2, credux = credux - $3 WHERE discord_id = $1`,
      [discordId, essence_cost, credux_cost]
    );
    await client.query('COMMIT');
    const globalSlot = (gear.native_sockets || []).length + nextIndex;
    return reply(message, `✅ Unlocked opposite slot **${globalSlot}** on **${gear.name}** (−${essence_cost} ${essence_tier} essence, −${Number(credux_cost).toLocaleString()} Credux).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[unlock socket]', err.message);
    return reply(message, 'Unlock failed — nothing changed.');
  } finally {
    client.release();
  }
}

module.exports = { socket, unsocket, unlockSocket };

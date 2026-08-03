'use strict';

const pool = require('../../db/pool');
const ent = require('../../engine/supporterEntitlements');
const { skinEmojiByCode } = require('../../engine/skinEmojis');
const { getActiveLoadout, updateActiveLoadout, setActivePresetSlot } = require('../../engine/loadout');

const CAT_WORD = { profile: 'profile', battle: 'battle', battle_result: 'battle result', summon: 'summon' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * `crd equip skin <skin_name|code>` — equip a cosmetic skin the player owns (by display name,
 * skin code, or exact key). Category is taken from the resolved catalog row. Cosmetic-only.
 */
async function equipSkin(message, args) {
  const ref = args.slice(1).join(' ').trim();
  if (!ref) {
    return reply(message, 'Usage: `crd equip skin <skin_name>` — e.g. `crd equip skin Divine Radiance` or `crd equip skin p1`.');
  }
  const ownerId = message.author.id;
  if (ref.toLowerCase() === 'default') {
    const removed = await ent.clearAllEquipped(pool, ownerId);
    return reply(message, removed
      ? `🧹 Reset **${removed}** skin slot${removed === 1 ? '' : 's'} to the default templates.`
      : 'Your skins are already on the default templates.');
  }
  const skin = await ent.resolveCatalogRef(pool, ownerId, ref);
  if (!skin) return reply(message, `No skin matches \`${ref}\`. See \`crd skin collection\`.`);
  if (!(await ent.ownsResolved(pool, ownerId, skin.cosmetic_id))) {
    const how = skin.skin_code ? `buy it with \`crd buy ${skin.skin_code}\`` : 'it isn\'t available to you';
    return reply(message, `You don't own **${skin.display_name}** yet — ${how}.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ent.equipCosmeticTx(client, ownerId, skin.category, skin.cosmetic_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[equip skin]', err.message);
    return reply(message, 'Equip failed — nothing changed.');
  } finally {
    client.release();
  }
  const codeTxt = skin.skin_code ? ` (\`${skin.skin_code}\`)` : '';
  return reply(message,
    `${skinEmojiByCode(skin.skin_code, skin.category, skin.cosmetic_key)} Equipped **${skin.display_name}**${codeTxt} as your ${CAT_WORD[skin.category]} skin.`);
}

function loadoutSummary(loadout) {
  const pieces = [];
  if (loadout.weapon_name) pieces.push(`weapon **${loadout.weapon_name}**`);
  if (loadout.armor_name) pieces.push(`armor **${loadout.armor_name}**`);
  if (loadout.deity_name) pieces.push(`deity **${loadout.deity_name}**`);
  if (loadout.deity2_name) pieces.push(`deity **${loadout.deity2_name}**`);
  if (loadout.deity3_name) pieces.push(`deity **${loadout.deity3_name}**`);
  if (loadout.echo_deity_name) pieces.push(`Echo **${loadout.echo_deity_name}**`);
  return pieces;
}

async function equipPreset(message, args) {
  const slot = Number(args[1]);
  if (![1, 2].includes(slot)) {
    return reply(message, 'Usage: `crd equip preset <1|2>`');
  }
  const discordId = message.author.id;
  const current = await getActiveLoadout(pool, discordId);
  if (!current) return reply(message, 'You don\'t have a character yet.');
  if (Number(current.active_preset_slot) === slot) {
    return reply(message, `already using Preset ${slot}`);
  }

  const switched = await setActivePresetSlot(pool, discordId, slot);
  if (!switched) return reply(message, `Preset ${slot} does not exist.`);
  const next = await getActiveLoadout(pool, discordId);
  if (loadoutSummary(next).length === 0) {
    return reply(message, `Preset ${slot} is empty. You now have nothing equipped.`);
  }
  return reply(message, `Now using Preset ${slot}: ${loadoutSummary(next).join(', ')}.`);
}

/**
 * `crd equip <id>` — equip a weapon OR armor the player owns ([v5] one command,
 *   id-detected: looks up user_weapons then user_armors and writes the matching slot).
 * `crd equip skin <skin_name>` — equip a cosmetic skin (delegates to equipSkin).
 * `crd equip info <id>` — unified equipment info card (delegates to equipment.js;
 *   supports the `crd eq info <id>` alias path since `eq` → `equip`).
 */
async function execute(message, { args }) {
  const first = (args[0] || '').toLowerCase();
  if (first === 'skin') return equipSkin(message, args);
  if (first === 'preset') return equipPreset(message, args);
  if (first === 'info') return require('./equipment').info(message, (args[1] || '').trim());

  const gearId = (args[0] || '').trim().toLowerCase();
  if (!gearId) {
    await reply(message, 'Usage: `crd equip <id>`');
    return;
  }

  const discordId = message.author.id;

  // Weapon first.
  const wRes = await pool.query(
    `SELECT wr.name, wr.tier, uw.enhancement
       FROM user_weapons uw
       JOIN weapon_roster wr ON uw.weapon_roster_id = wr.weapon_roster_id
      WHERE uw.weapon_id = $1 AND uw.discord_id = $2`,
    [gearId, discordId]
  );
  if (wRes.rows.length > 0) {
    const updated = await updateActiveLoadout(pool, discordId, { equipped_weapon_id: gearId });
    if (!updated) return reply(message, 'Equip failed â€” your active preset no longer exists.');
    const w = wRes.rows[0];
    await reply(message, `Equipped **${w.name}** (${w.tier}) +${w.enhancement - 1}.`);
    return;
  }

  // Then armor.
  const aRes = await pool.query(
    `SELECT ar.name, ar.tier, ar.type, ua.enhancement
       FROM user_armors ua
       JOIN armor_roster ar ON ua.armor_roster_id = ar.armor_roster_id
      WHERE ua.armor_id = $1 AND ua.discord_id = $2`,
    [gearId, discordId]
  );
  if (aRes.rows.length > 0) {
    const updated = await updateActiveLoadout(pool, discordId, { equipped_armor_id: gearId });
    if (!updated) return reply(message, 'Equip failed â€” your active preset no longer exists.');
    const a = aRes.rows[0];
    await reply(message, `Equipped **${a.name}** (${a.tier} ${a.type}) +${a.enhancement - 1}.`);
    return;
  }

  await reply(message, 'You don\'t own equipment with that ID.');
}

module.exports = { execute };

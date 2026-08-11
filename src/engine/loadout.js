'use strict';

/**
 * Active preset boundary.
 *
 * Runtime callers must use this module instead of reading user_presets or the
 * legacy loadout columns directly. The returned row intentionally contains the
 * joined combat/display data needed by the current callers, plus the selected
 * preset's identifiers and metadata.
 */

const LOADOUT_SELECT = `
  SELECT uc.discord_id, uc.class, uc.combat_level, uc.combat_exp,
         uc.believer_level, uc.believer_exp, uc.active_preset_slot,
         uc.raids_won, uc.raids_lost, uc.pvp_wins, uc.pvp_losses,
         uc.pvp_rating, uc.highest_raid_streak, uc.highest_rank_streak,
         u.username,
         p.id AS preset_id, p.slot AS preset_slot, p.name AS preset_name,
         (SELECT COUNT(*)::int FROM user_presets pc
           WHERE pc.discord_id = uc.discord_id) AS preset_count,
         p.equipped_deity_1_id, p.equipped_deity_2_id, p.equipped_deity_3_id,
         p.equipped_echo_deity_id, p.equipped_armor_id, p.equipped_weapon_id,
         p.updated_at AS preset_updated_at,
         w.enhancement AS weapon_enh,
         w.curr_atk AS w_atk, w.crit AS w_crit,
         w.bonus_dmg_pct, w.native_sockets AS w_native, w.opposite_sockets AS w_opposite,
         w.weapon_id, active_wr.name AS weapon_name, active_wr.tier AS weapon_tier,
         active_wr.passive_key,
         am.enhancement AS armor_enh,
         am.curr_hp AS a_hp, am.curr_def AS a_def,
         am.native_sockets AS a_native, am.opposite_sockets AS a_opposite,
         am.armor_id, am.enhancement AS armor_enhancement,
         active_ar.name AS armor_name, active_ar.type AS armor_type,
         active_ar.passive_key AS armor_passive_key,
         ud.user_deity_id AS d1_user_deity_id,
         COALESCE(ud.sigils, 0) AS d1_unlocked_sigils,
         COALESCE(ud.ascended, FALSE) AS d1_ascended, ud.enhancement AS d1_enhancement,
         dr.base_atk AS d1_batk, dr.base_hp AS d1_bhp, dr.base_def AS d1_bdef,
         dr.name AS deity_name, dr.tier AS deity_tier,
         dr.image_filename AS deity_image_filename,
         dr.blessing_key, dr.blessing_name AS deity_blessing_name,
         dr.blessing_description AS deity_blessing_description,
         dr.mythology AS d1_myth,
         ud2.user_deity_id AS d2_user_deity_id,
         COALESCE(ud2.sigils, 0) AS d2_unlocked_sigils,
         COALESCE(ud2.ascended, FALSE) AS d2_ascended, ud2.enhancement AS d2_enhancement,
         dr2.base_atk AS d2_batk, dr2.base_hp AS d2_bhp, dr2.base_def AS d2_bdef,
         dr2.name AS deity2_name, dr2.tier AS deity2_tier,
         dr2.image_filename AS deity2_image_filename,
         dr2.blessing_key AS blessing_key_2,
         dr2.blessing_name AS deity2_blessing_name,
         dr2.blessing_description AS deity2_blessing_description,
         dr2.mythology AS d2_myth,
         ud3.user_deity_id AS d3_user_deity_id,
         COALESCE(ud3.sigils, 0) AS d3_unlocked_sigils,
         COALESCE(ud3.ascended, FALSE) AS d3_ascended, ud3.enhancement AS d3_enhancement,
         dr3.base_atk AS d3_batk, dr3.base_hp AS d3_bhp, dr3.base_def AS d3_bdef,
         dr3.name AS deity3_name, dr3.tier AS deity3_tier,
         dr3.image_filename AS deity3_image_filename,
         dr3.blessing_key AS blessing_key_3,
         dr3.blessing_name AS deity3_blessing_name,
         dr3.blessing_description AS deity3_blessing_description,
         dr3.mythology AS d3_myth,
         ude.user_deity_id AS echo_udid, ude.ascended AS echo_ascended,
         dre.name AS echo_deity_name, dre.tier AS echo_deity_tier,
         dre.image_filename AS echo_deity_image_filename,
         dre.blessing_key AS echo_blessing_key,
         dre.blessing_name AS echo_blessing_name,
         dre.blessing_description AS echo_blessing_description,
         tcq.display AS equipped_title
    FROM user_character uc
    JOIN users u ON u.discord_id = uc.discord_id
    JOIN user_presets p
      ON p.discord_id = uc.discord_id AND p.slot = uc.active_preset_slot
    LEFT JOIN user_weapons w ON w.weapon_id = p.equipped_weapon_id
    LEFT JOIN weapon_roster active_wr ON active_wr.weapon_roster_id = w.weapon_roster_id
    LEFT JOIN user_armors am ON am.armor_id = p.equipped_armor_id
    LEFT JOIN armor_roster active_ar ON active_ar.armor_roster_id = am.armor_roster_id
    LEFT JOIN user_deities ud ON ud.user_deity_id = p.equipped_deity_1_id
    LEFT JOIN deity_roster dr ON dr.deity_id = ud.deity_id
    LEFT JOIN user_deities ud2 ON ud2.user_deity_id = p.equipped_deity_2_id
    LEFT JOIN deity_roster dr2 ON dr2.deity_id = ud2.deity_id
    LEFT JOIN user_deities ud3 ON ud3.user_deity_id = p.equipped_deity_3_id
    LEFT JOIN deity_roster dr3 ON dr3.deity_id = ud3.deity_id
    LEFT JOIN user_deities ude ON ude.user_deity_id = p.equipped_echo_deity_id
    LEFT JOIN deity_roster dre ON dre.deity_id = ude.deity_id
    LEFT JOIN title_catalog tcq ON tcq.title_id = uc.equipped_title_id
`;

const WRITABLE_FIELDS = Object.freeze(new Set([
  'equipped_deity_1_id',
  'equipped_deity_2_id',
  'equipped_deity_3_id',
  'equipped_echo_deity_id',
  'equipped_armor_id',
  'equipped_weapon_id',
]));

const UPDATED_LOADOUT_SELECT = LOADOUT_SELECT.replace(
  `JOIN user_presets p
      ON p.discord_id = uc.discord_id AND p.slot = uc.active_preset_slot`,
  'JOIN updated p ON p.discord_id = uc.discord_id'
);

function assertDiscordId(discordId) {
  if (discordId == null || String(discordId).trim() === '') {
    throw new TypeError('discordId is required');
  }
}

function changedFields(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('changes must be an object');
  }
  const entries = Object.entries(changes);
  if (entries.length === 0) throw new TypeError('changes must not be empty');
  for (const [field] of entries) {
    if (!WRITABLE_FIELDS.has(field)) throw new TypeError(`unsupported loadout field: ${field}`);
  }
  return entries;
}

async function getActiveLoadout(db, discordId) {
  assertDiscordId(discordId);
  const result = await db.query(
    `${LOADOUT_SELECT} WHERE uc.discord_id = $1`,
    [discordId]
  );
  return result.rows[0] || null;
}

async function updateActiveLoadout(dbOrClient, discordId, changes) {
  assertDiscordId(discordId);
  const entries = changedFields(changes);
  const values = [discordId];
  const assignments = entries.map(([field, value]) => {
    values.push(value);
    return `${field} = $${values.length}`;
  });

  const result = await dbOrClient.query(
    `WITH updated AS (
       UPDATE user_presets p
          SET ${assignments.join(', ')}, updated_at = NOW()
        WHERE p.discord_id = $1
          AND p.slot = (
            SELECT uc.active_preset_slot
              FROM user_character uc
             WHERE uc.discord_id = $1
          )
        RETURNING p.*
     )
     ${UPDATED_LOADOUT_SELECT}
      WHERE uc.discord_id = $1`,
    values
  );
  return result.rows[0] || null;
}

async function setActivePresetSlot(dbOrClient, discordId, slot) {
  assertDiscordId(discordId);
  const normalizedSlot = Number(slot);
  if (!Number.isInteger(normalizedSlot) || ![1, 2].includes(normalizedSlot)) {
    throw new RangeError('preset slot must be 1 or 2');
  }
  const result = await dbOrClient.query(
    `UPDATE user_character uc
        SET active_preset_slot = $2
      WHERE uc.discord_id = $1
        AND EXISTS (
          SELECT 1
            FROM user_presets p
           WHERE p.discord_id = uc.discord_id AND p.slot = $2
        )
      RETURNING uc.discord_id, uc.active_preset_slot`,
    [discordId, normalizedSlot]
  );
  return result.rows[0] || null;
}

async function createPresets(client, discordId, { weaponId = null, armorId = null } = {}) {
  assertDiscordId(discordId);
  const main = await client.query(
    `INSERT INTO user_presets
       (discord_id, slot, name, equipped_armor_id, equipped_weapon_id)
     VALUES ($1, 1, 'Main', $2, $3)
     ON CONFLICT (discord_id, slot) DO NOTHING
     RETURNING discord_id, slot, name`,
    [discordId, armorId, weaponId]
  );
  const second = await client.query(
    `INSERT INTO user_presets (discord_id, slot, name)
     VALUES ($1, 2, 'Preset 2')
     ON CONFLICT (discord_id, slot) DO NOTHING
     RETURNING discord_id, slot, name`,
    [discordId]
  );
  return [...main.rows, ...second.rows];
}

async function findPresetsReferencing(db, discordId, { weaponId, armorId, deityId } = {}) {
  assertDiscordId(discordId);
  const supplied = [weaponId, armorId, deityId].filter((value) => value != null).length;
  if (supplied !== 1) {
    throw new TypeError('exactly one of weaponId, armorId, or deityId is required');
  }

  let query;
  let value;
  if (weaponId != null) {
    query = `
      SELECT slot, 'equipped_weapon_id' AS field
        FROM user_presets
       WHERE discord_id = $1 AND equipped_weapon_id = $2
       ORDER BY slot`;
    value = weaponId;
  } else if (armorId != null) {
    query = `
      SELECT slot, 'equipped_armor_id' AS field
        FROM user_presets
       WHERE discord_id = $1 AND equipped_armor_id = $2
       ORDER BY slot`;
    value = armorId;
  } else {
    query = `
      SELECT p.slot, refs.field
        FROM user_presets p
        CROSS JOIN LATERAL (
          VALUES
            ('equipped_deity_1_id', p.equipped_deity_1_id),
            ('equipped_deity_2_id', p.equipped_deity_2_id),
            ('equipped_deity_3_id', p.equipped_deity_3_id),
            ('equipped_echo_deity_id', p.equipped_echo_deity_id)
        ) AS refs(field, value)
       WHERE p.discord_id = $1 AND refs.value = $2
       ORDER BY p.slot, refs.field`;
    value = deityId;
  }
  const result = await db.query(query, [discordId, value]);
  return result.rows.map((row) => ({ slot: Number(row.slot), field: row.field }));
}

async function clearPresets(dbOrClient, discordId, options = {}) {
  assertDiscordId(discordId);
  const hasFields = Object.prototype.hasOwnProperty.call(options, 'fields');
  if (hasFields && !Array.isArray(options.fields)) throw new TypeError('fields must be an array');
  const fields = hasFields ? [...new Set(options.fields)] : [...WRITABLE_FIELDS];
  if (fields.some((field) => !WRITABLE_FIELDS.has(field))) {
    throw new RangeError('fields contains an unsupported loadout field');
  }
  if (fields.length === 0) return [];
  const hasSlots = Object.prototype.hasOwnProperty.call(options, 'slots');
  let slotFilter = '';
  const values = [discordId];
  if (hasSlots) {
    if (!Array.isArray(options.slots)) throw new TypeError('slots must be an array');
    const slots = [...new Set(options.slots.map(Number))];
    if (slots.some((slot) => !Number.isInteger(slot) || ![1, 2].includes(slot))) {
      throw new RangeError('slots must contain only 1 or 2');
    }
    if (slots.length === 0) return [];
    values.push(slots);
    slotFilter = ' AND slot = ANY($2::smallint[])';
  }
  const assignments = fields.map((field) => `${field} = NULL`);
  assignments.push('updated_at = NOW()');
  const result = await dbOrClient.query(
    `UPDATE user_presets
        SET ${assignments.join(',\n            ')}
      WHERE discord_id = $1${slotFilter}
      RETURNING slot`,
    values
  );
  return result.rows.map((row) => Number(row.slot));
}

module.exports = {
  getActiveLoadout,
  updateActiveLoadout,
  setActivePresetSlot,
  createPresets,
  findPresetsReferencing,
  clearPresets,
};

'use strict';

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { CHESTS, CHEST_ALIASES, MAX_OPEN, rollTier, rollWeaponStats } = require('../../config/dropRates');
const { generateUniqueWeaponId } = require('../../utils/weaponId');

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TIER_RANK = { Common: 0, Rare: 1, Mythic: 2, Legendary: 3, Supreme: 4 };
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * `crd open <sc|gc|btc|bgtc|supc> [amount]`
 * (crd open sr|supr → relic gacha, Phase 4 stub)
 */
async function execute(message, { args }) {
  const alias = (args[0] || '').toLowerCase();

  if (alias === 'sr' || alias === 'supr') {
    await reply(message, 'Not implemented (Phase 4)');
    return;
  }
  if (!alias) {
    await reply(message, 'Usage: `crd open <sc|gc|btc|bgtc|supc> [amount]`');
    return;
  }
  if (!CHEST_ALIASES.includes(alias)) {
    await reply(message, 'Unknown chest. Try: `sc`, `gc`, `btc`, `bgtc`, `supc`.');
    return;
  }

  // Validate amount BEFORE the transaction (integer 1..10).
  const raw = args[1] ?? '1';
  if (!/^\d+$/.test(raw)) {
    await reply(message, 'Amount must be a whole number between 1 and 10.');
    return;
  }
  const amount = parseInt(raw, 10);
  if (amount < 1 || amount > MAX_OPEN) {
    await reply(message, `You can open between 1 and ${MAX_OPEN} chests at a time.`);
    return;
  }

  const chest = CHESTS[alias];
  const col = chest.column; // whitelisted identifier from our constant map (not raw user input)
  const discordId = message.author.id;

  const client = await pool.connect();
  let drops, previous, remaining;
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      `SELECT ${col} AS count FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await reply(message, `You don't have any ${chest.action}s.`);
      return;
    }
    previous = bagRes.rows[0].count;
    if (previous < amount) {
      await client.query('ROLLBACK');
      await reply(message, `You don't have enough ${chest.action}s. You have ${previous}.`);
      return;
    }

    drops = [];
    for (let i = 0; i < amount; i++) {
      const tier = rollTier(alias);
      const wr = await client.query(
        `SELECT weapon_roster_id, name, type FROM weapon_roster
          WHERE tier = $1 AND is_available = TRUE
          ORDER BY RANDOM() LIMIT 1`,
        [tier]
      );
      if (wr.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`[open] no available weapon for tier ${tier}`);
        await reply(message, 'Chest opening is temporarily unavailable (no available weapons for a rolled tier). Nothing was consumed.');
        return;
      }
      const { weapon_roster_id, name, type } = wr.rows[0];
      const s = rollWeaponStats(tier, type);
      const weaponId = await generateUniqueWeaponId(client);

      await client.query(
        `INSERT INTO user_weapons
           (discord_id, weapon_id, weapon_roster_id, curr_atk, curr_hp, curr_def,
            enhancement, base_atk, base_hp, base_def, crit, bonus_dmg_pct, bonus_crit_dmg_pct, is_locked)
         VALUES ($1,$2,$3,$4,$5,$6,1,$4,$5,$6,$7,$8,$9,FALSE)`,
        [discordId, weaponId, weapon_roster_id, s.atk, s.hp, s.def, s.crit, s.bonus_dmg_pct, s.bonus_crit_dmg_pct]
      );
      drops.push({ name, type, tier, ...s, weaponId });
    }

    remaining = previous - amount;
    await client.query(
      `UPDATE users_bag SET ${col} = ${col} - $2 WHERE discord_id = $1`,
      [discordId, amount]
    );

    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [discordId, chest.action, col, previous, remaining]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open] transaction failed:', err.message);
    await reply(message, 'Something went wrong opening your chest. Nothing was consumed.');
    return;
  } finally {
    client.release();
  }

  // Build result embed.
  const highest = drops.reduce((h, d) => (TIER_RANK[d.tier] > TIER_RANK[h] ? d.tier : h), 'Common');
  const lines = drops.map(d => {
    const emoji = TYPE_EMOJI[d.type] || '•';
    const critTxt = d.crit > 0 ? ` · CRIT ${Number(d.crit).toFixed(1)}%` : '';
    const bonus = d.bonus_dmg_pct ? ` · +${d.bonus_dmg_pct}% DMG/+${d.bonus_crit_dmg_pct}% CDMG` : '';
    return `${emoji} **${d.name}** (${d.tier})\n\`${d.weaponId}\` · ATK ${d.atk} · HP ${d.hp} · DEF ${d.def}${critTxt}${bonus}`;
  });

  const embed = new EmbedBuilder()
    .setColor(TIER_COLOR[highest] || TIER_COLOR.Common)
    .setTitle(`Opened ${amount} × ${chest.action}`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${chest.action} remaining: ${remaining} · Equip with crd equip <id>` });

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
}

module.exports = { execute };

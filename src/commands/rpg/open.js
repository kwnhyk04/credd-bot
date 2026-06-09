'use strict';

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { CHESTS, CHEST_ALIASES, MAX_OPEN, rollTier, rollWeaponStats } = require('../../config/dropRates');
const { generateUniqueWeaponId } = require('../../utils/weaponId');
const { runSummon } = require('../../engine/summonEngine');
const { TIER_ALIAS, TIER_COLOR: DEITY_TIER_COLOR, TIER_RANK: DEITY_TIER_RANK } = require('../../config/gachaRates');
const { playChestAnimation, playRelicAnimation } = require('../../engine/openAnimation');

const TIER_COLOR = {
  Common: 0x95a5a6, Rare: 0x3498db, Mythic: 0x9b59b6, Legendary: 0xFFD700, Supreme: 0xe74c3c,
};
const TIER_RANK = { Common: 0, Rare: 1, Mythic: 2, Legendary: 3, Supreme: 4 };
const TYPE_EMOJI = { Sword: '⚔️', Staff: '🪄', Gloves: '🥊', Shield: '🛡️', Bow: '🏹' };

// Relic gacha config (Master §6): which relic feeds how many deity rolls.
//   sr   → 1 Sacred Relic  → 10 deity rolls (pity applies)
//   supr → 1 Supreme Relic → 1 forced Supreme pull (does NOT touch pity)
const RELICS = {
  sr:   { column: 'sacred_relics',  action: 'Sacred Relic',  count: 10, forceTier: null },
  supr: { column: 'supreme_relics', action: 'Supreme Relic', count: 1,  forceTier: 'Supreme' },
};

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * Atomic chest-open core (extracted so the bag-chests Open button runs the
 * EXACT same logic as `crd open <alias>`): lock bag → validate count → roll
 * weapons + INSERT → deduct chests → game_logs → COMMIT. Behavior unchanged.
 * @returns {{ok:true, drops:object[], previous:number, remaining:number} |
 *           {ok:false, reason:'nobag'|'insufficient'|'no_weapon_pool'|'error', have?:number}}
 */
async function openChestsTxn(discordId, alias, amount) {
  const chest = CHESTS[alias];
  const col = chest.column; // whitelisted identifier from our constant map (not raw user input)

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      `SELECT ${col} AS count FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'nobag' };
    }
    const previous = bagRes.rows[0].count;
    if (previous < amount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient', have: previous };
    }

    const drops = [];
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
        return { ok: false, reason: 'no_weapon_pool' };
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

    const remaining = previous - amount;
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
    return { ok: true, drops, previous, remaining };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open] transaction failed:', err.message);
    return { ok: false, reason: 'error' };
  } finally {
    client.release();
  }
}

/**
 * `crd open <sc|gc|btc|bgtc|supc> [amount]`  — weapon chests
 * `crd open <sr|supr>`                        — relic-fed deity gacha (§6)
 */
async function execute(message, { args }) {
  const alias = (args[0] || '').toLowerCase();

  if (alias === 'sr' || alias === 'supr') {
    await openRelic(message, alias);
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
  const discordId = message.author.id;

  const res = await openChestsTxn(discordId, alias, amount);
  if (!res.ok) {
    if (res.reason === 'nobag') await reply(message, `You don't have any ${chest.action}s.`);
    else if (res.reason === 'insufficient') await reply(message, `You don't have enough ${chest.action}s. You have ${res.have}.`);
    else if (res.reason === 'no_weapon_pool') await reply(message, 'Chest opening is temporarily unavailable (no available weapons for a rolled tier). Nothing was consumed.');
    else await reply(message, 'Something went wrong opening your chest. Nothing was consumed.');
    return;
  }
  const { drops, remaining } = res;

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

  // Cosmetic frame-swap animation (post-commit). chestKey = column minus '_chest'.
  await playChestAnimation(message, {
    chestKey: col.replace(/_chest$/, ''),
    highestTier: highest,
    finalEmbed: embed,
    frameTitle: `Opening ${amount} × ${chest.action}`,
  });
}

/**
 * `crd open sr|supr` — consume one relic and run the deity gacha through the
 * shared summon engine. One atomic transaction: the relic only leaves on COMMIT
 * alongside the deity/essence/pity writes; any failure rolls back fully.
 */
async function openRelic(message, alias) {
  const relic = RELICS[alias];
  const col = relic.column; // whitelisted identifier from our constant map
  const discordId = message.author.id;

  const client = await pool.connect();
  let result, relicRemaining;
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      `SELECT ${col} AS count FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId]
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await reply(message, 'You don\'t have a bag yet. Use `crd register` first.');
      return;
    }
    const previous = bagRes.rows[0].count;
    if (previous < 1) {
      await client.query('ROLLBACK');
      await reply(message, `You don't have a ${relic.action}.`);
      return;
    }

    relicRemaining = previous - 1;
    await client.query(
      `UPDATE users_bag SET ${col} = ${col} - 1 WHERE discord_id = $1`,
      [discordId]
    );
    // Relic-consumption audit row (separate from the per-pull Deity Pull rows).
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_relic_count, updated_relic_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [discordId, relic.action, col, previous, relicRemaining]
    );

    // No shard logging on the relic path (relics are the spend, logged above).
    result = await runSummon(client, discordId, { count: relic.count, forceTier: relic.forceTier });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open] relic transaction failed:', err.message);
    await reply(message, `Something went wrong opening your ${relic.action}. Nothing was consumed.`);
    return;
  } finally {
    client.release();
  }

  const finalEmbed = buildRelicEmbed(message, relic, result, relicRemaining);
  const highestTier = result.pulls.reduce(
    (h, p) => (DEITY_TIER_RANK[p.tier] > DEITY_TIER_RANK[h] ? p.tier : h),
    'Epic'
  );
  // Cosmetic frame-swap animation (post-commit): relic frames → card flip → results.
  await playRelicAnimation(message, {
    relicAlias: alias,
    highestTier,
    finalEmbed,
    frameTitle: `Opening ${relic.action}`,
  });
}

function buildRelicEmbed(message, relic, result, relicRemaining) {
  const { pulls, summary, newActiveDeityId } = result;
  const highest = pulls.reduce((h, p) => (DEITY_TIER_RANK[p.tier] > DEITY_TIER_RANK[h] ? p.tier : h), 'Epic');

  const lines = pulls.map((p) => {
    const star = p.isDupe ? '↻ +1 essence' : '✨ NEW';
    return `**${p.name}** — ${TIER_ALIAS[p.tier]} *(${p.tier})* · ${p.mythology} · ${star}`;
  });
  const summaryLine = ['Supreme', 'Legendary', 'Mythic', 'Epic']
    .filter((t) => summary[t] > 0)
    .map((t) => `${TIER_ALIAS[t]} ×${summary[t]}`)
    .join(' · ');

  const embed = new EmbedBuilder()
    .setColor(DEITY_TIER_COLOR[highest])
    .setTitle(`Opened ${relic.action}`)
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Summary', value: summaryLine || '—', inline: false })
    .setFooter({ text: `${relic.action} remaining: ${relicRemaining}` });

  if (newActiveDeityId != null) {
    embed.addFields({ name: 'Active Deity', value: 'Your first deity is now equipped.', inline: false });
  }
  return embed;
}

module.exports = { execute, openChestsTxn };

'use strict';

const pool = require('../../db/pool');
const { CHESTS, CHEST_ALIASES, MAX_OPEN, rollTier, rollWeaponStats } = require('../../config/dropRates');
const { generateUniqueWeaponId } = require('../../utils/weaponId');
const { runSummon } = require('../../engine/summonEngine');
const { TIER_ALIAS } = require('../../config/gachaRates');
const { playAnimatedOpen, buildWeaponResultPayload } = require('../../engine/chestOpen');
const { buildResultMessage } = require('../../engine/renderSummon');

// Relic gacha config (Master §6): which relic feeds how many deity rolls.
//   sr   → 1 Sacred Relic  → 10 deity rolls (pity applies)
//   supr → 1 Supreme Relic → 1 forced Supreme pull (does NOT touch pity)
const RELICS = {
  sr:   { column: 'sacred_relics',  action: 'Sacred Relic',  emojiName: 'sacred_relic',  count: 10, forceTier: null },
  supr: { column: 'supreme_relics', action: 'Supreme Relic', emojiName: 'supreme_relic', count: 1,  forceTier: 'Supreme' },
};

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * Atomic chest-open core (extracted so the bag-chests Open button runs the
 * EXACT same logic as `crd open <alias>`): lock bag → validate count → roll
 * weapons + INSERT → deduct chests → game_logs → COMMIT. Also returns the
 * (post-open) relic balances for the result footer.
 * @returns {{ok:true, drops:object[], previous:number, remaining:number,
 *            sacredRelics:number, supremeRelics:number} |
 *           {ok:false, reason:'nobag'|'insufficient'|'no_weapon_pool'|'error', have?:number}}
 */
async function openChestsTxn(discordId, alias, amount) {
  const chest = CHESTS[alias];
  const col = chest.column; // whitelisted identifier from our constant map (not raw user input)

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      `SELECT ${col} AS count, sacred_relics, supreme_relics
         FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
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
    return {
      ok: true, drops, previous, remaining,
      sacredRelics: bagRes.rows[0].sacred_relics,
      supremeRelics: bagRes.rows[0].supreme_relics,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open] transaction failed:', err.message);
    return { ok: false, reason: 'error' };
  } finally {
    client.release();
  }
}

/** Renderer card stats line, e.g. `ATK 120 · HP 180 · DEF 70 · CRIT 3.2%`. */
function dropStatsLine(d) {
  const critTxt = d.crit > 0 ? ` · CRIT ${Number(d.crit).toFixed(1)}%` : '';
  const bonus = d.bonus_dmg_pct ? ` · +${Number(d.bonus_dmg_pct)}% DMG` : '';
  return `ATK ${d.atk} · HP ${d.hp} · DEF ${d.def}${critTxt}${bonus}`;
}

/**
 * `crd open <sc|gc|btc|bgtc|supc> [amount]`  — weapon chests
 * `crd open <sr|supr>`                        — relic-fed deity gacha (§6)
 */
async function execute(message, { args }) {
  const alias = (args[0] || '').toLowerCase();

  if (alias === 'sr' || alias === 'supr') {
    // Relics open exactly one at a time (supr is a single forced pull) —
    // reject any quantity argument instead of silently ignoring it.
    if (args[1] !== undefined) {
      await reply(message, `${RELICS[alias].action}s open one at a time — just \`crd open ${alias}\`.`);
      return;
    }
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

  const chest = CHESTS[alias];
  const limit = Math.min(chest.maxOpen ?? MAX_OPEN, MAX_OPEN);

  // Validate amount BEFORE the transaction (integer 1..limit).
  const raw = args[1] ?? '1';
  if (!/^\d+$/.test(raw)) {
    await reply(message, `Amount must be a whole number between 1 and ${limit}.`);
    return;
  }
  const amount = parseInt(raw, 10);
  if (amount < 1 || amount > limit) {
    await reply(message, limit === 1
      ? `${chest.action}s can only be opened one at a time.`
      : `You can open between 1 and ${limit} ${chest.action}s at a time.`);
    return;
  }

  const discordId = message.author.id;

  const res = await openChestsTxn(discordId, alias, amount);
  if (!res.ok) {
    if (res.reason === 'nobag') await reply(message, `You don't have any ${chest.action}s.`);
    else if (res.reason === 'insufficient') await reply(message, `You don't have enough ${chest.action}s. You have ${res.have}.`);
    else if (res.reason === 'no_weapon_pool') await reply(message, 'Chest opening is temporarily unavailable (no available weapons for a rolled tier). Nothing was consumed.');
    else await reply(message, 'Something went wrong opening your chest. Nothing was consumed.');
    return;
  }
  const { drops, remaining, sacredRelics, supremeRelics } = res;

  // Display layer (committed already): gif animation → weapon-grid result.
  const items = drops.map((d) => ({
    id: d.weaponId,
    name: d.name,
    tier: d.tier,
    stats: dropStatsLine(d),
  }));

  await playAnimatedOpen(message, {
    gifKey: chest.column,
    animTitle: `Opening ${amount} × ${chest.action}…`,
    userId: discordId,
    buildResult: () => buildWeaponResultPayload({
      gifKey: chest.column,
      title: `Opened ${amount} × ${chest.action}`,
      items,
      sacredRelics,
      supremeRelics,
      remaining,
      chestLabel: chest.action,
      chestEmojiName: chest.column,
    }),
  });
}

/**
 * `crd open sr|supr` — consume one relic and run the deity gacha through the
 * shared summon engine. One atomic transaction: the relic only leaves on COMMIT
 * alongside the deity/essence/pity writes; any failure rolls back fully.
 * Display reuses the EXISTING deity summon render (renderSummon): sr = the
 * 10-roll card grid, supr = the single centered card.
 */
async function openRelic(message, alias) {
  const relic = RELICS[alias];
  const col = relic.column; // whitelisted identifier from our constant map
  const discordId = message.author.id;

  const client = await pool.connect();
  let result, balances;
  try {
    await client.query('BEGIN');

    const bagRes = await client.query(
      `SELECT ${col} AS count, sacred_relics, supreme_relics, belief_shards
         FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
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

    const relicRemaining = previous - 1;
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

    // Post-open balances for the result footer.
    balances = {
      beliefShards: bagRes.rows[0].belief_shards,
      sacredRelics: alias === 'sr' ? relicRemaining : bagRes.rows[0].sacred_relics,
      supremeRelics: alias === 'supr' ? relicRemaining : bagRes.rows[0].supreme_relics,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open] relic transaction failed:', err.message);
    await reply(message, `Something went wrong opening your ${relic.action}. Nothing was consumed.`);
    return;
  } finally {
    client.release();
  }

  // Display layer (committed already): relic gif → existing deity card render.
  // rarity must be the display alias ('Remnant'|'Awakened'|'Undying'|'Primordial').
  const results = result.pulls.map((p) => ({
    name: p.name,
    rarity: TIER_ALIAS[p.tier],
    isNew: !p.isDupe,
  }));

  await playAnimatedOpen(message, {
    gifKey: relic.emojiName, // sacred_relic | supreme_relic
    animTitle: `Opening ${relic.action}…`,
    userId: discordId,
    buildResult: () => buildResultMessage(results, balances),
  });
}

module.exports = { execute, openChestsTxn };

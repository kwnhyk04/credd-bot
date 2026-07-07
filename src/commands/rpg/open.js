'use strict';

const pool = require('../../db/pool');
const {
  CHESTS, CHEST_ALIASES, MAX_OPEN,
  rollTier, rollGearClass, rollArmorType, rollWeaponStats, rollArmorStats,
  rollNativeSocketCount, buildSocketArray,
} = require('../../config/dropRates');
const { generateUniqueGearId, generateUniqueRuneUid } = require('../../utils/weaponId');
const { runSummon } = require('../../engine/summonEngine');
const { TIER_ALIAS } = require('../../config/gachaRates');
const { playAnimatedOpen, buildWeaponResultPayload, buildRuneResultPayload, OPEN_EMOJI } = require('../../engine/chestOpen');
const { emoji } = require('../../utils/emojis');
const { buildResultMessage } = require('../../engine/renderSummon');
const {
  BAGS, BAG_ALIAS, BAG_ALIASES, RUNE_BAG_MAX_OPEN,
  bagEmoji, runeEmojiName, runeEmoji, rollRuneValue, runeDescription,
} = require('../../config/runes');
const { assetPath } = require('../../utils/assets');
const { performanceLog } = require('../../utils/runtimeLogs');
const { getSelectionPool, pickRandomRow } = require('../../utils/selectionPools');

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

async function randomWeaponForTier(client, tier) {
  const rows = await getSelectionPool(
    ['weapon_roster', 'available', tier],
    async () => {
      const res = await client.query(
        `SELECT weapon_roster_id, name, type FROM weapon_roster
          WHERE tier = $1 AND is_available = TRUE`,
        [tier]
      );
      return res.rows;
    },
    { system: 'open', command: 'open', poolKey: `weapon:${tier}` }
  );
  return pickRandomRow(rows);
}

async function randomArmorForTier(client, tier, type) {
  const rows = await getSelectionPool(
    ['armor_roster', 'available', tier, type],
    async () => {
      const res = await client.query(
        `SELECT armor_roster_id, name, type FROM armor_roster
          WHERE tier = $1 AND type = $2 AND is_available = TRUE`,
        [tier, type]
      );
      return res.rows;
    },
    { system: 'open', command: 'open', poolKey: `armor:${tier}:${type}` }
  );
  return pickRandomRow(rows);
}

async function randomRuneForTier(client, tier) {
  const rows = await getSelectionPool(
    ['rune_roster', tier],
    async () => {
      const res = await client.query(
        'SELECT rune_id, name, effect_key, tier, value FROM rune_roster WHERE tier = $1',
        [tier]
      );
      return res.rows;
    },
    { system: 'open', command: 'open_rune_bag', poolKey: `rune:${tier}` }
  );
  return pickRandomRow(rows);
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
    let selectionMs = 0;
    for (let i = 0; i < amount; i++) {
      const tier = rollTier(alias);
      // [v5] each drop is a weapon OR an armor (GEAR_SPLIT). Same chest, same tier odds.
      const gearClass = rollGearClass();

      if (gearClass === 'weapon') {
        const selectStarted = Date.now();
        const weapon = await randomWeaponForTier(client, tier);
        selectionMs += Date.now() - selectStarted;
        if (!weapon) {
          performanceLog('open selection duration', {
            system: 'open',
            command: 'open',
            durationMs: selectionMs,
            count: amount,
          });
          await client.query('ROLLBACK');
          console.error(`[open] no available weapon for tier ${tier}`);
          return { ok: false, reason: 'no_weapon_pool' };
        }
        const { weapon_roster_id, name, type } = weapon;
        const s = rollWeaponStats(tier, type); // ATK + CRIT only (v5)
        const gearId = await generateUniqueGearId(client);
        const sockets = buildSocketArray(rollNativeSocketCount(tier)); // §2.2 native sockets

        await client.query(
          `INSERT INTO user_weapons
             (discord_id, weapon_id, weapon_roster_id, curr_atk,
              enhancement, base_atk, crit, bonus_dmg_pct, is_locked,
              native_sockets, opposite_sockets)
           VALUES ($1,$2,$3,$4,1,$4,$5,$6,FALSE,$7::jsonb,'[]'::jsonb)`,
          [discordId, gearId, weapon_roster_id, s.atk, s.crit, s.bonus_dmg_pct,
           JSON.stringify(sockets)]
        );
        drops.push({ gearClass: 'weapon', name, type, tier, ...s, id: gearId, socketCount: sockets.length });
      } else {
        // armor: roll type 1/3 each, pick an available roster row of that tier+type
        const armorType = rollArmorType();
        const selectStarted = Date.now();
        const armor = await randomArmorForTier(client, tier, armorType);
        selectionMs += Date.now() - selectStarted;
        if (!armor) {
          performanceLog('open selection duration', {
            system: 'open',
            command: 'open',
            durationMs: selectionMs,
            count: amount,
          });
          await client.query('ROLLBACK');
          console.error(`[open] no available armor for tier ${tier} type ${armorType}`);
          return { ok: false, reason: 'no_armor_pool' };
        }
        const { armor_roster_id, name, type } = armor;
        const s = rollArmorStats(tier, type); // HP + DEF only (v5 §C.1)
        const gearId = await generateUniqueGearId(client);
        const sockets = buildSocketArray(rollNativeSocketCount(tier)); // §2.2 native sockets

        await client.query(
          `INSERT INTO user_armors
             (discord_id, armor_id, armor_roster_id, curr_hp, curr_def,
              enhancement, base_hp, base_def, is_locked,
              native_sockets, opposite_sockets)
           VALUES ($1,$2,$3,$4,$5,1,$4,$5,FALSE,$6::jsonb,'[]'::jsonb)`,
          [discordId, gearId, armor_roster_id, s.hp, s.def, JSON.stringify(sockets)]
        );
        drops.push({ gearClass: 'armor', name, type, tier, ...s, id: gearId, socketCount: sockets.length });
      }
    }
    performanceLog('open selection duration', {
      system: 'open',
      command: 'open',
      durationMs: selectionMs,
      count: amount,
    });

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

/** Renderer card stats line. Weapon → `ATK 120 · CRIT 3.2%`; armor → `HP 180 · DEF 70 · Heavy`. */
function dropStatsLine(d) {
  if (d.gearClass === 'armor') {
    return `HP ${d.hp} · DEF ${d.def} · ${d.type}`;
  }
  const critTxt = d.crit > 0 ? ` · CRIT ${Number(d.crit).toFixed(1)}%` : '';
  const bonus = d.bonus_dmg_pct ? ` · +${Number(d.bonus_dmg_pct)}% DMG` : '';
  return `ATK ${d.atk}${critTxt}${bonus}`;
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
  if (BAG_ALIASES.includes(alias)) {
    await openRuneBags(message, alias, args[1]);
    return;
  }
  if (!alias) {
    await reply(message, 'Usage: `crd open <sc|gc|btc|bgtc|supc|lb|gb|db> [amount]`');
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
    else if (res.reason === 'no_armor_pool') await reply(message, 'Chest opening is temporarily unavailable (no available armor for a rolled tier). Nothing was consumed.');
    else await reply(message, 'Something went wrong opening your chest. Nothing was consumed.');
    return;
  }
  const { drops, remaining, sacredRelics, supremeRelics } = res;

  // Display layer (committed already): gif animation → weapon-grid result.
  const items = drops.map((d) => ({
    id: d.id,
    gearClass: d.gearClass,
    name: d.name,
    tier: d.tier,
    sockets: d.socketCount, // [v5 Phase 2] centered slot-count line on the card
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
    essence: p.essence,
  }));

  await playAnimatedOpen(message, {
    gifKey: relic.emojiName, // sacred_relic | supreme_relic
    animTitle: `Opening ${relic.action}…`,
    userId: discordId,
    // Keep the relic-open emoji in the result header (matches the animation).
    buildResult: () => buildResultMessage(results, balances, { headerEmoji: emoji(OPEN_EMOJI[relic.emojiName]) }),
  });
}

/** Weighted tier pick from essence_bag_def.rune_pool ([{tier,weight}], sums 100). */
function rollRuneTier(pool) {
  const total = pool.reduce((s, e) => s + Number(e.weight), 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= Number(e.weight);
    if (r < 0) return e.tier;
  }
  return pool[pool.length - 1].tier;
}

/**
 * Atomic rune-bag open: lock the bag column → validate count → per open roll a
 * tier from essence_bag_def.rune_pool then a uniform rune_roster row → INSERT
 * user_runes → deduct bags → game_logs → COMMIT.
 */
async function openRuneBagsTxn(discordId, bagKey, amount) {
  const bag = BAGS[bagKey];
  const col = bag.column; // whitelisted from constant map

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query(
      `SELECT ${col} AS count FROM users_bag WHERE discord_id = $1 FOR UPDATE`,
      [discordId]
    );
    if (bagRes.rows.length === 0) { await client.query('ROLLBACK'); return { ok: false, reason: 'nobag' }; }
    const previous = bagRes.rows[0].count;
    if (previous < amount) { await client.query('ROLLBACK'); return { ok: false, reason: 'insufficient', have: previous }; }

    const poolRes = await client.query('SELECT rune_pool FROM essence_bag_def WHERE bag_key = $1', [bag.poolKey]);
    if (poolRes.rows.length === 0) { await client.query('ROLLBACK'); return { ok: false, reason: 'no_pool' }; }
    const runePool = poolRes.rows[0].rune_pool;

    const drops = [];
    let selectionMs = 0;
    for (let i = 0; i < amount; i++) {
      const tier = rollRuneTier(runePool);
      const selectStarted = Date.now();
      const rune = await randomRuneForTier(client, tier);
      selectionMs += Date.now() - selectStarted;
      if (!rune) {
        performanceLog('open selection duration', {
          system: 'open',
          command: 'open_rune_bag',
          durationMs: selectionMs,
          count: amount,
        });
        await client.query('ROLLBACK');
        return { ok: false, reason: 'no_rune_pool' };
      }
      const rolledValue = rollRuneValue(rune.effect_key, rune.tier) ?? Number(rune.value);
      const runeUid = await generateUniqueRuneUid(client);
      await client.query(
        `INSERT INTO user_runes (rune_uid, discord_id, rune_id, socketed_into, is_locked, rolled_value)
         VALUES ($1, $2, $3, NULL, FALSE, $4)`,
        [runeUid, discordId, rune.rune_id, rolledValue]
      );
      drops.push({ id: runeUid, name: rune.name, tier: rune.tier, effect_key: rune.effect_key, value: rolledValue });
    }
    performanceLog('open selection duration', {
      system: 'open',
      command: 'open_rune_bag',
      durationMs: selectionMs,
      count: amount,
    });

    const remaining = previous - amount;
    await client.query(`UPDATE users_bag SET ${col} = ${col} - $2 WHERE discord_id = $1`, [discordId, amount]);
    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, 'Open Rune Bag', $2, $3, $4)`,
      [discordId, col, previous, remaining]
    );
    await client.query('COMMIT');
    return { ok: true, drops, remaining };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[open rune bag] transaction failed:', err.message);
    return { ok: false, reason: 'error' };
  } finally {
    client.release();
  }
}

/** `crd open <lb|gb|db> [amount]` — open stockpiled rune bags (max 20). */
async function openRuneBags(message, alias, rawAmount) {
  const bagKey = BAG_ALIAS[alias];
  const bag = BAGS[bagKey];
  const raw = rawAmount ?? '1';
  if (!/^\d+$/.test(raw)) { await reply(message, `Amount must be a whole number between 1 and ${RUNE_BAG_MAX_OPEN}.`); return; }
  const amount = parseInt(raw, 10);
  if (amount < 1 || amount > RUNE_BAG_MAX_OPEN) {
    await reply(message, `You can open between 1 and ${RUNE_BAG_MAX_OPEN} ${bag.display}s at a time.`);
    return;
  }

  const res = await openRuneBagsTxn(message.author.id, bagKey, amount);
  if (!res.ok) {
    if (res.reason === 'nobag') await reply(message, 'You don\'t have a bag yet. Use `crd register` first.');
    else if (res.reason === 'insufficient') await reply(message, `You don't have enough ${bag.display}s. You have ${res.have}.`);
    else if (res.reason === 'no_pool' || res.reason === 'no_rune_pool') await reply(message, 'Rune opening is temporarily unavailable (no rune pool seeded). Nothing was consumed.');
    else await reply(message, 'Something went wrong opening your bag. Nothing was consumed.');
    return;
  }

  const items = res.drops.map((d) => ({
    id: d.id, name: d.name, tier: d.tier, emoji: runeEmoji(d.effect_key), stats: runeDescription(d.effect_key, d.value),
    // [v5 #5] rune sprite from assets/items/runes/<key>_rune.png.
    imagePath: assetPath(`items/runes/${runeEmojiName(d.effect_key)}.png`),
  }));
  await playAnimatedOpen(message, {
    gifKey: bag.gifKey,
    // Rune-bag gif lives in assets/items/rune bag (e.g. lesser_bag.gif).
    gifPath: assetPath(`items/rune bag/${bagKey}_bag.gif`),
    animTitle: `Opening ${amount} × ${bag.display}…`,
    buildResult: () => buildRuneResultPayload({
      gifKey: bag.gifKey,
      title: `Opened ${amount} × ${bag.display}`,
      items,
      remaining: res.remaining,
      bagLabel: bag.display,
      bagEmoji: bagEmoji(bagKey),
    }),
  });
}

module.exports = { execute, openChestsTxn, openRuneBagsTxn };

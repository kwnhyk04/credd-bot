'use strict';

/**
 * `crd raid` / `crd r` — PvE raid vs a random mob (Master §13, Phase 7).
 *
 * Flow: spawn (80/20 via config/raidLoot, level = player ± 5 clamp [1,55]) →
 * battleEngine.resolveBattle (whole fight decided up-front) → rewards committed
 * in ONE transaction driven by sim.winner → battleRender animation with the
 * rewards line on the final panel. Rewards land even if Discord rendering
 * fails afterward — the battle result is the source of truth.
 *
 * active_battles (§35.0: raids persist): used as a per-player concurrency
 * guard + crash-visible record. Row is claimed before rewards commit (battle
 * snapshot data, message_id placeholder updated once the battle message
 * exists) and deleted in `finally`. A row older than 5 minutes is considered
 * stale (crashed battle) and taken over.
 *
 * Reward rolls draw from the SAME seeded stream as the spawn rolls, so a seed
 * fully determines spawn + battle + drops.
 */

const pool = require('../../db/pool');
const { resolveBattle, rngOf } = require('../../engine/battleEngine');
const {
  buildPlayerFighter, buildMobFighter, fetchRandomMob, rollMobLevel,
} = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { RAID_LOOT } = require('../../config/raidLoot');
const { applyCombatExp } = require('../../config/combatExp');

const STALE_BATTLE_MINUTES = 5;

// users_bag chest columns a raid may drop — identifiers interpolated ONLY from
// this whitelist, never from config/user input directly.
const CHEST_COLUMNS = { silver_chest: 'silver_chest', gold_chest: 'gold_chest' };
const CHEST_LABELS = { silver_chest: 'Silver Chest', gold_chest: 'Gold Chest' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

const randInt = (rng, [min, max]) => min + Math.floor(rng() * (max - min + 1));

/** Claim the player's active_battles slot. False = a live battle already exists. */
async function claimBattleSlot(discordId, channelId, sim, mobRow, level) {
  const vals = [
    discordId, channelId, mobRow.mob_id, level,
    sim.a.hp, sim.a.maxHp, sim.b.hp, sim.b.maxHp,
    sim.rounds.length, sim.playerFirst,
  ];
  const ins = await pool.query(
    `INSERT INTO active_battles
       (discord_id, channel_id, message_id, battle_type, mob_id, enemy_level,
        player_hp, player_max_hp, enemy_hp, enemy_max_hp, current_turn, player_goes_first)
     VALUES ($1, $2, '0', 'raid', $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (discord_id) DO NOTHING
     RETURNING battle_id`,
    vals
  );
  if (ins.rows.length > 0) return true;
  // existing row: take it over only if stale (crashed/abandoned battle)
  const upd = await pool.query(
    `UPDATE active_battles
        SET channel_id = $2, message_id = '0', battle_type = 'raid', mob_id = $3,
            enemy_level = $4, player_hp = $5, player_max_hp = $6, enemy_hp = $7,
            enemy_max_hp = $8, current_turn = $9, player_goes_first = $10,
            active_debuffs = '[]'::jsonb, battle_log = '[]'::jsonb,
            overcharge_pct = 0, bleed_stacks = '[]'::jsonb, started_at = NOW()
      WHERE discord_id = $1
        AND started_at < NOW() - INTERVAL '${STALE_BATTLE_MINUTES} minutes'
      RETURNING battle_id`,
    vals
  );
  return upd.rows.length > 0;
}

/**
 * Commit the battle outcome atomically: users_bag drops (lock first), then
 * user_character exp/level/counters, then the immutable raid_logs row.
 * Returns the reward summary for the panel footer.
 */
async function commitRewards(discordId, sim, mobRow, rng) {
  const won = sim.winner === 'a';
  const loot = RAID_LOOT[mobRow.mob_type];
  if (!loot) throw new Error(`no loot table for mob_type ${mobRow.mob_type}`);

  // roll drops (stream continuation — deterministic per seed)
  let credux = 0, shards = 0, chestCol = null;
  let exp;
  if (won) {
    credux = randInt(rng, loot.win.credux);
    exp = randInt(rng, loot.win.exp);
    shards = rng() < loot.win.shardChance ? randInt(rng, loot.win.shards) : 0;
    chestCol = rng() < loot.win.chestChance ? CHEST_COLUMNS[loot.win.chest] : null;
  } else {
    exp = loot.loss.exp;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bagRes = await client.query(
      'SELECT credux, belief_shards FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    const chRes = await client.query(
      'SELECT combat_level, combat_exp FROM user_character WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bagRes.rows.length === 0 || chRes.rows.length === 0) {
      throw new Error('player rows missing');
    }
    const ch = chRes.rows[0];
    const lvl = applyCombatExp(ch.combat_level, ch.combat_exp, exp);

    const bagUpd = await client.query(
      `UPDATE users_bag
          SET credux = credux + $2,
              belief_shards = belief_shards + $3
              ${chestCol ? `, ${chestCol} = ${chestCol} + 1` : ''}
        WHERE discord_id = $1
        RETURNING credux, belief_shards`,
      [discordId, credux, shards]
    );
    await client.query(
      `UPDATE user_character
          SET combat_level = $2, combat_exp = $3,
              ${won ? 'raids_won = raids_won + 1' : 'raids_lost = raids_lost + 1'}
        WHERE discord_id = $1`,
      [discordId, lvl.level, lvl.exp]
    );
    await client.query(
      `INSERT INTO raid_logs
         (discord_id, battle_type, enemy_name, enemy_tier, result, exp_earned,
          updated_exp, belief_shards_dropped, updated_belief_shards,
          credux_earned, updated_credux, chest_dropped)
       VALUES ($1, 'raid', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        discordId, mobRow.name, mobRow.mob_type, won ? 'win' : 'loss',
        exp, lvl.exp, shards, bagUpd.rows[0].belief_shards,
        credux, bagUpd.rows[0].credux, chestCol ? CHEST_LABELS[chestCol] : null,
      ]
    );
    await client.query('COMMIT');
    return {
      won, credux, exp, shards,
      chestLabel: chestCol ? CHEST_LABELS[chestCol] : null,
      levelFrom: ch.combat_level, levelTo: lvl.level, leveledUp: lvl.leveledUp,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Canvas-safe rewards line (DejaVu glyphs only — no unicode emoji).
 *  runBattle prefixes "<Mob> defeated! Rewards:" / "Defeated by <Mob>... Rewards:". */
function rewardsLine(r) {
  if (!r.won) return `+${r.exp} EXP`;
  const parts = [`+${r.credux.toLocaleString()} Credux`, `+${r.exp} EXP`];
  if (r.shards > 0) parts.push(`+${r.shards} Belief Shards`);
  if (r.chestLabel) parts.push(`${r.chestLabel}!`);
  if (r.leveledUp) parts.push(`LEVEL UP! ${r.levelFrom} → ${r.levelTo}`);
  return parts.join('  ·  ');
}

async function execute(message) {
  const discordId = message.author.id;
  try {
    const fighter = await buildPlayerFighter(pool, discordId);
    if (!fighter) {
      return reply(message, 'You have no character — use `crd create character` first.');
    }

    const seed = Date.now() >>> 0;
    const rng = rngOf(seed);
    const mobRow = await fetchRandomMob(pool, rng);
    if (!mobRow) return reply(message, 'No mobs are available to fight right now.');
    const level = rollMobLevel(fighter.level, rng);
    const mob = buildMobFighter(mobRow, level);

    const sim = resolveBattle(fighter, mob, { mode: 'raid', seed });

    const claimed = await claimBattleSlot(discordId, message.channel.id, sim, mobRow, level);
    if (!claimed) {
      return reply(message, '⚔️ You are already in a battle — wait for it to finish.');
    }

    try {
      const rewards = await commitRewards(discordId, sim, mobRow, rng);
      await runBattle(message.channel, {
        mode: 'raid',
        sim,
        rewards: rewardsLine(rewards),
        onMessage: (msg) => pool.query(
          'UPDATE active_battles SET message_id = $2, channel_id = $3 WHERE discord_id = $1',
          [discordId, msg.id, msg.channel.id]
        ),
      });
    } finally {
      await pool.query('DELETE FROM active_battles WHERE discord_id = $1', [discordId])
        .catch(() => {});
    }
  } catch (err) {
    console.error('[raid]', err);
    return reply(message, 'Raid failed — nothing was consumed.').catch(() => {});
  }
}

module.exports = { execute };

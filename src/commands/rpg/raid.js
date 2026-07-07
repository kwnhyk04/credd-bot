'use strict';

/**
 * `crd raid` / `crd r` — PvE raid vs a random mob (Master §13, Phase 7).
 *
 * Flow: spawn (80/20 via config/raidLoot, level = player -2..+15 clamp [1,55]) →
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
const { resolveSkin } = require('../../engine/skinResolver');
const { RAID_LOOT } = require('../../config/raidLoot');
const { awardCombatExp } = require('../../utils/awardCombatExp');
const { progressQuests } = require('../../utils/questProgress');

const STALE_BATTLE_MINUTES = 5;

// users_bag chest columns a raid may drop — identifiers interpolated ONLY from
// this whitelist, never from config/user input directly.
const CHEST_COLUMNS = { silver_chest: 'silver_chest', gold_chest: 'gold_chest' };
const CHEST_LABELS = { silver_chest: 'Silver Chest', gold_chest: 'Gold Chest' };

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

const randInt = (rng, [min, max]) => min + Math.floor(rng() * (max - min + 1));

function rewardSummaryText(sim, mobName, rewards) {
  const won = sim.winner === 'a';
  const lines = [
    won ? `${mobName} defeated!` : `Defeated by ${mobName}.`,
    'Rewards Obtained:',
  ];
  const parts = [];
  if (won) {
    parts.push(`🪙 +${Number(rewards.credux || 0).toLocaleString()} Credux`);
    parts.push(`✨ +${Number(rewards.exp || 0).toLocaleString()} EXP`);
    if (Number(rewards.shards || 0) > 0) {
      parts.push(`🔮 +${Number(rewards.shards).toLocaleString()} Belief Shards`);
    }
    if (rewards.chestLabel) parts.push(`🎁 ${rewards.chestLabel} x1`);
    if (rewards.leveledUp) parts.push(`⬆️ LEVEL UP! ${rewards.levelFrom} -> ${rewards.levelTo}`);
  } else {
    parts.push(`✨ +${Number(rewards.exp || 0).toLocaleString()} EXP`);
  }
  lines.push(parts.join(' · '));
  return lines.join('\n');
}

function isDiscordMissingPermissions(err) {
  return err?.code === 50013 || err?.rawError?.code === 50013;
}

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
 * user_character exp/level/counters (via the shared awardCombatExp util —
 * bag → character lock order, Phase-5 convention), then the game_logs audit
 * rows (one per currency/item changed, action 'Raid'), then the immutable
 * raid_logs row. Returns the reward summary for the panel footer.
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
    if (bagRes.rows.length === 0) {
      throw new Error('player rows missing');
    }
    const bagBefore = bagRes.rows[0];

    const bagUpd = await client.query(
      `UPDATE users_bag
          SET credux = credux + $2,
              belief_shards = belief_shards + $3,
              lifetime_credux_earned = lifetime_credux_earned + $2
              ${chestCol ? `, ${chestCol} = ${chestCol} + 1` : ''}
        WHERE discord_id = $1
        RETURNING credux, belief_shards${chestCol ? `, ${chestCol}` : ''}`,
      [discordId, credux, shards]
    );
    const bagAfter = bagUpd.rows[0];

    // bag → character lock order (Phase-5 convention); the util locks + levels
    const lvl = await awardCombatExp(client, discordId, exp);
    await client.query(
      `UPDATE user_character
          SET ${won ? 'raids_won = raids_won + 1' : 'raids_lost = raids_lost + 1'}
        WHERE discord_id = $1`,
      [discordId]
    );
    // game_logs — one row per currency/item changed (action 'Raid')
    if (credux > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
         VALUES ($1, 'Raid', $2, $3)`,
        [discordId, bagBefore.credux, bagAfter.credux]
      );
    }
    if (shards > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
         VALUES ($1, 'Raid', $2, $3)`,
        [discordId, bagBefore.belief_shards, bagAfter.belief_shards]
      );
    }
    if (chestCol) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
         VALUES ($1, 'Raid', $2, $3, $4)`,
        [discordId, chestCol, bagAfter[chestCol] - 1, bagAfter[chestCol]]
      );
    }

    await client.query(
      `INSERT INTO raid_logs
         (discord_id, battle_type, enemy_name, enemy_tier, result, exp_earned,
          updated_exp, belief_shards_dropped, updated_belief_shards,
          credux_earned, updated_credux, chest_dropped)
       VALUES ($1, 'raid', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        discordId, mobRow.name, mobRow.mob_type, won ? 'win' : 'loss',
        exp, lvl.newExp, shards, bagAfter.belief_shards,
        credux, bagAfter.credux, chestCol ? CHEST_LABELS[chestCol] : null,
      ]
    );

    // daily-quest progress (§20) — bag lock already held → bag → character → quests
    // order. Raid win → raid_wins; an elite win also progresses elite_defeats.
    let questNotices = [];
    if (won) {
      const deltas = { raid_wins: 1 };
      if (mobRow.mob_type === 'elite') deltas.elite_defeats = 1;
      questNotices = await progressQuests(client, discordId, deltas);
    }

    await client.query('COMMIT');
    return {
      won, credux, exp, shards,
      chestLabel: chestCol ? CHEST_LABELS[chestCol] : null,
      levelFrom: lvl.previousLevel, levelTo: lvl.newLevel, leveledUp: lvl.leveledUp,
      questNotices,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
      // Plain-text intro naming the mob (RenderTweaks Tweak 3) — sent before the battle render.
      const introText = mobRow.mob_type === 'elite'
        ? `⚠️ You ventured too deep — **${mobRow.name}** emerges from the shadows...`
        : `You ran into the territory of **${mobRow.name}**...`;
      if (message.isSlash) {
        await message.reply({ content: introText, allowedMentions: { parse: [] } });
      } else {
        await message.channel.send({ content: introText, allowedMentions: { parse: [] } })
          .catch(() => {});
      }

      // the summary object renders as battleRender's rewards strip
      const rewards = await commitRewards(discordId, sim, mobRow, rng);
      let battleSkinPath = null;
      let resultSkinPath = null;
      try {
        battleSkinPath = (await resolveSkin(pool, discordId, 'battle')).path;
        // STRICT outcome: win → victory canvas, loss → defeated canvas.
        const variant = sim.winner === 'a' ? 'victory' : 'defeated';
        resultSkinPath = (await resolveSkin(pool, discordId, 'battle_result', { variant })).path;
      } catch (err) {
        // Cosmetics are display-only; a resolver failure must never undo or
        // misreport an already-committed battle result.
        console.warn('[raid] battle skin resolution:', err.message);
      }
      try {
        await runBattle(message.channel, {
          mode: 'raid',
          sim,
          battleSkinPath,
          resultSkinPath,
          rewards,
          notices: rewards.questNotices,
          ownerId: discordId,
          onMessage: (msg) => pool.query(
            'UPDATE active_battles SET message_id = $2, channel_id = $3 WHERE discord_id = $1',
            [discordId, msg.id, msg.channel.id]
          ),
        });
      } catch (err) {
        const hint = isDiscordMissingPermissions(err)
          ? '\n\nI could not update the battle image in this channel. Please give the bot Send Messages, Embed Links, Attach Files, Read Message History, and Use External Emojis.'
          : '\n\nI could not render the battle image, but the battle was already resolved.';
        if (isDiscordMissingPermissions(err)) {
          console.warn(
            `[raid] render failed after rewards were committed: Discord missing permissions `
            + `(guild=${message.guildId || 'unknown'}, channel=${message.channel?.id || 'unknown'}).`
          );
        } else {
          console.error('[raid] render failed after rewards were committed:', err);
        }
        await reply(message, `${rewardSummaryText(sim, mobRow.name, rewards)}${hint}`).catch(() => {});
      }
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

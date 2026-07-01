'use strict';

/**
 * `crd auto raid` / `crd ar` — idle/passive raid system.
 *
 * A free, no-loss timer that banks the EXPECTED yield of grinding `crd raid` for
 * a window sized by the player's combat level (30 min per level → L50 = 25 hr).
 * It never loses, never blocks manual `crd raid` (separate `active_battles`), and
 * is re-startable the moment the previous run is claimed.
 *
 * All reward magnitudes are derived at runtime from config/raidLoot.js (RAID_LOOT
 * ranges + ELITE_SPAWN_CHANCE) so they track the real raid loot exactly — no
 * duplicated balance constants here. The payout is a deterministic expected value
 * (average of each loot range, 80/20 regular/elite split, all wins), computed at
 * claim from the combat level snapshotted at Start. Rewards: Combat EXP + Credux +
 * Belief Shards only (chests are NOT granted by auto raid).
 *
 * State lives in the `auto_raids` table (one row per player; deleted on claim):
 *   no row                  → Start card (Start button)
 *   row, NOW() < ends_at    → Progress card (no button)
 *   row, NOW() >= ends_at   → Claim card (Claim button)
 *
 * Reward grant mirrors raid.js commitRewards: users_bag lock → bag UPDATE →
 * awardCombatExp (bag→character lock order) → game_logs audit → delete row.
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { RAID_LOOT, ELITE_SPAWN_CHANCE } = require('../../config/raidLoot');
const { awardCombatExp } = require('../../utils/awardCombatExp');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { emojiForDisplay } = require('../../utils/emojis');

const ACCENT = 0x57c0ff;
const MIN_PER_LEVEL = 30;     // window minutes per combat level
const SEC_PER_RAID = 60;      // virtual raid cadence (one raid per 60 s of window)

// Idle-drop scale-down: passive farming pays a fraction of the expected raid
// value per reward type (manual `crd raid` stays the faster/fuller path). Tunable.
const EXP_SCALE = 0.5;        // Combat EXP: 50% of expected raid yield
const CREDUX_SCALE = 0.5;     // Credux: 50% of expected raid yield
const SHARD_SCALE = 0.2;      // Belief Shards: 20% of expected raid yield

// Render mentions without pinging.
const NO_PING = { parse: [], repliedUser: false };

const avg = ([a, b]) => (a + b) / 2;

/** Window length in seconds for a given combat level (snapshot at Start). */
function windowSecondsFor(level) {
  return Math.max(1, Number(level) || 1) * MIN_PER_LEVEL * 60;
}

/**
 * Deterministic expected payout for a full window at `level`. Derived from
 * RAID_LOOT (no hardcoded duplicates). Always-win, no losses. EXP + Credux +
 * Belief Shards only (no chests).
 */
function computeRewards(level) {
  const windowSec = windowSecondsFor(level);
  const raids = Math.floor(windowSec / SEC_PER_RAID);
  const eliteRaids = Math.round(raids * ELITE_SPAWN_CHANCE);
  const regRaids = raids - eliteRaids;

  const reg = RAID_LOOT.regular.win;
  const elite = RAID_LOOT.elite.win;

  const exp = Math.round((regRaids * avg(reg.exp) + eliteRaids * avg(elite.exp)) * EXP_SCALE);
  const credux = Math.round((regRaids * avg(reg.credux) + eliteRaids * avg(elite.credux)) * CREDUX_SCALE);
  const shards = Math.round(
    (regRaids * avg(reg.shards) * reg.shardChance
      + eliteRaids * avg(elite.shards) * elite.shardChance) * SHARD_SCALE,
  );

  return { windowSec, raids, regRaids, eliteRaids, exp, credux, shards };
}

/** "Xh Ym" / "Ym" from seconds. */
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function rewardLines(rw) {
  const credux = emojiForDisplay('Credux Coin', '💰');
  const shard = emojiForDisplay('Belief Shards', '🔮');
  return (
    `✨ **+${rw.exp.toLocaleString()}** Combat EXP\n` +
    `${credux} **+${rw.credux.toLocaleString()}** Credux\n` +
    `${shard} **+${rw.shards.toLocaleString()}** Belief Shards`
  );
}

/** Read the character (class + combat level) and any active auto-raid row. */
async function loadState(discordId) {
  const [charRes, rowRes] = await Promise.all([
    pool.query('SELECT class, combat_level FROM user_character WHERE discord_id = $1', [discordId]),
    pool.query(
      `SELECT combat_level, ends_at,
              (ends_at <= NOW())            AS done,
              EXTRACT(EPOCH FROM ends_at)::bigint AS ends_epoch
         FROM auto_raids WHERE discord_id = $1`,
      [discordId],
    ),
  ]);
  return { character: charRes.rows[0] || null, run: rowRes.rows[0] || null };
}

/** Start card — no active run. */
function buildStartPayload(ownerId, character) {
  const level = character.combat_level;
  const rw = computeRewards(level);
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## ⚔️ Auto Raid'))
    .addTextDisplayComponents((td) => td.setContent(`-# User: <@${ownerId}>`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `**Class:** ${character.class}\n` +
      `**Combat Level:** ${level}\n` +
      `**Max Auto-Raid:** ${fmtDuration(rw.windowSec)}`,
    ))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Expected rewards on completion:'))
    .addTextDisplayComponents((td) => td.setContent(rewardLines(rw)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      '-# 💡 Free & no losses. Press **Start**, then return after the timer and run `crd auto raid` to claim. You can still `crd raid` while it runs.',
    ));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`araid:start:${ownerId}`).setLabel('⚔️ Start Auto Raid').setStyle(ButtonStyle.Success),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PING };
}

/** Progress card — run active, not yet complete. */
function buildProgressPayload(ownerId, endsEpoch, level) {
  const rw = computeRewards(level);
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## ⚔️ Auto Raid — In Progress'))
    .addTextDisplayComponents((td) => td.setContent(`-# User: <@${ownerId}>`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `Your character is raiding… Return <t:${endsEpoch}:R> (<t:${endsEpoch}:f>) and run \`crd auto raid\` to claim your rewards.`,
    ))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Expected rewards on completion:'))
    .addTextDisplayComponents((td) => td.setContent(rewardLines(rw)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# 💡 You can still `crd raid` manually while this runs.'));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PING };
}

/** Claim card — run complete, awaiting claim. */
function buildClaimPayload(ownerId, level) {
  const rw = computeRewards(level);
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## ⚔️ Auto Raid — Complete!'))
    .addTextDisplayComponents((td) => td.setContent(`-# User: <@${ownerId}>`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('Your raiders have returned victorious. Claim your spoils:'))
    .addTextDisplayComponents((td) => td.setContent(rewardLines(rw)))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# 💡 You can start another auto raid right after claiming.'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`araid:claim:${ownerId}`).setLabel('🎁 Claim Rewards').setStyle(ButtonStyle.Success),
  );
  return { components: [container, row], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PING };
}

/** Claimed summary — terminal, no buttons. */
function buildClaimedPayload(ownerId, rw, lvl) {
  const levelNote = lvl.leveledUp
    ? `\n📈 **Combat Level ${lvl.previousLevel} → ${lvl.newLevel}!**`
    : '';
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents((td) => td.setContent('## ⚔️ Auto Raid — Claimed'))
    .addTextDisplayComponents((td) => td.setContent(`-# User: <@${ownerId}>`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(rewardLines(rw) + levelNote))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Run `crd auto raid` to start another.'));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_PING };
}

async function execute(message) {
  const discordId = message.author.id;
  const args = message.args || [];
  if ((args[0] || '').toLowerCase() !== 'raid') {
    return message.reply({
      content: 'Usage: `crd auto raid` — start a free passive raid (30 min per combat level, max 25 hr).',
      allowedMentions: { repliedUser: false },
    });
  }

  const { character, run } = await loadState(discordId);
  if (!character) {
    return message.reply({
      content: 'You have no character — use `crd create character` first.',
      allowedMentions: { repliedUser: false },
    });
  }

  let payload;
  if (!run) {
    payload = buildStartPayload(discordId, character);
  } else if (!run.done) {
    payload = buildProgressPayload(discordId, Number(run.ends_epoch), run.combat_level);
  } else {
    payload = buildClaimPayload(discordId, run.combat_level);
  }
  return message.reply(payload);
}

/** Owner-check helper for button presses. */
async function rejectIfNotOwner(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'This isn\'t your auto raid.', flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

/** Start button — INSERT the run (one per player) and flip the message to Progress. */
async function handleStart(interaction, ownerId) {
  if (await rejectIfNotOwner(interaction, ownerId)) return;

  await interaction.deferUpdate();
  let started = false;
  try {
    const charRes = await pool.query(
      'SELECT combat_level FROM user_character WHERE discord_id = $1', [ownerId],
    );
    if (charRes.rows.length === 0) {
      await interaction.followUp({ content: 'You have no character.', flags: MessageFlags.Ephemeral });
      return;
    }
    const level = charRes.rows[0].combat_level;
    const windowSec = windowSecondsFor(level);

    const ins = await pool.query(
      `INSERT INTO auto_raids (discord_id, ends_at, combat_level)
       VALUES ($1, NOW() + ($2 || ' seconds')::interval, $3)
       ON CONFLICT (discord_id) DO NOTHING
       RETURNING EXTRACT(EPOCH FROM ends_at)::bigint AS ends_epoch`,
      [ownerId, String(windowSec), level],
    );
    if (ins.rows.length === 0) {
      await interaction.followUp({ content: '⚔️ You already have an auto raid running.', flags: MessageFlags.Ephemeral });
      return;
    }
    started = true;
    await interaction.editReply(buildProgressPayload(ownerId, Number(ins.rows[0].ends_epoch), level));
  } catch (err) {
    console.error('[autoRaid] start failed:', err);
    await interaction.followUp({
      content: started
        ? 'Auto raid started, but the message could not refresh. Run `crd auto raid` to check progress.'
        : 'Auto raid start failed. Try again.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

/** Claim button — verify completion, grant rewards atomically, delete the run. */
async function handleClaim(interaction, ownerId) {
  if (await rejectIfNotOwner(interaction, ownerId)) return;

  await interaction.deferUpdate();
  let client;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const rowRes = await client.query(
      `SELECT combat_level, (ends_at <= NOW()) AS done,
              EXTRACT(EPOCH FROM ends_at)::bigint AS ends_epoch
         FROM auto_raids WHERE discord_id = $1 FOR UPDATE`,
      [ownerId],
    );
    if (rowRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await interaction.followUp({ content: 'No auto raid to claim. Run `crd auto raid` to start one.', flags: MessageFlags.Ephemeral });
      return;
    }
    const row = rowRes.rows[0];
    if (!row.done) {
      await client.query('ROLLBACK');
      await interaction.followUp({
        content: `⏳ Not finished yet — claimable <t:${Number(row.ends_epoch)}:R>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rw = computeRewards(row.combat_level);

    // users_bag lock → bag UPDATE (Phase-5 lock order: bag before character).
    const bagRes = await client.query(
      'SELECT credux, belief_shards FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [ownerId],
    );
    if (bagRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await interaction.followUp({ content: 'Your bag is missing — contact an admin.', flags: MessageFlags.Ephemeral });
      return;
    }
    const before = bagRes.rows[0];
    const bagUpd = await client.query(
      `UPDATE users_bag
          SET credux = credux + $2,
              belief_shards = belief_shards + $3,
              lifetime_credux_earned = lifetime_credux_earned + $2
        WHERE discord_id = $1
        RETURNING credux, belief_shards`,
      [ownerId, rw.credux, rw.shards],
    );
    const after = bagUpd.rows[0];

    const lvl = await awardCombatExp(client, ownerId, rw.exp);

    // game_logs — one row per currency changed (action 'AutoRaid').
    if (rw.credux > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_credux, updated_credux)
         VALUES ($1, 'AutoRaid', $2, $3)`,
        [ownerId, before.credux, after.credux],
      );
    }
    if (rw.shards > 0) {
      await client.query(
        `INSERT INTO game_logs (discord_id, action, previous_belief_shards, updated_belief_shards)
         VALUES ($1, 'AutoRaid', $2, $3)`,
        [ownerId, before.belief_shards, after.belief_shards],
      );
    }

    await client.query('DELETE FROM auto_raids WHERE discord_id = $1', [ownerId]);
    await client.query('COMMIT');
    committed = true;

    await interaction.editReply(buildClaimedPayload(ownerId, rw, lvl));
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[autoRaid] claim failed:', err);
    await interaction.followUp({
      content: committed
        ? 'Auto raid rewards were claimed, but the message could not refresh. Run `crd auto raid` to check current status.'
        : 'Claim failed — nothing was granted. Try again.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  } finally {
    if (client) client.release();
  }
}

module.exports = { execute, handleStart, handleClaim, computeRewards };

'use strict';

/**
 * `crd duel @user` — auto-PvP (Master §14, Phase 7).
 *
 * Challenge flow: challenge embed → only the challenged user can Accept/Decline
 * (60s window, collector-based like battleRender's Battle Log) → on Accept the
 * battle starts immediately, no pre-battle overview. Same engine as raids
 * (mode 'duel': both sides run weapon+deity passives, instakill disabled,
 * 50/50 first-attack roll); fighter 2's card renders MIRRORED.
 *
 * Duels run IN-MEMORY (§35.0 — no active_battles row). No EXP, no Credux, no
 * drops — purely friendly. The only writes: pvp_wins/pvp_losses counters and
 * the immutable pvp_logs row (challenger/opponent damage from sim.totals).
 * Loadouts are read at ACCEPT time, not challenge time.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { resolveBattle } = require('../../engine/battleEngine');
const { buildPlayerFighter } = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { isBanned } = require('../../handlers/middleware');

const CHALLENGE_WINDOW_MS = 60_000;

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/** §13.1/§35.0 conflict gate — true while the player has a live raid/boss row
 *  (duels themselves are in-memory and never stored in active_battles). */
async function inLiveBattle(discordId) {
  const res = await pool.query(
    'SELECT 1 FROM active_battles WHERE discord_id = $1', [discordId]
  );
  return res.rows.length > 0;
}

/** Counters + immutable log in one transaction. Rows locked in sorted-id order
 *  so two crossing duels can never deadlock. */
async function commitDuelResult(challengerId, opponentId, sim) {
  const winnerId = sim.winner === 'a' ? challengerId : opponentId;
  const loserId = sim.winner === 'a' ? opponentId : challengerId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockOrder = [challengerId, opponentId].sort();
    await client.query(
      'SELECT discord_id FROM user_character WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE',
      [lockOrder]
    );
    await client.query(
      'UPDATE user_character SET pvp_wins = pvp_wins + 1 WHERE discord_id = $1',
      [winnerId]
    );
    // TODO Phase-rep: duel_wins daily-quest hook (winner)
    await client.query(
      'UPDATE user_character SET pvp_losses = pvp_losses + 1 WHERE discord_id = $1',
      [loserId]
    );
    await client.query(
      `INSERT INTO pvp_logs (challenger_id, opponent_id, winner_id, challenger_damage, opponent_damage)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        challengerId, opponentId, winnerId,
        Math.floor(sim.totals.damageDealtToEnemy),   // damage the challenger dealt
        Math.floor(sim.totals.damageDealtToPlayer),  // damage the opponent dealt
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function execute(message) {
  const challenger = message.author;
  const target = message.mentions.users.first();
  if (!target) return reply(message, 'Usage: `crd duel @user`');
  if (target.id === challenger.id) return reply(message, 'You cannot duel yourself.');
  if (target.bot) return reply(message, 'You cannot duel a bot.');

  try {
    // challenger conflict gate — no challenges while mid-raid/boss
    if (await inLiveBattle(challenger.id)) {
      return reply(message, '⚔️ You are in a battle — finish it before challenging anyone.');
    }

    // challenged user passes the same gates: character (implies registered),
    // not banned, not mid-battle; loadouts are re-read at accept time
    const targetCheck = await pool.query(
      'SELECT 1 FROM user_character WHERE discord_id = $1', [target.id]
    );
    if (targetCheck.rows.length === 0) {
      return reply(message, `<@${target.id}> has no character yet — they need \`crd create character\` first.`);
    }
    if (await isBanned(target.id)) {
      return reply(message, `<@${target.id}> cannot be dueled right now.`);
    }
    if (await inLiveBattle(target.id)) {
      return reply(message, `<@${target.id}> is in a battle — try again when it's over.`);
    }

    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle('⚔️ Duel Challenge')
      .setDescription(
        `**${challenger.username}** challenges <@${target.id}> to a duel!\n` +
        '-# Auto-battle — no rewards. 60s to respond.'
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('duel_accept').setLabel('Accept').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('duel_decline').setLabel('Decline').setEmoji('🏃').setStyle(ButtonStyle.Danger),
    );
    const challengeMsg = await message.reply({
      content: `<@${target.id}>`,
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [target.id], repliedUser: false },
    });

    const collector = challengeMsg.createMessageComponentCollector({ time: CHALLENGE_WINDOW_MS });
    let settled = false;

    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== target.id) {
          await i.reply({ content: 'Only the challenged player can respond.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (settled) { await i.deferUpdate().catch(() => {}); return; }
        settled = true;
        collector.stop('settled');

        if (i.customId === 'duel_decline') {
          await i.update({
            embeds: [EmbedBuilder.from(embed).setColor(0xf23f43)
              .setDescription(`🏃 **${target.username}** declined the duel.`)],
            components: [],
          });
          return;
        }

        // re-check the conflict gate at accept time — either party may have
        // started a raid/boss attack during the challenge window
        const [cBusy, tBusy] = await Promise.all([
          inLiveBattle(challenger.id), inLiveBattle(target.id),
        ]);
        if (cBusy || tBusy) {
          const busyName = cBusy ? challenger.username : target.username;
          await i.update({
            embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6)
              .setDescription(`⚔️ Duel cancelled — **${busyName}** is mid-battle.`)],
            components: [],
          });
          return;
        }
        // TODO Phase-rep: duel_challenges daily-quest hook (accepted duel vs distinct opponent)

        // accept → battle starts immediately (no pre-battle overview, §14)
        await i.update({
          embeds: [EmbedBuilder.from(embed).setColor(0x43d675)
            .setDescription(`⚔️ **${target.username}** accepts! The duel begins...`)],
          components: [],
        });

        const [p1, p2] = await Promise.all([
          buildPlayerFighter(pool, challenger.id),
          buildPlayerFighter(pool, target.id),
        ]);
        if (!p1 || !p2) {
          await challengeMsg.channel.send('Duel cancelled — a duelist no longer has a character.');
          return;
        }

        const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
        await commitDuelResult(challenger.id, target.id, sim);
        await runBattle(challengeMsg.channel, { mode: 'duel', sim });
      } catch (err) {
        console.error('[duel]', err);
        // commit precedes render: a failure before COMMIT changed nothing; a
        // render failure after COMMIT already recorded the result.
        await challengeMsg.channel
          .send('Something went wrong running the duel.')
          .catch(() => {});
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'settled') return;
      challengeMsg.edit({
        embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6)
          .setDescription(`⌛ The challenge to **${target.username}** expired.`)],
        components: [],
      }).catch(() => {});
    });
  } catch (err) {
    console.error('[duel]', err);
    return reply(message, 'Duel failed — nothing was changed.').catch(() => {});
  }
}

module.exports = { execute };

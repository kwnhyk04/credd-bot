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
 * drops from the duel itself — purely friendly. Writes: pvp_wins/pvp_losses
 * counters, the immutable pvp_logs row (challenger/opponent damage from
 * sim.totals), and daily-quest progress (duel_wins / duel_challenges, §20 — a
 * completed quest still pays its own reward). Loadouts are read at ACCEPT time.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { resolveBattle } = require('../../engine/battleEngine');
const { buildPlayerFighter } = require('../../engine/statAssembly');
const { runBattle } = require('../../engine/battleRender');
const { resolveSkin } = require('../../engine/skinResolver');
const { isBanned } = require('../../handlers/middleware');
const { progressQuests } = require('../../utils/questProgress');

const CHALLENGE_WINDOW_MS = 60_000;
const MAX_DUEL_LEVEL = 50; // [Jun-2026 §3] current max combat level

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/**
 * [Jun-2026 §3] Parse an optional trailing level argument from the duel command.
 * Accepts `level 50`, `level50`, `lvl 50`, `lvl50` (case-insensitive, space optional);
 * the slash path injects a canonical `level<N>` token. Returns:
 *   null        — no level argument (each duelist fights at their own combat_level)
 *   number      — a valid normalized level in [1, 50]
 *   'invalid'   — a level token was present but out of range
 */
function parseDuelLevel(args) {
  const joined = (args || []).join(' ');
  const m = /(?:level|lvl)\s*0*(\d{1,3})/i.exec(joined);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DUEL_LEVEL) return 'invalid';
  return n;
}

/** §13.1/§35.0 conflict gate — true while the player has a live raid/boss row
 *  (duels themselves are in-memory and never stored in active_battles). */
async function inLiveBattle(discordId) {
  const res = await pool.query(
    'SELECT 1 FROM active_battles WHERE discord_id = $1', [discordId]
  );
  return res.rows.length > 0;
}

/** Counters + immutable log + daily-quest progress in one transaction. Rows locked in
 *  sorted-id order (users_bag → user_character, bag → character → quests order) so two
 *  crossing duels can never deadlock. Returns completion-notice lines (may be empty). */
async function commitDuelResult(challengerId, opponentId, sim) {
  const winnerId = sim.winner === 'a' ? challengerId : opponentId;
  const loserId = sim.winner === 'a' ? opponentId : challengerId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockOrder = [challengerId, opponentId].sort();
    // bag first (quest auto-grant credits it), then character — global lock order
    await client.query(
      'SELECT discord_id FROM users_bag WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE',
      [lockOrder]
    );
    await client.query(
      'SELECT discord_id FROM user_character WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE',
      [lockOrder]
    );
    await client.query(
      'UPDATE user_character SET pvp_wins = pvp_wins + 1 WHERE discord_id = $1',
      [winnerId]
    );
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

    // daily-quest progress (§20): challenger gets duel_challenges (accepted + fought),
    // the winner gets duel_wins. Merge when the challenger is the winner; progress per
    // user in sorted-id order (bag rows already locked above).
    // TODO Phase-rep: duel reputation award (§18) stays deferred.
    const deltaByUser = new Map();
    const bump = (id, type) => {
      const d = deltaByUser.get(id) || {};
      d[type] = (d[type] || 0) + 1;
      deltaByUser.set(id, d);
    };
    bump(challengerId, 'duel_challenges');
    bump(winnerId, 'duel_wins');
    const notices = [];
    for (const id of [...deltaByUser.keys()].sort()) {
      notices.push(...await progressQuests(client, id, deltaByUser.get(id)));
    }

    await client.query('COMMIT');
    return notices;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function execute(message) {
  const challenger = message.author;
  const target = message.getMention(0); // [v4.9] prefix @mention or slash user option
  if (!target) return reply(message, 'Usage: `crd duel @user`');
  if (target.id === challenger.id) return reply(message, 'You cannot duel yourself.');
  if (target.bot) return reply(message, 'You cannot duel a bot.');

  // [Jun-2026 §3] optional `level N` normalization (class-stat component only; gear unchanged).
  const duelLevel = parseDuelLevel(message.args);
  if (duelLevel === 'invalid') {
    return reply(message, `Level must be between 1 and ${MAX_DUEL_LEVEL}. Example: \`crd duel @user level 50\`.`);
  }

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
        (duelLevel != null ? `-# ⚖️ Both fight at **Level ${duelLevel}** (gear unchanged).\n` : '') +
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
        // accept → battle starts immediately (no pre-battle overview, §14). The
        // duel_challenges / duel_wins quest progress is committed in commitDuelResult.
        await i.update({
          embeds: [EmbedBuilder.from(embed).setColor(0x43d675)
            .setDescription(`⚔️ **${target.username}** accepts! The duel begins...`)],
          components: [],
        });

        // [Jun-2026 §3] when a level was given, recompute BOTH sides' class-stat component at N
        // (weapon + deity curr stats still apply as owned; nothing persisted).
        const [p1, p2] = await Promise.all([
          buildPlayerFighter(pool, challenger.id, { levelOverride: duelLevel }),
          buildPlayerFighter(pool, target.id, { levelOverride: duelLevel }),
        ]);
        if (!p1 || !p2) {
          await challengeMsg.channel.send('Duel cancelled — a duelist no longer has a character.');
          return;
        }

        const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
        const notices = await commitDuelResult(challenger.id, target.id, sim);
        // A duel has one shared message, so its visual theme belongs to the
        // challenger who opened it; both combatants still render in that skin's slots.
        let battleSkinPath = null;
        let resultSkinPath = null;
        try {
          battleSkinPath = (await resolveSkin(pool, challenger.id, 'battle')).path;
          // STRICT outcome from the challenger's POV (the shared message owner):
          // challenger wins → victory canvas, else defeated canvas.
          const variant = sim.winner === 'a' ? 'victory' : 'defeated';
          resultSkinPath = (await resolveSkin(pool, challenger.id, 'battle_result', { variant })).path;
        } catch (err) {
          console.warn('[duel] battle skin resolution:', err.message);
        }
        await runBattle(challengeMsg.channel, {
          mode: 'duel', sim, notices, battleSkinPath, resultSkinPath,
        });
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

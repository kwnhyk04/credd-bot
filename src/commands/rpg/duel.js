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
const {
  acquireDuelLock,
  attachDuelMessage,
  markDuelRunning,
  markDuelSettling,
  releaseDuelLock,
} = require('../../engine/duelLocks');
const { isBanned } = require('../../handlers/middleware');
const { progressQuests } = require('../../utils/questProgress');

const CHALLENGE_WINDOW_MS = 60_000;
const MAX_DUEL_LEVEL = 50; // [Jun-2026 §3] current max combat level
const WAGER_CAP = 50_000;          // [v5 §4.1] max Credux staked per wager duel
const BESTOW_DAILY_CAP = 1_000_000; // [v5 §4.1] wager winnings share the bestow daily cap

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

function lockFailureMessage(reason, targetId) {
  if (reason === 'missing_table') {
    return 'Duel locking is not ready yet. Please apply the active_duels migration and try again.';
  }
  return targetId
    ? `Either you or <@${targetId}> already has an active duel challenge. Finish it or wait for it to expire.`
    : 'A duelist already has an active duel challenge. Finish it or wait for it to expire.';
}

function mention(userOrId) {
  const id = typeof userOrId === 'string' ? userOrId : userOrId.id;
  return `<@${id}>`;
}

async function safeReleaseDuelLock(lock) {
  await releaseDuelLock(lock).catch((err) => console.error('[duel lock release]', err.message));
}

function isDiscordErrorCode(err, code) {
  return err?.code === code || err?.rawError?.code === code;
}

function isUnknownInteraction(err) {
  return isDiscordErrorCode(err, 10062);
}

async function acknowledgeButton(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    return true;
  } catch (err) {
    if (isUnknownInteraction(err)) return false;
    throw err;
  }
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

/**
 * Settle a wager duel: zero-sum Credux transfer (winner +stake, loser −stake),
 * clamped to the winner's remaining bestow-shared 1M/day headroom. NO rating, NO
 * casual win/loss counters. Logs to wager_logs. Returns { moved } actually transferred.
 */
async function commitWagerResult(challengerId, opponentId, winnerId, stake) {
  const loserId = winnerId === challengerId ? opponentId : challengerId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [challengerId, opponentId].sort();
    const bagRes = await client.query(
      'SELECT discord_id, credux FROM users_bag WHERE discord_id = ANY($1) ORDER BY discord_id FOR UPDATE',
      [ids]
    );
    const byId = Object.fromEntries(bagRes.rows.map((r) => [r.discord_id, r]));
    // winner's daily-cap headroom (bestow-shared)
    const uRes = await client.query(
      `SELECT bestow_received_today,
              (last_bestow_received = (NOW() AT TIME ZONE 'Asia/Manila')::date) AS is_today
         FROM users WHERE discord_id = $1 FOR UPDATE`,
      [winnerId]
    );
    const receivedToday = uRes.rows[0]?.is_today ? Number(uRes.rows[0].bestow_received_today) : 0;
    const headroom = Math.max(0, BESTOW_DAILY_CAP - receivedToday);
    // zero-sum: move only what the loser has AND the winner can still receive today
    const moved = Math.min(stake, Number(byId[loserId].credux), headroom);
    if (moved > 0) {
      await client.query('UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1', [loserId, moved]);
      await client.query('UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1', [winnerId, moved]);
      await client.query(
        `UPDATE users SET bestow_received_today = $2,
                          last_bestow_received  = (NOW() AT TIME ZONE 'Asia/Manila')::date
          WHERE discord_id = $1`,
        [winnerId, receivedToday + moved]
      );
    }
    await client.query(
      `INSERT INTO wager_logs (challenger_id, opponent_id, winner_id, amount) VALUES ($1, $2, $3, $4)`,
      [challengerId, opponentId, winnerId, moved]
    );
    await client.query('COMMIT');
    return { moved };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── crd duel wager @user <amount> ──────────────────────────────────────────
async function runWager(message, challenger, target, stake) {
  if (await inLiveBattle(challenger.id)) {
    return reply(message, '⚔️ You are in a battle — finish it before wagering.');
  }
  const targetCheck = await pool.query('SELECT 1 FROM user_character WHERE discord_id = $1', [target.id]);
  if (targetCheck.rows.length === 0) {
    return reply(message, `<@${target.id}> has no character yet.`);
  }
  if (await isBanned(target.id)) return reply(message, `<@${target.id}> cannot be dueled right now.`);
  if (await inLiveBattle(target.id)) return reply(message, `<@${target.id}> is in a battle.`);

  // both must currently afford the stake
  const balRes = await pool.query(
    'SELECT discord_id, credux FROM users_bag WHERE discord_id = ANY($1)', [[challenger.id, target.id]]
  );
  const bal = Object.fromEntries(balRes.rows.map((r) => [r.discord_id, Number(r.credux)]));
  if ((bal[challenger.id] || 0) < stake) return reply(message, `You don't have **${stake.toLocaleString()}** Credux to wager.`);
  if ((bal[target.id] || 0) < stake) return reply(message, `<@${target.id}> doesn't have **${stake.toLocaleString()}** Credux to wager.`);

  const duelLock = await acquireDuelLock({
    challengerId: challenger.id,
    opponentId: target.id,
    duelType: 'wager',
    stake,
    guildId: message.guild?.id ?? null,
    channelId: message.channel?.id ?? null,
  });
  if (!duelLock.ok) return reply(message, lockFailureMessage(duelLock.reason, target.id));

  const embed = new EmbedBuilder()
    .setColor(0xf0b232)
    .setTitle('💰 Wager Duel')
    .setDescription(
      `${mention(challenger)} stakes **${stake.toLocaleString()} Credux** against ${mention(target)}!\n` +
      '-# Winner takes the stake (shares the 1M/day cap). No rating. 60s to respond.'
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('duel_accept').setLabel('Accept').setEmoji('💰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('duel_decline').setLabel('Decline').setEmoji('🏃').setStyle(ButtonStyle.Danger),
  );
  let challengeMsg;
  try {
    challengeMsg = await message.reply({
      content: `<@${target.id}>`, embeds: [embed], components: [row],
      allowedMentions: { users: [target.id], repliedUser: false },
    });
  } catch (err) {
    await safeReleaseDuelLock(duelLock);
    throw err;
  }
  await attachDuelMessage(duelLock, challengeMsg.id).catch((err) => {
    console.warn('[wager lock] message attach:', err.message);
  });

  const collector = challengeMsg.createMessageComponentCollector({ time: CHALLENGE_WINDOW_MS });
  let settled = false;
  collector.on('collect', async (i) => {
    try {
      if (i.user.id !== target.id) {
        await i.reply({ content: 'Only the challenged player can respond.', flags: MessageFlags.Ephemeral })
          .catch((err) => {
            if (!isUnknownInteraction(err)) throw err;
          });
        return;
      }
      if (settled) { await acknowledgeButton(i); return; }
      if (!(await acknowledgeButton(i))) {
        await safeReleaseDuelLock(duelLock);
        collector.stop('stale-interaction');
        return;
      }
      settled = true;
      collector.stop('settled');

      if (i.customId === 'duel_decline') {
        await i.editReply({
          embeds: [EmbedBuilder.from(embed).setColor(0xf23f43).setDescription(`🏃 ${mention(target)} declined the wager.`)],
          components: [],
        });
        await safeReleaseDuelLock(duelLock);
        return;
      }
      const [cBusy, tBusy] = await Promise.all([inLiveBattle(challenger.id), inLiveBattle(target.id)]);
      if (cBusy || tBusy) {
        await i.editReply({
          embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6).setDescription('💰 Wager cancelled — a duelist is mid-battle.')],
          components: [],
        });
        await safeReleaseDuelLock(duelLock);
        return;
      }
      const running = await markDuelRunning(duelLock);
      if (!running.ok) {
        await i.editReply({
          embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6).setDescription('Wager cancelled - the duel challenge expired.')],
          components: [],
        });
        await safeReleaseDuelLock(duelLock);
        return;
      }
      try {
        await i.editReply({
        embeds: [EmbedBuilder.from(embed).setColor(0x43d675).setDescription(`💰 ${mention(target)} accepts! The duel begins...`)],
        components: [],
        });

      const [p1, p2] = await Promise.all([
        buildPlayerFighter(pool, challenger.id),
        buildPlayerFighter(pool, target.id),
      ]);
      if (!p1 || !p2) { await challengeMsg.channel.send('Wager cancelled — a duelist no longer has a character.'); return; }

      const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
      const winnerId = sim.winner === 'a' ? challenger.id : target.id;
      await markDuelSettling(duelLock).catch((err) => console.warn('[wager lock] settling:', err.message));
      const { moved } = await commitWagerResult(challenger.id, target.id, winnerId, stake);
      const winnerMention = mention(winnerId);
      const stakeLine = moved > 0
        ? `💰 ${winnerMention} wins **${moved.toLocaleString()} Credux**!`
        : `💰 ${winnerMention} wins — but the daily cap left no Credux to transfer.`;

      let battleSkinPath = null;
      let resultSkinPath = null;
      try {
        battleSkinPath = (await resolveSkin(pool, challenger.id, 'battle')).path;
        const variant = sim.winner === 'a' ? 'victory' : 'defeated';
        resultSkinPath = (await resolveSkin(pool, challenger.id, 'battle_result', { variant })).path;
      } catch (err) {
        console.warn('[wager] skin resolution:', err.message);
      }
      await runBattle(challengeMsg.channel, { mode: 'duel', sim, notices: [stakeLine], battleSkinPath, resultSkinPath });
      } finally {
        await safeReleaseDuelLock(duelLock);
      }
    } catch (err) {
      if (isUnknownInteraction(err)) {
        await safeReleaseDuelLock(duelLock);
        collector.stop('stale-interaction');
        return;
      }
      await safeReleaseDuelLock(duelLock);
      console.error('[wager]', err);
      await challengeMsg.channel.send('Something went wrong running the wager.').catch(() => {});
    }
  });
  collector.on('end', (_c, reason) => {
    if (reason === 'settled') return;
    safeReleaseDuelLock(duelLock);
    challengeMsg.edit({
      embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6).setDescription(`⌛ The wager to ${mention(target)} expired.`)],
      components: [],
    }).catch(() => {});
  });
}

async function execute(message) {
  const challenger = message.author;

  // [v5 §4.1] wager mode: `crd duel wager @user <amount>`
  if ((message.args[0] || '').toLowerCase() === 'wager') {
    const wTarget = message.getMention(0);
    if (!wTarget) return reply(message, 'Usage: `crd duel wager @user <amount>`');
    if (wTarget.id === challenger.id) return reply(message, 'You cannot wager against yourself.');
    if (wTarget.bot) return reply(message, 'You cannot wager against a bot.');
    const amtToken = message.args.map((a) => a.replace(/,/g, '')).find((a) => /^\d+$/.test(a));
    const stake = Number(amtToken);
    if (!amtToken || !Number.isInteger(stake) || stake <= 0) {
      return reply(message, 'Enter a positive stake — e.g. `crd duel wager @user 10000`.');
    }
    if (stake > WAGER_CAP) return reply(message, `Wager cap is **${WAGER_CAP.toLocaleString()}** Credux per duel.`);
    return runWager(message, challenger, wTarget, stake);
  }

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

    const duelLock = await acquireDuelLock({
      challengerId: challenger.id,
      opponentId: target.id,
      duelType: 'casual',
      guildId: message.guild?.id ?? null,
      channelId: message.channel?.id ?? null,
    });
    if (!duelLock.ok) return reply(message, lockFailureMessage(duelLock.reason, target.id));

    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle('⚔️ Duel Challenge')
      .setDescription(
        `${mention(challenger)} challenges ${mention(target)} to a duel!\n` +
        (duelLevel != null ? `-# ⚖️ Both fight at **Level ${duelLevel}** (gear unchanged).\n` : '') +
        '-# Auto-battle — no rewards. 60s to respond.'
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('duel_accept').setLabel('Accept').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('duel_decline').setLabel('Decline').setEmoji('🏃').setStyle(ButtonStyle.Danger),
    );
    let challengeMsg;
    try {
      challengeMsg = await message.reply({
        content: `<@${target.id}>`,
        embeds: [embed],
        components: [row],
        allowedMentions: { users: [target.id], repliedUser: false },
      });
    } catch (err) {
      await safeReleaseDuelLock(duelLock);
      throw err;
    }
    await attachDuelMessage(duelLock, challengeMsg.id).catch((err) => {
      console.warn('[duel lock] message attach:', err.message);
    });

    const collector = challengeMsg.createMessageComponentCollector({ time: CHALLENGE_WINDOW_MS });
    let settled = false;

    collector.on('collect', async (i) => {
      try {
        if (i.user.id !== target.id) {
          await i.reply({ content: 'Only the challenged player can respond.', flags: MessageFlags.Ephemeral })
            .catch((err) => {
              if (!isUnknownInteraction(err)) throw err;
            });
          return;
        }
        if (settled) { await acknowledgeButton(i); return; }
        if (!(await acknowledgeButton(i))) {
          await safeReleaseDuelLock(duelLock);
          collector.stop('stale-interaction');
          return;
        }
        settled = true;
        collector.stop('settled');

        if (i.customId === 'duel_decline') {
          await i.editReply({
            embeds: [EmbedBuilder.from(embed).setColor(0xf23f43)
              .setDescription(`🏃 ${mention(target)} declined the duel.`)],
            components: [],
          });
          await safeReleaseDuelLock(duelLock);
          return;
        }

        // re-check the conflict gate at accept time — either party may have
        // started a raid/boss attack during the challenge window
        const [cBusy, tBusy] = await Promise.all([
          inLiveBattle(challenger.id), inLiveBattle(target.id),
        ]);
        if (cBusy || tBusy) {
          const busyMention = mention(cBusy ? challenger : target);
          await i.editReply({
            embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6)
              .setDescription(`⚔️ Duel cancelled — ${busyMention} is mid-battle.`)],
            components: [],
          });
          await safeReleaseDuelLock(duelLock);
          return;
        }
        // accept → battle starts immediately (no pre-battle overview, §14). The
        const running = await markDuelRunning(duelLock);
        if (!running.ok) {
          await i.editReply({
            embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6)
              .setDescription('Duel cancelled - the challenge expired.')],
            components: [],
          });
          await safeReleaseDuelLock(duelLock);
          return;
        }
        // duel_challenges / duel_wins quest progress is committed in commitDuelResult.
        try {
          await i.editReply({
          embeds: [EmbedBuilder.from(embed).setColor(0x43d675)
            .setDescription(`⚔️ ${mention(target)} accepts! The duel begins...`)],
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
        await markDuelSettling(duelLock).catch((err) => console.warn('[duel lock] settling:', err.message));
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
        } finally {
          await safeReleaseDuelLock(duelLock);
        }
      } catch (err) {
        if (isUnknownInteraction(err)) {
          await safeReleaseDuelLock(duelLock);
          collector.stop('stale-interaction');
          return;
        }
        await safeReleaseDuelLock(duelLock);
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
      safeReleaseDuelLock(duelLock);
      challengeMsg.edit({
        embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6)
          .setDescription(`⌛ The challenge to ${mention(target)} expired.`)],
        components: [],
      }).catch(() => {});
    });
  } catch (err) {
    console.error('[duel]', err);
    return reply(message, 'Duel failed — nothing was changed.').catch(() => {});
  }
}

module.exports = { execute };

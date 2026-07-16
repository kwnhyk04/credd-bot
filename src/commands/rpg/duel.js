'use strict';

/**
 * `crd duel @user` — auto-PvP (Master §14, Phase 7).
 *
 * Challenge flow: challenge embed → only the challenged user can Accept/Decline
 * (60s window, globally routed with a persisted DB lock) → on Accept the battle
 * starts immediately, no pre-battle overview. Same engine as raids
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
  cancelPendingDuel,
  findDuelByMessage,
  markDuelRunning,
  markDuelSettling,
  releaseDuelLock,
} = require('../../engine/duelLocks');
const { isBanned } = require('../../handlers/middleware');
const { progressQuests } = require('../../utils/questProgress');
const { registerMemorySource } = require('../../utils/memoryRegistry');

const CHALLENGE_WINDOW_MS = 60_000;
const MAX_DUEL_LEVEL = 50; // [Jun-2026 §3] current max combat level
const WAGER_CAP = 50_000;          // [v5 §4.1] max Credux staked per wager duel
const BESTOW_DAILY_CAP = 1_000_000; // [v5 §4.1] wager winnings share the bestow daily cap
const DUEL_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const duelButtonPattern = new RegExp(`^duel:(accept|decline):(${DUEL_ID_PATTERN})(?::(\\d{1,2}))?$`, 'i');
const duelExpiryCollectors = new Map();
let activeDuelCollectors = 0;

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

/** Parse legacy exact ids plus session-qualified ids from an in-progress rollout. */
function parseDuelButtonId(customId) {
  if (customId === 'duel_accept') return { action: 'accept', duelId: null, duelLevel: null };
  if (customId === 'duel_decline') return { action: 'decline', duelId: null, duelLevel: null };
  const match = duelButtonPattern.exec(String(customId || ''));
  if (!match) return null;
  const rawLevel = Number(match[3] || 0);
  if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel > MAX_DUEL_LEVEL) return null;
  return {
    action: match[1].toLowerCase(),
    duelId: match[2].toLowerCase(),
    duelLevel: rawLevel || null,
  };
}

function legacyDuelLevel(interaction) {
  const description = interaction.message?.embeds?.[0]?.description || '';
  const match = /Both fight at \*\*Level (\d{1,2})\*\*/i.exec(description);
  const level = Number(match?.[1]);
  return Number.isInteger(level) && level >= 1 && level <= MAX_DUEL_LEVEL ? level : null;
}

function challengeEmbed(interaction, duelType) {
  const existing = interaction.message?.embeds?.[0];
  if (existing) return EmbedBuilder.from(existing);
  return new EmbedBuilder()
    .setColor(0xf0b232)
    .setTitle(duelType === 'wager' ? '💰 Wager Duel' : '⚔️ Duel Challenge');
}

function stopDuelExpiry(duelId) {
  const collector = duelExpiryCollectors.get(duelId);
  if (collector && !collector.ended) collector.stop('settled');
}

/**
 * Keep the normal 60-second expiry UI without making button delivery depend on
 * this process-local collector. A conditional DB delete prevents an old process
 * from expiring a duel another process already accepted.
 */
function watchDuelExpiry({ challengeMsg, embed, duelLock, targetId, wager = false }) {
  const collector = challengeMsg.createMessageComponentCollector({
    filter: () => false,
    time: CHALLENGE_WINDOW_MS,
  });
  duelExpiryCollectors.set(duelLock.duelId, collector);
  activeDuelCollectors += 1;

  collector.once('end', (_collected, reason) => {
    activeDuelCollectors = Math.max(0, activeDuelCollectors - 1);
    if (duelExpiryCollectors.get(duelLock.duelId) === collector) {
      duelExpiryCollectors.delete(duelLock.duelId);
    }
    if (reason === 'settled') return;
    cancelPendingDuel(duelLock)
      .then((expired) => {
        if (!expired) return;
        const description = wager
          ? `⌛ The wager to ${mention(targetId)} expired.`
          : `⌛ The challenge to ${mention(targetId)} expired.`;
        return challengeMsg.edit({
          embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6).setDescription(description)],
          components: [],
        });
      })
      .catch((err) => console.error('[duel expiry]', err.message));
  });
}

async function persistDuelChallenge({ duelLock, challengeMsg, embed, wager = false }) {
  try {
    if (await attachDuelMessage(duelLock, challengeMsg.id)) return true;
    throw new Error('Duel lock disappeared before its message could be attached');
  } catch (err) {
    console.error(`[${wager ? 'wager' : 'duel'} lock] message attach:`, err.message);
    await safeReleaseDuelLock(duelLock);
    await challengeMsg.edit({
      embeds: [EmbedBuilder.from(embed).setColor(0x95a5a6).setDescription(
        `${wager ? 'Wager' : 'Duel'} cancelled — the challenge could not be activated.`
      )],
      components: [],
    }).catch(() => {});
    return false;
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

async function notifyButtonUser(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
}

function expiredDescription(session) {
  return session.duelType === 'wager'
    ? `⌛ The wager to ${mention(session.opponentId)} expired.`
    : `⌛ The challenge to ${mention(session.opponentId)} expired.`;
}

/**
 * Global, DB-backed duel component handler. Unlike a message collector, this
 * remains routable after a restart and uses markDuelRunning/cancelPendingDuel as
 * the atomic winner when two bot processes briefly overlap during a deploy.
 */
async function handleButtonInteraction(interaction, services = {}) {
  const button = parseDuelButtonId(interaction.customId);
  if (!button) return false;
  if (!(await acknowledgeButton(interaction))) return true;
  const findSession = services.findDuelByMessage || findDuelByMessage;
  const cancelPending = services.cancelPendingDuel || cancelPendingDuel;
  const checkLiveBattle = services.inLiveBattle || inLiveBattle;
  const claimRunning = services.markDuelRunning || markDuelRunning;

  let session;
  try {
    session = await findSession({
      messageId: interaction.message?.id,
      duelId: button.duelId,
      pendingWindowMs: CHALLENGE_WINDOW_MS,
    });
  } catch (err) {
    console.error('[duel button lookup]', err);
    await notifyButtonUser(interaction, 'Could not load this duel challenge. Please try again.');
    return true;
  }

  if (!session) {
    await interaction.editReply({ components: [] }).catch(() => {});
    await notifyButtonUser(interaction, 'This duel challenge is no longer active.');
    return true;
  }

  const duelLock = { duelId: session.duelId, lockToken: session.lockToken };
  const embed = challengeEmbed(interaction, session.duelType);
  const isWager = session.duelType === 'wager';

  if (interaction.user.id !== session.opponentId) {
    await notifyButtonUser(interaction, 'Only the challenged player can respond.');
    return true;
  }

  if (session.status !== 'pending') {
    stopDuelExpiry(session.duelId);
    await notifyButtonUser(interaction, 'This duel challenge has already been handled.');
    return true;
  }

  try {
    if (!session.lockFresh || !session.challengeFresh) {
      const expired = await cancelPending(duelLock);
      stopDuelExpiry(session.duelId);
      if (expired) {
        await interaction.editReply({
          embeds: [embed.setColor(0x95a5a6).setDescription(expiredDescription(session))],
          components: [],
        });
      } else {
        await notifyButtonUser(interaction, 'This duel challenge has already been handled.');
      }
      return true;
    }

    if (button.action === 'decline') {
      const declined = await cancelPending(duelLock);
      if (!declined) {
        stopDuelExpiry(session.duelId);
        await notifyButtonUser(interaction, 'This duel challenge has already been handled.');
        return true;
      }
      stopDuelExpiry(session.duelId);
      await interaction.editReply({
        embeds: [embed.setColor(0xf23f43).setDescription(
          isWager
            ? `🏃 ${mention(session.opponentId)} declined the wager.`
            : `🏃 ${mention(session.opponentId)} declined the duel.`
        )],
        components: [],
      });
      return true;
    }

    const [challengerBusy, opponentBusy] = await Promise.all([
      checkLiveBattle(session.challengerId),
      checkLiveBattle(session.opponentId),
    ]);
    if (challengerBusy || opponentBusy) {
      const cancelled = await cancelPending(duelLock);
      if (!cancelled) {
        stopDuelExpiry(session.duelId);
        await notifyButtonUser(interaction, 'This duel challenge has already been handled.');
        return true;
      }
      stopDuelExpiry(session.duelId);
      const busyId = challengerBusy ? session.challengerId : session.opponentId;
      await interaction.editReply({
        embeds: [embed.setColor(0x95a5a6).setDescription(
          isWager
            ? '💰 Wager cancelled — a duelist is mid-battle.'
            : `⚔️ Duel cancelled — ${mention(busyId)} is mid-battle.`
        )],
        components: [],
      });
      return true;
    }

    const running = await claimRunning(duelLock, { pendingWindowMs: CHALLENGE_WINDOW_MS });
    if (!running.ok) {
      stopDuelExpiry(session.duelId);
      if (running.reason === 'expired') {
        const expired = await cancelPending(duelLock);
        if (expired) {
          await interaction.editReply({
            embeds: [embed.setColor(0x95a5a6).setDescription(expiredDescription(session))],
            components: [],
          });
          return true;
        }
      }
      await notifyButtonUser(interaction, 'This duel challenge has already been handled.');
      return true;
    }
  } catch (err) {
    console.error('[duel button claim]', err);
    await notifyButtonUser(interaction, 'Could not process this duel response. Please try again.');
    return true;
  }

  stopDuelExpiry(session.duelId);
  const channel = interaction.message?.channel || interaction.channel;
  const duelLevel = isWager
    ? null
    : (button.duelLevel ?? (button.duelId == null ? legacyDuelLevel(interaction) : null));

  try {
    await interaction.editReply({
      embeds: [embed.setColor(0x43d675).setDescription(
        isWager
          ? `💰 ${mention(session.opponentId)} accepts! The duel begins...`
          : `⚔️ ${mention(session.opponentId)} accepts! The duel begins...`
      )],
      components: [],
    });

    const fighterOptions = duelLevel == null ? {} : { levelOverride: duelLevel };
    const [p1, p2] = await Promise.all([
      buildPlayerFighter(pool, session.challengerId, fighterOptions),
      buildPlayerFighter(pool, session.opponentId, fighterOptions),
    ]);
    if (!p1 || !p2) {
      await interaction.editReply({
        embeds: [embed.setColor(0x95a5a6).setDescription(
          `${isWager ? 'Wager' : 'Duel'} cancelled — a duelist no longer has a character.`
        )],
        components: [],
      });
      return true;
    }

    const sim = resolveBattle(p1, p2, { mode: 'duel', seed: Date.now() >>> 0 });
    await markDuelSettling(duelLock).catch((err) => {
      console.warn(`[${isWager ? 'wager' : 'duel'} lock] settling:`, err.message);
    });

    let notices;
    if (isWager) {
      const stake = Number(session.stake);
      if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('Invalid persisted wager stake');
      const winnerId = sim.winner === 'a' ? session.challengerId : session.opponentId;
      const { moved } = await commitWagerResult(
        session.challengerId, session.opponentId, winnerId, stake
      );
      notices = [moved > 0
        ? `💰 ${mention(winnerId)} wins **${moved.toLocaleString()} Credux**!`
        : `💰 ${mention(winnerId)} wins — but the daily cap left no Credux to transfer.`];
    } else {
      notices = await commitDuelResult(session.challengerId, session.opponentId, sim);
    }

    let battleSkinPath = null;
    try {
      battleSkinPath = (await resolveSkin(pool, session.challengerId, 'battle')).path;
    } catch (err) {
      console.warn(`[${isWager ? 'wager' : 'duel'}] battle skin resolution:`, err.message);
    }
    if (!channel) throw new Error('Duel interaction channel is unavailable');
    await runBattle(channel, {
      mode: 'duel', sim, notices, battleSkinPath, ownerId: session.challengerId,
    });
  } catch (err) {
    console.error(`[${isWager ? 'wager' : 'duel'}]`, err);
    await channel?.send(`Something went wrong running the ${isWager ? 'wager' : 'duel'}.`).catch(() => {});
  } finally {
    await safeReleaseDuelLock(duelLock);
  }
  return true;
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
    // Keep the exact legacy ids during rollout: older processes ignore these,
    // allowing the DB-backed router on the new process to acknowledge them.
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
  if (!(await persistDuelChallenge({ duelLock, challengeMsg, embed, wager: true }))) return;
  watchDuelExpiry({ challengeMsg, embed, duelLock, targetId: target.id, wager: true });
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
    if (!(await persistDuelChallenge({ duelLock, challengeMsg, embed }))) return;
    watchDuelExpiry({ challengeMsg, embed, duelLock, targetId: target.id });
  } catch (err) {
    console.error('[duel]', err);
    return reply(message, 'Duel failed — nothing was changed.').catch(() => {});
  }
}

registerMemorySource('collectors.duel', () => ({
  active: activeDuelCollectors,
  lifetimeMs: CHALLENGE_WINDOW_MS,
}));

module.exports = {
  execute,
  handleButtonInteraction,
  parseDuelButtonId,
};

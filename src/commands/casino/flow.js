'use strict';

/**
 * flow.js — shared command-layer helpers for the casino (parsing + the two-phase instant
 * animation). The money path itself lives in casino/betGuard; this file only wires Discord.
 */

const betGuard = require('../../casino/betGuard');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function reply(message, content) {
  return message.reply({ content, allowedMentions: { repliedUser: false } });
}

/** Drop a leading subcommand word (`toss`/`roll`/`machine`) if present. */
function stripSub(args, word) {
  return args.length && args[0].toLowerCase() === word ? args.slice(1) : args;
}

/** Normalize a side token via an alias map; returns null if unrecognized. */
function normPick(token, map) {
  if (!token) return null;
  return map[token.toLowerCase()] ?? null;
}

/**
 * Read balance + validate the bet. On any problem, replies and returns null. On success
 * returns { amount, balance }.
 */
async function validate(message, game, betToken) {
  const balance = await betGuard.getBalance(message.author.id);
  if (balance == null) { await reply(message, 'You need to `crd register` before visiting the casino.'); return null; }
  const v = betGuard.validateBet(game, betToken, balance);
  if (!v.ok) { await reply(message, v.error); return null; }
  return { amount: v.amount, balance };
}

/** Friendly text for a failed settlement (race lost between read and lock). */
function settleErrorText(settle) {
  if (settle.status === 'missing') return 'You need to `crd register` before visiting the casino.';
  return 'Your balance changed — that bet is no longer covered. Nothing was wagered.';
}

/**
 * Two-phase instant reveal: send the GIF spin frame (pre-result balance), wait for the GIF to
 * finish its single play, then swap to the canvas RESULT frame (post-result balance + banner).
 * The outcome and money are already settled; `buildResult` is an async thunk that composites the
 * static PNG so the GIF never visibly re-loops.
 */
async function twoPhase(message, spinPayload, buildResult, animMs) {
  const sent = await message.reply({ ...spinPayload, allowedMentions: { repliedUser: false } });
  await sleep(animMs);
  const result = await buildResult();
  await sent.edit({ components: result.components, files: result.files, flags: result.flags }).catch(() => {});
  return sent;
}

module.exports = { reply, stripSub, normPick, validate, settleErrorText, twoPhase, sleep };

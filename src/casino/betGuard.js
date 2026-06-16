'use strict';

/**
 * betGuard.js — shared bet validation + the ATOMIC money path for the whole casino.
 * This is the money-critical surface; it is centralized so the settlement logic is written
 * and reviewed exactly once.
 *
 * NETTING CONVENTION (read before touching anything):
 *   - `payout` is ALWAYS the GROSS returned to the player (stake included): 2×bet on an
 *     even-money win, bet on a push, 0 on a loss. Net profit = payout − bet.
 *   - `casino_logs.result` is binary in the frozen schema ('win' | 'loss'). We log
 *     result = (payout > 0) ? 'win' : 'loss'. So a PUSH (stake returned, net 0) logs as
 *     'win' with payout = bet and balance_after = balance_before — "win" here means
 *     "credux came back", not necessarily "profit".
 *
 * TWO settlement shapes:
 *   1. INSTANT games (coin, dice, baccarat, slot): outcome is computed first, then ONE
 *      atomic transaction settles the NET (`credux += payout − bet`), guarded
 *      `WHERE credux >= bet`. The stake is never debited separately. One casino_logs row.
 *   2. STATEFUL games (blackjack, crash): the bet is DEBITED up front (locks the funds
 *      against double-spend), the session lives in memory, and on resolution the full payout
 *      is CREDITED. The single casino_logs row brackets the whole game: balance_before =
 *      pre-debit, balance_after = post-credit (= before + payout − bet). A bot restart
 *      mid-session means the bet stays debited = a loss (acceptable; that's why we debit up
 *      front).
 *
 * Invariants enforced here: never a negative balance; never debit more than balance; a win
 * never double-counts the stake; no DB write on a rejected bet.
 */

const pool = require('./../db/pool');
const { maxBet } = require('./payoutTables');

/** Parse a bet token (commas tolerated) → positive safe integer, or null. */
function parseBet(token) {
  if (token == null) return null;
  const cleaned = String(token).replace(/,/g, '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Validate a raw bet token for `game` against a known balance.
 * Returns { ok:true, amount } or { ok:false, error } (plain text; caller replies, no DB write).
 */
function validateBet(game, token, balance) {
  if (token == null || token === '') {
    return { ok: false, error: 'Enter a bet — e.g. `' + exampleFor(game) + '`.' };
  }
  const amount = parseBet(token);
  if (amount == null) return { ok: false, error: 'Your bet must be a positive whole number of Credux.' };
  const cap = maxBet(game);
  if (amount > cap) {
    return { ok: false, error: `The maximum bet for this game is **${cap.toLocaleString()}** Credux.` };
  }
  if (amount > balance) {
    return { ok: false, error: `You don't have enough Credux. Your balance is **${Number(balance).toLocaleString()}**.` };
  }
  return { ok: true, amount };
}

function exampleFor(game) {
  const map = {
    coin_toss: 'crd coin toss 500 heads',
    dice_roll: 'crd dice roll 500 odd',
    baccarat: 'crd baccarat 500 player',
    blackjack: 'crd blackjack 500',
    slot_machine: 'crd slot machine 500',
    crash: 'crd crash 500',
  };
  return map[game] || 'crd coin toss 500 heads';
}

/** Read a user's current Credux (0 if no bag row). */
async function getBalance(discordId) {
  const { rows } = await pool.query('SELECT credux FROM users_bag WHERE discord_id = $1', [discordId]);
  return rows.length ? Number(rows[0].credux) : null;
}

/** result label from gross payout (see netting convention). */
function resultLabel(payout) {
  return payout > 0 ? 'win' : 'loss';
}

async function logCasino(client, { discordId, game, bet, payout, before, after, metadata }) {
  await client.query(
    `INSERT INTO casino_logs
       (discord_id, game, bet_amount, result, payout, balance_before, balance_after, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [discordId, game, bet, resultLabel(payout), payout, before, after, metadata ? JSON.stringify(metadata) : null]
  );
}

/**
 * INSTANT settlement: ONE atomic transaction settling the net, then one log row.
 * Returns { status:'ok', before, after } | { status:'insufficient', balance } | { status:'missing' }.
 */
async function settleInstant({ discordId, game, bet, payout, metadata }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(
      'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]
    );
    if (sel.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'missing' }; }
    const before = Number(sel.rows[0].credux);
    if (before < bet) { await client.query('ROLLBACK'); return { status: 'insufficient', balance: before }; }

    const net = payout - bet; // negative on a loss, 0 on a push, positive on a win
    const upd = await client.query(
      'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 AND credux >= $3 RETURNING credux',
      [discordId, net, bet]
    );
    if (upd.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'insufficient', balance: before }; }
    const after = Number(upd.rows[0].credux);

    await logCasino(client, { discordId, game, bet, payout, before, after, metadata });
    await client.query('COMMIT');
    return { status: 'ok', before, after };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * STATEFUL step 1: debit the bet up front under a row lock.
 * Returns { status:'ok', before, after } | { status:'insufficient', balance } | { status:'missing' }.
 */
async function debitBet({ discordId, bet }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(
      'SELECT credux FROM users_bag WHERE discord_id = $1 FOR UPDATE', [discordId]
    );
    if (sel.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'missing' }; }
    const before = Number(sel.rows[0].credux);
    if (before < bet) { await client.query('ROLLBACK'); return { status: 'insufficient', balance: before }; }

    const upd = await client.query(
      'UPDATE users_bag SET credux = credux - $2 WHERE discord_id = $1 AND credux >= $2 RETURNING credux',
      [discordId, bet]
    );
    if (upd.rows.length === 0) { await client.query('ROLLBACK'); return { status: 'insufficient', balance: before }; }
    await client.query('COMMIT');
    return { status: 'ok', before, after: Number(upd.rows[0].credux) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * STATEFUL step 2: credit the gross payout and write the single bracketing log row.
 * `balanceBefore` is the PRE-DEBIT balance captured by debitBet. Returns { after }.
 */
async function resolveStateful({ discordId, game, bet, payout, balanceBefore, metadata }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let after;
    if (payout > 0) {
      const upd = await client.query(
        'UPDATE users_bag SET credux = credux + $2 WHERE discord_id = $1 RETURNING credux',
        [discordId, payout]
      );
      after = upd.rows.length ? Number(upd.rows[0].credux) : balanceBefore - bet + payout;
    } else {
      const sel = await client.query('SELECT credux FROM users_bag WHERE discord_id = $1', [discordId]);
      after = sel.rows.length ? Number(sel.rows[0].credux) : balanceBefore - bet;
    }
    await logCasino(client, { discordId, game, bet, payout, before: balanceBefore, after, metadata });
    await client.query('COMMIT');
    return { after };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  parseBet,
  validateBet,
  getBalance,
  settleInstant,
  debitBet,
  resolveStateful,
  resultLabel,
  logCasino,
};

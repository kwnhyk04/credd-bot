'use strict';

/**
 * casino-selftest.js — sandbox-safe fairness + payout-integrity harness for Phase 10.
 *
 * Touches NO database and NO Discord. It exercises the pure engines with the crypto rng (for
 * distribution) and with mock rngs (for forced outcomes), then asserts the money invariants on
 * the netting math. Run: `node scripts/casino-selftest.js`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * [item 1] Inject a fake in-memory `users_bag` pool BEFORE requiring betGuard, so the settlement
 * section exercises the REAL money path (settleInstant / debitBet / resolveStateful) writing
 * through to a balance — not a reimplementation. A regression like "win branch never writes" or a
 * sign error that no-ops the credit fails these assertions. `fakeStore.credux` is the single
 * account the settlement reads/locks/updates; `fakeStore.logs` captures casino_logs rows.
 */
const fakeStore = { credux: 0, logs: [] };
function fakeQuery(sql, params) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] };
  if (/^SELECT credux FROM users_bag/.test(s)) return { rows: [{ credux: String(fakeStore.credux) }] };
  if (/^UPDATE users_bag SET credux = credux \+ \$2 WHERE discord_id = \$1 AND credux >= \$3/.test(s)) {
    if (fakeStore.credux >= params[2]) { fakeStore.credux += params[1]; return { rows: [{ credux: String(fakeStore.credux) }] }; }
    return { rows: [] };
  }
  if (/^UPDATE users_bag SET credux = credux - \$2 WHERE discord_id = \$1 AND credux >= \$2/.test(s)) {
    if (fakeStore.credux >= params[1]) { fakeStore.credux -= params[1]; return { rows: [{ credux: String(fakeStore.credux) }] }; }
    return { rows: [] };
  }
  if (/^UPDATE users_bag SET credux = credux \+ \$2 WHERE discord_id = \$1 RETURNING/.test(s)) {
    fakeStore.credux += params[1]; return { rows: [{ credux: String(fakeStore.credux) }] };
  }
  if (/^INSERT INTO casino_logs/.test(s)) {
    fakeStore.logs.push({ result: params[3], payout: params[4], before: params[5], after: params[6] });
    return { rows: [] };
  }
  throw new Error('fake pool: unhandled SQL: ' + s);
}
const fakeClient = { query: async (sql, p) => fakeQuery(sql, p), release() {} };
const fakePool = { connect: async () => fakeClient, query: async (sql, p) => fakeQuery(sql, p) };
const poolPath = require.resolve('../src/db/pool');
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: fakePool };

const { makeRng } = require('../src/casino/rng');
const payouts = require('../src/casino/payoutTables');
const coinToss = require('../src/casino/coinToss');
const diceRoll = require('../src/casino/diceRoll');
const baccarat = require('../src/casino/baccarat');
const slotMachine = require('../src/casino/slotMachine');
const blackjack = require('../src/casino/blackjack');
const crash = require('../src/casino/crash');
const casinoRender = require('../src/casino/casinoRender');
const cardDeck = require('../src/casino/cardDeck');
const betGuard = require('../src/casino/betGuard');

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) { passed += 1; }
  else { failed += 1; fails.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function near(name, actual, expected, tol) {
  ok(name, Math.abs(actual - expected) <= tol, `got ${actual.toFixed(5)}, expected ${expected.toFixed(5)} ±${tol}`);
}

const cryptoRng = makeRng((n) => crypto.randomInt(n));

/**
 * [v4.7] An rng that makes `cardDeck.newDeck(...).draw()` deal an EXACT sequence of cards. The
 * deck builds 52 cards in canonical order (SUITS × RANKS) and draws via splice(int(remaining)),
 * so we replay the same splice to compute the index sequence. Used for forced blackjack scenarios
 * now that hands are dealt without replacement. @param {{suit,rank}[]} wantCards (in deal order)
 */
function deckRng(wantCards) {
  const order = [];
  for (const suit of cardDeck.SUITS) for (const rank of cardDeck.RANKS) order.push(`${suit}_${rank}`);
  const seq = [];
  for (const w of wantCards) {
    const idx = order.indexOf(`${w.suit}_${w.rank}`);
    if (idx < 0) throw new Error(`deckRng: ${w.suit}_${w.rank} not in deck`);
    seq.push(idx);
    order.splice(idx, 1);
  }
  let i = 0;
  return makeRng(() => seq[i++]);
}

/* ─────────────── 1. STATIC: no Math.random in casino engines/commands ─────────────── */
(function staticGrep() {
  const dirs = [
    path.join(__dirname, '..', 'src', 'casino'),
    path.join(__dirname, '..', 'src', 'commands', 'casino'),
  ];
  const offenders = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      // Match an actual invocation `Math.random(`, not the phrase in doc comments.
      if (/Math\.random\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8'))) {
        offenders.push(path.relative(path.join(__dirname, '..'), path.join(dir, f)));
      }
    }
  }
  ok('static: no Math.random in casino engines or commands', offenders.length === 0, offenders.join(', '));

  for (const file of ['blackjack.js', 'crash.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'casino', file), 'utf8');
    ok(`static: ${file} serializes overlapping button actions`,
      source.includes('wrap.resolving || wrap.actionPending')
        && source.includes('wrap.actionPending = true')
        && source.includes('wrap.actionPending = false'));
  }
})();

/* ─────────────────── 2. DISTRIBUTION (crypto rng, large N) ─────────────────── */
const N = 300_000;

(function coinDist() {
  let heads = 0;
  for (let i = 0; i < N; i++) if (coinToss.play(100, 'heads', cryptoRng).result === 'heads') heads++;
  near('dist: coin ~50% heads', heads / N, 0.5, 0.01);
})();

(function diceDist() {
  const faces = new Array(7).fill(0);
  let even = 0;
  for (let i = 0; i < N; i++) {
    const o = diceRoll.play(100, 'even', cryptoRng);
    faces[o.d1]++; faces[o.d2]++;
    if (o.parity === 'even') even++;
  }
  for (let f = 1; f <= 6; f++) near(`dist: die face ${f} ~1/6`, faces[f] / (2 * N), 1 / 6, 0.01);
  near('dist: dice parity ~50% even', even / N, 0.5, 0.01);
})();

(function cardDist() {
  const suits = {}; const ranks = {};
  for (let i = 0; i < N; i++) {
    const c = cardDeck.drawCard(cryptoRng);
    suits[c.suit] = (suits[c.suit] || 0) + 1;
    ranks[c.rank] = (ranks[c.rank] || 0) + 1;
  }
  for (const s of cardDeck.SUITS) near(`dist: suit ${s} ~25%`, suits[s] / N, 0.25, 0.01);
  for (const r of cardDeck.RANKS) near(`dist: rank ${r} ~1/13`, ranks[r] / N, 1 / 13, 0.01);
})();

(function slotDist() {
  // Marginal expected frequencies for the sequential ladder (conditional rungs):
  const survive = (i) => payouts.SLOT_LADDER.slice(0, i).reduce((p, r) => p * (1 - r.prob / 100), 1);
  const expected = {};
  payouts.SLOT_LADDER.forEach((r, i) => { expected[r.face] = survive(i) * (r.prob / 100); });
  const counts = { horus: 0, lightning: 0, skull: 0, trident: 0, wings: 0, lose: 0 };
  for (let i = 0; i < N; i++) {
    const o = slotMachine.play(100, cryptoRng);
    if (o.win) counts[o.face]++; else counts.lose++;
  }
  for (const face of Object.keys(expected)) {
    near(`dist: slot ${face} marginal`, counts[face] / N, expected[face], face === 'wings' ? 0.004 : 0.01);
  }
})();

(function crashRateDist() {
  // For each push level, force the earlier pushes to survive (int(10000)=9999 ≥ any chance*100)
  // and let the target push roll crypto — count crashes vs the table chance.
  const M = 120_000;
  for (let p = 1; p <= 6; p++) {
    let crashes = 0;
    for (let i = 0; i < M; i++) {
      let calls = 0;
      const rng = makeRng((n) => {
        if (n !== 10_000) return crypto.randomInt(n);
        calls += 1;
        return calls < p ? 9999 : crypto.randomInt(10_000); // survive earlier pushes
      });
      const s = crash.create(100, rng);
      let crashed = false;
      for (let k = 0; k < p; k++) { if (crash.pushNext(s).crashed) { crashed = true; break; } }
      if (crashed && s.push === p) crashes++;
    }
    near(`dist: crash push ${p} rate`, crashes / M, payouts.crashChance(p) / 100, 0.01);
  }
})();

/* ─────────────────── 3. CRASH CURVE (locked table + extension formula) ─────────────────── */
(function crashCumulativeDist() {
  const M = 300_000;
  let push1 = 0;
  let byPush2 = 0;
  for (let i = 0; i < M; i++) {
    const s = crash.create(100, cryptoRng);
    if (crash.pushNext(s).crashed) {
      push1 += 1;
      byPush2 += 1;
    } else if (crash.pushNext(s).crashed) {
      byPush2 += 1;
    }
  }
  const expectedBy2 = 1 - (1 - payouts.crashChance(1) / 100)
    * (1 - payouts.crashChance(2) / 100);
  near('dist: crash cumulative by push 1', push1 / M, 0.15, 0.01);
  near('dist: crash cumulative by push 2', byPush2 / M, expectedBy2, 0.01);
})();

(function crashCurve() {
  const table = { 1: 1.45, 2: 2.10, 3: 3.05, 4: 4.42, 5: 6.40, 6: 9.28 };
  for (const p of Object.keys(table)) {
    ok(`crash: published mult push ${p}`, payouts.crashMultiplier(Number(p)) === table[p], `got ${payouts.crashMultiplier(Number(p))}`);
    ok(`crash: chance push ${p}`, payouts.crashChance(Number(p)) === 15 + 2 * (Number(p) - 1));
  }
  ok('crash: extend mult push 7 = 13.46', payouts.crashMultiplier(7) === 13.46, `got ${payouts.crashMultiplier(7)}`);
  ok('crash: extend mult push 8 = 19.51', payouts.crashMultiplier(8) === 19.51, `got ${payouts.crashMultiplier(8)}`);
  ok('crash: chance push 7 = 27', payouts.crashChance(7) === 27);
  ok('crash: chance push 8 = 29', payouts.crashChance(8) === 29);
  ok('crash: final gameplay push 10 chance = 33', payouts.crashChance(10) === 33);
  ok('crash: gameplay cap is 10 pushes', payouts.CRASH_MAX_PUSHES === 10);
  ok('crash: formula cap remains 75 but is unreachable in gameplay', payouts.crashChance(30) === 73 && payouts.crashChance(31) === 75);

  let chanceCalls = 0;
  const survive = makeRng((n) => {
    if (n === 10_000) chanceCalls += 1;
    return n === 10_000 ? 9999 : 0;
  });
  const maxed = crash.create(100, survive);
  for (let push = 1; push <= payouts.CRASH_MAX_PUSHES; push += 1) crash.pushNext(maxed);
  const callsAtTen = chanceCalls;
  const blockedEleventh = crash.pushNext(maxed);
  ok('crash: surviving push 10 leaves session active for cashout',
    maxed.state === 'active' && maxed.push === 10 && maxed.multiplier === payouts.crashMultiplier(10));
  ok('crash: forged 11th push is blocked without another risk roll',
    blockedEleventh.maxed === true && maxed.push === 10 && chanceCalls === callsAtTen);

  const stepNineIds = casinoRender.crashButtons('tester', true, true).toJSON().components.map((button) => button.custom_id);
  const stepTenIds = casinoRender.crashButtons('tester', true, false).toJSON().components.map((button) => button.custom_id);
  ok('crash: before step 10 UI offers Push and Cash Out',
    stepNineIds.includes('crash:push:tester') && stepNineIds.includes('crash:cashout:tester'));
  ok('crash: step 10 UI offers Cash Out only',
    stepTenIds.length === 1 && stepTenIds[0] === 'crash:cashout:tester');
})();

/* ─────────────────── 4. SLOT lose-branch never three-of-a-kind ─────────────────── */
(function slotLoseBranch() {
  // Force every rung to miss (int(10000)=9999); reel picks stay random.
  const rng = makeRng((n) => (n === 10_000 ? 9999 : crypto.randomInt(n)));
  let bad = 0;
  let stillWon = 0;
  for (let i = 0; i < 200_000; i++) {
    const o = slotMachine.play(100, rng);
    if (o.win) stillWon++;
    if (o.reels[0] === o.reels[1] && o.reels[1] === o.reels[2]) bad++;
  }
  ok('slot lose: forced-miss always loses', stillWon === 0, `${stillWon} unexpected wins`);
  ok('slot lose: never three-of-a-kind', bad === 0, `${bad} bad combos`);
})();

/* ─────────────────── 5. PAYOUT INTEGRITY (netting invariants) ─────────────────── */
// Pure check mirroring betGuard's net settlement: after = before + payout − bet.
function assertSettlement(name, { game, bet, payout, before }) {
  const net = payout - bet;
  const after = before + net; // what settleInstant/resolveStateful produce
  ok(`${name}: balance delta == net`, after - before === net);
  ok(`${name}: payout ≥ 0`, payout >= 0);
  ok(`${name}: loss never deducts > bet`, net >= -bet);
  ok(`${name}: no negative balance`, before >= bet ? after >= 0 : true);
  ok(`${name}: result label consistent`, betGuard.resultLabel(payout) === (payout > 0 ? 'win' : 'loss'));
}

(function payoutIntegrity() {
  const BET = 1000;
  const BEFORE = 50_000;

  // Coin win / loss
  const coinWin = coinToss.play(BET, 'heads', makeRng(() => 0)); // result heads, pick heads → win
  ok('coin: forced win pays 2×', coinWin.win && coinWin.payout === 2 * BET);
  assertSettlement('coin win', { game: 'coin_toss', bet: BET, payout: coinWin.payout, before: BEFORE });
  const coinLoss = coinToss.play(BET, 'tails', makeRng(() => 0)); // result heads, pick tails → loss
  ok('coin: forced loss pays 0', !coinLoss.win && coinLoss.payout === 0);
  assertSettlement('coin loss', { game: 'coin_toss', bet: BET, payout: coinLoss.payout, before: BEFORE });

  // Dice forced (d1=1,d2=2 → sum 3 odd)
  let diceCalls = 0;
  const diceRng = makeRng(() => (diceCalls++ === 0 ? 0 : 1)); // int(6): 0→1, 1→2
  const diceWin = diceRoll.play(BET, 'odd', diceRng);
  ok('dice: forced odd win', diceWin.sum === 3 && diceWin.win && diceWin.payout === 2 * BET);
  assertSettlement('dice win', { game: 'dice_roll', bet: BET, payout: diceWin.payout, before: BEFORE });

  // Slot forced wings win (first rung hits) and forced lose
  const slotWin = slotMachine.play(BET, makeRng((n) => (n === 10_000 ? 0 : 0))); // chance(1) true
  ok('slot: forced wings ×20', slotWin.win && slotWin.face === 'wings' && slotWin.payout === 20 * BET);
  assertSettlement('slot win', { game: 'slot_machine', bet: BET, payout: slotWin.payout, before: BEFORE });
  ok('slot: win payout ≤ 20× bet', slotWin.payout <= 20 * BET);
  const slotLose = slotMachine.play(BET, makeRng((n) => (n === 10_000 ? 9999 : crypto.randomInt(n))));
  assertSettlement('slot loss', { game: 'slot_machine', bet: BET, payout: slotLose.payout, before: BEFORE });

  // Baccarat random sample — every outcome must satisfy invariants and payout ∈ {0, bet, 2bet}
  let bacBadPayout = 0; let bacBadPush = 0; let bacBadNet = 0;
  for (let i = 0; i < 20_000; i++) {
    const o = baccarat.play(BET, i % 2 ? 'player' : 'banker', cryptoRng);
    if (!(o.payout === 0 || o.payout === BET || o.payout === 2 * BET)) bacBadPayout++;
    if (o.push && o.payout !== BET) bacBadPush++;
    if ((BEFORE + (o.payout - BET)) - BEFORE !== o.payout - BET || o.payout - BET < -BET) bacBadNet++;
  }
  ok('baccarat: payout always in {0,bet,2bet}', bacBadPayout === 0, `${bacBadPayout} bad`);
  ok('baccarat: push always returns exactly bet', bacBadPush === 0, `${bacBadPush} bad`);
  ok('baccarat: net invariant holds', bacBadNet === 0, `${bacBadNet} bad`);

  // Blackjack forced scenarios — [v4.7] driven through the per-round deck (deal without
  // replacement), so each forced hand uses DISTINCT suit+rank cards. C = {suit,rank}.
  const C = (suit, rank) => ({ suit, rank });
  // player K,K (20); dealer 10,5 (15) → player hits Q → 30 bust → loss
  let s = blackjack.create(BET, deckRng([C('pegasus', 'k'), C('trident', 'k'), C('laurel', '10'), C('hammer', '5'), C('pegasus', 'q')]));
  blackjack.hit(s);
  ok('blackjack: bust = loss, payout 0', s.outcome === 'loss' && s.payout === 0);
  assertSettlement('bj loss', { game: 'blackjack', bet: BET, payout: s.payout, before: BEFORE });
  // player 20; dealer 15 then draws 10 → 25 bust → player win 2×
  s = blackjack.create(BET, deckRng([C('pegasus', 'k'), C('trident', 'k'), C('laurel', '10'), C('hammer', '5'), C('pegasus', '10')]));
  blackjack.stand(s);
  ok('blackjack: dealer bust = win 2×', s.outcome === 'win' && s.payout === 2 * BET);
  ok('blackjack: dealer hit to threshold', s.dealer.length >= 3);
  assertSettlement('bj win', { game: 'blackjack', bet: BET, payout: s.payout, before: BEFORE });
  // player 20; dealer 20 → push returns bet
  s = blackjack.create(BET, deckRng([C('pegasus', 'k'), C('trident', 'k'), C('laurel', 'k'), C('hammer', '10')]));
  blackjack.stand(s);
  ok('blackjack: push returns bet', s.outcome === 'push' && s.payout === BET);
  assertSettlement('bj push', { game: 'blackjack', bet: BET, payout: s.payout, before: BEFORE });

  // Player natural A,K; dealer starts 10,6. The dealer must not draw a 5 and
  // manufacture a 21 push against the player's opening natural.
  s = blackjack.create(BET, deckRng([
    C('pegasus', 'a'), C('trident', 'k'), C('laurel', '10'), C('hammer', '6'), C('pegasus', '5'),
  ]));
  ok('blackjack: player natural settles before dealer draws',
    s.outcome === 'win' && s.payout === 2 * BET && s.dealer.length === 2);

  // Crash forced crash on push 1 (loss) and forced cashout after push 1
  let cs = crash.create(BET, makeRng(() => 0)); // chance true → crash
  crash.pushNext(cs);
  ok('crash: forced crash push1 = loss, payout 0', cs.state === 'crashed' && cs.payout === 0 && cs.crashPoint === 1.45);
  assertSettlement('crash loss', { game: 'crash', bet: BET, payout: cs.payout, before: BEFORE });
  cs = crash.create(BET, makeRng((n) => (n === 10_000 ? 9999 : 0))); // survive
  crash.pushNext(cs);
  crash.cashOut(cs);
  ok('crash: survive+cashout pays floor(bet×1.45)', cs.payout === Math.floor(BET * 1.45));
  assertSettlement('crash win', { game: 'crash', bet: BET, payout: cs.payout, before: BEFORE });
})();

/* ─────────────────── 5b. NO DUPLICATE CARDS IN A HAND ([v4.7] deal without replacement) ─────────────────── */
(function noDuplicateCards() {
  const key = (c) => `${c.suit}|${c.rank}`;
  let bacDup = 0;
  for (let i = 0; i < 30_000; i++) {
    const o = baccarat.play(1000, i % 2 ? 'player' : 'banker', cryptoRng);
    const seen = new Set();
    for (const c of [...o.player, ...o.banker]) { if (seen.has(key(c))) bacDup++; seen.add(key(c)); }
  }
  ok('cards: baccarat round never repeats a suit+rank', bacDup === 0, `${bacDup} dup`);

  let bjDup = 0;
  for (let i = 0; i < 30_000; i++) {
    const s = blackjack.create(1000, cryptoRng);
    while (s.state === 'player' && blackjack.playerValue(s) < 17) blackjack.hit(s);
    if (s.state === 'player') blackjack.stand(s);
    const seen = new Set();
    for (const c of [...s.player, ...s.dealer]) { if (seen.has(key(c))) bjDup++; seen.add(key(c)); }
  }
  ok('cards: blackjack round never repeats a suit+rank', bjDup === 0, `${bjDup} dup`);
})();

/* ─────────────────── 6. BET GUARDS ─────────────────── */
(function betGuards() {
  const bal = 1_000_000;
  ok('guard: over-max 500k rejected', !betGuard.validateBet('coin_toss', '500001', bal).ok);
  ok('guard: 500k accepted', betGuard.validateBet('coin_toss', '500000', bal).ok);
  ok('guard: crash over-max 500k rejected', !betGuard.validateBet('crash', '500001', bal).ok);
  ok('guard: crash 500k accepted (unified cap)', betGuard.validateBet('crash', '500000', bal).ok);
  ok('guard: over-balance rejected', !betGuard.validateBet('coin_toss', '2000', 1000).ok);
  ok('guard: zero rejected', !betGuard.validateBet('coin_toss', '0', bal).ok);
  ok('guard: negative rejected', !betGuard.validateBet('coin_toss', '-5', bal).ok);
  ok('guard: non-integer rejected', !betGuard.validateBet('coin_toss', '10.5', bal).ok);
  ok('guard: empty rejected', !betGuard.validateBet('coin_toss', '', bal).ok);
  ok('guard: commas tolerated', betGuard.validateBet('coin_toss', '1,000', bal).ok);
  ok('guard: parseBet strips commas', betGuard.parseBet('12,345') === 12345);
  // `max` keyword: bets the cap when balance covers it, else the whole balance.
  const maxRich = betGuard.validateBet('coin_toss', 'max', 600_000);
  ok('guard: max @600k balance → 500k', maxRich.ok && maxRich.amount === 500_000, `got ${maxRich.amount}`);
  const maxPoor = betGuard.validateBet('coin_toss', 'max', 300_000);
  ok('guard: max @300k balance → 300k', maxPoor.ok && maxPoor.amount === 300_000, `got ${maxPoor.amount}`);
  ok('guard: MAX (case-insensitive) accepted', betGuard.validateBet('dice_roll', 'MAX', 50_000).amount === 50_000);
  ok('guard: max @0 balance rejected (must have credux)', !betGuard.validateBet('coin_toss', 'max', 0).ok);
  ok('guard: crash max respects unified 500k cap', betGuard.validateBet('crash', 'max', 900_000).amount === 500_000);
})();

/* ─────── 7. REAL SETTLEMENT PATH ([item 1] wins MUST credit Credux, all six games) ─────── */
// Drives the ACTUAL betGuard functions the commands call (through the fake in-memory pool above),
// asserting the balance really moves: win credits +net and strictly increases; loss debits −bet.
async function realSettlement() {
  const START = 100_000;
  const BET = 1000;

  // INSTANT games settle NET in one call. Win pays gross 2×bet → +BET; loss pays 0 → −BET.
  for (const game of ['coin_toss', 'dice_roll', 'baccarat', 'slot_machine']) {
    fakeStore.credux = START;
    const win = await betGuard.settleInstant({ discordId: 'u', game, bet: BET, payout: 2 * BET, metadata: {} });
    ok(`settle ${game}: win status ok`, win.status === 'ok');
    ok(`settle ${game}: win credits +net`, win.after === START + BET, `after ${win.after}`);
    ok(`settle ${game}: win balance strictly increases`, win.after > win.before, `before ${win.before} after ${win.after}`);
    ok(`settle ${game}: win persists to store`, fakeStore.credux === START + BET, `store ${fakeStore.credux}`);

    fakeStore.credux = START;
    const loss = await betGuard.settleInstant({ discordId: 'u', game, bet: BET, payout: 0, metadata: {} });
    ok(`settle ${game}: loss debits −bet`, loss.after === START - BET, `after ${loss.after}`);
    ok(`settle ${game}: loss persists to store`, fakeStore.credux === START - BET, `store ${fakeStore.credux}`);
  }

  // A bigger slot win (×20) credits +19×bet net.
  fakeStore.credux = START;
  const big = await betGuard.settleInstant({ discordId: 'u', game: 'slot_machine', bet: BET, payout: 20 * BET, metadata: {} });
  ok('settle slot: ×20 win credits +19×bet', big.after === START + 19 * BET, `after ${big.after}`);

  // STATEFUL games debit up front, then credit gross on win. Net win = +BET; loss = −BET.
  for (const game of ['blackjack', 'crash']) {
    fakeStore.credux = START;
    let d = await betGuard.debitBet({ discordId: 'u', bet: BET });
    ok(`settle ${game}: debit takes bet`, d.status === 'ok' && fakeStore.credux === START - BET, `store ${fakeStore.credux}`);
    let r = await betGuard.resolveStateful({ discordId: 'u', game, bet: BET, payout: 2 * BET, balanceBefore: d.before, metadata: {} });
    ok(`settle ${game}: win returns stake + winnings`, r.after === START + BET, `after ${r.after}`);
    ok(`settle ${game}: win balance strictly increases vs start`, r.after > d.before, `before ${d.before} after ${r.after}`);
    ok(`settle ${game}: win persists to store`, fakeStore.credux === START + BET, `store ${fakeStore.credux}`);

    fakeStore.credux = START;
    d = await betGuard.debitBet({ discordId: 'u', bet: BET });
    r = await betGuard.resolveStateful({ discordId: 'u', game, bet: BET, payout: 0, balanceBefore: d.before, metadata: {} });
    ok(`settle ${game}: loss nets −bet`, r.after === START - BET && fakeStore.credux === START - BET, `after ${r.after}`);
  }

  // casino_logs must reflect the credit: result 'win', payout gross, balance_after post-credit.
  fakeStore.credux = START; fakeStore.logs.length = 0;
  await betGuard.settleInstant({ discordId: 'u', game: 'coin_toss', bet: BET, payout: 2 * BET, metadata: {} });
  const log = fakeStore.logs[fakeStore.logs.length - 1];
  ok('settle log: result is win', log && log.result === 'win');
  ok('settle log: payout is gross', log && log.payout === 2 * BET);
  ok('settle log: balance_after is post-credit', log && Number(log.after) === START + BET, `log.after ${log && log.after}`);
}

/* ─────────────────── REPORT ─────────────────── */
realSettlement().then(() => {
  console.log(`\nCasino self-test: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of fails.slice(0, 40)) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log('All casino fairness + payout-integrity checks green.');
}).catch((err) => { console.error('settlement test crashed:', err); process.exit(1); });

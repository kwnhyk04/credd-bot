'use strict';

/**
 * aliases.js — the single routing source for command shorthands (Phase 11, §4).
 *
 * Flat map of `alias -> canonical command string` (the canonical may be multi-word, e.g.
 * `coin toss`). The messageCreate router, after stripping the prefix, replaces a leading alias
 * token with its canonical token stream BEFORE routing, so `c ct 500 heads` becomes
 * `coin toss 500 heads`. Canonical commands route by their first token; the rest are args.
 *
 * Back-compat ([v4.9] approval): `sm -> slot machine` and `g -> cred` are kept IN ADDITION to
 * the prompt's `sl`, so existing muscle memory keeps working. sm/sl both map to slot machine —
 * a documented intentional pair the help-selftest tolerates.
 */

module.exports = {
  // Account
  reg: 'register',
  cc: 'create character',
  p: 'profile',
  // Battle
  r: 'raid',
  d: 'duel',
  // Gacha / Deities
  s: 'summon',
  dc: 'deity collection',
  di: 'deity info',
  de: 'deity equip',
  deh: 'deity enhance',
  // Inventory
  b: 'bag',
  bc: 'bag chests',
  bw: 'bag weapons',
  ba: 'bag armors',
  o: 'open',
  eq: 'equip',
  wi: 'weapon info',
  ei: 'equipment info',
  enh: 'enhance',
  lk: 'lock',
  ulk: 'unlock',
  // Runes / sockets (Phase 2)
  es: 'essence shop',
  ex: 'exchange',
  rb: 'rune bag',
  rn: 'runes',
  so: 'socket',
  uso: 'unsocket',
  // Economy
  g: 'cred',          // [v4.9] back-compat
  bs: 'bestow',
  q: 'quests',
  // Casino
  ct: 'coin toss',
  dr: 'dice roll',
  bac: 'baccarat',
  bj: 'blackjack',
  sl: 'slot machine',
  sm: 'slot machine', // [v4.9] back-compat (was the wired slot alias pre-Phase-11)
};

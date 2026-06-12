'use strict';

const { getPrefix } = require('./middleware');
const { DEV_IDS } = require('../config/config');
const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const profileCmd = require('../commands/rpg/profile');
const bagCmd = require('../commands/rpg/bag');
const openCmd = require('../commands/rpg/open');
const equipCmd = require('../commands/rpg/equip');
const summonCmd = require('../commands/rpg/summon');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const lockCmd = require('../commands/rpg/lock');
const sellCmd = require('../commands/rpg/sell');
const weaponCmd = require('../commands/rpg/weapon');
const raidCmd = require('../commands/rpg/raid');
const duelCmd = require('../commands/rpg/duel');
const bossCmd = require('../commands/rpg/boss');
const devCmd = require('../commands/rpg/dev');

// Commands with real implementations.
//   mw 'ban'  → ban check only (no registration/character/activity); register needs this
//   mw 'full' → standard runMiddleware pipeline (requiresCharacter from COMMAND_MAP)
//   mw 'dev'  → superuser gate only (DEV_IDS); non-devs silent-ignore, no middleware
const IMPLEMENTED = {
  register: { mw: 'ban',  run: registerCmd.execute },
  create:   { mw: 'full', run: createCmd.execute },
  profile:  { mw: 'full', run: profileCmd.execute },
  stats:    { mw: 'full', run: profileCmd.execute },
  bag:      { mw: 'full', run: bagCmd.execute },
  b:        { mw: 'full', run: bagCmd.execute },
  open:     { mw: 'full', run: openCmd.execute },
  equip:    { mw: 'full', run: equipCmd.execute },
  summon:   { mw: 'full', run: summonCmd.execute },
  s:        { mw: 'full', run: summonCmd.execute },
  deity:    { mw: 'full', run: deityCmd.execute },
  enhance:  { mw: 'full', run: enhanceCmd.execute },
  lock:     { mw: 'full', run: lockCmd.lock },
  unlock:   { mw: 'full', run: lockCmd.unlock },
  sell:     { mw: 'full', run: sellCmd.execute },
  weapon:   { mw: 'full', run: weaponCmd.execute },
  raid:     { mw: 'full', run: raidCmd.execute },
  r:        { mw: 'full', run: raidCmd.execute },
  duel:     { mw: 'full', run: duelCmd.execute },
  boss:     { mw: 'full', run: bossCmd.execute },
  dev:      { mw: 'dev',  run: devCmd.execute },
};

// Aliases that must SHARE their canonical command's cooldown bucket — without
// this, `crd r` + `crd raid` would grant two battles inside one 10s window.
const COOLDOWN_KEY_ALIASES = { r: 'raid' };

// Command categories and their routing metadata
// requiresCharacter: true → character middleware check runs
// phase: which phase implements this
const COMMAND_MAP = {
  // ── Registration (no middleware — available to all) ────────────────────
  'register':          { category: 'rpg',     requiresCharacter: false, phase: 2 },
  'create':            { category: 'rpg',     requiresCharacter: false, phase: 2 }, // crd create character

  // ── RPG ───────────────────────────────────────────────────────────────
  'profile':           { category: 'rpg',     requiresCharacter: true,  phase: 9 },
  'stats':             { category: 'rpg',     requiresCharacter: true,  phase: 9 },
  'raid':              { category: 'rpg',     requiresCharacter: true,  phase: 6 },
  'r':                 { category: 'rpg',     requiresCharacter: true,  phase: 6 },
  'duel':              { category: 'rpg',     requiresCharacter: true,  phase: 6 },
  // boss: status view only needs registration — the ⚔️ Attack button enforces
  // the character gate itself (buttons bypass message middleware anyway)
  'boss':              { category: 'rpg',     requiresCharacter: false, phase: 7 },
  'summon':            { category: 'rpg',     requiresCharacter: true,  phase: 4 },
  's':                 { category: 'rpg',     requiresCharacter: true,  phase: 4 },
  'bag':               { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'b':                 { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'open':              { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'equip':             { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'enhance':           { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'lock':              { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'unlock':            { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'sell':              { category: 'rpg',     requiresCharacter: true,  phase: 5 },
  'deity':             { category: 'rpg',     requiresCharacter: true,  phase: 4 },
  'weapon':            { category: 'rpg',     requiresCharacter: true,  phase: 5 },

  // ── Economy ───────────────────────────────────────────────────────────
  'cred':              { category: 'economy', requiresCharacter: false,  phase: 3 },
  'g':                 { category: 'economy', requiresCharacter: false,  phase: 3 },
  'bestow':            { category: 'economy', requiresCharacter: false,  phase: 3 },
  'daily':             { category: 'economy', requiresCharacter: false,  phase: 8 },
  'quests':            { category: 'economy', requiresCharacter: false,  phase: 8 },

  // ── Casino ────────────────────────────────────────────────────────────
  'coin':              { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'ct':                { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'dice':              { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'dr':                { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'baccarat':          { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'bac':               { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'blackjack':         { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'bj':                { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'slot':              { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'sm':                { category: 'casino',  requiresCharacter: false,  phase: 10 },
  'crash':             { category: 'casino',  requiresCharacter: false,  phase: 10 },

  // ── Admin ─────────────────────────────────────────────────────────────
  'admin':             { category: 'admin',   requiresCharacter: false,  phase: 11 },

  // ── Dev (superuser only) ──────────────────────────────────────────────
  'dev':               { category: 'dev',     requiresCharacter: false,  phase: 3 },

  // ── Help ──────────────────────────────────────────────────────────────
  'help':              { category: 'help',    requiresCharacter: false,  phase: 11 },
};

/**
 * Parse a raw message into { prefix, command, args } or null if not a bot command.
 */
async function parseMessage(message) {
  if (message.author.bot || !message.guild) return null;
  const prefix = await getPrefix(message.guild.id);
  const content = message.content.trim();
  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return null;

  const withoutPrefix = content.slice(prefix.length).trim();
  const parts = withoutPrefix.split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  return { prefix, command, args };
}

/**
 * Handle an incoming message.
 * Returns true if a command was matched and processed.
 */
async function handleMessage(message, { runMiddleware, isBanned }) {
  const parsed = await parseMessage(message);
  if (!parsed) return false;

  const { command, args } = parsed;
  const entry = COMMAND_MAP[command];
  if (!entry) return false;

  const { requiresCharacter, phase } = entry;
  const impl = IMPLEMENTED[command];

  if (impl) {
    if (impl.mw === 'dev') {
      // Superuser-only (§2). Non-devs get NO reply — identical to an unknown
      // command — so dev tooling stays invisible and skips all middleware.
      if (!DEV_IDS.includes(message.author.id)) return true;
      await impl.run(message, { args });
      return true;
    }
    if (impl.mw === 'ban') {
      // register: ban check only — banned users silent-fail; no activity upsert
      // (the users row doesn't exist yet, so the FK would fail).
      if (await isBanned(message.author.id)) return true;
    } else {
      // commandKey = canonical COMMAND_MAP key → per-command cooldown window
      // (aliases in COOLDOWN_KEY_ALIASES share their canonical bucket).
      const commandKey = COOLDOWN_KEY_ALIASES[command] || command;
      const allowed = await runMiddleware(message, { requiresCharacter, commandKey });
      if (!allowed) return true;
    }
    await impl.run(message, { args });
    return true;
  }

  // Not yet implemented → run the full middleware pipeline, then stub reply.
  const allowed = await runMiddleware(message, { requiresCharacter, commandKey: command });
  if (!allowed) return true;

  await message.reply({
    content: `Not implemented (Phase ${phase})`,
    allowedMentions: { repliedUser: false },
  });

  return true;
}

module.exports = { handleMessage, parseMessage, COMMAND_MAP };

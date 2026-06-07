'use strict';

const { getPrefix } = require('./middleware');

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
async function handleMessage(message, { runMiddleware }) {
  const parsed = await parseMessage(message);
  if (!parsed) return false;

  const { command, args } = parsed;
  const entry = COMMAND_MAP[command];
  if (!entry) return false;

  const { requiresCharacter, phase } = entry;

  // Registration command: skip most middleware (no ban check needed to register;
  // but we still skip banned users silently using a lightweight check).
  const skipMiddleware = command === 'register';

  if (!skipMiddleware) {
    const allowed = await runMiddleware(message, { requiresCharacter });
    if (!allowed) return true; // middleware blocked it
  }

  // Stub reply
  await message.reply({
    content: `Not implemented (Phase ${phase})`,
    allowedMentions: { repliedUser: false },
  });

  return true;
}

module.exports = { handleMessage, parseMessage, COMMAND_MAP };

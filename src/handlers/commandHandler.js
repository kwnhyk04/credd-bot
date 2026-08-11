'use strict';

const { DEV_IDS } = require('../config/config');
const { MessageContext } = require('../utils/commandContext');
const { awardCommandBelieverExp, notifyBelieverLevelUp } = require('../utils/awardBelieverExp');
const guildConfig = require('./guildConfigCache');
const ALIASES = require('../config/aliases');
const { envBool } = require('../utils/runtimeLogs');
const { withNetworkContext } = require('../utils/networkTelemetry');

const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const classPassivesCmd = require('../commands/rpg/classPassives');
const profileCmd = require('../commands/rpg/profile');
const statsCmd = require('../commands/rpg/stats');
const bagCmd = require('../commands/rpg/bag');
const openCmd = require('../commands/rpg/open');
const equipCmd = require('../commands/rpg/equip');
const presetCmd = require('../commands/rpg/preset');
const summonCmd = require('../commands/rpg/summon');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const lockCmd = require('../commands/rpg/lock');
const sellCmd = require('../commands/rpg/sell');
const equipmentCmd = require('../commands/rpg/equipment');
const raidCmd = require('../commands/rpg/raid');
const autoRaidCmd = require('../commands/rpg/autoRaid');
const duelCmd = require('../commands/rpg/duel');
const rankedCmd = require('../commands/rpg/ranked');
const leaderboardCmd = require('../commands/rpg/leaderboard');
const titleCmd = require('../commands/rpg/title');
const bossCmd = require('../commands/rpg/boss');
const bestowCmd = require('../commands/economy/bestow');
const credCmd = require('../commands/economy/cred');
const questsCmd = require('../commands/economy/quests');
const dailyCmd = require('../commands/economy/daily');
const dailyLimitsCmd = require('../commands/economy/dailyLimits');
const devCmd = require('../commands/rpg/dev');
const essenceShopCmd = require('../commands/rpg/essenceShop');
const exchangeCmd = require('../commands/rpg/exchange');
const pvpShopCmd = require('../commands/rpg/pvpShop');
const socketCmd = require('../commands/rpg/socket');
const runeCmd = require('../commands/rpg/rune');
const shopCmd = require('../commands/rpg/crdShop'); // CRD Shop; forwards `shop supporter` to the legacy supporter shop
const skinCmd = require('../commands/rpg/skin');
const avatarCmd = require('../commands/rpg/avatar');
const buyCmd = require('../commands/rpg/buy');
const useCmd = require('../commands/rpg/use');
const ticketsCmd = require('../commands/rpg/tickets');
const glossaryCmd = require('../commands/rpg/glossary');
const compareCmd = require('../commands/rpg/compare');
const setCmd = require('../commands/rpg/set');
const helpCmd = require('../commands/help');
const adminCmd = require('../commands/admin');
const disabledCasinoCmd = require('../commands/casino/disabled');
const casinoEnabled = envBool('CASINO_ENABLED', true);
const casinoCmds = casinoEnabled ? {
  coin: require('../commands/casino/coin'),
  dice: require('../commands/casino/dice'),
  baccarat: require('../commands/casino/baccarat'),
  blackjack: require('../commands/casino/blackjack'),
  slot: require('../commands/casino/slot'),
  crash: require('../commands/casino/crash'),
} : null;

// One table per command, keyed by CANONICAL command (first token). Shorthands route
// here via config/aliases.js (expanded before lookup), so no direct alias keys live
// in this map. IMPLEMENTED / COMMAND_MAP below are derived views of this table, kept
// under their original export names (Phase 1.4 merge).
//   mw 'ban'  → ban check only (register needs this; the users row doesn't exist yet)
//   mw 'full' → standard runMiddleware pipeline (requiresCharacter from this table)
//   mw 'dev'  → superuser gate only (DEV_IDS); non-devs silent-ignore, no middleware
//   requiresCharacter true → character middleware check runs
const COMMANDS = {
  register: { mw: 'ban',  run: registerCmd.execute, requiresCharacter: false },
  create:   { mw: 'full', run: createCmd.execute, requiresCharacter: false },
  class:    { mw: 'full', run: classPassivesCmd.execute, requiresCharacter: false },
  profile:  { mw: 'full', run: profileCmd.execute, requiresCharacter: true },
  stats:    { mw: 'full', run: statsCmd.execute, requiresCharacter: true },
  bag:      { mw: 'full', run: bagCmd.execute, requiresCharacter: true },
  open:     { mw: 'full', run: openCmd.execute, requiresCharacter: true },
  equip:    { mw: 'full', run: equipCmd.execute, requiresCharacter: true },
  preset:   { mw: 'full', run: presetCmd.execute, requiresCharacter: true },
  summon:   { mw: 'full', run: summonCmd.execute, requiresCharacter: true },
  deity:    { mw: 'full', run: deityCmd.execute, requiresCharacter: true },
  deities:  { mw: 'full', run: deityCmd.deities, requiresCharacter: true },
  enhance:  { mw: 'full', run: enhanceCmd.execute, requiresCharacter: true },
  lock:     { mw: 'full', run: lockCmd.lock, requiresCharacter: true },
  unlock:   { mw: 'full', run: lockCmd.unlock, requiresCharacter: true },
  sell:     { mw: 'full', run: sellCmd.execute, requiresCharacter: true },
  equipment: { mw: 'full', run: equipmentCmd.execute, requiresCharacter: true },
  raid:     { mw: 'full', run: raidCmd.execute, requiresCharacter: true },
  auto:     { mw: 'full', run: autoRaidCmd.execute, requiresCharacter: true },  // auto raid (needs combat level)
  duel:     { mw: 'full', run: duelCmd.execute, requiresCharacter: true },
  ranked:   { mw: 'full', run: rankedCmd.execute, requiresCharacter: true },
  leaderboards: { mw: 'full', run: leaderboardCmd.execute, requiresCharacter: false },
  title:    { mw: 'full', run: titleCmd.execute, requiresCharacter: true },
  boss:     { mw: 'full', run: bossCmd.execute, requiresCharacter: false }, // status view; Attack button enforces the gate itself
  bestow:   { mw: 'full', run: bestowCmd.execute, requiresCharacter: false },
  cred:     { mw: 'full', run: credCmd.execute, requiresCharacter: false },
  quests:   { mw: 'full', run: questsCmd.execute, requiresCharacter: false },
  quest:    { mw: 'full', run: questsCmd.execute, requiresCharacter: false },
  daily:    {
    mw: 'full',
    run: (message, { args = [] } = {}) =>
      args[0]?.toLowerCase() === 'limits' ? dailyLimitsCmd.execute(message) : dailyCmd.execute(message),
    requiresCharacter: false,
  },
  help:     { mw: 'full', run: helpCmd.execute, requiresCharacter: false },
  admin:    { mw: 'full', run: adminCmd.execute, requiresCharacter: false },
  dev:      { mw: 'dev',  run: devCmd.execute, requiresCharacter: false },
  essence:  { mw: 'full', run: essenceShopCmd.execute, requiresCharacter: true },  // essence shop
  exchange: { mw: 'full', run: exchangeCmd.execute, requiresCharacter: true },
  pvp:      { mw: 'full', run: pvpShopCmd.execute, requiresCharacter: true },  // pvp shop (Valor sink)
  socket:   { mw: 'full', run: socketCmd.socket, requiresCharacter: true },
  unsocket: { mw: 'full', run: socketCmd.unsocket, requiresCharacter: true },
  rune:     { mw: 'full', run: runeCmd.execute, requiresCharacter: true },  // crd rune bag
  runes:    { mw: 'full', run: runeCmd.list, requiresCharacter: true },  // crd runes
  shop:     { mw: 'full', run: shopCmd.execute, requiresCharacter: false }, // cosmetic store; supporter status is independent of character
  skin:     { mw: 'full', run: skinCmd.execute, requiresCharacter: false }, // cosmetic skin collection (open to all)
  avatars:  { mw: 'full', run: avatarCmd.collection, requiresCharacter: true },
  avatar:   { mw: 'full', run: avatarCmd.execute, requiresCharacter: true },
  buy:      { mw: 'full', run: buyCmd.execute, requiresCharacter: false }, // buy a skin by code
  use:      { mw: 'full', run: useCmd.execute, requiresCharacter: false }, // equip a skin by code
  supporter: { mw: 'dev', run: ticketsCmd.execute, requiresCharacter: false }, // dev-only supporter ticket queue
  update:   { mw: 'dev', run: ticketsCmd.update, requiresCharacter: false }, // dev-only ticket status update
  set:      { mw: 'full', run: setCmd.execute, requiresCharacter: false }, // reset all skins to default templates
  glossary: { mw: 'full', run: glossaryCmd.execute, requiresCharacter: false }, // reference codex (§4) — open to all
  compare:  { mw: 'full', run: compareCmd.execute, requiresCharacter: true },  // owned-item compare (needs a character to own items)

  // ── Casino (Phase 10) — requiresCharacter:false (registration gate only) ──
  coin:      { mw: 'full', run: (casinoCmds?.coin || disabledCasinoCmd).execute, requiresCharacter: false },
  dice:      { mw: 'full', run: (casinoCmds?.dice || disabledCasinoCmd).execute, requiresCharacter: false },
  baccarat:  { mw: 'full', run: (casinoCmds?.baccarat || disabledCasinoCmd).execute, requiresCharacter: false },
  blackjack: { mw: 'full', run: (casinoCmds?.blackjack || disabledCasinoCmd).execute, requiresCharacter: false },
  slot:      { mw: 'full', run: (casinoCmds?.slot || disabledCasinoCmd).execute, requiresCharacter: false },
  crash:     { mw: 'full', run: (casinoCmds?.crash || disabledCasinoCmd).execute, requiresCharacter: false },
};

// Derived views — original export names and per-entry shapes preserved.
const IMPLEMENTED = Object.fromEntries(
  Object.entries(COMMANDS).map(([name, { mw, run }]) => [name, { mw, run }])
);
const COMMAND_MAP = Object.fromEntries(
  Object.entries(COMMANDS).map(([name, { requiresCharacter }]) => [name, { requiresCharacter }])
);

/** Resolve which trigger a message starts with: 'crd' always wins; else the guild prefix. */
function resolvePrefix(content, guildPrefix) {
  const lower = content.toLowerCase();
  const list = ['crd'];
  if (guildPrefix && guildPrefix.toLowerCase() !== 'crd') list.push(guildPrefix);
  for (const p of list) {
    if (lower.startsWith(p.toLowerCase())) return p;
  }
  return null;
}

/**
 * Parse a raw message into { command, args } (canonical) or null if not a bot command.
 * Accepts BOTH `crd` (permanent) and the guild's custom prefix; expands a leading alias.
 */
function parseMessage(message) {
  if (message.author.bot || !message.guild) return null;
  const guildPrefix = guildConfig.getPrefix(message.guild.id);
  const content = message.content.trim();
  const prefix = resolvePrefix(content, guildPrefix);
  if (!prefix) return null;

  let parts = content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  // Alias expansion (single source of truth — config/aliases.js). `ct 500 h` → `coin toss 500 h`.
  const aliasKey = parts[0].toLowerCase();
  if (ALIASES[aliasKey]) parts = [...ALIASES[aliasKey].split(' '), ...parts.slice(1)];

  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

/**
 * Handle an incoming prefix message. Returns true if a command was matched and processed.
 */
async function handleMessage(message, { runMiddleware, isBanned }) {
  const parsed = parseMessage(message);
  if (!parsed) return false;

  const { command, args } = parsed;
  const impl = IMPLEMENTED[command];
  if (!impl) return false;

  const ctx = new MessageContext(message, args);
  const requiresCharacter = COMMAND_MAP[command]?.requiresCharacter ?? false;
  const telemetryContext = {
    command,
    surface: 'prefix',
    phase: 'final',
    userId: ctx.userId,
    messageId: ctx.interactionId || message.id,
  };

  if (impl.mw === 'dev') {
    // Superuser-only (§2). Non-devs get NO reply (invisible), skipping all middleware.
    if (!DEV_IDS.includes(ctx.userId)) return true;
    await withNetworkContext(telemetryContext, () => impl.run(ctx, { args: ctx.args }));
    notifyBelieverLevelUp(message.channel, ctx.userId, await awardCommandBelieverExp(ctx.userId, command, ctx.args));
    return true;
  }
  if (impl.mw === 'ban') {
    if (await isBanned(ctx.userId)) return true;
  } else {
    const allowed = await runMiddleware(ctx, { requiresCharacter, commandKey: command });
    if (!allowed) return true;
  }
  await withNetworkContext(telemetryContext, () => impl.run(ctx, { args: ctx.args }));
  notifyBelieverLevelUp(message.channel, ctx.userId, await awardCommandBelieverExp(ctx.userId, command, ctx.args));
  return true;
}

module.exports = { handleMessage, parseMessage, COMMAND_MAP, IMPLEMENTED };

'use strict';

const { DEV_IDS } = require('../config/config');
const { MessageContext } = require('../utils/commandContext');
const guildConfig = require('./guildConfigCache');
const ALIASES = require('../config/aliases');

const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const profileCmd = require('../commands/rpg/profile');
const statsCmd = require('../commands/rpg/stats');
const bagCmd = require('../commands/rpg/bag');
const openCmd = require('../commands/rpg/open');
const equipCmd = require('../commands/rpg/equip');
const summonCmd = require('../commands/rpg/summon');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const lockCmd = require('../commands/rpg/lock');
const sellCmd = require('../commands/rpg/sell');
const weaponCmd = require('../commands/rpg/weapon');
const equipmentCmd = require('../commands/rpg/equipment');
const raidCmd = require('../commands/rpg/raid');
const duelCmd = require('../commands/rpg/duel');
const rankedCmd = require('../commands/rpg/ranked');
const leaderboardCmd = require('../commands/rpg/leaderboard');
const titleCmd = require('../commands/rpg/title');
const bossCmd = require('../commands/rpg/boss');
const bestowCmd = require('../commands/economy/bestow');
const credCmd = require('../commands/economy/cred');
const questsCmd = require('../commands/economy/quests');
const dailyCmd = require('../commands/economy/daily');
const devCmd = require('../commands/rpg/dev');
const essenceShopCmd = require('../commands/rpg/essenceShop');
const exchangeCmd = require('../commands/rpg/exchange');
const pvpShopCmd = require('../commands/rpg/pvpShop');
const socketCmd = require('../commands/rpg/socket');
const runeCmd = require('../commands/rpg/rune');
const shopCmd = require('../commands/rpg/shop');
const skinCmd = require('../commands/rpg/skin');
const buyCmd = require('../commands/rpg/buy');
const useCmd = require('../commands/rpg/use');
const setCmd = require('../commands/rpg/set');
const helpCmd = require('../commands/help');
const adminCmd = require('../commands/admin');
const coinCmd = require('../commands/casino/coin');
const diceCmd = require('../commands/casino/dice');
const baccaratCmd = require('../commands/casino/baccarat');
const blackjackCmd = require('../commands/casino/blackjack');
const slotCmd = require('../commands/casino/slot');
const crashCmd = require('../commands/casino/crash');

// Implemented commands, keyed by CANONICAL command (first token). Shorthands route here via
// config/aliases.js (expanded before lookup), so no direct alias keys live in this map.
//   mw 'ban'  → ban check only (register needs this; the users row doesn't exist yet)
//   mw 'full' → standard runMiddleware pipeline (requiresCharacter from COMMAND_MAP)
//   mw 'dev'  → superuser gate only (DEV_IDS); non-devs silent-ignore, no middleware
const IMPLEMENTED = {
  register: { mw: 'ban',  run: registerCmd.execute },
  create:   { mw: 'full', run: createCmd.execute },
  profile:  { mw: 'full', run: profileCmd.execute },
  stats:    { mw: 'full', run: statsCmd.execute },
  bag:      { mw: 'full', run: bagCmd.execute },
  open:     { mw: 'full', run: openCmd.execute },
  equip:    { mw: 'full', run: equipCmd.execute },
  summon:   { mw: 'full', run: summonCmd.execute },
  deity:    { mw: 'full', run: deityCmd.execute },
  deities:  { mw: 'full', run: deityCmd.deities },
  enhance:  { mw: 'full', run: enhanceCmd.execute },
  lock:     { mw: 'full', run: lockCmd.lock },
  unlock:   { mw: 'full', run: lockCmd.unlock },
  sell:     { mw: 'full', run: sellCmd.execute },
  weapon:    { mw: 'full', run: weaponCmd.execute },
  equipment: { mw: 'full', run: equipmentCmd.execute },
  raid:     { mw: 'full', run: raidCmd.execute },
  duel:     { mw: 'full', run: duelCmd.execute },
  ranked:   { mw: 'full', run: rankedCmd.execute },
  leaderboards: { mw: 'full', run: leaderboardCmd.execute },
  title:    { mw: 'full', run: titleCmd.execute },
  boss:     { mw: 'full', run: bossCmd.execute },
  bestow:   { mw: 'full', run: bestowCmd.execute },
  cred:     { mw: 'full', run: credCmd.execute },
  quests:   { mw: 'full', run: questsCmd.execute },
  quest:    { mw: 'full', run: questsCmd.execute },
  daily:    { mw: 'full', run: dailyCmd.execute },
  help:     { mw: 'full', run: helpCmd.execute },
  admin:    { mw: 'full', run: adminCmd.execute },
  dev:      { mw: 'dev',  run: devCmd.execute },
  essence:  { mw: 'full', run: essenceShopCmd.execute },
  exchange: { mw: 'full', run: exchangeCmd.execute },
  pvp:      { mw: 'full', run: pvpShopCmd.execute },
  socket:   { mw: 'full', run: socketCmd.socket },
  unsocket: { mw: 'full', run: socketCmd.unsocket },
  rune:     { mw: 'full', run: runeCmd.execute },
  runes:    { mw: 'full', run: runeCmd.list },
  shop:     { mw: 'full', run: shopCmd.execute },
  skin:     { mw: 'full', run: skinCmd.execute },
  buy:      { mw: 'full', run: buyCmd.execute },
  use:      { mw: 'full', run: useCmd.execute },
  set:      { mw: 'full', run: setCmd.execute },

  // ── Casino (Phase 10) — requiresCharacter:false (registration gate only) ──
  coin:      { mw: 'full', run: coinCmd.execute },
  dice:      { mw: 'full', run: diceCmd.execute },
  baccarat:  { mw: 'full', run: baccaratCmd.execute },
  blackjack: { mw: 'full', run: blackjackCmd.execute },
  slot:      { mw: 'full', run: slotCmd.execute },
  crash:     { mw: 'full', run: crashCmd.execute },
};

// requiresCharacter source, keyed by canonical command. true → character middleware check runs.
const COMMAND_MAP = {
  register:  { requiresCharacter: false },
  create:    { requiresCharacter: false },
  profile:   { requiresCharacter: true },
  stats:     { requiresCharacter: true },
  raid:      { requiresCharacter: true },
  duel:      { requiresCharacter: true },
  ranked:    { requiresCharacter: true },
  leaderboards: { requiresCharacter: false },
  title:       { requiresCharacter: true },
  boss:      { requiresCharacter: false }, // status view; Attack button enforces the gate itself
  summon:    { requiresCharacter: true },
  bag:       { requiresCharacter: true },
  open:      { requiresCharacter: true },
  equip:     { requiresCharacter: true },
  enhance:   { requiresCharacter: true },
  lock:      { requiresCharacter: true },
  unlock:    { requiresCharacter: true },
  sell:      { requiresCharacter: true },
  deity:     { requiresCharacter: true },
  deities:   { requiresCharacter: true },
  weapon:    { requiresCharacter: true },
  equipment: { requiresCharacter: true },
  cred:      { requiresCharacter: false },
  bestow:    { requiresCharacter: false },
  daily:     { requiresCharacter: false },
  quests:    { requiresCharacter: false },
  quest:     { requiresCharacter: false },
  help:      { requiresCharacter: false },
  admin:     { requiresCharacter: false },
  coin:      { requiresCharacter: false },
  dice:      { requiresCharacter: false },
  baccarat:  { requiresCharacter: false },
  blackjack: { requiresCharacter: false },
  slot:      { requiresCharacter: false },
  crash:     { requiresCharacter: false },
  dev:       { requiresCharacter: false },
  essence:   { requiresCharacter: true },  // essence shop
  exchange:  { requiresCharacter: true },
  pvp:       { requiresCharacter: true },  // pvp shop (Valor sink)
  socket:    { requiresCharacter: true },
  unsocket:  { requiresCharacter: true },
  rune:      { requiresCharacter: true },  // crd rune bag
  runes:     { requiresCharacter: true },  // crd runes
  shop:      { requiresCharacter: false }, // cosmetic store; supporter status is independent of character
  skin:      { requiresCharacter: false }, // cosmetic skin collection (open to all)
  buy:       { requiresCharacter: false }, // buy a skin by code
  use:       { requiresCharacter: false }, // equip a skin by code
  set:       { requiresCharacter: false }, // reset all skins to default templates
};

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

  if (impl.mw === 'dev') {
    // Superuser-only (§2). Non-devs get NO reply (invisible), skipping all middleware.
    if (!DEV_IDS.includes(ctx.userId)) return true;
    await impl.run(ctx, { args: ctx.args });
    return true;
  }
  if (impl.mw === 'ban') {
    if (await isBanned(ctx.userId)) return true;
  } else {
    const allowed = await runMiddleware(ctx, { requiresCharacter, commandKey: command });
    if (!allowed) return true;
  }
  await impl.run(ctx, { args: ctx.args });
  return true;
}

module.exports = { handleMessage, parseMessage, COMMAND_MAP, IMPLEMENTED };

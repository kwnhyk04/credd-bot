'use strict';

/**
 * `crd help [category]` (and `/help category:`) — categorized command reference (Phase 11, §5).
 *
 * A plain Discord embed (no Canvas), one compact field per category. There is NO developer
 * section — dev commands are internal tooling and never appear in public help. An optional
 * category keyword filters to a single section (`account`, `battle`, `casino`, `gacha`,
 * `inventory`, `economy`, `admin`); an unknown keyword shows the full help. `CATEGORIES` is
 * exported so help-selftest can cross-check every command against slashDefinitions.
 *
 * Density note: Discord embeds expose no font-size control; the compact look comes from the
 * condensed copy + monospace code blocks (which keep the space-aligned columns intact).
 */

const { EmbedBuilder } = require('discord.js');
const guildConfig = require('../handlers/guildConfigCache');

const ACCENT = 0xf0b232;

// Each line: { canonical, cmd (command + aliases), desc (one-line summary) }.
// prefixOnly categories are intentionally NOT slash commands (help-selftest skips their
// slash cross-check) — used for the prefix-only systems (runes, ranked, supporter, etc.).
const CATEGORIES = [
  {
    key: 'account', emoji: '⚔️', title: 'Account & Profile',
    lines: [
      { canonical: 'register', cmd: 'crd register (reg)', desc: 'Create your account' },
      { canonical: 'create', cmd: 'crd create character (cc)', desc: 'Choose your class' },
      { canonical: 'profile', cmd: 'crd profile [@user] (p)', desc: 'Identity + believer progress card' },
      { canonical: 'stats', cmd: 'crd stats [@user]', desc: 'Combat card — gear, deities, stats' },
      { canonical: 'cred', cmd: 'crd cred (g)', desc: 'Check Credux balance' },
    ],
  },
  {
    key: 'battle', emoji: '🗡️', title: 'Battle',
    lines: [
      { canonical: 'raid', cmd: 'crd raid (r)', desc: 'Fight monsters' },
      { canonical: 'duel', cmd: 'crd duel @user (d)', desc: 'Challenge a player' },
      { canonical: 'boss', cmd: 'crd boss', desc: 'View server boss' },
    ],
  },
  {
    key: 'ranked', emoji: '🏆', title: 'Ranked & Idle', prefixOnly: true,
    lines: [
      { canonical: 'auto', cmd: 'crd auto raid (ar)', desc: 'Free idle raid — banks EXP/Credux/Shards' },
      { canonical: 'ranked', cmd: 'crd ranked (rk)', desc: 'Ranked PvP match (Elo + Valor)' },
      { canonical: 'ranked', cmd: 'crd ranked claim (rc)', desc: 'Claim weekly ranked rewards' },
      { canonical: 'leaderboards', cmd: 'crd leaderboards (lb)', desc: 'Top players by category' },
      { canonical: 'pvp', cmd: 'crd pvp shop (ps) / crd pvp buy [id]', desc: 'Spend Valor Medals' },
      { canonical: 'title', cmd: 'crd title (t)', desc: 'Browse & equip earned titles' },
    ],
  },
  {
    key: 'casino', emoji: '🎰', title: 'Casino',
    lines: [
      { canonical: 'coin', cmd: 'crd coin toss [bet] heads/tails (ct)', desc: 'Coin Toss' },
      { canonical: 'dice', cmd: 'crd dice roll [bet] odd/even (dr)', desc: 'Odd or Even' },
      { canonical: 'baccarat', cmd: 'crd baccarat [bet] player/banker (bac)', desc: 'Player or Banker' },
      { canonical: 'blackjack', cmd: 'crd blackjack [bet] (bj)', desc: 'Beat the dealer' },
      { canonical: 'slot', cmd: 'crd slot machine [bet] (sl/sm)', desc: 'Spin the reels' },
      { canonical: 'crash', cmd: 'crd crash [bet]', desc: 'Cash out before it crashes' },
    ],
  },
  {
    key: 'gacha', emoji: '🌟', title: 'Gacha & Deities',
    lines: [
      { canonical: 'summon', cmd: 'crd summon [1/5/10] (s)', desc: 'Invoke a deity (100 shards/pull)' },
      { canonical: 'deity', cmd: 'crd deity collection (dc)', desc: 'Browse your collection' },
      { canonical: 'deity', cmd: 'crd deity info [name] (di)', desc: 'Deity info card' },
      { canonical: 'deity', cmd: 'crd deity equip [name] [slot] (de)', desc: 'Equip a deity (3 slots)' },
      { canonical: 'deity', cmd: 'crd deity enhance [name] (deh)', desc: 'Enhance a deity' },
    ],
  },
  {
    key: 'inventory', emoji: '🎒', title: 'Inventory & Gear',
    lines: [
      { canonical: 'bag', cmd: 'crd bag (b)', desc: 'Bag overview' },
      { canonical: 'bag', cmd: 'crd bag chests / weapons / armors (bc/bw/ba)', desc: 'Inventory sections' },
      { canonical: 'open', cmd: 'crd open [chest] (o)', desc: 'Open a chest or relic' },
      { canonical: 'equip', cmd: 'crd equip [id] (eq)', desc: 'Equip a weapon or armor' },
      { canonical: 'equipment', cmd: 'crd equipment info [id] (ei)', desc: 'Weapon/armor info card' },
      { canonical: 'enhance', cmd: 'crd enhance [id] (enh)', desc: 'Enhance gear' },
      { canonical: 'lock', cmd: 'crd lock / unlock [id] (lk/ulk)', desc: 'Lock or unlock gear' },
      { canonical: 'sell', cmd: 'crd sell [id | tier | all]', desc: 'Sell gear' },
    ],
  },
  {
    key: 'runes', emoji: '🔮', title: 'Runes & Essence', prefixOnly: true,
    lines: [
      { canonical: 'socket', cmd: 'crd socket / unsocket [id] (so/uso)', desc: 'Socket runes into gear' },
      { canonical: 'rune', cmd: 'crd rune bag (rb) / crd runes (rn)', desc: 'View runes' },
      { canonical: 'essence', cmd: 'crd essence shop (es)', desc: 'Buy rune bags with essence' },
      { canonical: 'exchange', cmd: 'crd exchange <lb|gb|db> [qty] (ex)', desc: 'Exchange essence → rune bags' },
      { canonical: 'exchange', cmd: 'crd exchange essence', desc: 'Convert essence up a tier' },
    ],
  },
  {
    key: 'supporter', emoji: '🎟️', title: 'Supporter Shop & Skins', prefixOnly: true,
    lines: [
      { canonical: 'shop', cmd: 'crd shop', desc: 'Browse the supporter skin shop' },
      { canonical: 'buy', cmd: 'crd buy [id]', desc: 'Claim a shop skin with tokens' },
      { canonical: 'skin', cmd: 'crd skin collection (skin list)', desc: 'Your skins + their equip IDs' },
      { canonical: 'equip', cmd: 'crd equip skin [id]', desc: 'Equip a skin by ID (e.g. p1, pb, pt1)' },
      { canonical: 'use', cmd: 'crd use skin [id]', desc: 'Equip a skin (alias of equip skin)' },
      { canonical: 'set', cmd: 'crd set all skin default', desc: 'Reset all skins to the default templates' },
    ],
  },
  {
    key: 'economy', emoji: '💰', title: 'Economy',
    lines: [
      { canonical: 'bestow', cmd: 'crd bestow @user [amount] (bs)', desc: 'Send Credux to a player' },
      { canonical: 'daily', cmd: 'crd daily', desc: 'Claim daily reward' },
      { canonical: 'quests', cmd: 'crd quests (q) — daily/weekly', desc: 'View & claim quests' },
    ],
  },
  {
    key: 'admin', emoji: '⚙️', title: 'Admin (requires Manage Server)',
    lines: [
      { canonical: 'admin', cmd: 'crd admin setprefix [prefix]', desc: 'Set a custom server prefix' },
      { canonical: 'admin', cmd: 'crd admin setbotchannel [#channel]', desc: 'Restrict bot to a channel' },
      { canonical: 'admin', cmd: 'crd admin setannouncementchannel [#]', desc: 'Set announcement channel' },
      { canonical: 'admin', cmd: 'crd admin setbosschannel [#channel]', desc: 'Set boss spawn channel' },
      { canonical: 'admin', cmd: 'crd admin stats', desc: 'Server activity summary' },
    ],
  },
];

const VALID_KEYS = new Set(CATEGORIES.map((c) => c.key));

function footer(guildId) {
  const gp = guildConfig.getPrefix(guildId);
  const custom = gp && gp !== 'crd' ? gp : 'not set';
  return `Prefix: crd  •  Custom prefix: ${custom}  •  Also accepts / slash commands`;
}

function buildHelpEmbed(ctx, category) {
  const filter = category ? String(category).toLowerCase() : null;
  const shown = filter && VALID_KEYS.has(filter) ? CATEGORIES.filter((c) => c.key === filter) : CATEGORIES;

  // Smaller text: render each command as a `-#` subtext line (Discord small font) instead of
  // a normal-size code block. Category headers stay bold; the whole reference lives in the
  // embed description so the compact small-text styling applies uniformly.
  const description = shown
    .map((cat) => {
      const lines = cat.lines.map((l) => `-# \`${l.cmd}\` — ${l.desc}`).join('\n');
      return `**${cat.emoji} ${cat.title}**\n${lines}`;
    })
    .join('\n\n');

  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📖 Credd — Command Help')
    .setDescription(description)
    .setFooter({ text: footer(ctx.guildId) });
}

async function execute(ctx, { args } = {}) {
  const category = args && args[0] ? args[0] : null;
  await ctx.reply({ embeds: [buildHelpEmbed(ctx, category)] });
}

module.exports = { execute, buildHelpEmbed, CATEGORIES, VALID_KEYS };

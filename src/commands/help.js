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

// Each line: { canonical, cmd (line 1, before " :"), desc (line 2, after "— ") }.
const CATEGORIES = [
  {
    key: 'account', emoji: '⚔️', title: 'Account & Profile',
    lines: [
      { canonical: 'register', cmd: 'crd register (reg)', desc: 'Create your account' },
      { canonical: 'create', cmd: 'crd create character (cc)', desc: 'Choose your class' },
      { canonical: 'profile', cmd: 'crd profile [@user] (p)', desc: 'View profile card' },
      { canonical: 'stats', cmd: 'crd stats', desc: 'Combat statistics' },
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
      { canonical: 'deity', cmd: 'crd deity equip [name] (de)', desc: 'Equip a deity' },
      { canonical: 'deity', cmd: 'crd deity enhance [name] (deh)', desc: 'Enhance a deity' },
    ],
  },
  {
    key: 'inventory', emoji: '🎒', title: 'Inventory & Weapons',
    lines: [
      { canonical: 'bag', cmd: 'crd bag (b)', desc: 'Bag overview' },
      { canonical: 'bag', cmd: 'crd bag chests (bc)', desc: 'Chest inventory' },
      { canonical: 'bag', cmd: 'crd bag weapons (bw)', desc: 'Weapon inventory' },
      { canonical: 'open', cmd: 'crd open [chest] (o)', desc: 'Open a chest or relic' },
      { canonical: 'equip', cmd: 'crd equip [weapon_id] (eq)', desc: 'Equip a weapon' },
      { canonical: 'weapon', cmd: 'crd weapon info [id] (wi)', desc: 'Weapon info card' },
      { canonical: 'enhance', cmd: 'crd enhance [weapon_id] (enh)', desc: 'Enhance a weapon' },
      { canonical: 'lock', cmd: 'crd lock / unlock [id] (lk/ulk)', desc: 'Lock or unlock a weapon' },
      { canonical: 'sell', cmd: 'crd sell [id | tier | all]', desc: 'Sell weapon(s)' },
    ],
  },
  {
    key: 'economy', emoji: '💰', title: 'Economy',
    lines: [
      { canonical: 'bestow', cmd: 'crd bestow @user [amount] (bs)', desc: 'Send Credux to a player' },
      { canonical: 'daily', cmd: 'crd daily', desc: 'Claim daily reward' },
      { canonical: 'quests', cmd: 'crd quests (q)', desc: 'View daily quests' },
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

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📖 Credd — Command Help')
    .setFooter({ text: footer(ctx.guildId) });

  for (const cat of shown) {
    const body = cat.lines.map((l) => `${l.cmd} :\n— ${l.desc}`).join('\n\n');
    embed.addFields({
      name: `${cat.emoji} ${cat.title}`,
      value: '```\n' + body + '\n```',
    });
  }
  return embed;
}

async function execute(ctx, { args } = {}) {
  const category = args && args[0] ? args[0] : null;
  await ctx.reply({ embeds: [buildHelpEmbed(ctx, category)] });
}

module.exports = { execute, buildHelpEmbed, CATEGORIES, VALID_KEYS };

'use strict';

/**
 * slashDefinitions.js — every slash command (Phase 11, §3.2) as a `SlashCommandBuilder` PLUS an
 * arg-assembler. The assembler is the load-bearing part: it reconstructs the EXACT canonical token
 * array the existing prefix handler consumes — including literal subcommand tokens like `toss`,
 * `chests`, `info`, `collection`, `machine` — and returns the User options as `mentions` (for
 * ctx.getMention). `InteractionContext.args` is always the assembler output, never raw options.
 *
 * Each entry: { name (slash command), canonical (IMPLEMENTED key to route to), builder, assemble }.
 * Dev commands have no slash equivalent (§3.2). Token contracts verified against the handlers:
 *   coin: stripSub('toss') → [bet, heads|tails]    dice: stripSub('roll') → [bet, odd|even]
 *   slot: stripSub('machine') → [bet]              baccarat: [bet, player|banker]
 *   open alias values: sc/gc/btc/bgtc/supc/sr/supr deity: [sub, name]   weapon: [info, id]
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const definitions = [];
function def(name, canonical, builder, assemble) {
  definitions.push({ name, canonical, builder: builder.setName(name), assemble });
}
const noArgs = () => ({ args: [], mentions: [] });

// ── Account ─────────────────────────────────────────────────────────────────
def('register', 'register',
  new SlashCommandBuilder().setDescription('Create your Credd account'),
  noArgs);

def('create', 'create',
  new SlashCommandBuilder().setDescription('Begin your journey')
    .addSubcommand((s) => s.setName('character').setDescription('Choose your class and create a character')),
  () => ({ args: ['character'], mentions: [] }));

def('profile', 'profile',
  new SlashCommandBuilder().setDescription('View a profile card')
    .addUserOption((o) => o.setName('user').setDescription('Whose profile (default: you)').setRequired(false)),
  (i) => { const u = i.options.getUser('user'); return { args: [], mentions: u ? [u] : [] }; });

def('stats', 'stats',
  new SlashCommandBuilder().setDescription('View your combat statistics'), noArgs);

def('avatars', 'avatars',
  new SlashCommandBuilder().setDescription('Browse your owned avatars for your current class'), noArgs);

def('avatar', 'avatar',
  new SlashCommandBuilder().setDescription('Avatar shop and equipment')
    .addSubcommand((s) => s.setName('shop').setDescription('Browse avatars for your current class'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy an avatar with supporter tokens')
      .addStringOption((o) => o.setName('id').setDescription('Avatar id').setRequired(true)))
    .addSubcommand((s) => s.setName('equip').setDescription('Equip an owned avatar')
      .addStringOption((o) => o.setName('id').setDescription('Avatar id').setRequired(true)))
    .addSubcommand((s) => s.setName('default').setDescription('Use your default class avatar')),
  (i) => {
    const sub = i.options.getSubcommand();
    const id = sub === 'buy' || sub === 'equip' ? i.options.getString('id') : null;
    return { args: id ? [sub, id] : [sub], mentions: [] };
  });

def('cred', 'cred',
  new SlashCommandBuilder().setDescription('Check your Credux balance'), noArgs);

// ── Inventory & Weapons ───────────────────────────────────────────────────────
def('bag', 'bag',
  new SlashCommandBuilder().setDescription('View your bag')
    .addStringOption((o) => o.setName('section').setDescription('Which section').setRequired(false)
      .addChoices({ name: 'chests', value: 'chests' }, { name: 'weapons', value: 'weapons' })),
  (i) => { const s = i.options.getString('section'); return { args: s ? [s] : [], mentions: [] }; });

def('open', 'open',
  new SlashCommandBuilder().setDescription('Open a chest or relic')
    .addStringOption((o) => o.setName('type').setDescription('What to open').setRequired(true)
      .addChoices(
        { name: 'Silver Chest', value: 'sc' },
        { name: 'Gold Chest', value: 'gc' },
        { name: 'Boss Treasure Chest', value: 'btc' },
        { name: 'Boss Golden Chest', value: 'bgtc' },
        { name: 'Supreme Chest', value: 'supc' },
        { name: 'Sacred Relic', value: 'sr' },
        { name: 'Supreme Relic', value: 'supr' },
        { name: 'Lesser Rune Bag', value: 'lb' },
        { name: 'Greater Rune Bag', value: 'gb' },
        { name: 'Divine Rune Bag', value: 'db' },
      ))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many to open').setRequired(false)
      .setMinValue(1).setMaxValue(20)),
  (i) => {
    const amount = i.options.getInteger('amount');
    return { args: amount ? [i.options.getString('type'), String(amount)] : [i.options.getString('type')], mentions: [] };
  });

def('equip', 'equip',
  new SlashCommandBuilder().setDescription('Equip a weapon')
    .addStringOption((o) => o.setName('weapon_id').setDescription('Weapon ID').setRequired(true)),
  (i) => ({ args: [i.options.getString('weapon_id')], mentions: [] }));

def('equipment', 'equipment',
  new SlashCommandBuilder().setDescription('Equipment tools (weapons & armor)')
    .addSubcommand((s) => s.setName('info').setDescription('View an equipment info card')
      .addStringOption((o) => o.setName('equipment_id').setDescription('Weapon or armor ID').setRequired(true))),
  (i) => ({ args: ['info', i.options.getString('equipment_id')], mentions: [] }));

def('enhance', 'enhance',
  new SlashCommandBuilder().setDescription('Enhance a weapon')
    .addStringOption((o) => o.setName('weapon_id').setDescription('Weapon ID').setRequired(true)),
  (i) => ({ args: [i.options.getString('weapon_id')], mentions: [] }));

def('lock', 'lock',
  new SlashCommandBuilder().setDescription('Lock a weapon')
    .addStringOption((o) => o.setName('weapon_id').setDescription('Weapon ID').setRequired(true)),
  (i) => ({ args: [i.options.getString('weapon_id')], mentions: [] }));

def('unlock', 'unlock',
  new SlashCommandBuilder().setDescription('Unlock a weapon')
    .addStringOption((o) => o.setName('weapon_id').setDescription('Weapon ID').setRequired(true)),
  (i) => ({ args: [i.options.getString('weapon_id')], mentions: [] }));

def('sell', 'sell',
  new SlashCommandBuilder().setDescription('Sell weapon(s)')
    .addStringOption((o) => o.setName('target').setDescription('weapon_id, a tier name, or "all"').setRequired(true)),
  (i) => ({ args: [i.options.getString('target')], mentions: [] }));

// ── Gacha & Deities ───────────────────────────────────────────────────────────
def('summon', 'summon',
  new SlashCommandBuilder().setDescription('Invoke a deity (100 shards per pull)')
    .addIntegerOption((o) => o.setName('count').setDescription('How many pulls').setRequired(false)
      .setMinValue(1).setMaxValue(30)),
  (i) => { const c = i.options.getInteger('count'); return { args: c ? [String(c)] : [], mentions: [] }; });

def('deity', 'deity',
  new SlashCommandBuilder().setDescription('Deity collection & management')
    .addSubcommand((s) => s.setName('collection').setDescription('Browse your deity collection'))
    .addSubcommand((s) => s.setName('info').setDescription('View a deity info card')
      .addStringOption((o) => o.setName('name').setDescription('Deity name').setRequired(true)))
    .addSubcommand((s) => s.setName('equip').setDescription('Equip a deity as your blessing')
      .addStringOption((o) => o.setName('name').setDescription('Deity name').setRequired(true)))
    .addSubcommand((s) => s.setName('enhance').setDescription('Enhance a deity with essence')
      .addStringOption((o) => o.setName('name').setDescription('Deity name').setRequired(true))),
  (i) => {
    const sub = i.options.getSubcommand();
    const name = sub === 'collection' ? null : i.options.getString('name');
    return { args: name ? [sub, name] : [sub], mentions: [] };
  });

def('glossary', 'glossary',
  new SlashCommandBuilder().setDescription('Browse the Credd glossary'), noArgs);

def('coin', 'coin',
  new SlashCommandBuilder().setDescription('Toss a coin with Credux')
    .addSubcommand((s) => s.setName('toss').setDescription('Call heads or tails')
      .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('side').setDescription('Your call').setRequired(true)
        .addChoices({ name: 'heads', value: 'heads' }, { name: 'tails', value: 'tails' }))),
  (i) => ({ args: ['toss', String(i.options.getInteger('amount')), i.options.getString('side')], mentions: [] }));

def('dice', 'dice',
  new SlashCommandBuilder().setDescription('Roll for odd or even with Credux')
    .addSubcommand((s) => s.setName('roll').setDescription('Call odd or even')
      .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('side').setDescription('Your call').setRequired(true)
        .addChoices({ name: 'odd', value: 'odd' }, { name: 'even', value: 'even' }))),
  (i) => ({ args: ['roll', String(i.options.getInteger('amount')), i.options.getString('side')], mentions: [] }));

def('baccarat', 'baccarat',
  new SlashCommandBuilder().setDescription('Play baccarat with Credux')
    .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('side').setDescription('Your bet').setRequired(true)
      .addChoices({ name: 'banker', value: 'banker' }, { name: 'player', value: 'player' })),
  (i) => ({ args: [String(i.options.getInteger('amount')), i.options.getString('side')], mentions: [] }));

def('blackjack', 'blackjack',
  new SlashCommandBuilder().setDescription('Play blackjack with Credux')
    .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1)),
  (i) => ({ args: [String(i.options.getInteger('amount'))], mentions: [] }));

def('slot', 'slot',
  new SlashCommandBuilder().setDescription('Play the slot machine with Credux')
    .addSubcommand((s) => s.setName('machine').setDescription('Spin the reels')
      .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1))),
  (i) => ({ args: ['machine', String(i.options.getInteger('amount'))], mentions: [] }));

def('crash', 'crash',
  new SlashCommandBuilder().setDescription('Play Crash with Credux')
    .addIntegerOption((o) => o.setName('amount').setDescription('Credux wager').setRequired(true).setMinValue(1)),
  (i) => ({ args: [String(i.options.getInteger('amount'))], mentions: [] }));

// ── Battle ────────────────────────────────────────────────────────────────────
def('raid', 'raid', new SlashCommandBuilder().setDescription('Fight a random mob'), noArgs);

def('duel', 'duel',
  new SlashCommandBuilder().setDescription('Challenge another player')
    .addUserOption((o) => o.setName('user').setDescription('Who to duel').setRequired(true))
    .addIntegerOption((o) => o.setName('level').setDescription('Normalize both duelists to this level (1-50)')
      .setMinValue(1).setMaxValue(50)),
  (i) => {
    // [Jun-2026 §3] inject a canonical `level<N>` token so duel.parseDuelLevel handles both paths.
    const lvl = i.options.getInteger('level');
    return { args: lvl != null ? [`level${lvl}`] : [], mentions: [i.options.getUser('user')] };
  });

def('boss', 'boss', new SlashCommandBuilder().setDescription('View the current server boss'), noArgs);

// ── Economy ─────────────────────────────────────────────────────────────────
def('bestow', 'bestow',
  new SlashCommandBuilder().setDescription('Send Credux to another player')
    .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount of Credux').setRequired(true).setMinValue(1)),
  (i) => ({ args: [String(i.options.getInteger('amount'))], mentions: [i.options.getUser('user')] }));

def('daily', 'daily', new SlashCommandBuilder().setDescription('Claim your daily reward'), noArgs);
def('quests', 'quests', new SlashCommandBuilder().setDescription("View today's daily quests"), noArgs);

// ── Admin ─────────────────────────────────────────────────────────────────
def('admin', 'admin',
  new SlashCommandBuilder().setDescription('Server settings (Manage Server)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('setprefix').setDescription('Set a custom server prefix')
      .addStringOption((o) => o.setName('prefix').setDescription('1–5 letters/numbers').setRequired(true)))
    .addSubcommand((s) => s.setName('setbotchannel').setDescription('Restrict bot commands to a channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('setannouncementchannel').setDescription('Official support server only for now')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('setbosschannel').setDescription('Official support server only for now')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((s) => s.setName('stats').setDescription('Server activity summary')),
  (i) => {
    const sub = i.options.getSubcommand();
    if (sub === 'setprefix') return { args: ['setprefix', i.options.getString('prefix')], mentions: [] };
    if (sub === 'stats') return { args: ['stats'], mentions: [] };
    const ch = i.options.getChannel('channel');
    return { args: [sub, ch ? ch.id : ''], mentions: [] };
  });

// ── Help ─────────────────────────────────────────────────────────────────────
def('help', 'help',
  new SlashCommandBuilder().setDescription('Command help')
    .addStringOption((o) => o.setName('category').setDescription('Filter to one category').setRequired(false)
      .addChoices(
        { name: 'account', value: 'account' }, { name: 'battle', value: 'battle' },
        { name: 'gacha', value: 'gacha' }, { name: 'casino', value: 'casino' },
        { name: 'inventory', value: 'inventory' }, { name: 'economy', value: 'economy' },
        { name: 'admin', value: 'admin' },
      )),
  (i) => { const c = i.options.getString('category'); return { args: c ? [c] : [], mentions: [] }; });

const byName = new Map(definitions.map((d) => [d.name, d]));

module.exports = { definitions, byName };

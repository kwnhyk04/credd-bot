'use strict';

const {
  ContainerBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const pool = require('../../db/pool');
const { isBanned } = require('../../handlers/middleware');

const BRAND = 0x9b59b6;

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

const LORE =
  '*Welcome to Credd, the home of many adventures. One of them is waiting for you.*\n\n' +
  '*In the age before silence, the world thrived under the watch of gods and spirits. Mortals prayed, ' +
  'offered, and remembered, and in return, the divine kept the darkness at bay.*\n\n' +
  '*But slowly, the prayers stopped. The offerings ceased. One by one, gods faded as the last whisper of ' +
  'their names died on human lips. Without belief, there is no power. Without power, there is no protection.*\n\n' +
  '*The monsters came first in shadows, then in floods. The world that was once guarded by divine hands ' +
  'crumbled into chaos. Cities fell. The faithful were scattered. And the gods were forgotten.*\n\n' +
  '*But not all of them.*\n\n' +
  '*Somewhere, in the ruins of a world that stopped believing, you still remember. A name. A story. A prayer. ' +
  'That single act of remembrance is enough to pull a forgotten god back from the void — weak, faded, but alive.*\n\n' +
  '*You are the Last Believer. And the fate of gods rests in your memory.*';

const STEPS = [
  ['⚔️', '1. Your Warrior — `crd create character`', 'Create your vessel and choose your path: Swordsman, Fighter, Mage, Knight, or Archer.'],
  ['✨', '2. The Forgotten Gods — `crd summon`', 'Perform Invocations to summon forgotten deities and carry their will into battle.'],
  ['🎒', '3. Your Arsenal — `crd bag`', 'Collect and equip weapons forged from history and myth.'],
  ['🛡️', '4. The Battle — `crd raid`', 'March against the creatures that have overtaken the land.'],
  ['🪙', '5. Wealth of the Believer — `crd cred`', 'Belief Shards fuel Invocations. Sacred Relics open greater summons. Credux strengthens your weapons.'],
];

// CLAUDE.md container standard: header → separator → body → separator → footer.
function welcomePayload(userId) {
  const steps = STEPS
    .map(([icon, title, text]) => `${icon} **${title}**\n-# ${text}`)
    .join('\n\n');

  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent('## 🕯️ Welcome to Credd, the Last Believer'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(LORE))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(steps))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Press "I Understand" to begin.'));

  return {
    components: [container, confirmRow(userId)],
    flags: MessageFlags.IsComponentsV2,
  };
}

// Simple one-box container for the post-click states (a CV2 message cannot be
// edited back to classic embeds, so these stay containers — same text as before).
function noteContainer(title, body, accent = BRAND) {
  return new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents((td) => td.setContent(`## ${title}`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(body));
}

function confirmRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`register:confirm:${userId}`)
      .setLabel('I Understand')
      .setStyle(ButtonStyle.Success),
  );
}

/**
 * `crd register` — ban-checked upstream. Shows the welcome embed + confirm button.
 * No-op friendly reply if already registered.
 */
async function execute(message) {
  const discordId = message.author.id;
  const { rows } = await pool.query('SELECT 1 FROM users WHERE discord_id = $1', [discordId]);
  if (rows.length > 0) {
    await message.reply({ content: 'You are already registered. Use `crd create character` to begin your journey.', allowedMentions: { repliedUser: false } });
    return;
  }
  await message.reply({ ...welcomePayload(discordId), allowedMentions: { repliedUser: false } });
}

/**
 * Button: register:confirm:<userId>
 * Inserts users → users_bag (defaults 0; NO grant here) → pity_counters in one transaction.
 */
async function handleConfirm(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  let client;
  try {
    if (await isBanned(interaction.user.id)) {
      await interaction.followUp({ content: 'You are unable to use this bot.', flags: MessageFlags.Ephemeral });
      return;
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const ins = await client.query(
      'INSERT INTO users (discord_id, username) VALUES ($1, $2) ON CONFLICT (discord_id) DO NOTHING',
      [interaction.user.id, interaction.user.username]
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      await interaction.editReply({
        components: [noteContainer('Already Registered', 'You are already registered. Use `crd create character` to begin.')],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    // users_bag at all-0 defaults — the 1,000 shards / 10 silver grant happens at character creation (§35.6).
    await client.query('INSERT INTO users_bag (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING', [interaction.user.id]);
    await client.query('INSERT INTO pity_counters (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING', [interaction.user.id]);

    await client.query('COMMIT');
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[register] transaction failed:', err.message);
    await interaction.editReply({
      components: [noteContainer('Registration Failed', 'Something went wrong. Please try `crd register` again.', 0xe74c3c)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    return;
  } finally {
    if (client) client.release();
  }

  try {
    await interaction.editReply({
      components: [noteContainer('Welcome, Believer', 'You are now registered.\n\nNext, create your warrior with `crd create character`.')],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    console.error('[register] completion refresh failed:', err.message);
    await interaction.followUp({
      content: 'Registration completed, but the welcome message could not refresh. Run `crd create character` to continue.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

module.exports = { execute, handleConfirm };

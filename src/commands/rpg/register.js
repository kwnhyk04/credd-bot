'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const pool = require('../../db/pool');
const { isBanned } = require('../../handlers/middleware');

const BRAND = 0x9b59b6;

function welcomeEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Welcome to Credd, the Last Believer')
    .setDescription(
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
      '*You are the Last Believer. And the fate of gods rests in your memory.*'
    )
    .addFields(
      { name: '1. Your Warrior — `crd create character`', value: 'Create your vessel and choose your path: Swordsman, Fighter, Mage, Knight, or Archer.' },
      { name: '2. The Forgotten Gods — `crd summon`', value: 'Perform Invocations to summon forgotten deities and carry their will into battle.' },
      { name: '3. Your Arsenal — `crd bag`', value: 'Collect and equip weapons forged from history and myth.' },
      { name: '4. The Battle — `crd raid`', value: 'March against the creatures that have overtaken the land.' },
      { name: '5. Wealth of the Believer — `crd cred`', value: 'Belief Shards fuel Invocations. Sacred Relics open greater summons. Credux strengthens your weapons.' },
    )
    .setFooter({ text: 'Press "I Understand" to begin.' });
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
  await message.reply({ embeds: [welcomeEmbed()], components: [confirmRow(discordId)], allowedMentions: { repliedUser: false } });
}

/**
 * Button: register:confirm:<userId>
 * Inserts users → users_bag (defaults 0; NO grant here) → pity_counters in one transaction.
 */
async function handleConfirm(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  if (await isBanned(interaction.user.id)) {
    await interaction.reply({ content: 'You are unable to use this bot.', ephemeral: true });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query(
      'INSERT INTO users (discord_id, username) VALUES ($1, $2) ON CONFLICT (discord_id) DO NOTHING',
      [interaction.user.id, interaction.user.username]
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(BRAND).setTitle('Already Registered').setDescription('You are already registered. Use `crd create character` to begin.')],
        components: [],
      });
      return;
    }

    // users_bag at all-0 defaults — the 1,000 shards / 10 silver grant happens at character creation (§35.6).
    await client.query('INSERT INTO users_bag (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING', [interaction.user.id]);
    await client.query('INSERT INTO pity_counters (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING', [interaction.user.id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[register] transaction failed:', err.message);
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('Registration Failed').setDescription('Something went wrong. Please try `crd register` again.')],
      components: [],
    }).catch(() => {});
    return;
  } finally {
    client.release();
  }

  await interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(BRAND)
      .setTitle('Welcome, Believer')
      .setDescription('You are now registered.\n\nNext, create your warrior with `crd create character`.')],
    components: [],
  });
}

module.exports = { execute, handleConfirm };

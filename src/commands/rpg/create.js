'use strict';

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const pool = require('../../db/pool');
const { isBanned } = require('../../handlers/middleware');
const { CLASSES, CLASS_NAMES } = require('../../config/classes');
const { STARTER_WEAPON_NAME, STARTER_WEAPON, GRANT_BELIEF_SHARDS, GRANT_SILVER_CHESTS } = require('../../config/starter');
const { generateUniqueWeaponId } = require('../../utils/weaponId');

const BRAND = 0x9b59b6;

function classSelectEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('Create Your Warrior')
    .setDescription('Every believer needs a vessel. Choose the path you walk.\n\nSelect a class below to learn more.')
    .addFields(CLASS_NAMES.map(name => ({
      name: `${CLASSES[name].emoji} ${name}`,
      value: `Passive: **${CLASSES[name].passiveName}**`,
      inline: true,
    })));
}

function classSelectRow(userId) {
  return new ActionRowBuilder().addComponents(
    CLASS_NAMES.map(name =>
      new ButtonBuilder()
        .setCustomId(`create:class:${name}:${userId}`)
        .setLabel(name)
        .setEmoji(CLASSES[name].emoji)
        .setStyle(ButtonStyle.Secondary)
    )
  );
}

function classPreviewEmbed(className) {
  const cls = CLASSES[className];
  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${cls.emoji} ${className}`)
    .setDescription(`*${cls.flavor}*\n\n${cls.passiveLine}`)
    .setFooter({ text: 'Confirm your choice, or go back to pick another class.' });
}

function previewRow(className, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`create:confirm:${className}:${userId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`create:back:${userId}`).setLabel('Go Back').setStyle(ButtonStyle.Secondary),
  );
}

/**
 * `crd create [character]` — must be registered (enforced by middleware before this runs).
 * No-op friendly reply if a character already exists, else show class selection.
 */
async function execute(message) {
  const { rows } = await pool.query('SELECT 1 FROM user_character WHERE discord_id = $1', [message.author.id]);
  if (rows.length > 0) {
    await message.reply({ content: 'You already have a character. Use `crd profile` to view it.', allowedMentions: { repliedUser: false } });
    return;
  }
  await message.reply({ embeds: [classSelectEmbed()], components: [classSelectRow(message.author.id)], allowedMentions: { repliedUser: false } });
}

// Button: create:class:<Class>:<userId>
async function handleClassSelect(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  if (!CLASSES[className]) {
    await interaction.reply({ content: 'Unknown class.', ephemeral: true });
    return;
  }
  await interaction.update({ embeds: [classPreviewEmbed(className)], components: [previewRow(className, ownerId)] });
}

// Button: create:back:<userId>
async function handleBack(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  await interaction.update({ embeds: [classSelectEmbed()], components: [classSelectRow(ownerId)] });
}

// Button: create:confirm:<Class>:<userId>
async function handleConfirm(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', ephemeral: true });
    return;
  }
  if (!CLASS_NAMES.includes(className)) {
    await interaction.reply({ content: 'Unknown class.', ephemeral: true });
    return;
  }
  if (await isBanned(interaction.user.id)) {
    await interaction.reply({ content: 'You are unable to use this bot.', ephemeral: true });
    return;
  }

  const discordId = interaction.user.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Must be registered.
    const reg = await client.query('SELECT 1 FROM users WHERE discord_id = $1', [discordId]);
    if (reg.rows.length === 0) {
      await client.query('ROLLBACK');
      await interaction.update({ embeds: [errEmbed('You are not registered. Use `crd register` first.')], components: [] });
      return;
    }

    // Guard: already has a character.
    const existing = await client.query('SELECT 1 FROM user_character WHERE discord_id = $1', [discordId]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      await interaction.update({ embeds: [errEmbed('You already have a character. Use `crd profile` to view it.')], components: [] });
      return;
    }

    // Look up the (seeded) Initiate's Blade roster row.
    const roster = await client.query('SELECT weapon_roster_id FROM weapon_roster WHERE name = $1', [STARTER_WEAPON_NAME]);
    if (roster.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error(`[create] starter weapon "${STARTER_WEAPON_NAME}" not found in weapon_roster`);
      await interaction.update({ embeds: [errEmbed('Character creation is temporarily unavailable. Please try again later.')], components: [] });
      return;
    }
    const weaponRosterId = roster.rows[0].weapon_roster_id;

    // Weapon row first (FK-safe), then character with equipped_weapon_id already set.
    const weaponId = await generateUniqueWeaponId(client);
    await client.query(
      `INSERT INTO user_weapons
         (discord_id, weapon_id, weapon_roster_id, curr_atk, curr_hp, curr_def,
          enhancement, base_atk, base_hp, base_def, crit, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $4, $5, $6, $7, FALSE)`,
      [discordId, weaponId, weaponRosterId, STARTER_WEAPON.atk, STARTER_WEAPON.hp, STARTER_WEAPON.def, STARTER_WEAPON.crit]
    );

    await client.query(
      'INSERT INTO user_character (discord_id, class, equipped_weapon_id) VALUES ($1, $2, $3)',
      [discordId, className, weaponId]
    );

    // Starter grant (creation only, §35.6).
    await client.query(
      'UPDATE users_bag SET belief_shards = belief_shards + $2, silver_chest = silver_chest + $3 WHERE discord_id = $1',
      [discordId, GRANT_BELIEF_SHARDS, GRANT_SILVER_CHESTS]
    );

    await client.query('COMMIT');

    const cls = CLASSES[className];
    await interaction.update({
      embeds: [new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`${cls.emoji} Character Created — ${className}`)
        .setDescription(`Your journey begins, Believer.\n\n**Passive:** ${cls.passiveName}`)
        .addFields(
          { name: 'Starter Weapon', value: `${STARTER_WEAPON_NAME} (Common) — equipped`, inline: false },
          { name: 'Starter Grant', value: `${GRANT_BELIEF_SHARDS.toLocaleString()} Belief Shards · ${GRANT_SILVER_CHESTS} Silver Chests`, inline: false },
        )
        .setFooter({ text: 'Use crd profile to view your character.' })],
      components: [],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[create] transaction failed:', err.message);
    await interaction.update({ embeds: [errEmbed('Something went wrong creating your character. Please try `crd create character` again.')], components: [] }).catch(() => {});
  } finally {
    client.release();
  }
}

function errEmbed(msg) {
  return new EmbedBuilder().setColor(0xe74c3c).setTitle('Character Creation').setDescription(msg);
}

module.exports = { execute, handleClassSelect, handleBack, handleConfirm };

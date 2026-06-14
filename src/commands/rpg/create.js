'use strict';

const {
  ContainerBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { isBanned } = require('../../handlers/middleware');
const { CLASSES, CLASS_NAMES } = require('../../config/classes');
const { STARTER_WEAPON_NAME, STARTER_WEAPON, GRANT_BELIEF_SHARDS, GRANT_SILVER_CHESTS } = require('../../config/starter');
const { generateUniqueWeaponId } = require('../../utils/weaponId');
const { renderPortraitCard } = require('../../engine/renderPortraitCard');

const BRAND = 0x9b59b6;

const sep = (s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true);

// Class art (Roster Conventions Part 4): assets/classes/{class_lowercase}.png
// — swordsman/fighter/mage/knight/archer.
const CLASSES_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'classes');

/** Absolute path to a class image, or null if missing (caller falls back to text-only). */
function classImageFile(className) {
  const p = path.join(CLASSES_DIR, `${className.toLowerCase()}.png`);
  try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  return null;
}

// CLAUDE.md container standard: header → separator → body → separator → footer.
// Body: one class per line (emoji + bold name + -# passive), like the bag layout.
function classSelectPayload(userId) {
  const classLines = CLASS_NAMES
    .map(name => `${CLASSES[name].emoji} **${name}**\n-# Passive: ${CLASSES[name].passiveName}`)
    .join('\n\n');

  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent('## ⚒️ Create Your Warrior'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent('*Every believer needs a vessel. Choose the path you walk.*')
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(classLines))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Select a class below to learn more.'));

  return {
    components: [container, classSelectRow(userId)],
    flags: MessageFlags.IsComponentsV2,
  };
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

// Portrait card: class art on the LEFT (3:4, never cropped), flavor + passive on the
// RIGHT. Missing art / render failure → text-only fallback, never crashes.
async function classPreviewPayload(className, userId) {
  const cls = CLASSES[className];
  const attachName = `class_${className.toLowerCase()}.png`;

  let file = null;
  try {
    const buffer = await renderPortraitCard({
      imagePath: classImageFile(className),
      accent: '#9b59b6',
      title: className,
      subtitle: `Passive: ${cls.passiveName}`,
      sections: [
        { body: cls.flavor },
        { body: cls.passiveLine.replace(/\*\*/g, '') },
      ],
    });
    file = new AttachmentBuilder(buffer, { name: attachName });
  } catch (err) {
    console.error('[create] class card render failed:', err.message);
  }

  const container = new ContainerBuilder().setAccentColor(BRAND);
  if (file) {
    container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(`attachment://${attachName}`)));
  } else {
    container
      .addTextDisplayComponents((td) => td.setContent(`## ${cls.emoji} ${className}`))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(`*${cls.flavor}*\n\n${cls.passiveLine}`));
  }
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent('-# Confirm your choice, or go back to pick another class.'));

  return {
    components: [container, previewRow(className, userId)],
    files: file ? [file] : [],
    flags: MessageFlags.IsComponentsV2,
  };
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
  await message.reply({ ...classSelectPayload(message.author.id), allowedMentions: { repliedUser: false } });
}

// Button: create:class:<Class>:<userId>
async function handleClassSelect(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!CLASSES[className]) {
    await interaction.reply({ content: 'Unknown class.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(await classPreviewPayload(className, ownerId));
}

// Button: create:back:<userId>
async function handleBack(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  // attachments: [] clears the class image carried by the preview screen.
  await interaction.update({ ...classSelectPayload(ownerId), attachments: [] });
}

// Button: create:confirm:<Class>:<userId>
async function handleConfirm(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!CLASS_NAMES.includes(className)) {
    await interaction.reply({ content: 'Unknown class.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (await isBanned(interaction.user.id)) {
    await interaction.reply({ content: 'You are unable to use this bot.', flags: MessageFlags.Ephemeral });
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
      await interaction.update(errPayload('You are not registered. Use `crd register` first.'));
      return;
    }

    // Guard: already has a character.
    const existing = await client.query('SELECT 1 FROM user_character WHERE discord_id = $1', [discordId]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      await interaction.update(errPayload('You already have a character. Use `crd profile` to view it.'));
      return;
    }

    // Look up the (seeded) Initiate's Blade roster row.
    const roster = await client.query('SELECT weapon_roster_id FROM weapon_roster WHERE name = $1', [STARTER_WEAPON_NAME]);
    if (roster.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error(`[create] starter weapon "${STARTER_WEAPON_NAME}" not found in weapon_roster`);
      await interaction.update(errPayload('Character creation is temporarily unavailable. Please try again later.'));
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
    const done = new ContainerBuilder()
      .setAccentColor(0xFFD700)
      .addTextDisplayComponents((td) => td.setContent(`## ${cls.emoji} Character Created — ${className}`))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) =>
        td.setContent(
          `Your journey begins, Believer.\n\n**Passive:** ${cls.passiveName}\n\n` +
          `**Starter Weapon**\n-# ${STARTER_WEAPON_NAME} (Common) — equipped\n\n` +
          `**Starter Grant**\n-# ${GRANT_BELIEF_SHARDS.toLocaleString()} Belief Shards · ${GRANT_SILVER_CHESTS} Silver Chests`
        )
      )
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent('-# Use `crd profile` to view your character.'));
    await interaction.update({ components: [done], flags: MessageFlags.IsComponentsV2, attachments: [] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[create] transaction failed:', err.message);
    await interaction.update(errPayload('Something went wrong creating your character. Please try `crd create character` again.')).catch(() => {});
  } finally {
    client.release();
  }
}

function errPayload(msg) {
  const container = new ContainerBuilder()
    .setAccentColor(0xe74c3c)
    .addTextDisplayComponents((td) => td.setContent('## Character Creation'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(msg));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { execute, handleClassSelect, handleBack, handleConfirm };

'use strict';

/**
 * changeClass.js — `crd use cc` Change Character flow (Genesis update S14).
 *
 * A fully INDEPENDENT copy of the Create Character embed configuration
 * (create.js): its own brand constant, payload builders, custom-id namespace
 * (`chgclass:*`), and cache key. Editing either flow never affects the other;
 * only true shared helpers are imported (CLASSES, smallDivider, portrait
 * renderer, canvas cache).
 *
 * Flow: `crd use cc` (ownership pre-checked in use.js) → class select →
 * preview + warning → Confirm/Cancel. The Character Class Change item is
 * consumed ONLY inside the confirm transaction, strictly after the class
 * update and every dependent update succeed. Cancel, Go Back, timeout
 * (component expiry), selecting the current class, invalid classes, and any
 * DB failure consume nothing (ROLLBACK / no DB writes at all).
 *
 * Owner-specified avatar & skin policy on a successful change:
 *  - Purchased avatar styles (token_cost > 0) of the OLD class: refund the
 *    CURRENT shop token price to the supporter token balance (skipped when no
 *    supporters row / price no longer exists), remove ownership, unequip.
 *  - Founder/tester (grant-only, genderless) avatars: no refund — ownership
 *    and equip remap directly to the NEW class row of the same style.
 *  - Battle skins: the OLD class default battle skin is replaced by the NEW
 *    class default (ownership + equip if it was the equipped one). Other
 *    equipped skins are untouched.
 * Progression (levels, EXP, Credux, items, chests, gear) is preserved by
 * construction — only user_character.class changes on the character row, and
 * stats are runtime-derived from class + level.
 */

const {
  ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/pool');
const { smallDivider: sep } = require('../../utils/componentsV2');
const { CLASSES, CLASS_NAMES } = require('../../config/classes');
const { renderPortraitCard } = require('../../engine/renderPortraitCard');
const { assetPath, isRemoteAssetsEnabled } = require('../../utils/assets');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const { makeOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { emoji } = require('../../utils/emojis');
const { STYLE_COST } = require('../../engine/avatarSystem');
const { grantTokensTx } = require('../../engine/supporterTokens');

// Independent Change Character configuration (S14: copied, never shared).
const CHANGE_BRAND = 0x9b59b6;
const CHANGE_CARD_RENDER_REV = 1;
const GRANT_ONLY_STYLES = new Set(['founder', 'tester']);

const CLASSES_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'classes');

function classImageFile(className) {
  if (isRemoteAssetsEnabled()) return assetPath(`classes/${className.toLowerCase()}.png`);
  const p = path.join(CLASSES_DIR, `${className.toLowerCase()}.png`);
  try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  return null;
}

/* ── Payload builders (independent copies of the Create layout) ─────────── */

function changeClassSelectPayload(userId, currentClass) {
  const classLines = CLASS_NAMES
    .map((name) => {
      const marker = name === currentClass ? ' — *current class*' : '';
      return `${CLASSES[name].emoji} **${name}**${marker}\n-# Passive: ${CLASSES[name].passiveName}`;
    })
    .join('\n\n');

  const container = new ContainerBuilder()
    .setAccentColor(CHANGE_BRAND)
    .addTextDisplayComponents((td) => td.setContent('## ⚒️ Change Character'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent('*Your vessel can be reforged. Choose the new path you will walk.*')
    )
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(classLines))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) =>
      td.setContent('-# Select a new class to preview it. Your Class Change item is only consumed after you confirm.')
    );

  return {
    components: [container, changeClassSelectRow(userId, currentClass)],
    flags: MessageFlags.IsComponentsV2,
  };
}

function changeClassSelectRow(userId, currentClass) {
  return new ActionRowBuilder().addComponents(
    CLASS_NAMES.map((name) =>
      new ButtonBuilder()
        .setCustomId(`chgclass:class:${name}:${userId}`)
        .setLabel(name)
        .setEmoji(CLASSES[name].emoji)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(name === currentClass) // current class is not selectable
    )
  );
}

async function changeClassPreviewPayload(className, userId, currentClass) {
  const cls = CLASSES[className];

  let image = null;
  try {
    const cardInput = {
      imagePath: classImageFile(className),
      accent: '#9b59b6',
      title: className,
      subtitle: `Passive: ${cls.passiveName}`,
      sections: [
        { body: cls.flavor },
        { body: cls.passiveLine.replace(/\*\*/g, '') },
      ],
    };
    const logContext = {
      system: 'changeClass',
      command: 'use cc',
      imageType: 'class_preview',
      userId,
    };
    const cached = await getCachedCanvasUrl(
      ['change-class-preview-card', CHANGE_CARD_RENDER_REV, cardInput],
      () => renderPortraitCard(cardInput),
      {},
      { returnImageOnFailure: true, logContext }
    );
    image = cached?.url
      ? { url: cached.url, file: null }
      : cached?.image
        ? attachmentFromOptimizedImage(cached.image, `chgclass_${className.toLowerCase()}`, { ...logContext, reusedBuffer: true })
        : await makeOptimizedAttachment(await renderPortraitCard(cardInput), `chgclass_${className.toLowerCase()}`, { logContext });
  } catch (err) {
    console.error('[changeClass] class card render failed:', err.message);
  }

  const container = new ContainerBuilder().setAccentColor(CHANGE_BRAND);
  if (image) {
    container.addMediaGalleryComponents((g) => g.addItems((item) => item.setURL(image.url)));
  } else {
    container
      .addTextDisplayComponents((td) => td.setContent(`## ${cls.emoji} ${className}`))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(`*${cls.flavor}*\n\n${cls.passiveLine}`));
  }
  container
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(
      `⚠️ **${currentClass} → ${className}**\n` +
      `Your class will be changed. Progression, Credux, items, chests, and equipment are kept. ` +
      `Class-specific avatars of your old class are refunded (purchased) or remapped (founder/tester), ` +
      `and your default battle skin follows the new class.\n` +
      `-# Confirm to change class and consume **1× ${emoji('change_class')} Character Class Change** — or cancel (nothing is consumed).`
    ));

  return {
    components: [container, changePreviewRow(className, userId)],
    files: image?.file ? [image.file] : [],
    flags: MessageFlags.IsComponentsV2,
  };
}

function changePreviewRow(className, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`chgclass:confirm:${className}:${userId}`).setLabel('Confirm Change').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`chgclass:back:${userId}`).setLabel('Go Back').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`chgclass:cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

function errPayload(msg) {
  const container = new ContainerBuilder()
    .setAccentColor(0xe74c3c)
    .addTextDisplayComponents((td) => td.setContent('## Change Character'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(msg));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function closedPayload(text) {
  const container = new ContainerBuilder()
    .setAccentColor(CHANGE_BRAND)
    .addTextDisplayComponents((td) => td.setContent('## ⚒️ Change Character'))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(text));
  return { components: [container], flags: MessageFlags.IsComponentsV2, attachments: [] };
}

/* ── Entry (from `crd use cc`; ownership already pre-checked) ───────────── */

async function start(message) {
  const { rows } = await pool.query(
    'SELECT class FROM user_character WHERE discord_id = $1',
    [message.author.id]
  );
  if (rows.length === 0) {
    return message.reply({
      content: 'You have no character — use `crd create character` first.',
      allowedMentions: { repliedUser: false },
    });
  }
  return message.reply({
    ...changeClassSelectPayload(message.author.id, rows[0].class),
    allowedMentions: { repliedUser: false },
  });
}

/* ── Button handlers ────────────────────────────────────────────────────── */

async function handleClassSelect(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!CLASSES[className]) {
    await interaction.reply({ content: 'Unknown class.', flags: MessageFlags.Ephemeral });
    return;
  }
  const { rows } = await pool.query('SELECT class FROM user_character WHERE discord_id = $1', [ownerId]);
  const currentClass = rows[0]?.class || null;
  if (className === currentClass) {
    // Server-side guard (buttons are disabled client-side too): no consumption.
    await interaction.reply({ content: `You are already a **${className}** — pick a different class.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  try {
    await interaction.editReply(await changeClassPreviewPayload(className, ownerId, currentClass));
  } catch (err) {
    console.error('[changeClass] preview failed:', err.message);
    await interaction.followUp({ content: 'Class preview failed. Try selecting the class again.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function handleBack(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  const { rows } = await pool.query('SELECT class FROM user_character WHERE discord_id = $1', [ownerId]);
  await interaction.deferUpdate();
  await interaction.editReply({ ...changeClassSelectPayload(ownerId, rows[0]?.class || null), attachments: [] });
}

async function handleCancel(interaction, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  // Pure message edit — zero DB writes; the item is untouched.
  await interaction.deferUpdate();
  await interaction.editReply(closedPayload('-# Class change cancelled — nothing was consumed.'));
}

/**
 * Button: chgclass:confirm:<Class>:<userId> — the ONLY place the item is
 * consumed, strictly after every dependent update succeeds, all-or-nothing.
 */
async function handleConfirm(interaction, className, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons aren\'t for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!CLASS_NAMES.includes(className)) {
    await interaction.reply({ content: 'Unknown class.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();

  const discordId = interaction.user.id;
  let client;
  let donePayload = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Lock order: users_bag BEFORE user_character (project convention).
    const bag = await client.query(
      'SELECT change_class FROM users_bag WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (bag.rows.length === 0 || Number(bag.rows[0].change_class) < 1) {
      await client.query('ROLLBACK');
      await interaction.editReply(errPayload('You no longer own a Character Class Change item — nothing was consumed.'));
      return;
    }

    const charRes = await client.query(
      'SELECT class FROM user_character WHERE discord_id = $1 FOR UPDATE',
      [discordId]
    );
    if (charRes.rows.length === 0) {
      await client.query('ROLLBACK');
      await interaction.editReply(errPayload('You have no character — nothing was consumed.'));
      return;
    }
    const oldClass = charRes.rows[0].class;
    if (oldClass === className) {
      await client.query('ROLLBACK');
      await interaction.editReply(errPayload(`You are already a **${className}** — nothing was consumed.`));
      return;
    }

    // 1) The class change itself. Nothing else on the row is touched —
    // level/EXP/believer/deities/equipment/pvp all preserved by construction.
    await client.query(
      'UPDATE user_character SET class = $2 WHERE discord_id = $1',
      [discordId, className]
    );

    // 2) Avatar policy (owner-specified). Snapshot the old-class ownership +
    // the equipped avatar, then refund purchased styles / remap grant-only.
    const equippedRes = await client.query(
      'SELECT avatar_id FROM equipped_avatars WHERE discord_id = $1',
      [discordId]
    );
    const equippedId = equippedRes.rows[0]?.avatar_id ?? null;

    const ownedOld = await client.query(
      `SELECT ua.avatar_id, ac.avatar_key, ac.style, ac.gender, ac.token_cost
         FROM user_avatars ua
         JOIN avatar_catalog ac ON ac.avatar_id = ua.avatar_id
        WHERE ua.discord_id = $1 AND lower(ac.class_name) = lower($2)`,
      [discordId, oldClass]
    );

    const hasSupporterRow = (await client.query(
      'SELECT 1 FROM supporters WHERE discord_id = $1', [discordId]
    )).rows.length > 0;

    let refundedTokens = 0;
    const remapped = [];
    for (const row of ownedOld.rows) {
      const wasEquipped = equippedId != null && String(equippedId) === String(row.avatar_id);
      if (GRANT_ONLY_STYLES.has(row.style)) {
        // Founder/tester: remap ownership (and equip) to the new class row of
        // the same style — genderless per owner, prefer the same gender row.
        const target = await client.query(
          `SELECT avatar_id FROM avatar_catalog
            WHERE style = $1 AND lower(class_name) = lower($2) AND is_active = TRUE
            ORDER BY (gender = $3) DESC
            LIMIT 1`,
          [row.style, className, row.gender]
        );
        await client.query('DELETE FROM user_avatars WHERE discord_id = $1 AND avatar_id = $2', [discordId, row.avatar_id]);
        if (target.rows.length > 0) {
          const newId = target.rows[0].avatar_id;
          await client.query(
            `INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
             VALUES ($1, $2, 'grant', NOW()) ON CONFLICT (discord_id, avatar_id) DO NOTHING`,
            [discordId, newId]
          );
          if (wasEquipped) {
            await client.query(
              `INSERT INTO equipped_avatars (discord_id, avatar_id, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (discord_id) DO UPDATE SET avatar_id = EXCLUDED.avatar_id, updated_at = NOW()`,
              [discordId, newId]
            );
          }
          remapped.push(row.style);
        } else if (wasEquipped) {
          await client.query('DELETE FROM equipped_avatars WHERE discord_id = $1', [discordId]);
        }
      } else {
        // Purchased style: refund the CURRENT shop price, remove ownership,
        // unequip (renderer falls back to the new class default art).
        const price = Number(STYLE_COST[row.style] ?? row.token_cost ?? 0);
        await client.query('DELETE FROM user_avatars WHERE discord_id = $1 AND avatar_id = $2', [discordId, row.avatar_id]);
        if (wasEquipped) {
          await client.query('DELETE FROM equipped_avatars WHERE discord_id = $1', [discordId]);
        }
        if (price > 0 && hasSupporterRow) {
          await grantTokensTx(client, discordId, price, 'avatar_refund', row.avatar_key);
          refundedTokens += price;
        }
      }
    }

    // 3) Battle skins: replace the old class default with the new class
    // default (create.js parity); other skins untouched.
    const defaults = await client.query(
      `SELECT cosmetic_key, cosmetic_id FROM cosmetic_catalog
        WHERE cosmetic_key IN ($1, $2) AND is_active = TRUE`,
      [`class_battle_${oldClass.toLowerCase()}`, `class_battle_${className.toLowerCase()}`]
    );
    const byKey = new Map(defaults.rows.map((r) => [r.cosmetic_key, r.cosmetic_id]));
    const oldDefaultId = byKey.get(`class_battle_${oldClass.toLowerCase()}`) ?? null;
    const newDefaultId = byKey.get(`class_battle_${className.toLowerCase()}`) ?? null;
    if (newDefaultId != null) {
      await client.query(
        `INSERT INTO user_cosmetics (discord_id, cosmetic_id, source, acquired_at)
         VALUES ($1, $2, 'grant', NOW()) ON CONFLICT (discord_id, cosmetic_id) DO NOTHING`,
        [discordId, newDefaultId]
      );
      if (oldDefaultId != null) {
        // Repoint only when the old class default is the equipped battle skin.
        await client.query(
          `UPDATE equipped_skins SET cosmetic_id = $3, override_path = NULL, updated_at = NOW()
            WHERE discord_id = $1 AND category = 'battle' AND cosmetic_id = $2`,
          [discordId, oldDefaultId, newDefaultId]
        );
      }
    }
    if (oldDefaultId != null) {
      await client.query(
        'DELETE FROM user_cosmetics WHERE discord_id = $1 AND cosmetic_id = $2',
        [discordId, oldDefaultId]
      );
    }

    // 4) Consume exactly one item — LAST, and only if still owned (guards
    // concurrent confirms / duplicate button retries; 0 rows ⇒ full rollback).
    const consume = await client.query(
      `UPDATE users_bag SET change_class = change_class - 1
        WHERE discord_id = $1 AND change_class >= 1
        RETURNING change_class`,
      [discordId]
    );
    if (consume.rows.length === 0) {
      await client.query('ROLLBACK');
      await interaction.editReply(errPayload('Your Character Class Change item was already used — nothing was changed or consumed.'));
      return;
    }
    const remaining = Number(consume.rows[0].change_class);

    await client.query(
      `INSERT INTO game_logs (discord_id, action, item_type, previous_chest_count, updated_chest_count)
       VALUES ($1, 'Class Change', 'change_class', $2, $3)`,
      [discordId, remaining + 1, remaining]
    );

    await client.query('COMMIT');

    const cls = CLASSES[className];
    const lines = [
      `Your vessel has been reforged, Believer.`,
      ``,
      `**${oldClass} → ${className}**`,
      `**Passive:** ${cls.passiveName}`,
      ``,
      `-# ${emoji('change_class')} Consumed **1× Character Class Change** · **${remaining}** remaining`,
    ];
    if (refundedTokens > 0) lines.push(`-# 🎟️ Refunded **${refundedTokens}** supporter tokens for old-class avatars`);
    if (remapped.length > 0) lines.push(`-# 🖼️ ${remapped.join('/')} avatar${remapped.length === 1 ? '' : 's'} remapped to ${className}`);
    lines.push(`-# Progression, Credux, items, chests, and equipment are unchanged.`);

    const done = new ContainerBuilder()
      .setAccentColor(0xFFD700)
      .addTextDisplayComponents((td) => td.setContent(`## ${cls.emoji} Character Changed — ${className}`))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent(lines.join('\n')))
      .addSeparatorComponents(sep)
      .addTextDisplayComponents((td) => td.setContent('-# Use `crd profile` to view your character.'));
    donePayload = { components: [done], flags: MessageFlags.IsComponentsV2, attachments: [] };
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[changeClass] transaction failed:', err.message);
    await interaction.editReply(errPayload('Something went wrong — your class and your item are unchanged. Try again.')).catch(() => {});
    return;
  } finally {
    if (client) client.release();
  }

  if (donePayload) {
    try {
      await interaction.editReply(donePayload);
    } catch (err) {
      console.error('[changeClass] completion refresh failed:', err.message);
      await interaction.followUp({
        content: 'Class was changed, but the confirmation view could not refresh. Run `crd profile` to verify it.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
}

module.exports = {
  start,
  handleClassSelect,
  handleBack,
  handleCancel,
  handleConfirm,
  // exported for the class-change selftest (config-independence checks)
  changeClassSelectPayload,
  changeClassSelectRow,
};

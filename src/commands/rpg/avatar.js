'use strict';

const pool = require('../../db/pool');
const { MessageFlags } = require('discord.js');
const avatar = require('../../engine/avatarSystem');
const { ownerGate } = require('../../engine/skinShopViews');

function reply(ctx, content) {
  return ctx.reply({ content, allowedMentions: { repliedUser: false } });
}

function usage(ctx) {
  return reply(ctx,
    'Usage: `crd avatars`, `crd avatar shop`, `crd avatar buy <id>` (or `at` for a Custom Avatar Token), `crd avatar equip <id>`, or `crd avatar default`.'
  );
}

function disableButtons(components) {
  return (components || []).map((component) => {
    const raw = typeof component?.toJSON === 'function' ? component.toJSON() : component;
    if (!raw) return raw;
    const disabled = { ...raw };
    if (Array.isArray(raw.components)) disabled.components = disableButtons(raw.components);
    if (raw.type === 2) disabled.disabled = true;
    return disabled;
  });
}

function attachAvatarCollector(message) {
  if (!message || typeof message.createMessageComponentCollector !== 'function') return;
  const collector = message.createMessageComponentCollector({ time: 150_000 });
  collector.once('end', () => {
    message.edit({ components: disableButtons(message.components) }).catch(() => {});
  });
}

async function collection(ctx) {
  const message = await ctx.reply({ ...(await avatar.buildAvatarPage(pool, ctx.userId, { page: 0, mode: 'collection' })), allowedMentions: { repliedUser: false } });
  attachAvatarCollector(message);
  return message;
}

async function shop(ctx) {
  const message = await ctx.reply({ ...(await avatar.buildAvatarPage(pool, ctx.userId, { page: 0, mode: 'shop' })), allowedMentions: { repliedUser: false } });
  attachAvatarCollector(message);
  return message;
}

async function buy(ctx, key) {
  const code = String(key || '').trim().toLowerCase();
  if (!code) return reply(ctx, 'Usage: `crd avatar buy <id>`.');
  if (code === 'default') return reply(ctx, 'The default class avatar is already yours.');

  let character;
  let row;
  try {
    character = await avatar.getCharacter(pool, ctx.userId);
    row = character ? await avatar.getAvatarByKey(pool, code, character.class) : null;
  } catch (err) {
    console.error('[avatar buy] lookup failed:', err.message);
    return reply(ctx, 'Avatar shop is not available yet.');
  }
  if (!character) return reply(ctx, 'Create a character first with `crd create character`.');
  if (['at', 'token', 'custom_avatar_token'].includes(code)) {
    try {
      const result = await avatar.purchaseCustomAvatarToken(ctx.userId);
      if (result.status === 'insufficient') return reply(ctx, `Not enough supporter tokens - the Custom Avatar Token costs ${avatar.CUSTOM_AVATAR_TOKEN_PRICE}, you have ${result.balance}.`);
      if (result.status === 'not_supporter') return reply(ctx, 'Custom Avatar Tokens require an active supporter token balance.');
      return reply(ctx, avatar.customAvatarTokenPurchaseMessage(result.balance));
    } catch (err) {
      console.error('[avatar token buy]', err.message);
      return reply(ctx, 'Custom Avatar Token purchase failed - nothing was spent.');
    }
  }
  if (!row) return reply(ctx, `No avatar with id \`${code}\`. See \`crd avatar shop\`.`);
  if (String(row.class_name).toLowerCase() !== String(character.class).toLowerCase()) {
    return reply(ctx, `That avatar is for **${row.class_name}**. Your current class is **${character.class}**.`);
  }
  if (avatar.isGrantOnlyAvatarRow(row)) {
    return reply(ctx, `**${avatar.displayName(row)}** isn't available in the shop.`);
  }
  try {
    const result = await avatar.purchaseAvatar(ctx.userId, row);
    if (result.status === 'owned') {
      return reply(ctx, `You already own **${avatar.displayName(row)}**. Equip it with \`crd avatar equip ${avatar.avatarShortId(row)}\`.`);
    }
    if (result.status !== 'bought') {
      return reply(ctx, result.status === 'insufficient'
        ? `Not enough supporter tokens - **${row.display_name}** costs ${row.token_cost}, you have ${result.balance}.`
        : 'Avatar purchases require an active supporter token balance.');
    }
    return reply(ctx,
      `Bought **${avatar.displayName(row)}** (\`${avatar.avatarShortId(row)}\`) for ${row.token_cost} supporter tokens. Balance: **${result.balance}**. Equip: \`crd avatar equip ${avatar.avatarShortId(row)}\`.`
    );
  } catch (err) {
    console.error('[avatar buy]', err.message);
    return reply(ctx, 'Avatar purchase failed - nothing was spent.');
  }
}

async function equip(ctx, key) {
  const code = String(key || '').trim().toLowerCase();
  if (!code) return reply(ctx, 'Usage: `crd avatar equip <id>` or `crd avatar default`.');
  if (code === 'default') {
    try {
      await avatar.clearEquippedAvatar(pool, ctx.userId);
      return reply(ctx, 'Equipped your default class avatar.');
    } catch (err) {
      console.error('[avatar default]', err.message);
      return reply(ctx, 'Avatar reset failed.');
    }
  }

  let character;
  let row;
  try {
    character = await avatar.getCharacter(pool, ctx.userId);
    row = character ? await avatar.getAvatarByKey(pool, code, character.class) : null;
  } catch (err) {
    console.error('[avatar equip] lookup failed:', err.message);
    return reply(ctx, 'Avatar system is not available yet.');
  }
  if (!character) return reply(ctx, 'Create a character first with `crd create character`.');
  if (!row) return reply(ctx, `No avatar with id \`${code}\`. See \`crd avatars\`.`);
  if (String(row.class_name).toLowerCase() !== String(character.class).toLowerCase()) {
    return reply(ctx, `That avatar is for **${row.class_name}**. Your current class is **${character.class}**.`);
  }
  if (!(await avatar.ownsAvatar(pool, ctx.userId, row.avatar_id, character.class))) {
    return reply(ctx, `You don't own \`${avatar.avatarShortId(row)}\` yet. Buy it with \`crd avatar buy ${avatar.avatarShortId(row)}\`.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await avatar.equipAvatarTx(client, ctx.userId, row.avatar_id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[avatar equip]', err.message);
    return reply(ctx, 'Avatar equip failed - nothing changed.');
  } finally {
    client.release();
  }
  return reply(ctx, `Equipped **${avatar.displayName(row)}** (\`${avatar.avatarShortId(row)}\`) as your stats avatar.`);
}

async function execute(ctx, { args } = {}) {
  const sub = String((args && args[0]) || '').toLowerCase();
  if (!sub || sub === 'collection' || sub === 'list') return collection(ctx);
  if (sub === 'shop') return shop(ctx);
  if (sub === 'buy') return buy(ctx, args[1]);
  if (sub === 'equip' || sub === 'use') return equip(ctx, args[1]);
  if (sub === 'default' || sub === 'reset') return equip(ctx, 'default');
  return usage(ctx);
}

async function handleAvatarButton(interaction) {
  const parts = interaction.customId.split(':');
  const mode = parts[1] === 'shop' ? 'shop' : 'collection';
  const ownerId = parts[2];
  const page = Number(parts[3] || 0);
  const action = parts[4] || 'next';
  if (!ownerGate(interaction, ownerId)) return;
  if (action === 'preview') {
    const payload = await avatar.buildAvatarPreview(pool, ownerId, { page });
    await interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
    attachAvatarCollector(await interaction.fetchReply());
    return;
  }
  await interaction.deferUpdate();
  let notice = null;
  if (action === 'buy' || action === 'buytoken') {
    if (action === 'buytoken') {
      const result = await avatar.purchaseCustomAvatarToken(ownerId);
      notice = result.status === 'bought'
        ? avatar.customAvatarTokenPurchaseMessage(result.balance)
        : result.status === 'insufficient'
          ? `Not enough supporter tokens - the Custom Avatar Token costs ${avatar.CUSTOM_AVATAR_TOKEN_PRICE}, you have ${result.balance}.`
          : 'Custom Avatar Tokens require an active supporter token balance.';
    } else {
      const row = await avatar.getShopAvatarAtPage(pool, ownerId, page);
      if (!row) {
        notice = 'That avatar is no longer available.';
      } else {
        const result = await avatar.purchaseAvatar(ownerId, row);
        notice = result.status === 'bought'
          ? `✅ Bought **${avatar.displayName(row)}**. Balance: **${result.balance}** supporter tokens.`
          : result.status === 'owned'
            ? `You already own **${avatar.displayName(row)}**.`
            : result.status === 'insufficient'
              ? `Not enough supporter tokens - **${avatar.displayName(row)}** costs ${row.token_cost}, you have ${result.balance}.`
              : 'Avatar purchases require an active supporter token balance.';
      }
    }
  }
  await interaction.editReply(await avatar.buildAvatarPage(pool, ownerId, { page, mode, notice }));
}

async function handleAvatarPreviewButton(interaction) {
  const [, action, ownerId, pageStr] = interaction.customId.split(':');
  const page = Number(pageStr || 0);
  if (!ownerGate(interaction, ownerId)) return;
  await interaction.deferUpdate();
  if (action === 'back') {
    await interaction.editReply(await avatar.buildAvatarPage(pool, ownerId, {
      page: Math.floor(page / 10),
      mode: 'shop',
    }));
    return;
  }
  let notice = null;
  if (action === 'buytoken') {
    const result = await avatar.purchaseCustomAvatarToken(ownerId);
    notice = result.status === 'bought'
      ? avatar.customAvatarTokenPurchaseMessage(result.balance)
      : result.status === 'insufficient'
        ? `Not enough supporter tokens - the Custom Avatar Token costs ${avatar.CUSTOM_AVATAR_TOKEN_PRICE}, you have ${result.balance}.`
        : 'Custom Avatar Tokens require an active supporter token balance.';
  } else if (action === 'buy') {
    const row = await avatar.getShopAvatarAtPage(pool, ownerId, page);
    if (!row) {
      notice = 'That avatar is no longer available.';
    } else {
      const result = await avatar.purchaseAvatar(ownerId, row);
      notice = result.status === 'bought'
        ? `✅ Bought **${avatar.displayName(row)}**. Balance: **${result.balance}** supporter tokens.`
        : result.status === 'owned'
          ? `You already own **${avatar.displayName(row)}**.`
          : result.status === 'insufficient'
            ? `Not enough supporter tokens - **${avatar.displayName(row)}** costs ${row.token_cost}, you have ${result.balance}.`
            : 'Avatar purchases require an active supporter token balance.';
    }
  }
  await interaction.editReply(await avatar.buildAvatarPreview(pool, ownerId, { page, notice }));
}

module.exports = { execute, collection, handleAvatarButton, handleAvatarPreviewButton };

'use strict';

const pool = require('../../db/pool');
const { MessageFlags } = require('discord.js');
const { spendTokensTx } = require('../../engine/supporterTokens');
const avatar = require('../../engine/avatarSystem');

function reply(ctx, content) {
  return ctx.reply({ content, allowedMentions: { repliedUser: false } });
}

function usage(ctx) {
  return reply(ctx,
    'Usage: `crd avatars`, `crd avatar shop`, `crd avatar buy <id>`, `crd avatar equip <id>`, or `crd avatar default`.'
  );
}

async function collection(ctx) {
  return ctx.reply({ ...(await avatar.buildAvatarPage(pool, ctx.userId, { page: 0, mode: 'collection' })), allowedMentions: { repliedUser: false } });
}

async function shop(ctx) {
  return ctx.reply({ ...(await avatar.buildAvatarPage(pool, ctx.userId, { page: 0, mode: 'shop' })), allowedMentions: { repliedUser: false } });
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
  if (!row) return reply(ctx, `No avatar with id \`${code}\`. See \`crd avatar shop\`.`);
  if (String(row.class_name).toLowerCase() !== String(character.class).toLowerCase()) {
    return reply(ctx, `That avatar is for **${row.class_name}**. Your current class is **${character.class}**.`);
  }
  if (await avatar.ownsAvatar(pool, ctx.userId, row.avatar_id, character.class)) {
    return reply(ctx, `You already own **${avatar.displayName(row)}**. Equip it with \`crd avatar equip ${avatar.avatarShortId(row)}\`.`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const spend = await spendTokensTx(client, ctx.userId, Number(row.token_cost), 'avatar_buy', row.avatar_key);
    if (!spend.ok) {
      await client.query('ROLLBACK');
      return reply(ctx, spend.reason === 'insufficient'
        ? `Not enough supporter tokens - **${row.display_name}** costs ${row.token_cost}, you have ${spend.balance}.`
        : 'Avatar purchases require an active supporter token balance.');
    }
    await client.query(
      `INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
       VALUES ($1, $2, 'shop', NOW())
       ON CONFLICT (discord_id, avatar_id) DO NOTHING`,
      [ctx.userId, row.avatar_id]
    );
    await client.query('COMMIT');
    return reply(ctx,
      `Bought **${avatar.displayName(row)}** (\`${avatar.avatarShortId(row)}\`) for ${row.token_cost} supporter tokens. Balance: **${spend.balance}**. Equip: \`crd avatar equip ${avatar.avatarShortId(row)}\`.`
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[avatar buy]', err.message);
    return reply(ctx, 'Avatar purchase failed - nothing was spent.');
  } finally {
    client.release();
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
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'These buttons are not for you.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await interaction.editReply(await avatar.buildAvatarPage(pool, ownerId, { page, mode }));
}

module.exports = { execute, collection, handleAvatarButton };

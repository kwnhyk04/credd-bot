'use strict';

/**
 * `crd admin <sub>` (and `/admin <sub>`) — server settings + stats (Phase 11, §2).
 *
 * Every sub-command requires Manage Server (PermissionFlagsBits.ManageGuild); a non-admin gets a
 * plain-text error (ephemeral on slash) and nothing happens. Settings UPSERT `server_config`
 * (never a plain INSERT — a guild may have no row) and then update guildConfigCache in the SAME
 * code path, so a write is never followed by a stale read. `stats` is read-only.
 *
 * Schema is frozen — `server_config` is used as-is (`prefix VARCHAR(5)`).
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const pool = require('../db/pool');
const guildConfig = require('../handlers/guildConfigCache');
const { bossOfficialOnlyMessage } = require('../config/officialSupport');

const ACCENT = 0xf0b232;
const PREFIX_RE = /^[a-zA-Z0-9]{1,5}$/;

function err(ctx, text) {
  return ctx.reply({ content: text, ephemeral: ctx.isSlash });
}

function okEmbed(title, desc) {
  return new EmbedBuilder().setColor(ACCENT).setTitle(title).setDescription(desc);
}

/** A guild's channel id from a `<#id>` mention or a raw id token; null if not a valid id. */
function parseChannelId(token) {
  if (!token) return null;
  const id = String(token).replace(/[<#>]/g, '').trim();
  return /^\d+$/.test(id) ? id : null;
}

/** Whitelisted-column UPSERT (column is never user-supplied). */
async function upsert(guildId, column, value) {
  await pool.query(
    `INSERT INTO server_config (guild_id, ${column}) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET ${column} = EXCLUDED.${column}`,
    [guildId, value]
  );
}

async function setPrefix(ctx, args) {
  const value = args[1];
  if (!value) return err(ctx, 'Usage: `crd admin setprefix [prefix]` (1–5 letters/numbers).');
  if (value.toLowerCase() === 'crd') {
    return err(ctx, '`crd` is the permanent fallback prefix and always works — no need to set it.');
  }
  if (!PREFIX_RE.test(value)) {
    return err(ctx, 'Prefix must be 1–5 characters, letters/numbers only (no spaces or `/`).');
  }
  await upsert(ctx.guildId, 'prefix', value);
  guildConfig.setField(ctx.guildId, 'prefix', value);
  await ctx.reply({ embeds: [okEmbed('✅ Prefix updated',
    `This server's prefix is now **\`${value}\`**.\n\`crd\` still works everywhere as the permanent fallback.`)] });
}

async function setChannel(ctx, args, column, label) {
  const id = parseChannelId(args[1]);
  const channel = id ? ctx.guild?.channels?.cache?.get(id) : null;
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    return err(ctx, `Couldn't find that text channel in this server. Mention it (e.g. #channel) or pass its ID.`);
  }
  await upsert(ctx.guildId, column, id);
  guildConfig.setField(ctx.guildId, column, id);
  await ctx.reply({ embeds: [okEmbed(`✅ ${label} set`, `${label} is now <#${id}>.`)] });
}

async function setBotChannel(ctx, args) {
  const value = String(args[1] || '').trim().toLowerCase();
  if (['off', 'none', 'clear', 'all'].includes(value)) {
    await upsert(ctx.guildId, 'bot_channel_id', null);
    guildConfig.setField(ctx.guildId, 'bot_channel_id', null);
    return ctx.reply({ embeds: [okEmbed('Bot channel cleared', 'Credd commands now work in every channel the bot can access.')] });
  }
  return setChannel(ctx, args, 'bot_channel_id', 'Bot channel');
}

async function bossLimitedSetting(ctx) {
  return err(ctx, bossOfficialOnlyMessage());
}

async function stats(ctx) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE uga.last_active > NOW() - INTERVAL '7 days')::int AS active7,
            COALESCE(ROUND(AVG(uc.combat_level)
              FILTER (WHERE uga.last_active > NOW() - INTERVAL '7 days'))::int, 0) AS avg_lvl
       FROM user_guild_activity uga
       INNER JOIN user_character uc ON uc.discord_id = uga.discord_id
      WHERE uga.guild_id = $1`,
    [ctx.guildId]
  );
  const r = rows[0] || { total: 0, active7: 0, avg_lvl: 0 };
  await ctx.reply({ embeds: [new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📊 Server Activity')
    .addFields(
      { name: 'Registered players', value: `${r.total}`, inline: true },
      { name: 'Active (7 days)', value: `${r.active7}`, inline: true },
      { name: 'Avg combat level (active)', value: `${r.avg_lvl}`, inline: true },
    )] });
}

async function execute(ctx, { args } = {}) {
  args = args || ctx.args || [];
  // Manage Server gate (no embed on the permission error — plain text, ephemeral on slash).
  const perms = ctx.member && ctx.member.permissions;
  if (!perms || typeof perms.has !== 'function' || !perms.has(PermissionFlagsBits.ManageGuild)) {
    return err(ctx, 'You need the **Manage Server** permission to use `crd admin`.');
  }

  const sub = (args[0] || '').toLowerCase();
  switch (sub) {
    case 'setprefix':                return setPrefix(ctx, args);
    case 'setbotchannel':            return setBotChannel(ctx, args);
    case 'setannouncementchannel':   return bossLimitedSetting(ctx);
    case 'setbosschannel':           return bossLimitedSetting(ctx);
    case 'stats':                    return stats(ctx);
    default:
      return err(ctx, 'Admin commands: `setprefix`, `setbotchannel [#channel|off]`, `setannouncementchannel`, `setbosschannel`, `stats`.');
  }
}

module.exports = { execute };

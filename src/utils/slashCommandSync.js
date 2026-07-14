'use strict';

const { REST, RESTEvents, Routes } = require('discord.js');
const { definitions } = require('../commands/slashDefinitions');
const { recordDiscordRestResponse } = require('./networkTelemetry');

function commandBody() {
  return definitions.map((d) => d.builder.toJSON());
}

function parseGuildIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slashCommandSyncEnabled() {
  return process.env.SYNC_SLASH_COMMANDS_ON_START !== 'false';
}

async function putGuildCommands(rest, clientId, guildId, body) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
}

async function putGlobalCommands(rest, clientId, body) {
  await rest.put(Routes.applicationCommands(clientId), { body });
}

async function syncSlashCommandsOnStart(client, { token, clientId, logger = console } = {}) {
  if (!slashCommandSyncEnabled()) {
    logger.log('[commands] Slash-command startup sync disabled.');
    return { skipped: true, scope: 'disabled', count: 0 };
  }
  if (!token || !clientId) {
    throw new Error('Missing BOT_TOKEN or CLIENT_ID for slash-command sync.');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  rest.on(RESTEvents.Response, recordDiscordRestResponse);
  const body = commandBody();
  const configuredGuildIds = parseGuildIds(process.env.GUILD_IDS);
  const guildIds = configuredGuildIds.length
    ? configuredGuildIds
    : Array.from(client.guilds.cache.keys());

  if (guildIds.length > 0) {
    for (const guildId of guildIds) {
      await putGuildCommands(rest, clientId, guildId, body);
    }
    logger.log(`[commands] Registered ${body.length} slash command(s) to ${guildIds.length} guild(s).`);
    return { skipped: false, scope: 'guild', count: body.length, guildIds };
  }

  await putGlobalCommands(rest, clientId, body);
  logger.log(`[commands] Registered ${body.length} global slash command(s).`);
  return { skipped: false, scope: 'global', count: body.length, guildIds: [] };
}

module.exports = {
  commandBody,
  parseGuildIds,
  putGlobalCommands,
  putGuildCommands,
  slashCommandSyncEnabled,
  syncSlashCommandsOnStart,
};

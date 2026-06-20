'use strict';

/**
 * deploy-commands.js — register slash commands with Discord (Phase 11, §3.3).
 *
 * Add to your .env (the .env file itself is NOT modified by this phase):
 *   CLIENT_ID=<bot application ID from the Discord Developer Portal>   (already present)
 *   BOT_TOKEN=<bot token>                                             (already present)
 *   GUILD_IDS=<comma-separated server IDs>   (OPTIONAL — guild-scoped = instant registration;
 *                                             if omitted, registers GLOBALLY, ~1h to propagate)
 *
 * Run:  node scripts/deploy-commands.js
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { definitions } = require('../src/commands/slashDefinitions');

const CLIENT_ID = process.env.CLIENT_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_IDS = (process.env.GUILD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  if (!CLIENT_ID || !BOT_TOKEN) {
    console.error('Missing CLIENT_ID or BOT_TOKEN in .env — cannot deploy.');
    process.exit(1);
  }
  const body = definitions.map((d) => d.builder.toJSON());
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

  if (GUILD_IDS.length) {
    for (const gid of GUILD_IDS) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body });
      console.log(`Registered ${body.length} commands to guild ${gid} (instant).`);
    }
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
    console.log(`Registered ${body.length} GLOBAL commands (propagation can take up to ~1 hour).`);
  }
}

main().catch((err) => { console.error('[deploy-commands] failed:', err); process.exit(1); });

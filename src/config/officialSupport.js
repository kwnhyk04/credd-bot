'use strict';

const DEFAULT_OFFICIAL_GUILD_ID = '1522127011768832141';
const DEFAULT_SUPPORT_INVITE_URL = 'https://discord.gg/H4bSMHYsSk';
const SUPPORT_LINK_TEXT = 'Credd Official Support Server';

function officialGuildId() {
  return String(process.env.BOSS_OFFICIAL_GUILD_ID || DEFAULT_OFFICIAL_GUILD_ID).trim();
}

function supportInviteUrl() {
  return String(process.env.OFFICIAL_SUPPORT_INVITE_URL || DEFAULT_SUPPORT_INVITE_URL).trim();
}

function supportMarkdownLink() {
  return `[${SUPPORT_LINK_TEXT}](${supportInviteUrl()})`;
}

function isOfficialGuild(guildId) {
  return String(guildId || '') === officialGuildId();
}

function bossOfficialOnlyMessage() {
  return `Credd monster bosses are currently limited to the ${supportMarkdownLink()}. Please join the official server to participate.`;
}

function bossRedirectMessage() {
  return `A monster boss has spawned in the ${supportMarkdownLink()}. Join the official server to participate.`;
}

module.exports = {
  DEFAULT_OFFICIAL_GUILD_ID,
  DEFAULT_SUPPORT_INVITE_URL,
  SUPPORT_LINK_TEXT,
  bossOfficialOnlyMessage,
  bossRedirectMessage,
  isOfficialGuild,
  officialGuildId,
  supportInviteUrl,
  supportMarkdownLink,
};

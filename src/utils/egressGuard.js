'use strict';

const r2 = require('./r2Client');
const { isRemoteAssetsEnabled } = require('./assets');

function envTrue(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isManagedRuntime() {
  return process.env.NODE_ENV === 'production'
    || Boolean(
      process.env.RAILWAY_PROJECT_ID
      || process.env.RAILWAY_SERVICE_ID
      || process.env.RAILWAY_DEPLOYMENT_ID
      || process.env.RAILWAY_ENVIRONMENT
      || process.env.RAILWAY_ENVIRONMENT_NAME
    );
}

function discordImageAttachmentsAllowed() {
  return !isManagedRuntime() || envTrue('ALLOW_DISCORD_IMAGE_ATTACHMENTS');
}

function productionEgressIssues() {
  if (discordImageAttachmentsAllowed()) return [];
  const issues = [];
  if (!isRemoteAssetsEnabled()) {
    issues.push('ASSET_BASE_URL is missing, so static media would be uploaded from the bot');
  }
  if (!r2.isConfigured()) {
    issues.push('R2 write credentials are missing, so rendered canvases cannot be cached by URL');
  }
  return issues;
}

function assertDiscordImageAttachmentsAllowed(context = 'image attachment fallback') {
  if (discordImageAttachmentsAllowed()) return;
  throw new Error(
    `${context} blocked: Discord image attachments are disabled in production. `
    + 'Fix ASSET_BASE_URL/R2/canvas_cache or set ALLOW_DISCORD_IMAGE_ATTACHMENTS=true intentionally.'
  );
}

module.exports = {
  isManagedRuntime,
  discordImageAttachmentsAllowed,
  productionEgressIssues,
  assertDiscordImageAttachmentsAllowed,
};

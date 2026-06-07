'use strict';

/**
 * Reply to a message with a plain-text error (§27 — no embeds on errors).
 */
async function replyError(message, text) {
  try {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
  } catch {
    // channel may be gone; nothing to do
  }
}

/**
 * Wire process-level uncaught error handlers.
 * Call once at startup.
 */
function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
}

module.exports = { replyError, setupGlobalErrorHandlers };

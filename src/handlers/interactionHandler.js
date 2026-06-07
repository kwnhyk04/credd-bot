'use strict';

const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');

/**
 * Routes button interactions by customId.
 * customId schemes (last segment is always the initiating user id):
 *   register:confirm:<uid>
 *   create:class:<Class>:<uid>
 *   create:confirm:<Class>:<uid>
 *   create:back:<uid>
 */
async function handleInteraction(interaction) {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split(':');
  const [namespace, action] = parts;

  try {
    if (namespace === 'register' && action === 'confirm') {
      const ownerId = parts[2];
      await registerCmd.handleConfirm(interaction, ownerId);
      return;
    }

    if (namespace === 'create') {
      if (action === 'class') {
        const className = parts[2];
        const ownerId = parts[3];
        await createCmd.handleClassSelect(interaction, className, ownerId);
        return;
      }
      if (action === 'confirm') {
        const className = parts[2];
        const ownerId = parts[3];
        await createCmd.handleConfirm(interaction, className, ownerId);
        return;
      }
      if (action === 'back') {
        const ownerId = parts[2];
        await createCmd.handleBack(interaction, ownerId);
        return;
      }
    }
    // Unknown customId: ignore silently.
  } catch (err) {
    console.error('[interactionHandler] error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true }).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };

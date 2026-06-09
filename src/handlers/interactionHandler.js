'use strict';

const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const bagCmd = require('../commands/rpg/bag');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const sellCmd = require('../commands/rpg/sell');

/**
 * Routes button interactions by customId.
 * customId schemes (last segment is always the initiating user id):
 *   register:confirm:<uid>
 *   create:class:<Class>:<uid>
 *   create:confirm:<Class>:<uid>
 *   create:back:<uid>
 *   weapons:<prev|next>:<uid>:<page>
 *   deityc:<page>:<uid>
 *   enhance:attempt:<weaponId>:<uid>
 *   enhance:cancel:<weaponId>:<uid>
 *   sell:confirm:<mode>:<arg>:<uid>
 *   sell:cancel:<uid>
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

    if (namespace === 'weapons') {
      await bagCmd.handleWeaponsButton(interaction);
      return;
    }

    if (namespace === 'deityc') {
      const page = parseInt(parts[1], 10);
      const ownerId = parts[2];
      await deityCmd.handlePage(interaction, Number.isNaN(page) ? 1 : page, ownerId);
      return;
    }

    if (namespace === 'enhance') {
      if (action === 'attempt') {
        const weaponId = parts[2];
        const ownerId = parts[3];
        await enhanceCmd.handleAttempt(interaction, weaponId, ownerId);
        return;
      }
      if (action === 'cancel') {
        const ownerId = parts[3];
        await enhanceCmd.handleCancel(interaction, ownerId);
        return;
      }
    }

    if (namespace === 'sell') {
      if (action === 'confirm') {
        const mode = parts[2];
        const arg = parts[3];
        const ownerId = parts[4];
        await sellCmd.handleConfirm(interaction, mode, arg, ownerId);
        return;
      }
      if (action === 'cancel') {
        const ownerId = parts[2];
        await sellCmd.handleCancel(interaction, ownerId);
        return;
      }
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

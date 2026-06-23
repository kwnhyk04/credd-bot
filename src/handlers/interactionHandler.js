'use strict';

const { MessageFlags } = require('discord.js');
const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const bagCmd = require('../commands/rpg/bag');
const bagViews = require('../engine/bagViews');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const sellCmd = require('../commands/rpg/sell');
const bossSystem = require('../engine/bossSystem');
const blackjackCmd = require('../commands/casino/blackjack');
const crashCmd = require('../commands/casino/crash');
const skinShop = require('../engine/skinShopViews');

/**
 * Routes button interactions by customId.
 * customId schemes (last segment is always the initiating user id):
 *   register:confirm:<uid>
 *   create:class:<Class>:<uid>
 *   create:confirm:<Class>:<uid>
 *   create:back:<uid>
 *   weapons:<prev|next>:<uid>:<page>
 *   deities:<prev|next>:<uid>:<page>
 *   denhance:<attempt|cancel>:<userDeityId>:<uid>
 *   enhance:attempt:<weaponId>:<uid>
 *   enhance:cancel:<weaponId>:<uid>
 *   sell:confirm:<mode>:<arg>:<uid>
 *   sell:cancel:<uid>
 *   boss:<attack|log>:<guildId>   (no owner segment — any player may press;
 *                                  bossSystem gates per-presser internally)
 *   bj:<hit|stand>:<uid>          (casino blackjack — bettor-gated, session-locked)
 *   crash:<push|cashout>:<uid>    (casino crash — bettor-gated, session-locked)
 */
async function handleInteraction(interaction) {
  const isButton = interaction.isButton();
  const isSelect = interaction.isStringSelectMenu && interaction.isStringSelectMenu();
  if (!isButton && !isSelect) return;

  const parts = interaction.customId.split(':');
  const [namespace, action] = parts;

  try {
    // Supporter shop / collection — paginated pages + Preview button (owner-gated).
    if (namespace === 'sshop') { await skinShop.handleShopButton(interaction); return; }
    if (namespace === 'sprev') { await skinShop.handlePreviewButton(interaction); return; }
    if (!isButton) return; // everything below this point is button-only
    if (namespace === 'register' && action === 'confirm') {
      const ownerId = parts[2];
      await registerCmd.handleConfirm(interaction, ownerId);
      return;
    }

    if (namespace === 'boss') {
      if (action === 'attack') {
        await bossSystem.handleAttack(interaction);
        return;
      }
      if (action === 'log') {
        await bossSystem.handleLog(interaction);
        return;
      }
    }

    if (namespace === 'bj') {
      await blackjackCmd.handleButton(interaction, action, parts[2]);
      return;
    }

    if (namespace === 'crash') {
      await crashCmd.handleButton(interaction, action, parts[2]);
      return;
    }

    if (namespace === 'weapons') {
      await bagCmd.handleWeaponsButton(interaction);
      return;
    }

    if (namespace === 'armors') {
      await bagCmd.handleArmorsButton(interaction);
      return;
    }

    if (namespace === 'chests' && action === 'rates') {
      await bagViews.handleChestRatesButton(interaction);
      return;
    }

    if (namespace === 'deities') {
      await deityCmd.handleListButton(interaction);
      return;
    }

    if (namespace === 'denhance') {
      const userDeityId = parts[2];
      const ownerId = parts[3];
      if (action === 'attempt') {
        await deityCmd.handleEnhanceAttempt(interaction, userDeityId, ownerId);
        return;
      }
      if (action === 'cancel') {
        await deityCmd.handleEnhanceCancel(interaction, userDeityId, ownerId);
        return;
      }
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
      await interaction.reply({ content: 'An unexpected error occurred.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };

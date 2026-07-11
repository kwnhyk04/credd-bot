'use strict';

const { MessageFlags } = require('discord.js');
const registerCmd = require('../commands/rpg/register');
const createCmd = require('../commands/rpg/create');
const bagCmd = require('../commands/rpg/bag');
const bagViews = require('../engine/bagViews');
const runeCmd = require('../commands/rpg/rune');
const deityCmd = require('../commands/rpg/deity');
const enhanceCmd = require('../commands/rpg/enhance');
const sellCmd = require('../commands/rpg/sell');
const bossSystem = require('../engine/bossSystem');
const skinShop = require('../engine/skinShopViews');
const avatarCmd = require('../commands/rpg/avatar');
const leaderboardCmd = require('../commands/rpg/leaderboard');
const titleCmd = require('../commands/rpg/title');
const exchangeEssenceCmd = require('../commands/rpg/exchangeEssence');
const questsCmd = require('../commands/economy/quests');
const autoRaidCmd = require('../commands/rpg/autoRaid');
const glossaryCmd = require('../commands/rpg/glossary');
const { envBool } = require('../utils/runtimeLogs');

const casinoEnabled = envBool('CASINO_ENABLED', false);
const casinoButtons = casinoEnabled ? {
  blackjack: require('../commands/casino/blackjack'),
  crash: require('../commands/casino/crash'),
} : null;

const COLLECTOR_OWNED_BUTTONS = new Set([
  'battle_log',
  'duel_accept',
  'duel_decline',
]);

/**
 * Routes button interactions by customId.
 * customId schemes (last segment is always the initiating user id):
 *   register:confirm:<uid>
 *   create:class:<Class>:<uid>
 *   create:confirm:<Class>:<uid>
 *   create:back:<uid>
 *   weapons:<prev|next>:<uid>:<page>
 *   runes:<filter|prev|next>:<uid>:<page>:<lane>
 *   deities:<prev|next>:<uid>:<page>
 *   dsigil:act:<userDeityId>:<uid>
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

  if (isButton && COLLECTOR_OWNED_BUTTONS.has(interaction.customId)) return;

  const parts = interaction.customId.split(':');
  const [namespace, action] = parts;

  try {
    // Supporter shop / collection — paginated pages + Preview button (owner-gated).
    if (namespace === 'sshop') { await skinShop.handleShopButton(interaction); return; }
    if (namespace === 'sprev') { await skinShop.handlePreviewButton(interaction); return; }
    if (namespace === 'avat') { await avatarCmd.handleAvatarButton(interaction); return; }
    if (namespace === 'runes') { await runeCmd.handleRunesInteraction(interaction); return; }
    if (namespace === 'lb') { await leaderboardCmd.handleSelect(interaction); return; }
    if (namespace === 'title' && action === 'cat') { await titleCmd.handleSelect(interaction); return; }
    if (namespace === 'essx' && action === 'tier') { await exchangeEssenceCmd.handleSelect(interaction); return; }
    if (namespace === 'quest' && action === 'scope') { await questsCmd.handleScopeSelect(interaction); return; }
    // Glossary (§4): category select AND prev/next buttons share the namespace.
    if (namespace === 'gloss') { await glossaryCmd.handleInteraction(interaction); return; }
    if (!isButton) return; // everything below this point is button-only
    if (namespace === 'araid') {
      if (action === 'start') { await autoRaidCmd.handleStart(interaction, parts[2]); return; }
      if (action === 'claim') { await autoRaidCmd.handleClaim(interaction, parts[2]); return; }
    }
    if (namespace === 'essx' && action === 'convert') {
      await exchangeEssenceCmd.handleConvert(interaction, parts[2], parts[3]);
      return;
    }
    if (namespace === 'quest' && action === 'claim') {
      await questsCmd.handleClaimButton(interaction);
      return;
    }
    if (namespace === 'title') { await titleCmd.handleButton(interaction); return; }
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
      if (casinoButtons) {
        await casinoButtons.blackjack.handleButton(interaction, action, parts[2]);
        return;
      }
      await interaction.reply({ content: 'Casino commands are currently disabled.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (namespace === 'crash') {
      if (casinoButtons) {
        await casinoButtons.crash.handleButton(interaction, action, parts[2]);
        return;
      }
      await interaction.reply({ content: 'Casino commands are currently disabled.', flags: MessageFlags.Ephemeral }).catch(() => {});
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

    if (namespace === 'dsigil' && action === 'act') {
      // [Ascension §3.7] Unlock Sigil / Ascend button on the deity info embed.
      const userDeityId = parts[2];
      const ownerId = parts[3];
      await deityCmd.handleSigilButton(interaction, userDeityId, ownerId);
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
        await deityCmd.handleEnhanceCancel(interaction, ownerId);
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
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'This control is no longer active. Please run the command again.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[interactionHandler] error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An unexpected error occurred.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

module.exports = { handleInteraction };

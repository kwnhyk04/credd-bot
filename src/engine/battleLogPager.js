'use strict';

/**
 * battleLogPager.js — the ephemeral battle-log viewer: page building, the
 * bounded navigation row, and the component collector that drives it
 * (Phase 3.1 split of battleRender.js; all bodies moved VERBATIM).
 *
 * The 'battle_log_page:*' custom ids live here and are byte-identical to the
 * ones battleRender used to own; interactionHandler still treats them as
 * collector-owned and must not route them.
 *
 * Depends on nothing in battleRender — the arrow is battleRender -> pager, so
 * no cycle can form. isDiscordErrorCode and BATTLE_LOG_COLLECTOR_MS moved down
 * here for that reason and are imported back by battleRender.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

let activeBattleLogPageCollectors = 0;

const BATTLE_LOG_TURNS_PER_PAGE = 8;
const BATTLE_LOG_DESCRIPTION_LIMIT = 3800;
const BATTLE_LOG_COLLECTOR_MS = 300_000;
const BATTLE_LOG_MODE_LABELS = { raid: 'Raid Battle', duel: 'PvP Battle', boss: 'Boss Battle' };

function causeOfDeathText(sim) {
  const cause = sim.causeOfDeath;
  if (!cause?.source) return null;
  const loser = sim.winner === 'a' ? sim.b?.name : sim.a?.name;
  if (cause.type === 'reflect') {
    return `${loser} was defeated by ${cause.source}'s reflected damage`;
  }
  if (cause.type === 'execute') {
    return cause.source === 'Death Charm'
      ? `${loser} was slain by Death Charm`
      : `${loser} was executed by ${cause.source}`;
  }
  if (cause.type === 'dot') {
    return `${loser} was defeated by ${cause.source}`;
  }
  return null;
}

function logEmbeds(sim) {
  // Keep every turn in chronological order. Eight complete turns is the normal
  // page size; the character guard can create a shorter page when event text is
  // unusually verbose so no Discord embed limit is exceeded.
  const pageData = [];
  let current = { texts: [], turns: [] };

  const flush = () => {
    if (!current.texts.length) return;
    pageData.push(current);
    current = { texts: [], turns: [] };
  };

  for (const round of sim.rounds || []) {
    const chunks = battleLogTurnChunks(round);

    // A single exceptional turn can exceed the safe description size. Keep it
    // intact at event-line boundaries and label its continuation pages.
    if (chunks.length > 1) {
      flush();
      for (const text of chunks) pageData.push({ texts: [text], turns: [round.round] });
      continue;
    }

    const text = chunks[0];
    const separatorLength = current.texts.length ? 2 : 0;
    const currentLength = current.texts.reduce((sum, entry) => sum + entry.length, 0)
      + Math.max(0, current.texts.length - 1) * 2;
    if (current.turns.length >= BATTLE_LOG_TURNS_PER_PAGE
      || currentLength + separatorLength + text.length > BATTLE_LOG_DESCRIPTION_LIMIT) {
      flush();
    }
    current.texts.push(text);
    current.turns.push(round.round);
  }
  flush();

  if (!pageData.length) pageData.push({ texts: ['No turn events were recorded.'], turns: [] });

  const aName = sim.a?.name || 'Player';
  const bName = sim.b?.name || 'Enemy';
  const winnerName = sim.winner === 'a' ? aName : bName;
  const modeLabel = BATTLE_LOG_MODE_LABELS[sim.mode] || 'Battle';
  const resultLine = sim.outcome === 'boss_timeout'
    ? `${bName} survived`
    : (causeOfDeathText(sim) || `${winnerName} won`);
  // Mode · participants · result go in the embed AUTHOR (its own 256-char field)
  // rather than the description, so the per-page turn text keeps the full safe
  // character budget and a maxed page can never spill past the limit.
  const authorLine = `${modeLabel} · ${aName} vs ${bName} · ${resultLine}`.slice(0, 256);
  const totalTurns = Array.isArray(sim.rounds) ? sim.rounds.length : pageData.length;

  return pageData.map((page, index) => {
    const firstTurn = page.turns[0];
    const lastTurn = page.turns[page.turns.length - 1];
    const rangeLabel = firstTurn == null
      ? ''
      : (firstTurn === lastTurn ? `Turn ${firstTurn}` : `Turns ${firstTurn}–${lastTurn}`);
    const title = rangeLabel ? `📋 Battle Log • ${rangeLabel}` : '📋 Battle Log';
    const footer = firstTurn == null
      ? `Page ${index + 1} of ${pageData.length}`
      : `Page ${index + 1} of ${pageData.length} • ${rangeLabel} of ${totalTurns}`;
    return new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: authorLine })
      .setTitle(title)
      .setDescription(page.texts.join('\n\n'))
      .setFooter({ text: footer.slice(0, 2048) });
  });
}

function battleLogTurnChunks(round) {
  const heading = `**— TURN ${round.round} —**`;
  const continuationHeading = `**— TURN ${round.round} (cont.) —**`;
  const events = Array.isArray(round.events) && round.events.length
    ? round.events.map((event) => String(event))
    : ['No events recorded.'];
  const chunks = [];
  let buf = heading;
  let hasBody = false;

  for (const event of events) {
    if (buf.length + 1 + event.length <= BATTLE_LOG_DESCRIPTION_LIMIT) {
      buf += `\n${event}`;
      hasBody = true;
      continue;
    }

    let chunkHeading;
    if (hasBody) {
      chunks.push(buf);
      chunkHeading = continuationHeading;
    } else {
      chunkHeading = chunks.length ? continuationHeading : heading;
    }
    buf = chunkHeading;
    hasBody = false;

    let remaining = event;
    let available = BATTLE_LOG_DESCRIPTION_LIMIT - chunkHeading.length - 1;
    while (remaining.length > available) {
      chunks.push(`${chunkHeading}\n${remaining.slice(0, available)}`);
      remaining = remaining.slice(available);
      chunkHeading = continuationHeading;
      available = BATTLE_LOG_DESCRIPTION_LIMIT - chunkHeading.length - 1;
    }
    if (remaining.length) {
      buf = `${chunkHeading}\n${remaining}`;
      hasBody = true;
    }
  }

  if (hasBody || !chunks.length) chunks.push(buf);
  return chunks;
}

// Action-suffixed custom ids (not page-number ids) so every button in the row
// is unique. Page-number ids collided on the first page (Previous == counter ==
// `battle_log_page:0`) and last page (Next == counter), which made Discord reject
// the whole message (50035) and the nav row silently failed to appear. The target
// page is resolved from the collector's closure pageIndex, not the custom id.
// Bounded pagination — First/Previous disabled on page 0, Next/Last on the last
// page; never wraps (that is reserved for the deity/glossary carousels).
function battleLogNavigationRow(pageIndex, pageCount) {
  const lastPage = Math.max(0, pageCount - 1);
  const atFirst = pageIndex <= 0;
  const atLast = pageIndex >= lastPage;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('battle_log_page:first')
      .setLabel('First')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atFirst),
    new ButtonBuilder()
      .setCustomId('battle_log_page:prev')
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atFirst),
    new ButtonBuilder()
      .setCustomId('battle_log_page:count')
      .setLabel(`${pageIndex + 1} / ${pageCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('battle_log_page:next')
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atLast),
    new ButtonBuilder()
      .setCustomId('battle_log_page:last')
      .setLabel('Last')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atLast),
  );
}

async function showPaginatedBattleLog(interaction, pages) {
  const safePages = Array.isArray(pages) && pages.length
    ? pages
    : [new EmbedBuilder().setColor(0x2b2d31).setTitle('📋 Full Battle Log')
      .setDescription('No turn events were recorded.')];
  let pageIndex = 0;
  const components = safePages.length > 1
    ? [battleLogNavigationRow(pageIndex, safePages.length)]
    : [];
  const reply = await interaction.editReply({ embeds: [safePages[pageIndex]], components });

  if (safePages.length <= 1 || typeof reply?.createMessageComponentCollector !== 'function') return reply;

  const lastPage = safePages.length - 1;
  const collector = reply.createMessageComponentCollector({
    time: BATTLE_LOG_COLLECTOR_MS,
    // Only the user who opened this ephemeral viewer controls it. Each duel/ranked
    // participant opens their own separate viewer, so this scopes to that opener.
    filter: (button) => button.user?.id === interaction.user?.id
      && /^battle_log_page:(first|prev|next|last|count)$/.test(button.customId),
  });
  activeBattleLogPageCollectors += 1;
  collector.on('collect', async (button) => {
    try {
      // Resolve the target from the closure pageIndex (not the custom id) so
      // rapid clicks always step relative to the page actually shown.
      const action = button.customId.split(':')[1];
      let target = pageIndex;
      if (action === 'first') target = 0;
      else if (action === 'prev') target = Math.max(0, pageIndex - 1);
      else if (action === 'next') target = Math.min(lastPage, pageIndex + 1);
      else if (action === 'last') target = lastPage;
      if (target === pageIndex) {
        // Counter press or a no-op boundary click — acknowledge without a rerender
        // so the page indicator can never drift out of sync.
        await button.deferUpdate().catch(() => {});
        return;
      }
      pageIndex = target;
      await button.update({
        embeds: [safePages[pageIndex]],
        components: [battleLogNavigationRow(pageIndex, safePages.length)],
      });
    } catch (err) {
      if (!isDiscordErrorCode(err, 10062)) console.error('[battleRender] log page error:', err.message);
    }
  });
  collector.once('end', () => {
    activeBattleLogPageCollectors = Math.max(0, activeBattleLogPageCollectors - 1);
    interaction.editReply({ components: [] }).catch(() => {});
  });
  return reply;
}

function isDiscordErrorCode(err, code) {
  return err?.code === code || err?.rawError?.code === code;
}

// activeBattleLogPageCollectors is reassigned, so battleRender reads it through
// this accessor instead of destructuring a require-time snapshot.
function pagerMemoryStats() {
  return { activeLogPageCollectors: activeBattleLogPageCollectors };
}

module.exports = {
  logEmbeds,
  battleLogNavigationRow,
  showPaginatedBattleLog,
  causeOfDeathText,
  isDiscordErrorCode,
  pagerMemoryStats,
  BATTLE_LOG_COLLECTOR_MS,
};

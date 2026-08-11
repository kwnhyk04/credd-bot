'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Boss implementation source, layout-agnostic: bossSystem.js plus any modules
 * split out of it under src/engine/boss/. The source-text checks below assert
 * WHAT the boss code says, not WHICH file holds it, so extracting a module
 * must not fail them (Phase 2 refactor).
 */
function readBossSource() {
  const parts = [fs.readFileSync(path.join(ROOT, 'src', 'engine', 'bossSystem.js'), 'utf8')];
  const dir = path.join(ROOT, 'src', 'engine', 'boss');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js')).sort()) {
      parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return parts.join('\n');
}

const {
  formatGearDrops,
  tierSummary,
} = require(path.join(ROOT, 'src', 'engine', 'chestOpen'));
const {
  buildResultMessage,
  formatSummonResultLine,
  formatSummonResults,
  splitSummonResultLines,
  summonOutcomeSummary,
} = require(path.join(ROOT, 'src', 'engine', 'renderSummon'));
const {
  runSummon,
  claimSummonReward,
} = require(path.join(ROOT, 'src', 'engine', 'summonEngine'));
const { CHEST_ALIASES } = require(path.join(ROOT, 'src', 'config', 'dropRates'));
const { emoji } = require(path.join(ROOT, 'src', 'utils', 'emojis'));
const {
  calamityBonusRewardBlock,
} = require(path.join(ROOT, 'src', 'engine', 'boss', 'bossMessages'));

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

const gearLine = formatGearDrops([{
  id: 'w123',
  name: 'Salakot Ward',
  gearClass: 'armor',
  tier: 'Mythic',
  sockets: 2,
}]);
check('gear result keeps the item id', gearLine.includes('`w123`'));
check('gear result keeps the item name', gearLine.includes('Salakot Ward'));
check('gear result keeps the rune-slot count', /- .* 2$/.test(gearLine));
check('gear result removes the written tier suffix', !gearLine.includes(' - Mythic - '));
const tierWordName = formatGearDrops([{
  id: 'a456',
  name: 'Rare Supreme Aegis',
  gearClass: 'armor',
  tier: 'Rare',
  sockets: null,
}]);
check('gear names containing tier words are preserved', tierWordName.includes('Rare Supreme Aegis'));
check('missing socket counts render intentionally as zero', / 0$/.test(tierWordName));
check('tier summary uses equipment-tier icons', tierSummary([
  { tier: 'Mythic' }, { tier: 'Rare' }, { tier: 'Rare' },
]).includes('<:eqmythic_icon:') && tierSummary([
  { tier: 'Mythic' }, { tier: 'Rare' }, { tier: 'Rare' },
]).includes('<:eqrare_icon:'));

const pulls = [
  { name: 'Njord', rarity: 'Awakened', isNew: true, essence: 0 },
  { name: 'Njord', rarity: 'Awakened', isNew: false, essence: 2 },
  { name: 'Freyr', rarity: 'Remnant', isNew: true, essence: 0 },
  { name: 'Njord', rarity: 'Awakened', isNew: false, essence: 2 },
];
const lines = formatSummonResults(pulls).split('\n');
check('identical deity pulls are grouped', lines.length === 2 && lines.filter((line) => line.includes('Njord')).length === 1);
check('grouped duplicate uses tier, deity, total essence, and count order',
  lines[0].startsWith('<:mythical_icon:')
    && lines[0].includes(`${emoji('njord')} **Njord** ${emoji('mythic_essence')} **4** ×**3**`)
    && !lines[0].includes('Awakened')
    && !lines[0].includes('Essence'));
check('grouped result keeps the total pull count', lines[0].includes('×**3**'));
check('new-only deity has no tier wording, essence icon, or zero reward',
  !lines[1].includes('Remnant') && !lines[1].includes('Essence') && !lines[1].includes('+0'));
check('grouped summon result order is unchanged', lines[0].includes('Njord') && lines[1].includes('Freyr'));

const singleNewLine = formatSummonResultLine({
  name: 'Artemis', rarity: 'Awakened', isNew: true, essence: 0,
});
check('single new row starts with tier and deity icons', singleNewLine.startsWith('<:mythical_icon:')
  && singleNewLine.includes(`${emoji('artemis')} **Artemis**`));
check('single new row omits the rarity wording and x1', !singleNewLine.includes('Awakened') && !singleNewLine.includes('×**1**'));
const singleDuplicateLine = formatSummonResultLine({
  name: 'Artemis', rarity: 'Awakened', isNew: false, essence: 2,
});
check('single duplicate row places essence after the deity', singleDuplicateLine.includes(
  `${emoji('artemis')} **Artemis** ${emoji('mythic_essence')} **2**`
) && !singleDuplicateLine.includes('Awakened'));

const summary = summonOutcomeSummary(pulls);
check('summary counts actual Awakened pulls by rarity', summary.includes('Awakened ×**3**'));
check('summary counts actual Remnant pulls by rarity', summary.includes('Remnant ×**1**'));

const summaryCounts = (summaryText) => [...summaryText.matchAll(/×\*\*(\d+)\*\*/g)]
  .map((match) => Number(match[1]));
const remnantOnly = Array.from({ length: 30 }, (_, index) => ({
  name: `Remnant Deity ${index}`,
  rarity: 'Remnant',
  isNew: index === 0,
  essence: index === 0 ? 0 : 1,
}));
const awakenedOnly = Array.from({ length: 30 }, (_, index) => ({
  name: `Awakened Deity ${index}`,
  rarity: 'Awakened',
  isNew: index === 0,
  essence: index === 0 ? 0 : 2,
}));
const mixedPulls = [
  ...remnantOnly.slice(0, 23),
  ...awakenedOnly.slice(0, 7),
];
check('30 Remnant pulls summarize as Remnant ×30', (() => {
  const text = summonOutcomeSummary(remnantOnly);
  return text.includes('Remnant ×**30**') && summaryCounts(text).reduce((a, b) => a + b, 0) === 30;
})());
check('30 Awakened pulls summarize as Awakened ×30', (() => {
  const text = summonOutcomeSummary(awakenedOnly);
  return text.includes('Awakened ×**30**') && summaryCounts(text).reduce((a, b) => a + b, 0) === 30;
})());
check('mixed 23/7 pulls summarize each rarity correctly', (() => {
  const text = summonOutcomeSummary(mixedPulls);
  return text.includes('Remnant ×**23**')
    && text.includes('Awakened ×**7**')
    && summaryCounts(text).reduce((a, b) => a + b, 0) === mixedPulls.length;
})());
check('duplicate-compressed body rows still contribute their raw pull quantity', (() => {
  const duplicateGroup = Array.from({ length: 5 }, () => ({
    name: 'Nike', rarity: 'Remnant', isNew: false, essence: 1,
  }));
  const body = formatSummonResults(duplicateGroup);
  const text = summonOutcomeSummary(duplicateGroup);
  return body.includes('×**5**')
    && text.includes('Remnant ×**5**')
    && summaryCounts(text).reduce((a, b) => a + b, 0) === duplicateGroup.length;
})());
check('multiple duplicate groups across result types preserve the batch total', (() => {
  const duplicateGroups = [
    ...Array.from({ length: 5 }, () => ({ name: 'Nike', rarity: 'Remnant', isNew: false, essence: 1 })),
    ...Array.from({ length: 2 }, () => ({ name: 'Njord', rarity: 'Awakened', isNew: false, essence: 2 })),
  ];
  const text = summonOutcomeSummary(duplicateGroups);
  return text.includes('Remnant ×**5**')
    && text.includes('Awakened ×**2**')
    && summaryCounts(text).reduce((a, b) => a + b, 0) === duplicateGroups.length;
})());
check('future result categories aggregate generically', (() => {
  const text = summonOutcomeSummary([
    { name: 'A', rarity: 'Event', isNew: true, essence: 0 },
    { name: 'B', rarity: 'Event', isNew: false, essence: 1 },
  ]);
  return text.includes('◆ Event ×**2**') && summaryCounts(text).reduce((a, b) => a + b, 0) === 2;
})());

const chunks = splitSummonResultLines(pulls, 100);
check('large summon result lists split only between grouped lines', chunks.length > 1 && chunks.join('\n').split('\n').join('|') === lines.join('|'));
const thirtyPulls = Array.from({ length: 30 }, (_, index) => ({
  name: `Long Deity Name ${index}`,
  rarity: 'Remnant',
  isNew: false,
  essence: 2,
}));
check('30-pull summon result components stay below Discord text limits', splitSummonResultLines(thirtyPulls).every((chunk) => chunk.length <= 2800));
check('malformed duplicate rewards never render zero or the Essence literal', (() => {
  const line = formatSummonResultLine({
    name: 'Njord', rarity: 'Awakened', isNew: false, essence: 0,
  });
  return !line.includes('+0') && !line.includes('Essence');
})());
check('Markdown in deity names is escaped', formatSummonResultLine({
  name: 'Njord_*', rarity: 'Awakened', isNew: true, essence: 0,
}).includes('Njord\\_\\*'));

const summonEngineSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'summonEngine.js'), 'utf8');
const summonRendererSource = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'renderSummon.js'), 'utf8');
const summonCommandSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'summon.js'), 'utf8');
const questSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'economy', 'quests.js'), 'utf8');
check('summon engine checks ownership for every sequential roll', /const isDupe = ownedSet\.has\(d\.deity_id\)/.test(summonEngineSource));
check('summon engine marks a rolled deity owned before the next roll', /ownedSet\.add\(d\.deity_id\)/.test(summonEngineSource));
check('summon result keeps the remaining balance footer', summonRendererSource.includes("emoji('belief_shards')") && summonRendererSource.includes("emoji('sacred_relic')"));
check('normal summon edits strip immutable Components V2 flags', summonCommandSource.includes('delete resultPayload.flags'));
check('daily quest completion line includes the sacred relic icon', questSource.includes("emoji('sacred_relic')} Sacred Relic"));
check('daily quest quote footer remains intact', questSource.includes('The gods reward those who prove their worth'));
check('weekly quest full-completion footer is removed', !questSource.includes('Weekly full-completion bonus: no additional Sacred Relic'));

const bossSource = readBossSource();
const calamityPreview = calamityBonusRewardBlock('active');
check('Calamity preview uses a Bonus Rewards heading', bossSource.includes('**Bonus Rewards**'));
check('Calamity preview explains two independent damage-weighted chances',
  bossSource.includes('Two independent chances per eligible participant, each weighted by the same damage contribution.'));
check('Calamity preview displays both one-item bonus rolls',
  calamityPreview.includes('Supreme Chest ×1') && calamityPreview.includes('Divine Bag ×1'));

const openCommandSource = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'rpg', 'open.js'), 'utf8');
check('normal summons use the shared summon formatter for fallback output', summonCommandSource.includes('splitSummonResultLines(results, 1450)'));
check('Sacred and Supreme Relics share the summon result builder', openCommandSource.includes('buildResultMessage(results, balances'));
check('all configured equipment chests use the shared result builder', CHEST_ALIASES.length === 7
  && openCommandSource.includes('buildWeaponResultPayload({'));

function makeSummonClient({ alreadyOwned = false } = {}) {
  const today = new Date('2026-08-07T00:00:00.000Z');
  const state = {
    bag: {
      epic_essence: 0,
      mythic_essence: 0,
      legendary_essence: 0,
      supreme_essence: 0,
    },
    owned: new Set(alreadyOwned ? [7] : []),
    inserted: [],
    essenceLogs: [],
    activeDeityId: null,
  };
  const deity = {
    deity_id: 7,
    name: 'Njord',
    mythology: 'Norse',
    tier: 'Epic',
    base_hp: 100,
    base_atk: 50,
    base_def: 25,
    blessing_name: 'Tidecaller',
  };
  const client = {
    async query(raw, params = []) {
      const sql = String(raw).replace(/\s+/g, ' ').trim();
      if (sql.includes('FROM users_bag WHERE discord_id = $1 FOR UPDATE')) {
        return { rows: [{ ...state.bag }] };
      }
      if (sql.startsWith('SELECT pity_count FROM pity_counters')) return { rows: [{ pity_count: 0 }] };
      if (sql.includes('FROM user_character WHERE discord_id = $1 FOR UPDATE')) {
        return { rows: [{
          believer_level: 1,
          believer_exp: 0,
          reputation_exp_today: 0,
          reputation_exp_reset_date: today,
          pht_today: today,
        }] };
      }
      if (sql.includes('FROM user_character uc') && sql.includes('JOIN user_presets p')) {
        return { rows: [{ equipped_deity_1_id: state.activeDeityId }] };
      }
      if (sql === 'SELECT deity_id FROM user_deities WHERE discord_id = $1') {
        return { rows: [...state.owned].map((deityId) => ({ deity_id: deityId })) };
      }
      if (sql.includes('FROM deity_roster') && sql.includes('WHERE tier = $1')) {
        return { rows: [{ ...deity }] };
      }
      if (sql.startsWith('INSERT INTO user_deities')) {
        assert.equal(state.owned.has(params[1]), false, 'new deity inserted only once');
        state.owned.add(params[1]);
        const userDeityId = 100 + state.inserted.length;
        state.inserted.push(params[1]);
        return { rows: [{ user_deity_id: userDeityId }] };
      }
      if (sql.startsWith('INSERT INTO game_logs') && sql.includes('previous_essence_count')) {
        state.essenceLogs.push({ itemType: params[1], before: params[2], after: params[3] });
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO game_logs')) return { rows: [] };
      if (sql.startsWith('UPDATE users_bag SET')) {
        state.bag.epic_essence = params[1];
        return { rows: [] };
      }
      if (sql.startsWith('WITH updated AS')) {
        state.activeDeityId = params[1];
        return { rows: [{ equipped_deity_1_id: state.activeDeityId }] };
      }
      if (sql.startsWith('UPDATE user_character SET believer_level')) return { rows: [] };
      if (sql.startsWith('INSERT INTO user_titles')) return { rows: [] };
      if (sql.startsWith('SELECT dr.mythology')) {
        return { rows: [{ mythology: 'Norse', avail: 2, owned: 1 }] };
      }
      throw new Error(`unexpected summon test query: ${sql}`);
    },
  };
  return { client, state };
}

async function integrationChecks() {
  const previousTtl = process.env.SELECTION_POOL_CACHE_TTL_MS;
  process.env.SELECTION_POOL_CACHE_TTL_MS = '0';
  try {
    const fresh = makeSummonClient();
    const result = await runSummon(fresh.client, 'u1', { count: 3, forceTier: 'Epic' });
    check('sequential repeated pulls classify one new then two duplicates',
      result.pulls.map((pull) => pull.isDupe).join(',') === 'false,true,true');
    check('a repeated new deity is inserted exactly once', fresh.state.inserted.join(',') === '7');
    check('later duplicates credit the configured total Essence', fresh.state.bag.epic_essence === 2);
    check('committed pull Essence matches the credited total',
      result.pulls.reduce((total, pull) => total + pull.essence, 0) === fresh.state.bag.epic_essence);
    check('the consolidated Essence audit log matches the credited total',
      fresh.state.essenceLogs.length === 1 && fresh.state.essenceLogs[0].after === 2);

    const existing = makeSummonClient({ alreadyOwned: true });
    const existingResult = await runSummon(existing.client, 'u2', { count: 2, forceTier: 'Epic' });
    check('previously owned deities remain duplicates for every roll',
      existingResult.pulls.every((pull) => pull.isDupe) && existing.state.inserted.length === 0);
    check('existing-deity duplicate Essence is credited exactly', existing.state.bag.epic_essence === 2);

    const claimedKeys = new Set();
    const guardClient = {
      async query(_sql, params) {
        if (claimedKeys.has(params[0])) return { rows: [] };
        claimedKeys.add(params[0]);
        return { rows: [{ reward_key: params[0] }] };
      },
    };
    check('summon delivery guard accepts the first processing',
      await claimSummonReward(guardClient, 'u', 'interaction-1', 'belief_shards'));
    check('summon delivery guard rejects a replay',
      !(await claimSummonReward(guardClient, 'u', 'interaction-1', 'belief_shards')));

    const maxBatch = Array.from({ length: 30 }, (_, index) => ({
      name: `Long Deity ${String(index).padStart(2, '0')} ${'X'.repeat(70)}`,
      rarity: index % 2 ? 'Remnant' : 'Awakened',
      isNew: index % 3 === 0,
      essence: index % 3 === 0 ? 0 : 2,
    }));
    const payload = await buildResultMessage(maxBatch, { beliefShards: 1234, sacredRelics: 2 });
    const json = payload.components.map((component) => component.toJSON());
    const children = json[0].components;
    const textComponents = children.filter((component) => component.type === 10);
    const actualLines = textComponents.flatMap((component) => component.content.split('\n'));
    const expectedLines = maxBatch.map(formatSummonResultLine);
    check('max summon payload keeps every result exactly once and in order',
      actualLines.filter((line) => expectedLines.includes(line)).join('\n') === expectedLines.join('\n'));
    check('max summon payload keeps every text component below the safety limit',
      textComponents.every((component) => component.content.length <= 2800));
    check('max summon payload stays within the container child limit', children.length <= 10);
    const joinedPayload = textComponents.map((component) => component.content).join('\n');
    check('max summon payload emits the global summary once',
      joinedPayload.split(summonOutcomeSummary(maxBatch)).length - 1 === 1);
    check('max summon payload emits the resource footer once',
      joinedPayload.split('Belief Shards:').length - 1 === 1);
  } finally {
    if (previousTtl === undefined) delete process.env.SELECTION_POOL_CACHE_TTL_MS;
    else process.env.SELECTION_POOL_CACHE_TTL_MS = previousTtl;
  }

  console.log(`REWARD_SUMMON_QOL ${passed} passed`);
}

integrationChecks().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

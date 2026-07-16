'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { resolveBattle } = require('../src/engine/battleEngine');
const PASSIVES = require('../src/engine/passiveRegistry');
const { RAID_LOOT, rollRaidChest } = require('../src/config/raidLoot');
const { containRect, badgeRect } = require('../src/engine/identityLayout');
const { displayEnhancement, formatEnhancedName } = require('../src/utils/enhancementFormat');
const { computeDeityProgressionStats } = require('../src/engine/deityEnhancement');
const { DEITY_ESSENCE_COST, nextDeityAttempt } = require('../src/engine/deityEnhancement');
const { nextSigilCost } = require('../src/config/ascension');
const { syncSubscriptionEntitlementsTx } = require('../src/engine/supporterEntitlements');
const { buildDeityInfoPayload, attemptDeityEnhance } = require('../src/commands/rpg/deity');
const { buildInfoPayload } = require('../src/commands/rpg/equipment');
const { detectImageFormat, validateGeneratedImageBuffer } = require('../src/utils/imageOutput');
const { battleFrameCacheParts, battleResultCacheParts } = require('../src/engine/battleRender');
const { handleButtonInteraction, parseDuelButtonId } = require('../src/commands/rpg/duel');
const { cancelPendingDuel, findDuelByMessage } = require('../src/engine/duelLocks');
const {
  execute: executeCompare, splitDeityNames, weaponEntry, deityEntry,
} = require('../src/commands/rpg/compare');
const { groupSummonResults } = require('../src/engine/renderSummon');
const { emoji } = require('../src/utils/emojis');
const {
  DEITY_UPDATES, WEAPON_UPDATES, validateDefinitions,
} = require('./update-final-passive-descriptions');

const player = (over = {}) => ({
  name: 'Hero', kind: 'player', class: 'Test', classPassive: null,
  atk: 100, hp: 100000, def: 0, crit: 0, bonusDmgPct: 0,
  weaponPassiveKey: 'none', armorPassiveKey: 'none', deityBlessingKey: 'none',
  ...over,
});
const mob = (over = {}) => ({
  name: 'Dummy', kind: 'mob', mobType: 'regular', atk: 0, hp: 100000, def: 0, crit: 0,
  skillKey: 'none', immunityTags: [], specialFlags: {},
  ...over,
});
const events = (sim) => sim.rounds.flatMap((round) => round.events);
const firstDamage = (sim, token = 'attacks') => {
  const line = events(sim).find((event) => event.includes(token));
  return Number(/\*\*(\d+) DMG\*\*/.exec(line)?.[1]);
};

async function main() {
  const imageCanvas = createCanvas(2, 2);
  const pngBuffer = imageCanvas.toBuffer('image/png');
  assert.equal(detectImageFormat(pngBuffer), 'png');
  assert.equal(validateGeneratedImageBuffer(pngBuffer, {}, 'png'), 'png');
  assert.throws(() => validateGeneratedImageBuffer(undefined), /must be a Buffer/);
  assert.throws(() => validateGeneratedImageBuffer(Buffer.alloc(0)), /empty or already disposed/);
  assert.throws(() => validateGeneratedImageBuffer({ pipe() {} }), /must be a Buffer/);
  assert.throws(() => validateGeneratedImageBuffer(pngBuffer, {}, 'webp'), /format mismatch/);

  const startSnapshot = {
    round: 0,
    a: { hp: 100, maxHp: 100, debuffs: [] },
    b: { hp: 100, maxHp: 100, debuffs: [] },
    actions: {
      a: { title: 'Ready', detail: 'Awaiting first action' },
      b: { title: 'Ready', detail: 'Awaiting first action' },
    },
    tag: 'start',
  };
  const visualFighter = {
    name: 'Hero', kind: 'player', cls: 'Knight', level: 10,
    weapon: 'Sword', armor: 'Mail', deity: 'Odin',
    skill: null, skillDesc: null, atk: 100, def: 80, crit: 5, maxHp: 100,
  };
  const frameOptions = { mode: 'raid', mirror: false, battleSkinPath: 'battle.png' };
  const firstStartKey = battleFrameCacheParts({
    a: { ...visualFighter, hp: 17 },
    b: { ...visualFighter, name: 'Mob', kind: 'mob', hp: 0 },
    snapshots: [startSnapshot],
    seed: 1,
  }, 0, frameOptions);
  const secondStartKey = battleFrameCacheParts({
    a: { ...visualFighter, hp: 91 },
    b: { ...visualFighter, name: 'Mob', kind: 'mob', hp: 44 },
    snapshots: [startSnapshot],
    seed: 2,
  }, 0, frameOptions);
  assert.deepEqual(firstStartKey, secondStartKey);
  assert.notDeepEqual(
    firstStartKey,
    battleFrameCacheParts({
      a: { ...visualFighter, hp: 17 },
      b: { ...visualFighter, name: 'Mob', kind: 'mob', hp: 0 },
      snapshots: [{
        ...startSnapshot,
        a: { ...startSnapshot.a, hp: 99 },
      }],
    }, 0, frameOptions)
  );
  assert.notDeepEqual(
    firstStartKey,
    battleFrameCacheParts({
      a: { ...visualFighter, name: 'Changed Hero', hp: 17 },
      b: { ...visualFighter, name: 'Mob', kind: 'mob', hp: 0 },
      snapshots: [startSnapshot],
    }, 0, frameOptions)
  );
  assert.notDeepEqual(
    firstStartKey,
    battleFrameCacheParts({
      a: { ...visualFighter, hp: 17 },
      b: { ...visualFighter, name: 'Mob', kind: 'mob', hp: 0 },
      snapshots: [startSnapshot],
    }, 0, { ...frameOptions, battleSkinLoaded: true }),
    'a generic fallback must not poison the cache key for a later loaded skin'
  );

  const resultRewards = {
    won: true,
    credux: 500,
    exp: 1200,
    shards: 25,
    chestLabel: 'Gold Chest',
    leveledUp: false,
    levelFrom: 10,
    levelTo: 10,
  };
  const firstResultKey = battleResultCacheParts({
    winner: 'a', outcome: 'victory', seed: 1,
    a: { name: 'Hero', hp: 17 },
    b: { name: 'Mob', hp: 0 },
  }, resultRewards, 'victory.png');
  const secondResultKey = battleResultCacheParts({
    winner: 'a', outcome: 'different-outcome', seed: 2,
    a: { name: 'Changed Hero', hp: 91 },
    b: { name: 'Changed Mob', hp: 44 },
  }, {
    ...resultRewards,
    won: false,
    levelFrom: 999,
    levelTo: 1000,
    unusedMetadata: 'ignored',
  }, 'victory.png');
  assert.deepEqual(firstResultKey, secondResultKey);
  assert.notDeepEqual(
    firstResultKey,
    battleResultCacheParts({ winner: 'b' }, resultRewards, 'victory.png')
  );
  assert.notDeepEqual(
    firstResultKey,
    battleResultCacheParts({ winner: 'a' }, { ...resultRewards, credux: 501 }, 'victory.png')
  );
  assert.notDeepEqual(
    firstResultKey,
    battleResultCacheParts({ winner: 'a' }, resultRewards, 'other-victory.png')
  );

  assert.equal(displayEnhancement(undefined), 0);
  assert.equal(formatEnhancedName('Odin', 1), 'Odin +0');
  assert.equal(formatEnhancedName('Odin', 11), 'Odin +10');

  const unascendedDeity = computeDeityProgressionStats(
    { base_atk: 100, base_hp: 200, base_def: 50 },
    { sigils: 5, ascended: false, enhancement: 11 }
  );
  assert.deepEqual(unascendedDeity, { curr_atk: 75, curr_hp: 150, curr_def: 37 });
  const enhancedDeity = computeDeityProgressionStats(
    { base_atk: 100, base_hp: 200, base_def: 50 },
    { sigils: 10, ascended: true, enhancement: 3 }
  );
  assert.deepEqual(enhancedDeity, { curr_atk: 120, curr_hp: 240, curr_def: 60 });

  assert.deepEqual(DEITY_ESSENCE_COST.Epic, { 1: 15, 2: 19, 3: 23, 4: 27, 5: 31, 6: 35, 7: 39, 8: 43, 9: 47, 10: 51 });
  assert.deepEqual(DEITY_ESSENCE_COST.Mythic, { 1: 15, 2: 18, 3: 21, 4: 24, 5: 27, 6: 30, 7: 33, 8: 36, 9: 39, 10: 42 });
  assert.deepEqual(DEITY_ESSENCE_COST.Legendary, { 1: 10, 2: 12, 3: 14, 4: 16, 5: 18, 6: 20, 7: 22, 8: 24, 9: 26, 10: 28 });
  assert.deepEqual(DEITY_ESSENCE_COST.Supreme, { 1: 4, 2: 5, 3: 6, 4: 7, 5: 8, 6: 10, 7: 12, 8: 14, 9: 16, 10: 18 });
  assert.deepEqual(nextDeityAttempt('Supreme', 10), { targetLevel: 10, cost: 18 });
  assert.deepEqual(nextSigilCost('Epic', 0), { sigil: 1, essence: 5 });

  for (const [w, h] of [[100, 100], [100, 150], [140, 100]]) {
    const rect = containRect({ width: w, height: h }, { x: 20, y: 30, w: 200, h: 240 });
    assert.equal(rect.x + rect.w / 2, 120);
    assert.equal(rect.y + rect.h / 2, 150);
    assert(Math.abs(rect.w / rect.h - w / h) < 1e-9);
  }

  const noTitleBadge = badgeRect(
    { width: 200, height: 100 },
    { x: 365, titleY: 0, hasTitle: false, fallbackY: 710, height: 96 }
  );
  assert.deepEqual(noTitleBadge, { x: 269, y: 710, w: 192, h: 96 });
  const titleBadge = badgeRect(
    { width: 200, height: 100 },
    { x: 680, titleY: 450, hasTitle: true, fallbackY: 710, height: 96 }
  );
  assert.deepEqual(titleBadge, { x: 584, y: 486, w: 192, h: 96 });

  assert.equal(RAID_LOOT.regular.win.chestChance, 0.10);
  assert.equal(RAID_LOOT.elite.win.chestChance, 0.20);
  assert.equal(rollRaidChest(RAID_LOOT.regular.win, () => 0.099), 'silver_chest');
  assert.equal(rollRaidChest(RAID_LOOT.regular.win, () => 0.10), null);
  assert.equal(rollRaidChest(RAID_LOOT.elite.win, () => 0.199), 'gold_chest');
  assert.equal(rollRaidChest(RAID_LOOT.elite.win, () => 0.20), null);

  const neutral = resolveBattle(player(), mob(), { rng: () => 0.5 });
  const knight = resolveBattle(player({ class: 'Knight', classPassive: 'damage_reduction' }), mob(), { rng: () => 0.5 });
  assert.equal(firstDamage(knight), Math.floor(firstDamage(neutral) * 1.30));

  const swordsman = resolveBattle(player({ class: 'Swordsman', classPassive: 'bleed' }), mob(), { rng: () => 0.5 });
  const bleedTicks = events(swordsman)
    .filter((event) => event.includes('Bleed damage'))
    .map((event) => Number(/suffers (\d+)/.exec(event)?.[1]));
  assert(bleedTicks.includes(30));
  assert(Math.max(...bleedTicks) <= 30);

  const fighterRolls = [0, 0.99, 0.05, 0.5, 0];
  const fighter = resolveBattle(
    player({ class: 'Fighter', classPassive: 'stun' }),
    mob(),
    { rng: () => fighterRolls.length ? fighterRolls.shift() : 0.5 }
  );
  assert(events(fighter).some((event) => event.includes('follows with Bash')));
  assert(events(fighter).some((event) => event.includes('misses its attack due to Dizzy')));

  const odin = resolveBattle(
    player({ atk: 0, deityBlessingKey: 'odin_all_fathers_wisdom' }),
    mob({ atk: 100 }),
    { rng: () => 0.5 }
  );
  assert(events(odin).some((event) => event.includes('released 25 stored damage')));

  const bathalaFlags = {};
  const bathala = {
    currentTurn: 0, flags: bathalaFlags, playerAtkMult: 0, playerDefMult: 0, log: [],
  };
  for (let turn = 1; turn <= 12; turn++) {
    bathala.currentTurn = turn;
    bathala.playerAtkMult = 0;
    bathala.playerDefMult = 0;
    PASSIVES.bathala_divine_vessel(bathala);
  }
  assert.equal(bathalaFlags.bathala_stacks, 10);
  assert.equal(bathala.playerAtkMult, 1);
  assert.equal(bathala.playerDefMult, 1);

  const zeusFlags = {};
  const zeus = {
    flags: zeusFlags, playerAtkMult: 0, rng: () => 0, enemyImmune: () => false, log: [],
  };
  for (let i = 0; i < 8; i++) {
    zeus.playerAtkMult = 0;
    PASSIVES.zeus_thunder_sovereign(zeus);
    assert.equal(zeus.playerAtkMult, 0.5);
  }
  assert.equal(zeusFlags.zeus_def_shred_stacks, 6);

  const queries = [];
  const fakeClient = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('WHERE is_base = true')) return { rows: [] };
      if (sql.includes('SELECT category FROM equipped_skins')) return { rows: [] };
      if (sql.includes('INSERT INTO user_cosmetics')) return { rows: [], rowCount: 4 };
      if (sql.includes('INSERT INTO user_avatars')) return { rows: [], rowCount: 5 };
      throw new Error(`Unexpected entitlement query: ${sql}`);
    },
  };
  const grants = await syncSubscriptionEntitlementsTx(fakeClient, '123', 'eternal');
  assert.deepEqual(grants, { founderCosmetics: 4, founderAvatars: 5 });
  assert(!queries.some((sql) => sql.includes('equipped_avatars')));
  assert(!queries.some((sql) => sql.includes("LIKE 'founder") && sql.includes('equipped_skins')));

  let enhanceQuery = 0;
  const enhanceClient = {
    async query(sql) {
      enhanceQuery += 1;
      if (enhanceQuery === 2) return { rows: [{ supreme_essence: 10 }] };
      if (enhanceQuery === 3) {
        return {
          rows: [{
            enhancement: 1, ascended: true, tier: 'Supreme', name: 'Odin',
            base_atk: 100, base_hp: 200, base_def: 50,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const enhanced = await attemptDeityEnhance(enhanceClient, '123', 1);
  assert.deepEqual(enhanced, { status: 'done', name: 'Odin', previousLevel: 0, level: 1, cost: 4 });

  const deitySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'rpg', 'deity.js'), 'utf8');
  assert(/dr\.name, dr\.mythology, dr\.tier, dr\.base_atk/.test(deitySource));
  assert(deitySource.includes('const essenceEmoji = emoji(`${String(deity.tier).toLowerCase()}_essence`);'));

  const avatarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'avatarSystem.js'), 'utf8');
  assert(/purchasableOnly \? 'AND token_cost > 0' : ''/.test(avatarSource));

  const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'rpg', 'stats.js'), 'utf8');
  assert(statsSource.includes('const filename = `stats-${discordId}.webp`;'));
  assert(statsSource.includes('setImage(`attachment://${filename}`)'));
  assert(statsSource.includes('files: [{ attachment: image.buffer, name: filename }]'));

  const deityPayload = await buildDeityInfoPayload({
    name: 'Odin', enhancement: 1, tier: 'Supreme', mythology: 'Norse', sigils: 0,
    ascended: false, base_atk: 100, base_hp: 100, base_def: 100,
    blessing_name: 'Foresight', blessing_description: 'Test', lore: 'Test', user_deity_id: 1,
  }, { ownerId: '123', ownerDisplayName: 'Ignored' });
  const deityJson = JSON.stringify(deityPayload.components.map((component) => component.toJSON()));
  assert(deityJson.includes('Odin +0'));
  assert(deityJson.includes('Owner: <@123>'));
  assert(deityJson.includes('Supreme Essence'));
  assert(!deityJson.includes("Ignored's"));

  const gearPayload = await buildInfoPayload({
    kind: 'armor', discord_id: '123', name: 'Mail of Brokkr', tier: 'Supreme', enhancement: 11,
    curr_hp: 20000, curr_def: 1200, passive_name: 'Dwarven Forge', passive_description: 'Test',
    native_sockets: [], opposite_sockets: [], lore: 'Test',
  }, 'gear1', '123', 'Ignored');
  const gearJson = JSON.stringify(gearPayload.components.map((component) => component.toJSON()));
  assert(gearJson.includes('Mail of Brokkr +10'));
  assert(gearJson.includes('Owner: <@123>'));
  assert(!gearJson.includes('**Enhancement**'));
  assert(!gearJson.includes("Ignored's"));

  const rosterNames = ['Apolaki', 'Dian Masalanta', 'Mayari', 'Thor'];
  assert.deepEqual(
    splitDeityNames(['Dian', 'Masalanta', 'Mayari', 'Apolaki'], rosterNames),
    { ok: true, names: ['Dian Masalanta', 'Mayari', 'Apolaki'] },
  );
  assert.deepEqual(
    splitDeityNames(['Dian', 'Masalanta,', 'Mayari'], rosterNames),
    { ok: true, names: ['Dian Masalanta', 'Mayari'] },
  );
  assert.equal(splitDeityNames(['Unknown', 'Mayari'], rosterNames).ok, false);
  assert.equal(splitDeityNames(['Mayari'], rosterNames).ok, false);

  const compareWeapon = weaponEntry({
    name: 'Tyrfing', enhancement: 8, tier: 'Mythic', curr_atk: 1234, crit: 12.5,
    bonus_dmg_pct: 0, passive_name: 'Cursed Edge', passive_description: 'DB weapon description',
  });
  assert(compareWeapon.includes('Tyrfing'));
  assert(compareWeapon.includes('+7'));
  assert(compareWeapon.includes('DB weapon description'));
  const compareDeity = deityEntry({
    name: 'Dian Masalanta', mythology: 'Philippine', tier: 'Mythic', base_hp: 100,
    base_atk: 50, base_def: 25, blessing_name: 'Devotion',
    blessing_description: 'DB deity description', sigils: 3, ascended: false, enhancement: 0,
  });
  assert(compareDeity.includes('Dian Masalanta'));
  assert(compareDeity.includes('3/10'));
  assert(compareDeity.includes('DB deity description'));

  const comparePool = require('../src/db/pool');
  const originalCompareQuery = comparePool.query;
  const compareRows = [
    {
      deity_id: 1, name: 'Dian Masalanta', mythology: 'Philippine', tier: 'Mythic',
      base_hp: 100, base_atk: 50, base_def: 25, blessing_name: 'Devotion',
      blessing_description: 'DB Dian description', user_deity_id: 11, sigils: 3,
      ascended: false, enhancement: 1,
    },
    {
      deity_id: 2, name: 'Mayari', mythology: 'Philippine', tier: 'Legendary',
      base_hp: 110, base_atk: 45, base_def: 30, blessing_name: 'Lunar Veil',
      blessing_description: 'DB Mayari description', user_deity_id: 12, sigils: 10,
      ascended: true, enhancement: 1,
    },
    {
      deity_id: 3, name: 'Apolaki', mythology: 'Philippine', tier: 'Epic',
      base_hp: 90, base_atk: 55, base_def: 20, blessing_name: 'Solar Burn',
      blessing_description: 'DB Apolaki description', user_deity_id: null, sigils: null,
      ascended: null, enhancement: null,
    },
  ];
  const compareReplies = [];
  const compareMessage = {
    author: { id: '123' },
    async reply(payload) { compareReplies.push(payload); return payload; },
  };
  try {
    comparePool.query = async (sql, params) => {
      assert(sql.includes('FROM deity_roster'));
      assert.deepEqual(params, ['123']);
      return { rows: compareRows };
    };
    await executeCompare(compareMessage, {
      args: ['deity', 'Dian', 'Masalanta', 'Dian', 'Masalanta'],
    });
    assert(compareReplies.pop().content.includes('Duplicate deity'));

    await executeCompare(compareMessage, {
      args: ['deity', 'Dian', 'Masalanta', 'Apolaki'],
    });
    const ownershipRejected = compareReplies.pop();
    assert(ownershipRejected.content.includes("don't have `Apolaki`"));
    assert(!ownershipRejected.components);

    await executeCompare(compareMessage, {
      args: ['deity', 'Dian', 'Masalanta', 'Mayari'],
    });
    const comparison = compareReplies.pop();
    assert.equal(comparison.flags, 32768);
    assert.equal(comparison.components.length, 1);
    const comparisonJson = JSON.stringify(comparison.components[0].toJSON());
    assert(comparisonJson.includes('Dian Masalanta'));
    assert(comparisonJson.includes('Mayari'));
    assert(comparisonJson.includes('DB Dian description'));
    assert(comparisonJson.includes('DB Mayari description'));

    await executeCompare(compareMessage, {
      args: ['weapon', 'same-id', 'same-id'],
    });
    assert(compareReplies.pop().content.includes('Duplicate weapon'));
  } finally {
    comparePool.query = originalCompareQuery;
  }

  const duplicateSummonLine = groupSummonResults([
    { name: 'Mayari', rarity: 'Awakened', isNew: false, essence: 6 },
    { name: 'Mayari', rarity: 'Awakened', isNew: false, essence: 6 },
  ]);
  assert(duplicateSummonLine.includes('**Mayari** x2'));
  assert(duplicateSummonLine.includes(`${emoji('mythic_essence')} essence +12`));
  const newSummonLine = groupSummonResults([
    { name: 'Apolaki', rarity: 'Undying', isNew: true, essence: 0 },
  ]);
  assert(newSummonLine.includes('New'));
  assert(newSummonLine.includes(`${emoji('legendary_essence')} essence +0`));

  validateDefinitions();
  assert.equal(DEITY_UPDATES.length, 38);
  assert.equal(WEAPON_UPDATES.length, 5);
  assert.equal(WEAPON_UPDATES.find((entry) => entry.requestedName === 'Laevateinn').name, 'Laevateinn Staff');
  const passiveData = fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'passive_registry_keys.md'), 'utf8');
  const passiveSql = fs.readFileSync(path.join(__dirname, 'final-passive-description-updates.sql'), 'utf8');
  const userWordingSql = fs.readFileSync(path.join(__dirname, 'update-user-passive-descriptions.sql'), 'utf8');
  const passiveLineByKey = new Map(
    [...passiveData.matchAll(/^- `([^`]+)` — ([^\r\n]+)$/gm)].map((match) => [match[1], match[2]]),
  );
  assert.equal((passiveSql.match(/^\s+\('deity',/gm) || []).length, 38);
  assert.equal((passiveSql.match(/^\s+\('weapon',/gm) || []).length, 5);
  const sqlLiteral = (value) => String(value).replace(/'/g, "''");
  for (const [rosterType, updates] of [['deity', DEITY_UPDATES], ['weapon', WEAPON_UPDATES]]) {
    for (const entry of updates) {
      assert.equal(typeof PASSIVES[entry.key], 'function', `passiveRegistry.js missing ${entry.key} for ${entry.name}`);
      assert(
        passiveLineByKey.get(entry.key)?.endsWith(entry.description),
        `passive_registry_keys.md key ${entry.key} does not carry the final text for ${entry.name}`,
      );
      const sqlTuple = `('${rosterType}', '${sqlLiteral(entry.name)}', '${sqlLiteral(entry.key)}', '${sqlLiteral(entry.description)}')`;
      assert(
        passiveSql.includes(sqlTuple),
        `final-passive-description-updates.sql is missing the exact ${rosterType} row for ${entry.name}`,
      );
    }
  }
  const userWordedKeys = new Set([
    'sidapa_deaths_reprieve',
    'skadi_winters_hunt',
    'thor_mjolnirs_wrath',
    'apolaki_solar_burn',
    'baldur_invulnerability',
  ]);
  assert.equal((userWordingSql.match(/^UPDATE deity_roster$/gm) || []).length, 5);
  assert(!userWordingSql.includes('UPDATE weapon_roster'));
  for (const entry of DEITY_UPDATES.filter((candidate) => userWordedKeys.has(candidate.key))) {
    assert(
      userWordingSql.includes(`SET blessing_description = '${sqlLiteral(entry.description)}'`) &&
        userWordingSql.includes(`AND blessing_key = '${entry.key}';`),
      `update-user-passive-descriptions.sql is missing ${entry.name}`,
    );
  }

  const duelId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(parseDuelButtonId(`duel:accept:${duelId}:50`), {
    action: 'accept', duelId, duelLevel: 50,
  });
  assert.deepEqual(parseDuelButtonId(`duel:decline:${duelId}:0`), {
    action: 'decline', duelId, duelLevel: null,
  });
  assert.deepEqual(parseDuelButtonId('duel_accept'), {
    action: 'accept', duelId: null, duelLevel: null,
  });
  assert.equal(parseDuelButtonId(`duel:accept:${duelId}:51`), null);
  assert.equal(parseDuelButtonId('duel:accept:not-a-uuid:0'), null);

  const buttonCalls = [];
  const declineInteraction = {
    customId: 'duel_decline',
    deferred: false,
    replied: false,
    user: { id: 'opponent' },
    message: {
      id: 'message-1',
      embeds: [{ title: '⚔️ Duel Challenge', description: '<@challenger> challenges <@opponent>!' }],
    },
    async deferUpdate() {
      buttonCalls.push('defer');
      this.deferred = true;
    },
    async editReply(payload) {
      buttonCalls.push('edit');
      this.edited = payload;
    },
    async followUp(payload) {
      buttonCalls.push('followUp');
      this.followedUp = payload;
    },
  };
  const handledDecline = await handleButtonInteraction(declineInteraction, {
    async findDuelByMessage(query) {
      buttonCalls.push('lookup');
      assert.deepEqual(query, {
        messageId: 'message-1', duelId: null, pendingWindowMs: 60_000,
      });
      return {
        duelId,
        lockToken: 'lock',
        challengerId: 'challenger',
        opponentId: 'opponent',
        duelType: 'casual',
        status: 'pending',
        lockFresh: true,
        challengeFresh: true,
      };
    },
    async cancelPendingDuel() {
      buttonCalls.push('cancel');
      return true;
    },
  });
  assert.equal(handledDecline, true);
  assert.deepEqual(buttonCalls, ['defer', 'lookup', 'cancel', 'edit']);
  assert.deepEqual(declineInteraction.edited.components, []);
  assert(declineInteraction.edited.embeds[0].data.description.includes('declined the duel'));

  const acceptCalls = [];
  const acceptInteraction = {
    customId: 'duel_accept',
    deferred: false,
    replied: false,
    user: { id: 'opponent' },
    message: { id: 'message-1', embeds: [{ title: '⚔️ Duel Challenge' }] },
    async deferUpdate() {
      acceptCalls.push('defer');
      this.deferred = true;
    },
    async editReply(payload) {
      acceptCalls.push('edit');
      this.edited = payload;
    },
    async followUp(payload) {
      acceptCalls.push('followUp');
      this.followedUp = payload;
    },
  };
  await handleButtonInteraction(acceptInteraction, {
    async findDuelByMessage(query) {
      acceptCalls.push('lookup');
      assert.equal(query.duelId, null);
      return {
        duelId,
        lockToken: 'lock',
        challengerId: 'challenger',
        opponentId: 'opponent',
        duelType: 'casual',
        status: 'pending',
        lockFresh: true,
        challengeFresh: true,
      };
    },
    async inLiveBattle(id) {
      acceptCalls.push(`live:${id}`);
      return false;
    },
    async markDuelRunning() {
      acceptCalls.push('claim');
      return { ok: false, reason: 'not_pending' };
    },
  });
  assert.deepEqual(acceptCalls, [
    'defer', 'lookup', 'live:challenger', 'live:opponent', 'claim', 'followUp',
  ]);
  assert(acceptInteraction.followedUp.content.includes('already been handled'));

  let lookupCall;
  const persistedDuel = { duelId, lockToken: 'lock', status: 'pending' };
  const foundDuel = await findDuelByMessage({
    messageId: 'message-1', duelId, pendingWindowMs: 60_000,
  }, {
    async query(sql, params) {
      lookupCall = { sql, params };
      return { rows: [persistedDuel] };
    },
  });
  assert.strictEqual(foundDuel, persistedDuel);
  assert.deepEqual(lookupCall.params, ['message-1', duelId, 60_000]);
  assert(lookupCall.sql.includes('message_id = $1'));
  assert(lookupCall.sql.includes('challengeFresh'));

  let cancelCall;
  assert.equal(await cancelPendingDuel({ duelId, lockToken: 'lock' }, {
    async query(sql, params) {
      cancelCall = { sql, params };
      return { rowCount: 1 };
    },
  }), true);
  assert.deepEqual(cancelCall.params, [duelId, 'lock']);
  assert(cancelCall.sql.includes("status = 'pending'"));

  const duelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'rpg', 'duel.js'), 'utf8');
  assert(duelSource.includes('filter: () => false'));
  assert(duelSource.includes("setCustomId('duel_accept')"));

  const interactionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'interactionHandler.js'), 'utf8');
  assert(interactionSource.includes('duelCmd.handleButtonInteraction(interaction)'));

  console.log('REQUESTED PATCH SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

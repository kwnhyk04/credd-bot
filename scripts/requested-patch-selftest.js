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

  console.log('REQUESTED PATCH SELFTEST: passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

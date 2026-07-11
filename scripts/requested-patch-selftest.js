'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveBattle } = require('../src/engine/battleEngine');
const PASSIVES = require('../src/engine/passiveRegistry');
const { RAID_LOOT, rollRaidChest } = require('../src/config/raidLoot');
const { containRect, badgeRect } = require('../src/engine/identityLayout');
const { displayEnhancement, formatEnhancedName } = require('../src/utils/enhancementFormat');
const { computeDeityProgressionStats } = require('../src/engine/deityEnhancement');
const { syncSubscriptionEntitlementsTx } = require('../src/engine/supporterEntitlements');
const { buildDeityInfoPayload, attemptDeityEnhance } = require('../src/commands/rpg/deity');
const { buildInfoPayload } = require('../src/commands/rpg/equipment');

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
  assert.deepEqual(enhanced, { status: 'done', name: 'Odin', previousLevel: 0, level: 1, cost: 2 });

  const deitySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'rpg', 'deity.js'), 'utf8');
  assert(/dr\.name, dr\.mythology, dr\.tier, dr\.base_atk/.test(deitySource));

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

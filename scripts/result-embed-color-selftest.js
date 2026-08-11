'use strict';

const assert = require('node:assert/strict');

const {
  CHEST_TIER_COLOR,
  DEITY_ALIAS_TO_TIER,
  RUNE_TIER_COLOR,
  getChestResultColor,
  getDeityResultColor,
  getRuneResultColor,
} = require('../src/utils/resultEmbedColors');
const { TIER_COLOR } = require('../src/config/gachaRates');
const {
  buildResultMessage,
} = require('../src/engine/renderSummon');
const {
  buildWeaponResultPayload,
  buildRuneResultPayload,
} = require('../src/engine/chestOpen');

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

function accent(payload) {
  return payload.components[0].toJSON().accent_color;
}

const FALLBACK = 0xf0b232;

check('deity aliases remain tied to their underlying tiers', DEITY_ALIAS_TO_TIER.Remnant === 'Epic'
  && DEITY_ALIAS_TO_TIER.Awakened === 'Mythic'
  && DEITY_ALIAS_TO_TIER.Undying === 'Legendary'
  && DEITY_ALIAS_TO_TIER.Primordial === 'Supreme');
check('deity Epic is blue', getDeityResultColor([{ rarity: 'Remnant' }], FALLBACK) === TIER_COLOR.Epic);
check('deity Mythic is purple', getDeityResultColor([{ rarity: 'Awakened' }], FALLBACK) === TIER_COLOR.Mythic);
check('deity Legendary is gold', getDeityResultColor([{ rarity: 'Undying' }], FALLBACK) === TIER_COLOR.Legendary);
check('deity Supreme is red', getDeityResultColor([{ rarity: 'Primordial' }], FALLBACK) === TIER_COLOR.Supreme);
check('deity Epic plus Mythic resolves to purple', getDeityResultColor([
  { rarity: 'Remnant' }, { rarity: 'Awakened' },
], FALLBACK) === TIER_COLOR.Mythic);
check('deity Mythic plus Legendary resolves to gold', getDeityResultColor([
  { rarity: 'Awakened' }, { rarity: 'Undying' },
], FALLBACK) === TIER_COLOR.Legendary);
check('deity Legendary plus Supreme resolves to red', getDeityResultColor([
  { rarity: 'Undying' }, { rarity: 'Primordial' },
], FALLBACK) === TIER_COLOR.Supreme);
check('deity Epic plus Supreme resolves to red', getDeityResultColor([
  { rarity: 'Remnant' }, { rarity: 'Primordial' },
], FALLBACK) === TIER_COLOR.Supreme);
check('deity uses the highest tier rather than quantity', getDeityResultColor([
  ...Array.from({ length: 29 }, () => ({ rarity: 'Remnant' })),
  { rarity: 'Awakened' },
], FALLBACK) === TIER_COLOR.Mythic);
check('deity Mythic x29 plus Legendary x1 resolves to gold', getDeityResultColor([
  ...Array.from({ length: 29 }, () => ({ rarity: 'Awakened' })),
  { rarity: 'Undying' },
], FALLBACK) === TIER_COLOR.Legendary);
check('deity Legendary x29 plus Supreme x1 resolves to red', getDeityResultColor([
  ...Array.from({ length: 29 }, () => ({ rarity: 'Undying' })),
  { rarity: 'Primordial' },
], FALLBACK) === TIER_COLOR.Supreme);
check('deity Supreme wins anywhere in the result', getDeityResultColor([
  ...Array.from({ length: 29 }, () => ({ rarity: 'Awakened' })),
  { rarity: 'Primordial' },
], FALLBACK) === TIER_COLOR.Supreme);
check('deity accepts the underlying tier field', getDeityResultColor([{ tier: 'Legendary' }], FALLBACK) === TIER_COLOR.Legendary);
check('deity ignores chest-only tiers', getDeityResultColor([{ tier: 'Rare' }], FALLBACK) === FALLBACK);

check('chest Rare is blue', getChestResultColor([{ tier: 'Rare' }], FALLBACK) === CHEST_TIER_COLOR.Rare);
check('chest Mythic is purple', getChestResultColor([{ tier: 'Mythical' }], FALLBACK) === CHEST_TIER_COLOR.Mythic);
check('chest Legendary is gold', getChestResultColor([{ tier: 'Legendary' }], FALLBACK) === CHEST_TIER_COLOR.Legendary);
check('chest Supreme is red', getChestResultColor([{ tier: 'Supreme' }], FALLBACK) === CHEST_TIER_COLOR.Supreme);
check('chest Genesis is white', getChestResultColor([{ tier: 'Genesis' }], FALLBACK) === CHEST_TIER_COLOR.Genesis);
check('chest Rare plus Mythic resolves to purple', getChestResultColor([
  { tier: 'Rare' }, { tier: 'Mythical' },
], FALLBACK) === CHEST_TIER_COLOR.Mythic);
check('chest Mythic plus Legendary resolves to gold', getChestResultColor([
  { tier: 'Mythical' }, { tier: 'Legendary' },
], FALLBACK) === CHEST_TIER_COLOR.Legendary);
check('chest Legendary plus Supreme resolves to red', getChestResultColor([
  { tier: 'Legendary' }, { tier: 'Supreme' },
], FALLBACK) === CHEST_TIER_COLOR.Supreme);
check('chest Genesis wins over Supreme', getChestResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Supreme' })),
  { tier: 'Genesis' },
], FALLBACK) === CHEST_TIER_COLOR.Genesis);
check('chest Rare x29 plus Mythic x1 resolves to purple', getChestResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Rare' })),
  { tier: 'Mythical' },
], FALLBACK) === CHEST_TIER_COLOR.Mythic);
check('chest Mythic x29 plus Legendary x1 resolves to gold', getChestResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Mythical' })),
  { tier: 'Legendary' },
], FALLBACK) === CHEST_TIER_COLOR.Legendary);
check('chest Legendary x29 plus Supreme x1 resolves to red', getChestResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Legendary' })),
  { tier: 'Supreme' },
], FALLBACK) === CHEST_TIER_COLOR.Supreme);
check('chest Supreme x29 plus Genesis x1 resolves to white', getChestResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Supreme' })),
  { tier: 'Genesis' },
], FALLBACK) === CHEST_TIER_COLOR.Genesis);
check('chest ignores deity-only Epic', getChestResultColor([{ tier: 'Epic' }], FALLBACK) === FALLBACK);

check('rune Epic is blue', getRuneResultColor([{ tier: 'Epic' }], FALLBACK) === RUNE_TIER_COLOR.Epic);
check('rune Mythic is purple', getRuneResultColor([{ tier: 'Mythical' }], FALLBACK) === RUNE_TIER_COLOR.Mythic);
check('rune Legendary is gold', getRuneResultColor([{ tier: 'Legendary' }], FALLBACK) === RUNE_TIER_COLOR.Legendary);
check('rune Supreme is red', getRuneResultColor([{ tier: 'Supreme' }], FALLBACK) === RUNE_TIER_COLOR.Supreme);
check('rune Epic plus Mythic resolves to purple', getRuneResultColor([
  { tier: 'Epic' }, { tier: 'Mythical' },
], FALLBACK) === RUNE_TIER_COLOR.Mythic);
check('rune Mythic plus Legendary resolves to gold', getRuneResultColor([
  { tier: 'Mythical' }, { tier: 'Legendary' },
], FALLBACK) === RUNE_TIER_COLOR.Legendary);
check('rune Legendary plus Supreme resolves to red', getRuneResultColor([
  { tier: 'Legendary' }, { tier: 'Supreme' },
], FALLBACK) === RUNE_TIER_COLOR.Supreme);
check('rune highest tier is independent of quantity', getRuneResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Epic' })),
  { tier: 'Mythic' },
], FALLBACK) === RUNE_TIER_COLOR.Mythic);
check('rune Mythic x29 plus Legendary x1 resolves to gold', getRuneResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Mythical' })),
  { tier: 'Legendary' },
], FALLBACK) === RUNE_TIER_COLOR.Legendary);
check('rune Legendary x29 plus Supreme x1 resolves to red', getRuneResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Legendary' })),
  { tier: 'Supreme' },
], FALLBACK) === RUNE_TIER_COLOR.Supreme);
check('rune Supreme wins anywhere in the result', getRuneResultColor([
  ...Array.from({ length: 29 }, () => ({ tier: 'Legendary' })),
  { tier: 'Supreme' },
], FALLBACK) === RUNE_TIER_COLOR.Supreme);
check('rune ignores unsupported chest tiers', getRuneResultColor([{ tier: 'Genesis' }], FALLBACK) === FALLBACK);

const rawItems = [{ tier: 'Epic', id: 'r1' }, { tier: 'Supreme', id: 'r2' }];
const rawSnapshot = JSON.stringify(rawItems);
getRuneResultColor(rawItems, FALLBACK);
check('tier resolution does not mutate reward objects', JSON.stringify(rawItems) === rawSnapshot);
check('unknown or empty results preserve the existing fallback', getChestResultColor([], FALLBACK) === FALLBACK
  && getDeityResultColor([{ rarity: 'future-tier' }], FALLBACK) === FALLBACK
  && getRuneResultColor(null, FALLBACK) === FALLBACK);

async function builderChecks() {
  const chest = await buildWeaponResultPayload({
    gifKey: 'silver_chest',
    title: 'Opened 2 × Silver Chest',
    items: [{ id: 'w1', name: 'Rare Blade', tier: 'Rare', sockets: 0 }, { id: 'w2', name: 'Supreme Blade', tier: 'Supreme', sockets: 0 }],
    sacredRelics: 0,
    supremeRelics: 0,
    remaining: 1,
    chestLabel: 'Silver Chest',
    chestEmojiName: 'silver_chest',
  });
  check('weapon result builder applies the highest chest tier color', accent(chest) === CHEST_TIER_COLOR.Supreme);

  const rune = await buildRuneResultPayload({
    gifKey: 'lesser_bag',
    title: 'Opened 2 × Lesser Rune Bag',
    items: [{ id: 'r1', name: 'Sharpness Rune', tier: 'Epic', emoji: '', stats: '' }, { id: 'r2', name: 'Aegis Rune', tier: 'Legendary', emoji: '', stats: '' }],
    remaining: 1,
    bagLabel: 'Lesser Rune Bag',
    bagEmoji: '📦',
  });
  check('rune result builder applies the highest rune tier color', accent(rune) === RUNE_TIER_COLOR.Legendary);

  const deity = await buildResultMessage([
    { name: 'Nike', rarity: 'Remnant', isNew: true, essence: 0 },
    { name: 'Zeus', rarity: 'Primordial', isNew: true, essence: 0 },
  ], { beliefShards: 0, sacredRelics: 0 });
  check('deity result builder applies the highest deity tier color', accent(deity) === TIER_COLOR.Supreme);
}

builderChecks()
  .then(() => console.log(`RESULT_EMBED_COLORS ${passed} passed`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });

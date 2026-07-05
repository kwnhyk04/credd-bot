'use strict';

// Divine Blessing deities — slot 1 activates their divine blessing
const DIVINE_BLESSING_DEITIES = new Set([
  'Zeus', 'Athena', 'Artemis', 'Aphrodite', 'Poseidon', 'Dionysus',
  'Odin', 'Thor', 'Loki', 'Skadi', 'Baldur', 'Heimdall',
  'Bathala', 'Sidapa', 'Amihan',
]);

// Echo Blessing deities — their blessing is echo-type
const ECHO_BLESSING_DEITIES = new Set([
  'Nike', 'Persephone', 'Hades', 'Hera', 'Ares', 'Hephaestus', 'Apollo',
  'Bragi', 'Idunn', 'Freyr', 'Vidar', 'Magni', 'Njord', 'Freya', 'Tyr',
  'Surt', 'Hel', 'Mimir',
  'Idiyanale', 'Lakapati', 'Habagat', 'Mandarangan', 'Magwayen',
  'Dian Masalanta', 'Mayari', 'Apolaki',
]);

// Echo blessing passive keys — used when an echo deity's blessing fires
const ECHO_BLESSING_KEY_MAP = {
  'Nike':            'echo_nike',
  'Persephone':      'echo_persephone',
  'Hades':           'echo_hades',
  'Hera':            'echo_hera',
  'Ares':            'echo_ares',
  'Hephaestus':      'echo_hephaestus',
  'Apollo':          'echo_apollo',
  'Bragi':           'echo_bragi',
  'Idunn':           'echo_idunn',
  'Freyr':           'echo_freyr',
  'Vidar':           'echo_vidar',
  'Magni':           'echo_magni',
  'Njord':           'echo_njord',
  'Freya':           'echo_freya',
  'Tyr':             'echo_tyr',
  'Surt':            'echo_surt',
  'Hel':             'echo_hel',
  'Mimir':           'echo_mimir',
  'Idiyanale':       'echo_idiyanale',
  'Lakapati':        'echo_lakapati',
  'Habagat':         'echo_habagat',
  'Mandarangan':     'echo_mandarangan',
  'Magwayen':        'echo_magwayen',
  'Dian Masalanta':  'echo_dian_masalanta',
  'Mayari':          'echo_mayari',
  'Apolaki':         'echo_apolaki',
};

// Believer level required to unlock each slot
const SLOT_UNLOCK_GATES = { 2: 15, 3: 30 };

// Mythology resonance: equip 3 deities from the same mythology
const MYTHOLOGY_RESONANCES = [
  { mythology: 'Greek', count: 3, bonuses: { atkPct: 6, critPts: 5, hpPct: 0, defPct: 0 } },
  { mythology: 'Norse', count: 3, bonuses: { atkPct: 0, critPts: 0, hpPct: 8, defPct: 6 } },
  { mythology: 'PH',    count: 3, bonuses: { atkPct: 6, critPts: 0, hpPct: 6, defPct: 0 } },
];

// Domain resonance: specific trio combos (cross-pantheon)
const DOMAIN_RESONANCES = [
  { name: 'War Gods',       deities: ['Ares', 'Tyr', 'Mandarangan'],        bonuses: { atkPct: 10, hpPct: 5, defPct: 0, critPts: 0 } },
  { name: 'Sun Deities',    deities: ['Apollo', 'Surt', 'Apolaki'],         bonuses: { atkPct: 8, hpPct: 0, defPct: 0, critPts: 5 } },
  { name: 'Harvest',        deities: ['Persephone', 'Freyr', 'Lakapati'],   bonuses: { atkPct: 0, hpPct: 10, defPct: 5, critPts: 0 } },
  { name: 'Wisdom',         deities: ['Athena', 'Odin', 'Bathala'],         bonuses: { atkPct: 0, hpPct: 5, defPct: 10, critPts: 0 } },
  { name: 'Sea',            deities: ['Poseidon', 'Njord', 'Magwayen'],     bonuses: { atkPct: 0, hpPct: 10, defPct: 8, critPts: 0 } },
  { name: 'Moon',           deities: ['Artemis', 'Hel', 'Mayari'],          bonuses: { atkPct: 0, hpPct: 0, defPct: 8, critPts: 6 } },
  { name: 'Death',          deities: ['Hades', 'Vidar', 'Sidapa'],          bonuses: { atkPct: 8, hpPct: 0, defPct: 8, critPts: 0 } },
  { name: 'Forge & Flame',  deities: ['Hephaestus', 'Thor', 'Apolaki'],     bonuses: { atkPct: 8, hpPct: 0, defPct: 6, critPts: 0 } },
  { name: 'Tricksters',     deities: ['Dionysus', 'Loki', 'Habagat'],       bonuses: { atkPct: 5, hpPct: 0, defPct: 0, critPts: 8 } },
  { name: 'Guardians',      deities: ['Athena', 'Heimdall', 'Mayari'],      bonuses: { atkPct: 0, hpPct: 8, defPct: 12, critPts: 0 } },
  { name: 'Last Stand',     deities: ['Hera', 'Tyr', 'Dian Masalanta'],     bonuses: { atkPct: 0, hpPct: 10, defPct: 10, critPts: 0 } },
];

/**
 * Compute total resonance bonuses from up to 3 equipped deity names + mythologies.
 * @param {{ name: string, mythology: string }[]} deities
 * @returns {{ atkPct: number, hpPct: number, defPct: number, critPts: number }}
 */
function computeResonanceMods(deities) {
  const mods = { atkPct: 0, hpPct: 0, defPct: 0, critPts: 0 };
  const valid = deities.filter(Boolean);
  if (valid.length === 0) return mods;

  const names = valid.map(d => d.name);
  const mythologies = valid.map(d => d.mythology);

  for (const r of MYTHOLOGY_RESONANCES) {
    if (mythologies.filter(m => m === r.mythology).length >= r.count) {
      mods.atkPct += r.bonuses.atkPct;
      mods.hpPct += r.bonuses.hpPct;
      mods.defPct += r.bonuses.defPct;
      mods.critPts += r.bonuses.critPts;
    }
  }

  const nameSet = new Set(names);
  for (const r of DOMAIN_RESONANCES) {
    if (r.deities.every(d => nameSet.has(d))) {
      mods.atkPct += r.bonuses.atkPct;
      mods.hpPct += r.bonuses.hpPct;
      mods.defPct += r.bonuses.defPct;
      mods.critPts += r.bonuses.critPts;
    }
  }

  return mods;
}

module.exports = {
  DIVINE_BLESSING_DEITIES,
  ECHO_BLESSING_DEITIES,
  ECHO_BLESSING_KEY_MAP,
  SLOT_UNLOCK_GATES,
  MYTHOLOGY_RESONANCES,
  DOMAIN_RESONANCES,
  computeResonanceMods,
};

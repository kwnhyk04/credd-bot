'use strict';

const EFFECT_CATEGORY = Object.freeze({
  STATUS: 'status',
  DOT: 'dot',
});

const defineEffect = (category, options = {}) => Object.freeze({ category, ...options });

const EFFECT_DEFINITIONS = Object.freeze({
  stun: defineEffect(EFFECT_CATEGORY.STATUS),
  freeze: defineEffect(EFFECT_CATEGORY.STATUS),
  petrify: defineEffect(EFFECT_CATEGORY.STATUS),
  paralyze: defineEffect(EFFECT_CATEGORY.STATUS),
  thor_paralyze: defineEffect(EFFECT_CATEGORY.STATUS),
  dizzy: defineEffect(EFFECT_CATEGORY.STATUS),
  miss: defineEffect(EFFECT_CATEGORY.STATUS),
  frostbite: defineEffect(EFFECT_CATEGORY.STATUS),
  charm: defineEffect(EFFECT_CATEGORY.STATUS),
  confuse: defineEffect(EFFECT_CATEGORY.STATUS),
  atk_down: defineEffect(EFFECT_CATEGORY.STATUS),
  def_down: defineEffect(EFFECT_CATEGORY.STATUS),
  crit_down: defineEffect(EFFECT_CATEGORY.STATUS),
  bleed: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  burn: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  venom: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  poison: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  hp_pct_dot: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  thor_paralyze_dot: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
});

const CANONICAL_ON_HIT_EFFECTS = Object.freeze({
  apolaki: Object.freeze({
    flag: 'apolaki_on_hit',
    tag: 'burn',
    atkPctPerHit: 0.10,
    maxAtkPct: 0.10,
    turns: 1,
  }),
  surt: Object.freeze({
    flag: 'surt_on_hit',
    tag: 'burn',
    atkPctPerHit: 0.05,
    maxAtkPct: 0.30,
    turns: 2,
  }),
});

function effectDefinition(effectId) {
  return EFFECT_DEFINITIONS[effectId] || null;
}

function effectCategory(effectId) {
  return effectDefinition(effectId)?.category || null;
}

function isStatusEffect(effectId) {
  return effectCategory(effectId) === EFFECT_CATEGORY.STATUS;
}

function isDotEffect(effectId) {
  return effectCategory(effectId) === EFFECT_CATEGORY.DOT;
}

function isRecurringDamageEffect(effectId) {
  return effectDefinition(effectId)?.recurringDamage === true;
}

function removeEffectsByCategory(activeEffects, categories) {
  const selected = new Set(categories);
  let removedCount = 0;
  let writeIndex = 0;

  for (const effect of activeEffects) {
    const category = effect.category || effectCategory(effect.tag);
    if (selected.has(category)) {
      removedCount += 1;
    } else {
      activeEffects[writeIndex] = effect;
      writeIndex += 1;
    }
  }

  activeEffects.length = writeIndex;
  return removedCount;
}

module.exports = {
  EFFECT_CATEGORY,
  EFFECT_DEFINITIONS,
  CANONICAL_ON_HIT_EFFECTS,
  effectDefinition,
  effectCategory,
  isStatusEffect,
  isDotEffect,
  isRecurringDamageEffect,
  removeEffectsByCategory,
};

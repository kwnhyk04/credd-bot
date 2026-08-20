'use strict';

const EFFECT_CATEGORY = Object.freeze({
  STATUS: 'status',
  DOT: 'dot',
});

const defineEffect = (category, options = {}) => Object.freeze({ category, ...options });
const BLEED_TAG = 'bleed';

const EFFECT_DEFINITIONS = Object.freeze({
  stun: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  freeze: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  petrify: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  paralyze: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  thor_paralyze: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  dizzy: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  miss: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  frostbite: defineEffect(EFFECT_CATEGORY.STATUS),
  charm: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  confuse: defineEffect(EFFECT_CATEGORY.STATUS, { crowdControl: true }),
  atk_down: defineEffect(EFFECT_CATEGORY.STATUS),
  // Atlas uses a dedicated action-timed ATK reduction. Keeping it in the
  // status registry preserves the shared immunity, cleanse, and ward paths
  // without forcing its lifetime through the round-based stat-debuff clock.
  atlas_atk_down: defineEffect(EFFECT_CATEGORY.STATUS),
  def_down: defineEffect(EFFECT_CATEGORY.STATUS),
  crit_down: defineEffect(EFFECT_CATEGORY.STATUS),
  darkened: defineEffect(EFFECT_CATEGORY.STATUS),
  hemorrhage: defineEffect(EFFECT_CATEGORY.STATUS, { tags: [BLEED_TAG] }),
  rupture: defineEffect(EFFECT_CATEGORY.STATUS, { tags: [BLEED_TAG] }),
  // Ordinary Bleed now belongs to the same semantic family as Hemorrhage,
  // Rupture, and Venom. Bloodhunter therefore recognizes the visible Bleed DOT.
  bleed: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true, tags: [BLEED_TAG] }),
  burn: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true }),
  venom: defineEffect(EFFECT_CATEGORY.DOT, { recurringDamage: true, tags: [BLEED_TAG] }),
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
    atkPctPerHit: 0.03,
    maxAtkPct: 0.15,
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

function isCrowdControlEffect(effectId) {
  return effectDefinition(effectId)?.crowdControl === true;
}

function effectHasTag(effectId, tag) {
  return effectDefinition(effectId)?.tags?.includes(tag) === true;
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
  BLEED_TAG,
  EFFECT_DEFINITIONS,
  CANONICAL_ON_HIT_EFFECTS,
  effectDefinition,
  effectCategory,
  effectHasTag,
  isStatusEffect,
  isDotEffect,
  isRecurringDamageEffect,
  isCrowdControlEffect,
  removeEffectsByCategory,
};

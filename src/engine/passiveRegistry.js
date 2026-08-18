'use strict';

/**
 * PASSIVE REGISTRY — CREDD BOT v4 (Phase 6 — factory build)
 *
 * One flat object keyed by passive_key / blessing_key / skill_key. Every key in
 * passive_registry_keys.md has a function here (coverage is asserted both ways by
 * scripts/battle-selftest.js). Functions are pure state-mutation over a perspective
 * `bs` object described below. They never deal damage, apply mitigation, end the
 * battle, or touch the DB.
 *
 * RANDOMNESS: every probability check draws from bs.rng() (the engine-injected
 * seeded stream). Math.random is forbidden in this file (statically checked by the
 * selftest). Round-bound checks draw once per invocation. Attack-bound checks are
 * queued and draw once only when their attack/landed-hit trigger actually occurs.
 *
 * Timing rules (§35.1):
 *   - bs.currentTurn = ROUND counter (the only periodic clock)
 *   - CC + stat debuffs last 1 turn; Bleed/Burn DOTs tick 2 turns
 *   - "first hit / first N hits" → one-shot flag or small tally on bs.flags.*
 *   - Stacking buffs are per-turn; bonus/extra hits are riders (advance nothing)
 *   - bs.enemyImmune(tag) gates all enemy-targeted debuffs
 *
 * bs scratch fields (reset by the engine every round):
 *   damageBonusPct (proc-granted damage %, summed with the weapon's bonusDmgPct),
 *   damageReductionPct, incomingDamageIncreasePct, playerAtkMult, playerDefMult,
 *   ignoreDefPct, nextAttackAutoCrit, nextAttackDouble, isPrimaryAttack,
 *   isAdditionalAttack, allowAdditionalAttackProcs, log.
 * bs.flags.* persists for the whole battle (except the engine-managed per-round
 * derived flags — see battleEngine.js round-start reset list).
 *
 * Most keys are built from the archetype factories below; genuinely unique effects
 * stay bespoke. The canonical key/description ledger lives in
 * assets/data/passive_registry_keys.md.
 */

const { CANONICAL_ON_HIT_EFFECTS } = require('./combatEffects');
const { LOG_PRIORITY: LOG } = require('./combatLog');

// Fenrir's passive configuration and state transitions live with the passive
// registry so the boss skill key, thresholds, multipliers, and announcements
// have one authoritative home. These helpers are exposed non-enumerably below
// so the registry's key coverage remains limited to actual passive handlers.
const FENRIR_PASSIVE_KEY = 'fenrir_gleipnirs_doom';

const FENRIR_PHASES = Object.freeze([
  Object.freeze({
    index: 0,
    key: 'bound',
    label: 'Bound',
    outgoingDamageMultiplier: 1,
    armorPenetration: 0,
  }),
  Object.freeze({
    index: 1,
    key: 'first_seal_broken',
    label: 'First Seal Broken',
    outgoingDamageMultiplier: 1.10,
    armorPenetration: 0.05,
  }),
  Object.freeze({
    index: 2,
    key: 'second_seal_broken',
    label: 'Second Seal Broken',
    outgoingDamageMultiplier: 1.20,
    armorPenetration: 0.10,
  }),
  Object.freeze({
    index: 3,
    key: 'ragnarok_unbound',
    label: 'Ragnarök Unbound',
    outgoingDamageMultiplier: 1.35,
    armorPenetration: 0.15,
  }),
]);

function fenrirPhaseForHp(currentHp, maxHp) {
  const max = Number(maxHp);
  const current = Number(currentHp);
  const ratio = Number.isFinite(max) && max > 0 && Number.isFinite(current)
    ? Math.max(0, Math.min(1, current / max))
    : 1;
  if (ratio <= 0.25) return FENRIR_PHASES[3];
  if (ratio <= 0.50) return FENRIR_PHASES[2];
  if (ratio <= 0.75) return FENRIR_PHASES[1];
  return FENRIR_PHASES[0];
}

function fenrirPhaseFromState(state = {}) {
  const index = Number(state.fenrirPhaseIndex);
  if (!Number.isInteger(index)) return FENRIR_PHASES[0];
  return FENRIR_PHASES[Math.max(0, Math.min(FENRIR_PHASES.length - 1, index))];
}

function reconcileFenrirPhase(state = {}, currentHp, maxHp) {
  const previous = fenrirPhaseFromState(state);
  const byHp = fenrirPhaseForHp(currentHp, maxHp);
  const phase = FENRIR_PHASES[Math.max(previous.index, byHp.index)];
  return {
    phase,
    advanced: phase.index > previous.index,
    initialized: state.fenrirPhaseInitialized === true,
    state: {
      ...state,
      fenrirPhaseInitialized: true,
      fenrirPhaseIndex: phase.index,
    },
  };
}

function fenrirPhaseAnnouncement(phase) {
  if (!phase || phase.index === 0) return null;
  if (phase.index === 1) {
    return "⛓️ Gleipnir's first seal has broken! Fenrir gains +10% outgoing damage and +5% armor penetration.";
  }
  if (phase.index === 2) {
    return "⛓️ Gleipnir's second seal has broken! Fenrir now has +20% outgoing damage and +10% armor penetration.";
  }
  return '🐺 RAGNARÖK UNBOUND — Fenrir breaks free from Gleipnir and gains +35% outgoing damage and +15% armor penetration!';
}

const fenrirGleipnirsDoom = (bs) => {
  if (typeof bs.refreshEnemyBossPhase === 'function') bs.refreshEnemyBossPhase();
};

// ───────────────────────────────────────────────────────────────────────────
// Archetype factories
// ───────────────────────────────────────────────────────────────────────────

/** Shared no-op (basic weapons, immunity-only bosses). */
const noop = () => {};

/** Announce a persistent passive state once per battle without spamming every round. */
const logOnce = (bs, flagKey, label) => {
  if (bs.flags[flagKey]) return;
  bs.flags[flagKey] = true;
  bs.log.push(label);
};

// Round-timed status effects are armed by the engine on the round after application,
// so one stored turn now means one complete affected round regardless of actor order.
const LANDED_STAT_DEBUFF_TURNS = 1;

// Aegis tuning lives in config/combat.js — shared with battleEngine's grantAegisStone
// so the reduction applied here and the reduction rolled back on Petrify cannot drift.
const { AEGIS_DR_PER_STACK } = require('../config/combat');

/** First player action of the battle deals +pct of its damage (one-shot flag).
 *  The attack hook means crowd control cannot consume the opener before an attack starts.
 *  Routed through the ATK multiplier (pre-mitigation), so the bonus is +pct of the
 *  damage actually dealt — NOT a flat ATK-fraction that bypasses the enemy's DEF. */
const firstHitBonus = (flagKey, pct, label) => (bs) => {
  bs.onAttack(() => {
    if (!bs.flags[flagKey]) {
      bs.flags[flagKey] = true;
      bs.playerAtkMult += pct;
      bs.log.push(label);
    }
  });
};

/** chance → +pct damage this round (ATK-mult lane; mitigated — see firstHitBonus). */
const chanceRider = (chance, pct, label) => (bs) => {
  if (bs.rng() < chance) {
    bs.playerAtkMult += pct;
    bs.log.push(label);
  }
};

/** Attack-bound chance rider: no attack means no roll, proc, or misleading log. */
const attackChanceRider = (chance, pct, label) => (bs) => {
  bs.onAttack(() => {
    if (bs.rng() < chance) {
      bs.playerAtkMult += pct;
      bs.log.push(label);
    }
  });
};

/** ATK +step every everyN turns, stacking up to cap (stack persists in flags). */
const stackingAtk = (flagKey, step, cap, everyN = 1, labelFn = null) => (bs) => {
  if (!bs.flags[flagKey]) bs.flags[flagKey] = 0;
  const previous = bs.flags[flagKey];
  if ((everyN === 1 || bs.currentTurn % everyN === 0) && bs.flags[flagKey] < cap) {
    bs.flags[flagKey] = Math.min(bs.flags[flagKey] + step, cap);
  }
  bs.playerAtkMult += bs.flags[flagKey];
  if (labelFn && bs.flags[flagKey] > previous) {
    bs.log.push(labelFn(
      Math.round(bs.flags[flagKey] * 100),
      Math.round(bs.flags[flagKey] / step),
    ));
  }
};

/**
 * End-of-turn ATK ramp. The passive phase runs at the start of a round, so the
 * completed-turn offset keeps turn 1 unbuffed and makes the first stack affect
 * the next real turn. The applied-turn latch also prevents duplicate channel
 * registration from applying the same ramp twice in one round.
 */
const delayedStackingAtk = (flagKey, step, cap, labelFn = null) => (bs) => {
  const turn = Math.max(0, Math.floor(Number(bs.currentTurn) || 0));
  const maxStacks = Math.floor((cap / step) + Number.EPSILON);
  const stacks = Math.min(Math.max(turn - 1, 0), maxStacks);
  const previous = Number(bs.flags[flagKey]) || 0;
  const next = Math.min(stacks * step, cap);
  const appliedTurnKey = `${flagKey}_applied_turn`;
  if (bs.flags[appliedTurnKey] === turn) return;
  bs.flags[appliedTurnKey] = turn;
  bs.flags[flagKey] = next;
  bs.playerAtkMult += next;
  if (labelFn && next > previous) {
    const label = labelFn(next, previous, stacks);
    if (label) bs.log.push(label);
  }
};

const bloodFrenzyLabel = (prefix) => (total, previous, stacks) =>
  `🩸 ${prefix}: Blood Frenzy — end-turn stack +${Math.round((total - previous) * 100)}% ATK ` +
  `(total +${Math.round(total * 100)}%, ${stacks}/5).`;

/** chance → apply an enemy debuff (draw always happens; immunity gated after). */
const chanceEnemyDebuff = (chance, tag, turns, valueFn, label) => (bs) => {
  const proc = bs.rng() < chance;
  if (proc && !bs.enemyImmune(tag)
      && bs.applyDebuff(tag, turns, valueFn ? valueFn(bs) : 0)) {
    bs.log.push(label);
  }
};

/** Landed-hit chance debuff: evasion and crowd-control skips cannot proc it. */
const chanceLandedHitDebuff = (chance, tag, turns, valueFn, label) => (bs) => {
  let proc = false;
  bs.onAttack(() => { proc = bs.rng() < chance; });
  bs.onLandedHit(() => {
    if (proc && !bs.enemyImmune(tag)) {
      if (bs.applyDebuff(tag, turns, valueFn ? valueFn(bs) : 0)) bs.log.push(label);
    }
  }, LOG.STATUS);
};

/** Roll and apply only after a hit lands. */
const chancePerLandedHitDebuff = (chance, tag, turns, valueFn, label) => (bs) => {
  bs.onLandedHit(() => {
    if (bs.rng() < chance && !bs.enemyImmune(tag)
        && bs.applyDebuff(tag, turns, valueFn ? valueFn(bs) : 0)) {
      bs.log.push(label);
    }
  }, LOG.STATUS);
};

/** Apply an enemy DOT on every hit (refreshes; highest value wins in the engine). */
const onHitEnemyDot = (tag, pct, label) => (bs) => {
  bs.onLandedHit(() => {
    if (!bs.enemyImmune(tag) && bs.applyDebuff(tag, 2, bs.playerATK * pct)) {
      bs.log.push(label);
    }
  }, LOG.STATUS);
};

/** +pct damage while an engine-set state flag is true (stunned/bleeding).
 *  ATK-mult lane (mitigated) — +pct of the damage dealt, not a DEF-bypassing flat add. */
const bonusVsState = (stateFlag, pct, label) => (bs) => {
  bs.onAttack(() => {
    if (bs.flags[stateFlag]) {
      bs.playerAtkMult += pct;
      bs.log.push(label);
    }
  });
};

/** Permanent armor pierce (highest ignoreDefPct wins — registry only raises). */
const flatPierce = (pct) => (bs) => {
  if (pct > bs.ignoreDefPct) bs.ignoreDefPct = pct;
};

/** Self buff for the first N rounds. */
const timedSelfBuff = (rounds, atk, def) => (bs) => {
  if (bs.currentTurn <= rounds) {
    if (atk) bs.playerAtkMult += atk;
    if (def) bs.playerDefMult += def;
  }
};

/** Constant whole-battle self buff (re-applied to the per-round scratch). */
const constantSelfBuff = (atk, def, incoming) => (bs) => {
  if (atk) bs.playerAtkMult += atk;
  if (def) bs.playerDefMult += def;
  if (incoming < 0) bs.damageReductionPct += -incoming;
  if (incoming > 0) bs.incomingDamageIncreasePct += incoming;
};

/** Re-roll a defensive check flag each round (block/evade/reflect hooks). */
const chanceFlag = (chance, flagKey, label, extrasFn) => (bs) => {
  bs.flags[flagKey] = bs.rng() < chance;
  if (bs.flags[flagKey]) {
    if (extrasFn) extrasFn(bs);
    if (label) bs.log.push(label);
  }
};

/** Every Nth round: +pct damage and/or extra effects (ATK-mult lane; mitigated). */
const everyNthRider = (n, pct, label, extraFn) => (bs) => {
  if (bs.currentTurn % n === 0) {
    if (pct) bs.playerAtkMult += pct;
    if (extraFn) extraFn(bs);
    if (label) bs.log.push(label);
  }
};

/** Self buff while own HP is below a threshold. */
const hpThresholdBuff = (hpPct, atk, def) => (bs) => {
  if (bs.playerHP < bs.playerMaxHP * hpPct) {
    if (atk) bs.playerAtkMult += atk;
    if (def) bs.playerDefMult += def;
  }
};

/** Once per battle, when own HP crosses the threshold: heal healPct max HP. */
const oncePerBattleHeal = (usedFlag, hpPct, healPct, labelFn, orEqual = false) => (bs) => {
  const trig = orEqual ? bs.playerHP <= bs.playerMaxHP * hpPct
                       : bs.playerHP < bs.playerMaxHP * hpPct;
  if (!bs.flags[usedFlag] && trig) {
    bs.flags[usedFlag] = true;
    const heal = Math.floor(bs.playerMaxHP * healPct);
    bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
    bs.log.push(labelFn(heal));
  }
};

/** Heal own HP by pct max HP every N rounds. */
const regenSelf = (everyN, pct, labelFn) => (bs) => {
  if (bs.currentTurn % everyN === 0) {
    const heal = Math.floor(bs.playerMaxHP * pct);
    bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
    bs.log.push(labelFn(heal));
  }
};

/** Heal the ENEMY (mob self-regen — mob skills run on the player's perspective). */
const regenEnemy = (everyN, pct, labelFn) => (bs) => {
  if (bs.currentTurn % everyN === 0) {
    const heal = Math.floor(bs.enemyMaxHP * pct);
    bs.enemyHP = Math.min(bs.enemyHP + heal, bs.enemyMaxHP);
    bs.log.push(labelFn(heal));
  }
};

/** Mob skill: chance → apply player debuff(s). specs: [{tag, turns, value|valueFn}] */
const chancePlayerDebuff = (chance, specs, label) => (bs) => {
  const proc = bs.rng() < chance;
  if (proc) {
    let applied = false;
    for (const s of specs) {
      applied = bs.applyPlayerDebuff(
        s.tag,
        s.turns,
        s.valueFn ? s.valueFn(bs) : (s.value || 0),
      ) || applied;
    }
    if (applied) bs.log.push(label);
  }
};

/** Mob skill: roll only after the mob lands a hit, then apply player debuff(s). */
const chanceEnemyLandedHitPlayerDebuff = (chance, specs, label) => (bs) => {
  bs.onEnemyLandedHit(() => {
    if (bs.rng() >= chance) return;
    let applied = false;
    for (const s of specs) {
      applied = bs.applyPlayerDebuff(
        s.tag,
        s.turns,
        s.valueFn ? s.valueFn(bs) : (s.value || 0),
      ) || applied;
    }
    if (applied) bs.log.push(label);
  }, LOG.STATUS);
};

/** Mob skill: every Nth round → apply player debuff(s). */
const everyNthPlayerDebuff = (n, specs, label) => (bs) => {
  if (bs.currentTurn % n === 0) {
    let applied = false;
    for (const s of specs) {
      applied = bs.applyPlayerDebuff(
        s.tag,
        s.turns,
        s.valueFn ? s.valueFn(bs) : (s.value || 0),
      ) || applied;
    }
    if (applied) bs.log.push(label);
  }
};

const canonicalOnHitEffect = (effect) => (bs) => {
  bs.flags[effect.flag] = true;
};

const apolakiSolarBurn = canonicalOnHitEffect(CANONICAL_ON_HIT_EFFECTS.apolaki);
const surtMuspellsFlame = canonicalOnHitEffect(CANONICAL_ON_HIT_EFFECTS.surt);

/** Mob skill: every Nth round → the enemy attack deals pct× ATK as its TOTAL damage
 *  (mitigated by the player's DEF). pct is the whole multiplier, like a crit: "200% ATK"
 *  = ×2.0 of a normal hit (NOT +200% on top), "150% ATK" = ×1.5, etc. */
const everyNthEnemyNuke = (n, pctOrFn, labelFn, extraFn) => (bs) => {
  if (bs.currentTurn % n === 0) bs.flags.enemy_nuke_pending = true;
  if (bs.flags.enemy_nuke_pending) {
    let triggered = false;
    let landedEffectApplied = false;
    bs.onEnemyAttack(() => {
      if (!bs.flags.enemy_nuke_pending) return;
      bs.flags.enemy_nuke_pending = false;
      triggered = true;
      const pct = typeof pctOrFn === 'function' ? pctOrFn(bs) : pctOrFn;
      bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * pct;
      bs.log.push(typeof labelFn === 'function' ? labelFn(pct) : labelFn);
    });
    if (extraFn) {
      bs.onEnemyLandedHit(() => {
        if (!triggered || landedEffectApplied) return;
        landedEffectApplied = true;
        extraFn(bs);
      }, LOG.STATUS);
    }
  }
};

// ───────────────────────────────────────────────────────────────────────────
// Registry
// ───────────────────────────────────────────────────────────────────────────

const PASSIVE_REGISTRY = {

  // ── sentinel ──────────────────────────────────────────────────────────────
  'none': noop,

  // ── WEAPON PASSIVES — Rare ───────────────────────────────────────────────

  'cutlass': chancePerLandedHitDebuff(0.10, 'bleed', 2, (bs) => bs.playerATK * 0.05,
    '🗡️ Cutlass: Serrated Edge — Bleed applied (5% ATK for 2 turns)!'),

  'kampilan': firstHitBonus('kampilan_used', 0.20,
    '⚔️ Kampilan: Opening Strike — +20% ATK bonus!'),

  'war_club': chanceLandedHitDebuff(0.10, 'stun', 1, null,
    '🪓 War Club: Concussive Blow — Enemy stunned!'),

  'bone_crusher': firstHitBonus('bone_crusher_used', 0.20,
    '🦴 Bone Crusher: Opening Strike — +20% ATK bonus!'),

  'crystal_wand': attackChanceRider(0.10, 0.15,
    '🔮 Crystal Wand: Arcane Surge — +15% ATK bonus hit!'),

  'carved_totem': firstHitBonus('carved_totem_used', 0.20,
    '🪵 Carved Totem: Opening Strike — +20% ATK bonus!'),

  // Rolled during setup; the engine logs it only if an incoming hit consumes it.
  'steel_kite_shield': chanceFlag(0.10, 'steel_kite_shield_block', null),

  'reinforced_targe': firstHitBonus('reinforced_targe_used', 0.20,
    '🛡️ Reinforced Targe: Opening Strike — +20% ATK bonus!'),

  'recurve_bow': attackChanceRider(0.10, 0.20,
    '🏹 Recurve Bow: Precise Shot — +20% ATK bonus hit!'),

  'crossbow': (bs) => {
    // First actual attack +20% ATK ignoring 25% DEF. CC cannot split/consume the opener.
    bs.onAttack(() => {
      if (!bs.flags.crossbow_used) {
        bs.flags.crossbow_used = true;
        bs.playerAtkMult += 0.20;
        bs.flags.crossbow_pierce = true;
        bs.log.push('🏹 Crossbow: Piercing Opener — +20% ATK, ignores 25% DEF!');
      }
    });
  },

  // ── WEAPON PASSIVES — Mythic ─────────────────────────────────────────────

  'katana': (bs) => {
    // +30% damage (unified §35.2). Applies to crit AND non-crit: ×1.30 normal / ×2.30 crit.
    bs.damageBonusPct += 30;
    logOnce(bs, 'katana_passive_logged',
      '🗡️ Katana: Lethal Edge — each attack deals +30% damage.');
  },

  'gladius': attackChanceRider(0.30, 0.50,
    '⚔️ Gladius: Brutal Swing — +50% bonus ATK!'),

  'scimitar': stackingAtk('scimitar_stack', 0.03, 0.15, 1,
    (pct, stacks) => `⚔️ Scimitar: Rising Slash — ATK +${pct}% (${stacks}/5 stacks).`),

  'roman_cestus': bonusVsState('enemy_is_stunned', 0.50,
    '👊 Roman Cestus: Executioner — +50% vs stunned!'),

  'pata': onHitEnemyDot('bleed', 0.05,
    '🗡️ Pata: Rending Claws — Bleed applied (5% ATK for 2 turns)!'),

  'bagh_nakh': stackingAtk('bagh_nakh_stack', 0.05, 0.25, 1,
    (pct, stacks) => `🗡️ Bagh Nakh: Frenzied Claws — ATK +${pct}% (${stacks}/5 stacks).`),

  'japanese_bo': (bs) => {
    bs.onAttack(() => {
      bs.flags.japanese_bo_active = bs.rng() < 0.25;
    });
  },

  'english_quarterstaff': attackChanceRider(0.20, 0.50,
    '🪄 English Quarterstaff: Sweeping Strike — +50% bonus ATK!'),

  'egyptian_asa': (bs) => {
    // +3% DEF ignore every turn, stacking to 15% (merged into ignoreDefPct, highest wins)
    if (!bs.flags.egyptian_asa_pierce) bs.flags.egyptian_asa_pierce = 0;
    const previous = bs.flags.egyptian_asa_pierce;
    if (bs.flags.egyptian_asa_pierce < 0.15) {
      bs.flags.egyptian_asa_pierce = Math.min(bs.flags.egyptian_asa_pierce + 0.03, 0.15);
    }
    if (bs.flags.egyptian_asa_pierce > bs.ignoreDefPct) {
      bs.ignoreDefPct = bs.flags.egyptian_asa_pierce;
    }
    if (bs.flags.egyptian_asa_pierce > previous) {
      const pct = Math.round(bs.flags.egyptian_asa_pierce * 100);
      const stacks = Math.round(bs.flags.egyptian_asa_pierce / 0.03);
      bs.log.push(`🪄 Egyptian Asa: Armor Breaker — DEF ignored ${pct}% (${stacks}/5 stacks).`);
    }
  },

  'pilgrims_bordone': chanceLandedHitDebuff(0.50, 'def_down', LANDED_STAT_DEBUFF_TURNS, () => 0.15,
    '🪄 Pilgrim\'s Bordone: Sundering Blow — Enemy DEF -15%!'),

  'vatican_aspis': (bs) => {
    constantSelfBuff(0.12, 0, -0.08)(bs);
    logOnce(bs, 'vatican_aspis_logged',
      '🛡️ Vatican Aspis: Sacred Guard — +12% outgoing damage · 8% damage reduction.');
  },

  'battersea_shield': (bs) => {
    const previous = bs.flags.iron_stance_stacks || 0;
    const stacks = Math.min(previous + 1, 5);
    bs.flags.iron_stance_stacks = stacks;
    bs.damageReductionPct += stacks * 0.03;
    if (stacks > previous) {
      bs.log.push(`🛡️ Iron Stance — damage reduction now ${stacks * 3}% (turn ${bs.currentTurn})`);
    }
  },

  'enderby_shield': (bs) => {
    bs.flags.enderby_reflect_pct = 0.12;
  },

  'holmegaard_bow': stackingAtk('holmegaard_stack', 0.03, 0.15, 1,
    (pct, stacks) => `🏹 Holmegaard Bow: Steady Aim — ATK +${pct}% (${stacks}/5 stacks).`),

  'scandinavian_glacial_wooden_bow': (bs) => {
    // 10% chance on the primary attack to add one attack. Generated attacks
    // cannot roll another additional-attack generator.
    bs.onAttack(() => {
      if (bs.allowAdditionalAttackProcs === false) return;
      bs.flags.extra_turn = bs.rng() < 0.10;
    });
  },

  'scythian_composite_bow': attackChanceRider(0.20, 0.50,
    '🏹 Scythian Composite Bow: Power Draw — +50% bonus ATK!'),

  'xiphos': stackingAtk('xiphos_stack', 0.04, 0.20, 1,
    (pct, stacks) => `⚔️ Xiphos: Honed Edge — ATK +${pct}% (${stacks}/5 stacks).`),

  'kopis': attackChanceRider(0.25, 0.60,
    '⚔️ Kopis: Cleaving Blow — +60% bonus ATK!'),

  'caestus': attackChanceRider(0.35, 0.40,
    '👊 Caestus: Hammer Fists — +40% bonus ATK!'),

  'myrmex': bonusVsState('enemy_is_stunned', 0.40,
    '👊 Myrmex: Predator\'s Grip — +40% vs stunned!'),

  'dory': stackingAtk('dory_stack', 0.06, 0.18, 2,
    (pct, stacks) => `🔱 Dory: Phalanx Momentum — ATK +${pct}% (${stacks}/3 stacks).`),

  'thyrsus': chanceEnemyDebuff(0.20, 'bleed', 2, (bs) => bs.playerATK * 0.05,
    '🪄 Thyrsus: Maddening Touch — Bleed applied (5% ATK for 2 turns)!'),

  'dipylon_shield': (bs) => {
    timedSelfBuff(3, 0, 0.30)(bs);
    if (bs.currentTurn <= 3) {
      bs.log.push(`🛡️ Dipylon Shield: Hoplite Wall — DEF +30% (turn ${bs.currentTurn}/3).`);
    }
  },

  'pelte': (bs) => {
    bs.flags.pelte_active = true;
  },

  'arrow_of_eros': attackChanceRider(0.30, 0.45,
    '🏹 Arrow of Eros: Love\'s Arrow — +45% bonus ATK!'),

  'cretan_bow': stackingAtk('cretan_bow_stack', 0.04, 0.20, 1,
    (pct, stacks) => `🏹 Cretan Bow: Hunter's Focus — ATK +${pct}% (${stacks}/5 stacks).`),

  // ── WEAPON PASSIVES — Legendary PH & Norse ──────────────────────────────

  'juru_pakal': (bs) => {
    bs.playerAtkMult += 0.10;
    logOnce(bs, 'juru_pakal_base_logged',
      '🩸 Bloodhunter — outgoing damage +10%.');
    bs.onAttack(() => {
      if (bs.enemyHasEffectTag('bleed')) {
        bs.playerAtkMult += 0.50;
        bs.log.push('🩸 Bloodhunter — target is bleeding, +50% damage.');
      }
    });
  },

  'gram': (bs) => {
    // Ignores 25% of enemy DEF; actual attacks gain +30% above 50% enemy HP.
    if (0.25 > bs.ignoreDefPct) bs.ignoreDefPct = 0.25;
    logOnce(bs, 'gram_pierce_logged',
      '🐉 Dragonbane — 25% of enemy DEF ignored.');
    bs.onAttack(() => {
      if (bs.enemyHP > bs.enemyMaxHP * 0.50) {
        bs.playerAtkMult += 0.30;
        bs.log.push('🐉 Dragonbane — target above 50% HP, +30% bonus damage.');
      }
    });
  },

  'tyrfing': (bs) => {
    if (!bs.flags.tyrfing_stack) bs.flags.tyrfing_stack = 0;
    const previous = bs.flags.tyrfing_stack;
    if (bs.flags.tyrfing_stack < 0.30) {
      bs.flags.tyrfing_stack = Math.min(bs.flags.tyrfing_stack + 0.10, 0.30);
    }
    bs.playerAtkMult += bs.flags.tyrfing_stack;
    if (bs.flags.tyrfing_stack > previous) {
      const pct = Math.round(bs.flags.tyrfing_stack * 100);
      bs.log.push(`🗡️ Cursed Edge — ATK +${pct}% (${pct === 30 ? 'max stacks' : `${pct / 10} stacks`})`);
    }
  },

  'laevateinn_sword': (bs) => {
    // Enemy DEF -10%/turn stacking to 30%. ONE def_down source whose value is the
    // stack — combined highest-wins with other def_down sources by the engine (R8).
    // Gated by def_down immunity; persists (does not expire each turn).
    if (!bs.flags.laevateinn_sword_def_stack) bs.flags.laevateinn_sword_def_stack = 0;
    if (!bs.enemyImmune('def_down') && bs.flags.laevateinn_sword_def_stack < 0.30) {
      const nextStack = Math.min(bs.flags.laevateinn_sword_def_stack + 0.10, 0.30);
      // Route the increment through the normal debuff gate so Alan, Salakot Ward,
      // and mob immunities can stop it. The durable flag carries successful stacks.
      if (bs.applyDebuff('def_down', 1, nextStack)) {
        bs.flags.laevateinn_sword_def_stack = nextStack;
        bs.log.push(`⚔️ Laevateinn Sword: Sundering Flame — Enemy DEF reduced (total -${Math.round(nextStack * 100)}%)!`);
      }
    }
  },

  'jarngreipr': (bs) => {
    bs.playerAtkMult += 0.20;
    logOnce(bs, 'jarngreipr_base_logged',
      '⚡ Thunder Grip — outgoing damage +20%.');
    // The engine applies the +50% rider only when the attack really lands and its
    // Fighter stun succeeds after all immunity/evade checks.
    bs.flags.jarngreipr_on_stun = true;
  },

  'gridr_iron_gloves': (bs) => {
    bs.playerAtkMult += 0.20;
    bs.flags.gridr_ironhide_active = true;
    logOnce(bs, 'gridr_ironhide_logged',
      '🛡️ Ironhide — outgoing damage +20%; hit-ignore guard active.');
  },

  'alans_reversed_hands': (bs) => {
    bs.playerAtkMult += 0.20;
    bs.playerStatusImmune = true;
    bs.clearPlayerStatusEffects();
    logOnce(bs, 'alans_reversed_hands_logged',
      '✋ Untouchable — outgoing damage +20%; status immunity active.');
  },

  'knuckle_charm_anting_anting': (bs) => {
    bs.playerAtkMult += 0.10;
    logOnce(bs, 'death_charm_base_logged',
      '🔮 Death Charm — outgoing damage +10%; execute chance armed.');
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.05; });
    bs.onLandedHit(() => {
      if (!proc) return;
      if (bs.enemyImmune('boss_immune')) {
        bs.log.push('🚫 Death Charm has no effect on bosses.');
        return;
      }
      bs.flags.instakill_check = true;
    });
  },

  'laevateinn_staff': (bs) => {
    // Ignores 15% of enemy DEF. The engine applies/refreshes the 10% ATK Burn
    // for 2 turns after each landed hit, so a skipped/evaded attack cannot burn.
    if (0.15 > bs.ignoreDefPct) bs.ignoreDefPct = 0.15;
    bs.flags.laevateinn_staff_on_hit = true;
    logOnce(bs, 'laevateinn_staff_base_logged',
      '🔥 Flickering Flame — ignores 15% enemy DEF; Burn armed on hit.');
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DIVINE TIER — the five First Arms.
  // Tier above Supreme; weapon-only drops from the Divine Chest.
  // ─────────────────────────────────────────────────────────────────────────

  'kiri': (bs) => {
    // Thousand Partings — each ATTACK ramps damage +20% (cap +120%), and every
    // attack has a 25% chance to strike twice. Both are attack-bound so crowd
    // control cannot burn a stack or a double-strike roll on a skipped turn.
    bs.onAttack(() => {
      if (!bs.flags.kiri_stack) bs.flags.kiri_stack = 0;
      const previousStack = bs.flags.kiri_stack;
      if (bs.flags.kiri_stack < 1.20) {
        bs.flags.kiri_stack = Math.min(bs.flags.kiri_stack + 0.20, 1.20);
      }
      bs.playerAtkMult += bs.flags.kiri_stack;
      if (bs.flags.kiri_stack > previousStack) {
        bs.log.push(
          `🌫️ Kiri: Thousand Partings — Damage +20% (total +${Math.round(bs.flags.kiri_stack * 100)}%).`
        );
      }
      if (bs.rng() < 0.25) {
        bs.nextAttackDouble = true;
        bs.log.push('🌫️ Kiri: Thousand Partings — Double strike triggered!');
      }
    });
  },

  'moira': (bs) => {
    // Fate Ignores Iron — each landed attack applies enemy DEF -10%, stacking
    // to -50% (one def_down source, highest-wins per R8 and immunity-gated),
    // +50% armor pierce while the target's DEF is buffed (engine reads
    // moira_pierce_vs_def_buff at DEF time), and attacks cannot miss or be
    // evaded (engine reads attacks_cannot_miss).
    if (!bs.flags.moira_def_stack) bs.flags.moira_def_stack = 0;
    bs.onLandedHit(() => {
      if (!bs.enemyImmune('def_down') && bs.flags.moira_def_stack < 0.50) {
        const nextStack = Math.min(bs.flags.moira_def_stack + 0.10, 0.50);
        if (bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, nextStack)) {
          bs.flags.moira_def_stack = nextStack;
          bs.log.push(`🏹 Moira: Fate Ignores Iron — Enemy DEF reduced (total -${Math.round(nextStack * 100)}%)!`);
        }
      }
    }, LOG.STATUS);
    bs.flags.moira_pierce_vs_def_buff = true;
    if (!bs.flags.attacks_cannot_miss) {
      bs.log.push('🏹 Moira: Fate Ignores Iron — Every arrow was always meant to land.');
    }
    bs.flags.attacks_cannot_miss = true;
  },

  'sophia': (bs) => {
    // The Price of Knowing — +75% damage dealt and +20% damage taken; once the
    // wielder drops below 30% HP the bonus RISES TO +150% for the rest of the
    // battle (sticky, not additive with the base +75%).
    if (!bs.flags.sophia_passive_logged) {
      bs.flags.sophia_passive_logged = true;
      bs.log.push('📖 Sophia: The Price of Knowing — Damage +75%; damage taken +20%.');
    }
    if (bs.playerHP < bs.playerMaxHP * 0.30 && !bs.flags.sophia_awakened) {
      bs.flags.sophia_awakened = true;
      bs.log.push('📖 Sophia: The Price of Knowing — Reality relents; damage +150%!');
    }
    bs.playerAtkMult += bs.flags.sophia_awakened ? 1.50 : 0.75;
    bs.incomingDamageIncreasePct += 0.20;
  },

  'atlas': (bs) => {
    // Worldbreaker's Grip — +50% ATK, every 3rd round is a guaranteed critical
    // strike, and any critical strike cuts the enemy's ATK by 30% for 1 turn
    // (engine applies it on the landed crit via atlas_crit_atk_down).
    bs.playerAtkMult += 0.50;
    bs.flags.atlas_crit_atk_down = true;
    if (!bs.flags.atlas_passive_logged) {
      bs.flags.atlas_passive_logged = true;
      bs.log.push('🥊 Atlas: Worldbreaker\'s Grip — Base ATK +50%.');
    }
    if (bs.currentTurn % 3 === 0) {
      bs.nextAttackAutoCrit = true;
      bs.log.push('🥊 Atlas: Worldbreaker\'s Grip — The sky-bearing blow lands true!');
    }
  },

  'titan': (bs) => {
    // Forgefire Veins — heal 30% of damage dealt (50% while below 50% HP), and
    // once per battle survive fatal damage at 1 HP with +100% damage for the
    // rest of the battle. The engine reads titan_lifesteal_pct on every landed
    // hit and consumes titan_reprieve_available on the lethal blow.
    const lifestealPct = bs.playerHP < bs.playerMaxHP * 0.50 ? 0.50 : 0.30;
    if (bs.flags.titan_lifesteal_pct !== lifestealPct) {
      bs.log.push(
        `🔥 Titan: Forgefire Veins — Lifesteal ${Math.round(lifestealPct * 100)}%` +
        `${lifestealPct > 0.30 ? ' while below half HP' : ''}.`
      );
    }
    bs.flags.titan_lifesteal_pct = lifestealPct;
    if (!bs.flags.titan_reprieve_used) {
      bs.flags.titan_reprieve_available = true;
    }
    if (!bs.flags.titan_reprieve_logged && !bs.flags.titan_reprieve_used) {
      bs.flags.titan_reprieve_logged = true;
      bs.log.push('🔥 Titan: Forgefire Veins — Fatal reprieve armed.');
    }
    if (bs.flags.titan_atk_bonus > 0) bs.playerAtkMult += bs.flags.titan_atk_bonus;
  },

  'galdrastafir': (bs) => {
    // Runebreaker: +10% damage, and landed hits shred 20% enemy DEF for 1 turn.
    // The shared round lifecycle keeps this one-turn DEF shred active through the
    // attacker's next complete round; only the damage component was missing.
    bs.playerAtkMult += 0.10;
    logOnce(bs, 'galdrastafir_logged', '🔻 Runebreaker — outgoing damage +10%.');
    bs.onLandedHit(() => {
      if (!bs.enemyImmune('def_down')
          && bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.20)) {
        bs.log.push('🔻 Runebreaker — enemy DEF reduced by 20% for 1 turn.');
      }
    }, LOG.STATUS);
  },

  'babaylans_ritual_staff': (bs) => {
    const removedCount = bs.rng() < 0.50 ? bs.clearPlayerDebuffs() : 0;
    if (removedCount > 0) {
      bs.flags.babaylan_cleansed_this_turn = true;
      bs.playerAtkMult += 1.00;
      bs.log.push('🪄 Babaylan\'s Ritual Staff: Sacred Cleansing — Debuffs cleansed! ATK +100% this turn!');
    } else {
      bs.flags.babaylan_cleansed_this_turn = false;
    }
  },

  'badiang_stalk': (bs) => {
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.30; });
    bs.onLandedHit(() => {
      if (!proc) return;
      const bossBlocked = bs.enemyImmune('boss_immune');
      bs.flags.rupture_check = !bossBlocked;
      bs.flags.rupture_boss_blocked = bossBlocked;
      bs.flags.rupture_pct = 0.10;
      if (bossBlocked) return;
      // The marker carries the canonical bleed tag so Bloodhunter can detect
      // Rupture even when the target separately resists Venom.
      bs.applyDebuff('rupture', LANDED_STAT_DEBUFF_TURNS);
      bs.flags.venom_burst_applied = bs.applyDebuff(
        'venom',
        2,
        bs.playerATK * 0.10,
      );
    }, LOG.STATUS);
  },

  // ── WEAPON PASSIVES — Legendary Norse shields ───────────────────────────

  'shield_of_the_valkyrie': (bs) => {
    // Every individual hit received: reduction +5% and ATK +5%, stacking to 25%.
    if (!bs.flags.valkyrie_shield_dr) bs.flags.valkyrie_shield_dr = 0;
    if (!bs.flags.valkyrie_shield_atk) bs.flags.valkyrie_shield_atk = 0;
    bs.flags.valkyrie_resolve_active = true;
    bs.damageReductionPct += bs.flags.valkyrie_shield_dr;
    bs.playerAtkMult += bs.flags.valkyrie_shield_atk;
  },

  'skjaldmaer': (bs) => {
    bs.flags.skjaldmaer_active = true;
    bs.flags.skjaldmaer_reflect_pct = 0.20;
  },

  'luzon_tribal_shield': (bs) => {
    // While debuffed: DEF +45% until the final debuff is removed.
    bs.flags.tribal_ward_active = true;
    if (bs.hasPlayerDebuff('any')) {
      bs.playerDefMult += 0.45;
      bs.log.push('🪶 Tribal Ward — DEF +45% while debuffed.');
    }
  },

  'gusisnautar': (bs) => {
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.50; });
    bs.onLandedHit(() => {
      if (!proc) return;
      if (bs.enemyImmune('boss_immune')) {
        bs.log.push('🚫 Hemorrhaging Shot has no effect on bosses.');
        return;
      }
      bs.flags.hemorrhage_check = true;
      bs.flags.hemorrhage_pct = 0.05;
      bs.applyDebuff('hemorrhage', LANDED_STAT_DEBUFF_TURNS);
      bs.flags.hemorrhage_shredded = !bs.enemyImmune('def_down')
        && bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.15);
    }, LOG.STATUS);
  },

  'freyrs_arrow': (bs) => {
    bs.onAttack(() => {
      if (bs.allowAdditionalAttackProcs !== false && bs.rng() < 0.30) {
        bs.flags.auto_fire_shot = true;
      }
    });
  },

  // ── WEAPON PASSIVES — Legendary Greek ───────────────────────────────────

  'harpe': (bs) => {
    flatPierce(0.30)(bs);
    logOnce(bs, 'harpe_pierce_logged',
      '🗡️ Harpe: Gorgon Slayer — 30% of enemy DEF ignored.');
  },

  'sword_of_damocles': (bs) => {
    // ATK +5%/turn stacking to +100%; while any stacks are active, +10% damage taken
    if (!bs.flags.damocles_stack) bs.flags.damocles_stack = 0;
    const previous = bs.flags.damocles_stack;
    if (bs.flags.damocles_stack < 1.00) {
      bs.flags.damocles_stack = Math.min(bs.flags.damocles_stack + 0.05, 1.00);
    }
    bs.playerAtkMult += bs.flags.damocles_stack;
    if (bs.flags.damocles_stack > 0) bs.incomingDamageIncreasePct += 0.10;
    if (bs.flags.damocles_stack > previous) {
      const pct = Math.round(bs.flags.damocles_stack * 100);
      const stacks = Math.round(bs.flags.damocles_stack / 0.05);
      bs.log.push(
        `⚔️ Sword of Damocles: Impending Doom — ATK +${pct}% (${stacks}/20 stacks) · damage taken +10%.`
      );
    }
  },

  'labrys': (bs) => {
    // Every 3rd eligible turn, the primary attack queues one 70% ATK additional
    // strike. Generated attacks cannot re-arm Labrys.
    if (bs.currentTurn % 3 === 0) {
      bs.onAttack(() => {
        if (bs.allowAdditionalAttackProcs === false) return;
        bs.flags.labrys_double_hit = true;
        bs.flags.labrys_second_hit_pct = 0.70;
      });
    }
  },

  'hephaestus_hammer': (bs) => {
    // DEF +20% for the battle; every 4th actual attack gains the 150% ATK rider.
    bs.playerDefMult += 0.20;
    logOnce(bs, 'hephaestus_hammer_def_logged',
      '🔨 Hephaestus Hammer: Forged Armor — DEF +20% for the battle.');
    if (bs.currentTurn % 4 === 0) {
      bs.onAttack(() => {
        if (bs.isPrimaryAttack === false) return;
        bs.playerAtkMult += 1.50;
        bs.log.push('🔨 Hephaestus Hammer: Forged Armor — Forge Strike! +150% ATK!');
      });
    }
  },

  'caduceus': (bs) => {
    // Herald's Touch: +10% damage, incoming DOT reduced 10%.
    //
    // This REPLACES the previous every-3rd-turn cleanse + 8% max-HP heal outright. It
    // is a role change (sustain -> damage), not an addition, and is worth calling out
    // in patch notes for anyone who built around the cleanse.
    //
    // The bonus routes through playerAtkMult rather than damageBonusPct because
    // mitigation is linear in ATK (mitigated = atk * (1 - def/(def+K))), so +10% ATK is
    // exactly +10% damage. damageBonusPct instead lands inside the additive crit
    // multiplier and would not be a clean 10%.
    bs.playerAtkMult += 0.10;
    // Separate flag from rune_warding_pct: the rune runner overwrites that one every
    // round, so sharing it would make the two silently clobber each other.
    bs.flags.caduceus_dot_reduction = 0.10;
    logOnce(bs, 'caduceus_logged',
      '🐍 Herald\'s Touch — outgoing damage +10%; incoming damage-over-time -10%.');
  },

  'spear_of_ares': (bs) => {
    const previous = bs.flags.spear_of_ares_stacks || 0;
    const stacks = Math.min(previous + 1, 5);
    bs.flags.spear_of_ares_stacks = stacks;
    bs.playerAtkMult += stacks * 0.10;
    if (stacks > previous) {
      bs.log.push(`🔥 Bloodlust — ATK +${stacks * 10}% (${stacks} stacks)`);
    }
  },

  'helm_of_darkness': (bs) => {
    bs.flags.helm_darkness_active = true;
  },

  'aegis': (bs) => {
    if (!bs.flags.aegis_stacks) bs.flags.aegis_stacks = 0;
    bs.flags.aegis_active = true;
    // 10% per Stone stack. Effective maximum is 20%, not 30%: the third stack is
    // consumed by the Petrify and the accrued reduction is rolled back in the same
    // step (see grantAegisStone in battleEngine). That is deliberate — 30% stacking
    // reduction PLUS a Petrify would make Aegis strictly better than Mail of Brokkr's
    // flat 30%.
    bs.damageReductionPct += bs.flags.aegis_stacks * AEGIS_DR_PER_STACK;
  },

  'apollos_silver_bow': (bs) => {
    // Ignores 25% DEF; every 3rd ATTACK TURN is a guaranteed CRIT.
    //
    // "Every 3rd turn" counts the WIELDER'S OWN attack turns, not the round clock, so
    // the counter lives in an onAttack hook rather than testing bs.currentTurn. Those
    // hooks fire only when an attack really begins, which means a turn lost to stun,
    // freeze or any other skip does NOT burn a count — the third actual swing crits,
    // whenever it happens. This makes Apollo the only turn-cycle weapon off the shared
    // round clock (mjolnir and trident_of_poseidon still use bs.currentTurn).
    //
    // bs.flags is recreated per battle by initSide, so the counter resets each battle
    // with no explicit teardown.
    if (0.25 > bs.ignoreDefPct) bs.ignoreDefPct = 0.25;
    logOnce(bs, 'apollos_silver_bow_pierce_logged',
      '🏹 Apollo\'s Silver Bow: Unerring Arrow — 25% of enemy DEF ignored.');
    bs.onAttack(() => {
      // Additional attacks ride along on the primary's turn and must not advance it.
      if (bs.isPrimaryAttack === false) return;
      bs.flags.apollo_attack_turns = (bs.flags.apollo_attack_turns || 0) + 1;
      if (bs.flags.apollo_attack_turns % 3 === 0) {
        bs.nextAttackAutoCrit = true;
        bs.log.push('🏹 Apollo\'s Silver Bow: Unerring Arrow — Guaranteed CRIT!');
      }
    });
  },

  // ── WEAPON PASSIVES — Supreme ────────────────────────────────────────────

  'mjolnir': (bs) => {
    // Actual attacks gain +30%; the every-3rd-turn +200% rider belongs only to
    // that turn's primary attack and is not repeated by additional attacks.
    bs.onAttack(() => {
      bs.playerAtkMult += 0.30;
      if (bs.currentTurn % 3 === 0 && bs.isPrimaryAttack !== false) {
        bs.playerAtkMult += 2.00;
        bs.log.push('⚡ Mjolnir: Crushing Force — CRUSH! +200% ATK!');
      } else {
        bs.log.push('⚡ Mjolnir: Crushing Force — +30% ATK bonus!');
      }
    });
  },

  'gungnir': (bs) => {
    // Ignores 30% DEF; each actual attack has a separate 10% full-pierce roll. The two
    // are independent rolls and full-pierce SUPERSEDES rather than stacks — the engine
    // zeroes DEF entirely on a pierce, so the 30% is simply not consulted.
    if (0.30 > bs.ignoreDefPct) bs.ignoreDefPct = 0.30;
    logOnce(bs, 'gungnir_pierce_logged',
      '🏹 Gungnir: Never Misses — 30% of enemy DEF ignored.');
    bs.onAttack(() => {
      bs.flags.gungnir_full_pierce = bs.rng() < 0.10;
      if (bs.flags.gungnir_full_pierce) {
        bs.log.push('🏹 Gungnir: Never Misses — ALL DEF PIERCED!');
      }
    });
  },

  'thunderbolt_of_zeus': (bs) => {
    // The engine evaluates the final landed crit (including guaranteed crits and evasion)
    // so the damage rider and Paralyze cannot trigger from a pre-roll alone.
    bs.flags.thunderbolt_on_crit = true;
  },

  'trident_of_poseidon': (bs) => {
    // [Jun-2026 §4] Every 2nd actual attack: +100%; landed hit rolls 30% stun
    // and applies DEF -20% for 1 turn.
    if (bs.currentTurn % 2 === 0) {
      let stunProc = false;
      bs.onAttack(() => {
        if (bs.isPrimaryAttack === false) return;
        bs.playerAtkMult += 1.00;
        stunProc = bs.rng() < 0.30;
        bs.log.push('🔱 Trident of Poseidon: Tidal Wrath — +100% ATK!');
      });
      bs.onLandedHit(() => {
        if (bs.isPrimaryAttack === false) return;
        const stunned = stunProc
          && !bs.enemyImmune('stun')
          && bs.applyDebuff('stun', 1);
        const shredded = !bs.enemyImmune('def_down')
          && bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.20);
        if (stunned) bs.log.push('🔱 Trident of Poseidon: Enemy Stunned!');
        if (shredded) bs.log.push('🔱 Trident of Poseidon: Enemy DEF -20%!');
      }, LOG.STATUS);
    }
  },

  // ── ARMOR PASSIVES — v5 (defensive; fire alongside weapon/deity each round) ─
  // Mapped from credd_v5_new_armor_passives.js placeholder API → this engine's
  // real bs model (flags + scratch mults). aegis / helm_of_darkness already live
  // in the weapon section above (shared keys, updated for their Supreme armor form).

  // Kalasag — Bulwark Hide: incoming damage −3% (additive incoming lane, post-DEF).
  'kalasag': (bs) => {
    constantSelfBuff(0, 0, -0.03)(bs);
    logOnce(bs, 'kalasag_logged',
      '🛡️ Kalasag: Bulwark Hide — damage taken reduced by 3%.');
  },

  'hoplite_panoply': (bs) => {
    bs.damageReductionPct += 0.20;
    bs.flags.phalanx_wall_active = true;
    // No round-phase log here. Phalanx Wall is a DEFENSIVE REACTION, so the engine
    // reports it once per incoming hit from the defender stack (battleEngine's
    // applyHitToDefender) — 50% on the first hit (this 20% + the 30% first-hit bonus),
    // 20% on every hit after. Announcing it here as well printed both lines for the
    // same first attack.
  },

  'mail_of_brokkr': (bs) => {
    bs.damageReductionPct += 0.30;
    bs.flags.mail_brokkr_reflect = 0.20;
    bs.flags.mail_brokkr_hit_cap = 0.15;
    logOnce(bs, 'mail_of_brokkr_logged',
      '⚒️ Dwarven Forge — 30% reduction · 20% reflect · 15% max-HP hit cap.');
  },

  'wolfskin_cloak': (bs) => {
    const pct = bs.playerHP < bs.playerMaxHP * 0.50 ? 0.06 : 0.03;
    const before = bs.playerHP;
    bs.playerHP = Math.min(bs.playerHP + Math.floor(bs.playerMaxHP * pct), bs.playerMaxHP);
    bs.log.push(`🐺 Wolf's Vigor — restored ${bs.playerHP - before} HP.`);
  },

  // Salakot Ward — Spirit Ward: 20% chance to negate an incoming debuff. The roll
  // happens in the engine's addDebuff() at apply-time (see battleEngine §13.1 hook).
  'salakot_ward': (bs) => {
    bs.flags.salakot_negate_chance = 0.35;
  },

  'anting_anting_sash': (bs) => {
    bs.damageReductionPct += 0.10;
    bs.flags.charmed_hide_active = true;
    logOnce(bs, 'anting_anting_sash_logged',
      '🪬 Charmed Hide — damage taken reduced by 10%; first crowd-control nullified.');
  },

  'valkyrie_mantle': (bs) => {
    bs.flags.chooser_grace_active = true;
    if (!Number.isFinite(bs.flags.chooser_grace_chance)) {
      bs.flags.chooser_grace_chance = 0.22;
    }
  },

  'mantle_of_bathala': (bs) => {
    const stacks = Math.min((bs.flags.mantle_bathala_stacks || 0) + 1, 5);
    bs.flags.mantle_bathala_stacks = stacks;
    bs.flags.bathala_hp_fraction = stacks * 0.06;
    bs.damageReductionPct += stacks * 0.04;
    bs.flags.mantle_bathala_heal_pct = stacks === 5 ? 0.08 : 0;
    bs.log.push(`✨ Divine Aegis — +${stacks * 6}% max HP · ${stacks * 4}% reduction (${stacks}/5)`);
  },

  // ── DEITY BLESSINGS — Philippine ─────────────────────────────────────────

  'bathala_divine_vessel': (bs) => {
    if (!bs.flags.bathala_stacks) bs.flags.bathala_stacks = 0;
    if (bs.flags.bathala_stacks < 10) bs.flags.bathala_stacks += 1;
    const atkPct = 0.10 * bs.flags.bathala_stacks;
    const defPct = 0.04 * bs.flags.bathala_stacks;
    bs.playerAtkMult += atkPct;
    bs.playerDefMult += defPct;
    bs.log.push(`🌅 Bathala: Divine Vessel — Divine ramp +${Math.round(atkPct * 100)}% ATK / +${Math.round(defPct * 100)}% DEF!`);
  },

  'sidapa_deaths_reprieve': (bs) => {
    // Once per battle: survive lethal damage at 1 HP (engine consumes on lethal hit),
    // then heal 30% max HP and gain +50% ATK for the rest of the battle. The engine sets
    // sidapa_atk_bonus on the reprieve; fold it into effATK here each subsequent round.
    if (!bs.flags.sidapa_reprieve_used) {
      bs.flags.sidapa_reprieve_available = true;
    }
    if (bs.flags.sidapa_atk_bonus > 0) bs.playerAtkMult += bs.flags.sidapa_atk_bonus;
  },

  'magwayen_soul_drain': (bs) => {
    bs.flags.soul_drain_pct = Math.max(bs.flags.soul_drain_pct || 0, 0.30);
  },

  'mandarangan_war_frenzy': (bs) => {
    // Earn +10% at each turn end. The first attack is unbuffed; after turn 5 the
    // persistent stack has reached +50% and is visible from turn 6 onward.
    const stacks = Math.min(Math.max(bs.currentTurn - 1, 0), 5);
    bs.playerAtkMult += stacks * 0.10;
  },

  'apolaki_solar_burn': apolakiSolarBurn,

  'mayari_lunar_veil': (bs) => {
    // While HP < 50%: DEF +30% and reflect 15% of incoming damage (engine reads mayari_reflect).
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerDefMult += 0.30;
      bs.flags.mayari_reflect = 0.15;
    } else {
      bs.flags.mayari_reflect = 0;
    }
  },

  'dian_masalanta_devotion': (bs) => {
    // While HP < 50%: ATK +30% and heal 4% max HP each turn
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerAtkMult += 0.30;
      const heal = Math.floor(bs.playerMaxHP * 0.04);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`💖 Dian Masalanta: Devotion — ATK +30%, regenerated ${heal} HP!`);
    }
  },

  'amihan_tailwind': (bs) => {
    // 20% evade. [v5] Registers its chance into the shared evade budget so the
    // armor evade (valkyrie_mantle) capping at 40% total can see it. One rng draw
    // (unchanged from the old chanceFlag — draw order is stable).
    bs.flags.evade_chance_used = (bs.flags.evade_chance_used || 0) + 0.20;
    bs.flags.amihan_evade_check = bs.rng() < 0.20;
    // The engine records each actual evade and consumes all +20% stacks on her next
    // real attack, including one later in this same round.
  },

  'habagat_monsoon_fury': chanceRider(0.25, 0.50,
    '🌩️ Habagat: Monsoon Fury — Storm Strike! +50% ATK!'),

  'lakapati_abundance': regenSelf(1, 0.03,
    (heal) => `🌱 Lakapati: Abundance — Regenerated ${heal} HP!`),

  'idiyanale_persistence': (bs) => {
    // Every 3rd turn arms +75% for the next actual attack. It remains queued through CC.
    if (bs.currentTurn % 3 === 0 && !bs.flags.idiyanale_attack_bonus_pending) {
      bs.flags.idiyanale_attack_bonus_pending = 0.75;
      bs.log.push('⚙️ Idiyanale: Persistence — Next attack +75% damage!');
    }
  },

  // ── DEITY BLESSINGS — Norse ──────────────────────────────────────────────

  'odin_all_fathers_wisdom': (bs) => {
    bs.playerAtkMult += 0.50;
    // Even turns prevent 25%; the immediately following odd-turn attack consumes it.
    if (bs.currentTurn % 2 === 0) {
      bs.flags.odin_foresight_block = true;
      bs.flags.odin_foresight_bonus = 0;
    } else {
      bs.flags.odin_foresight_block = false;
      bs.flags.odin_foresight_bonus = Math.max(0, Math.floor(bs.flags.odin_prevented_damage || 0));
      bs.flags.odin_prevented_damage = 0;
    }
  },

  'thor_mjolnirs_wrath': (bs) => {
    // The engine rolls 30% after each landed attack, then applies Stun + 3-turn
    // Paralyze (20% base ATK DOT, 10% action-skip roll). No attack means no proc.
    bs.flags.thor_on_hit = true;
  },

  'freya_valkyries_embrace': (bs) => {
    // ATK +30% whole battle; once/battle at ≤40% HP: restore 20% max HP
    bs.playerAtkMult += 0.30;
    if (!bs.flags.freya_embrace_used && bs.playerHP <= bs.playerMaxHP * 0.40) {
      bs.flags.freya_embrace_used = true;
      const heal = Math.floor(bs.playerMaxHP * 0.20);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🌸 Freya: Valkyrie's Embrace — ATK +30%! Healed ${heal} HP!`);
    }
  },

  'loki_illusory_double': (bs) => {
    // 25% chance each turn: evade one attack and counter for 100% base ATK (rider).
    // [v5] Registers its chance into the shared evade budget (40% total cap).
    bs.flags.evade_chance_used = (bs.flags.evade_chance_used || 0) + 0.25;
    bs.flags.loki_evade_check = bs.rng() < 0.25;
    if (bs.flags.loki_evade_check) {
      bs.flags.loki_counter_dmg = Math.floor(bs.playerATK);
    }
  },

  'tyr_oathkeeper': (bs) => {
    // DEF +30% all battle; while HP < 50%, reflect 20% of incoming
    bs.playerDefMult += 0.30;
    bs.flags.tyr_reflect = bs.playerHP < bs.playerMaxHP * 0.50 ? 0.20 : 0;
  },

  'skadi_winters_hunt': (bs) => {
    // The engine rolls 30% after each landed attack. Freeze gates the next action;
    // when it expires the engine applies one turn of +50% Frostbite damage taken.
    bs.flags.skadi_on_hit = true;
  },

  'surt_muspells_flame': surtMuspellsFlame,

  'heimdall_eternal_vigilance': (bs) => {
    // First hit taken each battle negated by 50% — engine consumes on that hit. Afterward,
    // incoming critical hits are reduced by 30% for the rest of the battle (engine reads
    // heimdall_crit_guard once the first hit is spent).
    if (!bs.flags.heimdall_first_hit_used) {
      bs.flags.heimdall_first_hit_available = true;
    }
    bs.flags.heimdall_crit_guard = true;
  },

  'baldur_invulnerability': (bs) => {
    // Once/battle, first turn debuffed OR strictly below 50% HP: cleanse, heal 15% max HP,
    // and reduce damage taken by 50% for 1 turn.
    if (!bs.flags.baldur_used &&
        (bs.hasPlayerDebuff('any') || bs.playerHP < bs.playerMaxHP * 0.50)) {
      bs.flags.baldur_used = true;
      bs.clearPlayerDebuffs();
      const heal = Math.floor(bs.playerMaxHP * 0.15);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.flags.baldur_dr_turns = 1;
      bs.log.push(`✨ Baldur: Invulnerability — Debuffs cleansed! Healed ${heal} HP! 50% damage reduction!`);
    }
    if (bs.flags.baldur_dr_turns > 0) {
      bs.damageReductionPct += 0.50;
      bs.flags.baldur_dr_turns -= 1;
    }
  },

  'hel_half_dead': hpThresholdBuff(0.50, 0.30, 0.30),

  'mimir_runic_knowledge': (bs) => {
    // Every 3rd turn arms +90% for the next actual attack; CC cannot consume it.
    if (bs.currentTurn % 3 === 0 && !bs.flags.mimir_attack_bonus_pending) {
      bs.flags.mimir_attack_bonus_pending = 0.90;
      bs.log.push('📖 Mimir: Runic Knowledge — Next attack +90% damage!');
    }
  },

  'freyr_harvest_bounty': regenSelf(2, 0.06,
    (heal) => `🌾 Freyr: Harvest Bounty — Restored ${heal} HP!`),

  'njord_seas_favor': chanceFlag(0.15, 'njord_block_check', null,
    (bs) => { bs.flags.njord_block_pct = 0.30; }),

  'bragi_battle_hymn': constantSelfBuff(0.15, 0, 0), // ATK +15% for the whole battle

  'idunn_golden_apple': oncePerBattleHeal('idunn_used', 0.50, 0.15,
    (heal) => `🍎 Idunn: Golden Apple — Restored ${heal} HP!`, true),

  'vidar_silent_vengeance': (bs) => {
    // Received-crit and first-below-50 triggers queue one guaranteed next attack.
    // The engine consumes the queue only when an attack actually starts.
    if (bs.flags.player_was_critted) {
      if (!bs.flags.vidar_crit_latch_handled && !bs.flags.vidar_auto_crit_pending) {
        bs.flags.vidar_auto_crit_pending = true;
        bs.log.push('⚔️ Vidar: Silent Vengeance — Auto-CRIT next attack!');
      }
      bs.flags.vidar_crit_latch_handled = false;
    }
    if (!bs.flags.vidar_low_hp_used && bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.flags.vidar_low_hp_used = true;
      bs.flags.vidar_auto_crit_pending = true;
      bs.log.push('⚔️ Vidar: Silent Vengeance — Wounded! Guaranteed CRIT!');
    }
  },

  'magni_might_of_magni': (bs) => {
    // ATK +5% per 10% max HP lost, capped at 25%
    const hpLostPct = (bs.playerMaxHP - bs.playerHP) / bs.playerMaxHP;
    const stacks = Math.min(Math.floor(hpLostPct / 0.10), 5);
    if (stacks > 0) {
      bs.playerAtkMult += stacks * 0.05;
    }
  },

  // ── DEITY BLESSINGS — Greek ──────────────────────────────────────────────

  // Constant +50% ATK; Chain Lightning can add another +50% and a persistent DEF shred.
  'zeus_thunder_sovereign': (bs) => {
    bs.playerAtkMult += 0.50;
    let proc = false;
    bs.onAttack(() => {
      proc = bs.rng() < 0.50;
      if (proc) bs.playerAtkMult += 0.50;
    });
    bs.onLandedHit(() => {
      if (proc) bs.log.push('⚡ Zeus: Chain Lightning — +50% damage!');
    });
    bs.onLandedHit(() => {
      if (!proc) return;
      if (bs.enemyImmune('def_down')) {
        bs.log.push('⚡ Zeus: Chain Lightning — Enemy resisted DEF shred.');
        return;
      }
      bs.flags.zeus_def_shred_stacks = Math.min(
        6,
        (bs.flags.zeus_def_shred_stacks || 0) + 1,
      );
      const shred = bs.flags.zeus_def_shred_stacks * 5;
      bs.log.push(`⚡ Zeus: Chain Lightning — Enemy DEF -${shred}%!`);
    }, LOG.STATUS);
  },

  'ares_blood_frenzy': (bs) => {
    // Earn +10% at each turn end, cap +50%; apply stacks earned on prior turns.
    delayedStackingAtk(
      'ares_blood_frenzy_stack',
      0.10,
      0.50,
      bloodFrenzyLabel('Ares'),
    )(bs);
  },

  'poseidon_tidal_force': (bs) => {
    // The engine rolls 30% after each landed attack. Stun cannot refresh; the
    // 30% DEF shred lasts 2 turns and refreshes (highest-value), never stacks.
    bs.flags.poseidon_on_hit = true;
  },

  'hades_soul_harvest': (bs) => {
    // When enemy HP < 30% (live %, shared pool % for bosses): ATK +50% latched
    if (bs.enemyHP / bs.enemyMaxHP < 0.30) {
      bs.flags.hades_harvest_active = true;
    }
    if (bs.flags.hades_harvest_active) {
      bs.playerAtkMult += 0.50;
      if (!bs.flags.hades_harvest_logged) {
        bs.flags.hades_harvest_logged = true;
        bs.log.push('💀 Hades: Soul Harvest — Enemy HP critical! ATK +50% for battle!');
      }
    }
  },

  'hera_divine_wrath': (bs) => {
    // DEF +30% whole battle; each received crit grants ATK +10%, stacking up to 3×.
    bs.playerDefMult += 0.30;
    if (!bs.flags.hera_stacks) bs.flags.hera_stacks = 0;
    const receivedCrits = Math.max(0, Number(bs.flags.player_crits_received) || 0);
    const gained = Math.min(receivedCrits, 3 - bs.flags.hera_stacks);
    if (gained > 0) {
      bs.flags.hera_stacks += gained;
      bs.log.push(`👑 Hera: Divine Wrath — ${gained} crit${gained === 1 ? '' : 's'} received! ATK stack ${bs.flags.hera_stacks}/3!`);
    }
    if (bs.flags.hera_stacks > 0) {
      bs.playerAtkMult += bs.flags.hera_stacks * 0.10;
    }
  },

  'athena_aegis_shield': (bs) => {
    // First 2 hits received reduced 40% — engine owns the absorb counter (cap 2).
    // The engine applies the permanent 10% reduction immediately from hit 3 onward.
    if (!bs.flags.athena_hits_absorbed) bs.flags.athena_hits_absorbed = 0;
    bs.flags.athena_shield_active = bs.flags.athena_hits_absorbed < 2;
  },

  'apollo_solar_radiance': constantSelfBuff(0.25, 0, 0),

  'artemis_huntress_precision': (bs) => {
    // First actual attack auto-crits; afterward every 3rd turn queues an auto-crit.
    // A skipped turn leaves the guarantee pending.
    if (!bs.flags.artemis_first_used && !bs.flags.artemis_auto_crit_pending) {
      bs.flags.artemis_auto_crit_pending = true;
      bs.flags.artemis_first_attack_pending = true;
      bs.log.push('🏹 Artemis: Huntress Precision — First attack auto-CRIT!');
    } else if (bs.flags.artemis_first_used && bs.currentTurn % 3 === 0 && !bs.flags.artemis_auto_crit_pending) {
      bs.flags.artemis_auto_crit_pending = true;
      bs.log.push('🏹 Artemis: Huntress Precision — Auto-CRIT this turn!');
    }
  },

  'hephaestus_forged_armor': (bs) => {
    // DEF +25% all battle; HP < 50%: ATK +20%
    bs.playerDefMult += 0.25;
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerAtkMult += 0.20;
    }
  },

  'aphrodite_enchanting_aura': (bs) => {
    // 25% chance each turn to charm the enemy (skips its attack via the debuff)
    const proc = bs.rng() < 0.25;
    bs.flags.aphrodite_charm_check = false;
    if (proc && !bs.enemyImmune('charm') && bs.applyDebuff('charm', 1)) {
      bs.flags.aphrodite_charm_check = true;
      bs.log.push('💗 Aphrodite: Enchanting Aura — Enemy charmed! Skips attack!');
    }
  },

  'persephone_cycle_of_renewal': oncePerBattleHeal('persephone_used', 0.50, 0.15,
    (heal) => `🌸 Persephone: Cycle of Renewal — Restored ${heal} HP!`),

  'dionysus_drunken_haze': (bs) => {
    // 30% chance each turn: enemy attacks itself (30% of its own ATK)
    if (bs.rng() < 0.30) {
      const selfDmg = Math.floor(bs.enemyATK * 0.30);
      bs.enemyHP = Math.max(bs.enemyHP - selfDmg, 0);
      bs.log.push(`🍷 Dionysus: Drunken Haze — Enemy attacks itself! ${selfDmg} DMG!`);
    }
  },

  'nike_wings_of_victory': constantSelfBuff(0.15, 0, 0),

  // ── ECHO BLESSINGS — Greek ──────────────────────────────────────────────

  'echo_nike': constantSelfBuff(0.12, 0, 0),

  'echo_persephone': regenSelf(3, 0.03,
    (heal) => `🌸 Echo · Persephone: Renewal — Regenerated ${heal} HP!`),

  'echo_hades': (bs) => {
    if (bs.enemyHP / bs.enemyMaxHP < 0.30) {
      bs.playerAtkMult += 0.15;
      if (!bs.flags.echo_hades_logged) {
        bs.flags.echo_hades_logged = true;
        bs.log.push('💀 Echo · Hades: Soul Harvest — Enemy HP critical! ATK +15%!');
      }
    }
  },

  'echo_hera': (bs) => {
    if (bs.flags.player_was_critted && !bs.flags.echo_hera_active) {
      bs.flags.echo_hera_active = 2;
      bs.log.push('👑 Echo · Hera: Divine Wrath — Critted! DEF +15% for 2 turns!');
    }
    if (bs.flags.echo_hera_active > 0) {
      bs.playerDefMult += 0.15;
      bs.flags.echo_hera_active -= 1;
    }
  },

  'echo_ares': delayedStackingAtk(
    'ares_blood_frenzy_stack',
    0.10,
    0.50,
    bloodFrenzyLabel('Echo · Ares'),
  ),

  'echo_hephaestus': constantSelfBuff(0, 0.15, 0),

  'echo_apollo': constantSelfBuff(0.10, 0, 0),

  // ── ECHO BLESSINGS — Norse ──────────────────────────────────────────────

  'echo_bragi': (bs) => {
    if (bs.currentTurn % 4 === 0) {
      bs.flags.echo_bragi_buff = 1;
      bs.log.push('🎵 Echo · Bragi: Battle Hymn — ATK +10% this turn!');
    }
    if (bs.flags.echo_bragi_buff > 0) {
      bs.playerAtkMult += 0.10;
      bs.flags.echo_bragi_buff -= 1;
    }
  },

  'echo_idunn': regenSelf(2, 0.02,
    (heal) => `🍎 Echo · Idunn: Golden Apple — Regenerated ${heal} HP!`),

  'echo_freyr': regenSelf(3, 0.03,
    (heal) => `🌾 Echo · Freyr: Harvest Bounty — Regenerated ${heal} HP!`),

  'echo_vidar': (bs) => {
    if (bs.flags.player_was_critted) {
      if (!bs.flags.echo_vidar_crit_latch_handled && !bs.flags.echo_vidar_revenge_pending) {
        bs.flags.echo_vidar_revenge_pending = true;
        bs.log.push('⚔️ Echo · Vidar: Silent Vengeance — Next attack +30% ATK!');
      }
      bs.flags.echo_vidar_crit_latch_handled = false;
    }
    bs.onAttack(() => {
      if (!bs.flags.echo_vidar_revenge_pending) return;
      bs.flags.echo_vidar_revenge_pending = false;
      bs.playerAtkMult += 0.30;
    });
  },

  'echo_magni': (bs) => {
    const hpLostPct = (bs.playerMaxHP - bs.playerHP) / bs.playerMaxHP;
    const stacks = Math.min(Math.floor(hpLostPct / 0.10), 5);
    if (stacks > 0) bs.playerAtkMult += stacks * 0.03;
  },

  'echo_njord': chanceFlag(0.10, 'echo_njord_block_check', null,
    (bs) => { bs.flags.echo_njord_block_pct = 0.20; }),

  'echo_freya': hpThresholdBuff(0.40, 0, 0.20),

  'echo_tyr': constantSelfBuff(0, 0.10, 0),

  'echo_surt': surtMuspellsFlame,

  'echo_hel': hpThresholdBuff(0.50, 0.08, 0.08),

  'echo_mimir': everyNthRider(5, 0.30, '📖 Echo · Mimir: Runic Knowledge — +30% ATK this turn!'),

  // ── ECHO BLESSINGS — Philippine ─────────────────────────────────────────

  'echo_idiyanale': (bs) => {
    if (bs.currentTurn % 6 === 0 && !bs.flags.echo_idiyanale_double_pending) {
      bs.flags.echo_idiyanale_double_pending = true;
      bs.log.push('⚙️ Echo · Idiyanale: Persistence — Next attack deals double damage!');
    }
    bs.onAttack(() => {
      if (!bs.flags.echo_idiyanale_double_pending) return;
      bs.flags.echo_idiyanale_double_pending = false;
      bs.nextAttackDouble = true;
    });
  },

  'echo_lakapati': regenSelf(1, 0.02,
    (heal) => `🌱 Echo · Lakapati: Abundance — Regenerated ${heal} HP!`),

  'echo_habagat': attackChanceRider(0.15, 0.30,
    '🌩️ Echo · Habagat: Monsoon Fury — +30% ATK!'),

  'echo_mandarangan': (bs) => {
    const stacks = Math.min(bs.currentTurn, 3);
    bs.playerAtkMult += stacks * 0.05;
  },

  'echo_magwayen': (bs) => {
    bs.flags.soul_drain_pct = Math.max(bs.flags.soul_drain_pct || 0, 0.30);
  },

  'echo_dian_masalanta': hpThresholdBuff(0.30, 0.12, 0),

  'echo_mayari': hpThresholdBuff(0.50, 0, 0.15),

  'echo_apolaki': apolakiSolarBurn,

  // ── MOB / BOSS SKILLS — Philippine ───────────────────────────────────────

  'dwende_black_hex': chancePlayerDebuff(0.25,
    [{ tag: 'atk_down', turns: 1, value: 0.15 }],
    '👺 Black Duwende: Hex — Your ATK -15% for 1 turn!'),

  'dwende_white_daze': chancePlayerDebuff(0.20,
    [{ tag: 'crit_down', turns: 1, value: 0.50 }],
    '👺 White Duwende: Daze — Your CRIT -50% for 1 turn!'),

  'amalanhig_infectious_bite': chanceEnemyLandedHitPlayerDebuff(0.30,
    [{ tag: 'hp_pct_dot', turns: 2, value: 0.05 }],
    '🧟 Amalanhig: Infectious Bite — Rot! 5% max HP/turn for 2 turns!'),

  'amomongo_rend': everyNthEnemyNuke(3, 1.50, '🦍 Amomongo: Rend — 150% ATK!'),

  'bal_bal_carrion_sense': (bs) => {
    // When player HP < 30%: enemy ATK +20% (per-round derived flag)
    if (bs.playerHP < bs.playerMaxHP * 0.30) {
      bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * 1.20;
      bs.log.push('💀 Bal-Bal: Carrion Sense — Player HP critical! Enemy ATK +20%!');
    }
  },

  'santelmo_will_o_wisp': chancePlayerDebuff(0.20,
    [{ tag: 'miss', turns: 1 }],
    '🔥 Santelmo: Will-o-Wisp — You will skip your next attack!'),

  'manananggal_viscera_drain': (bs) => {
    // Every 3 turns: drain 15% of player max HP and heal self
    if (bs.currentTurn % 3 === 0) {
      const drain = Math.floor(bs.playerMaxHP * 0.15);
      bs.playerHP = Math.max(bs.playerHP - drain, 0);
      bs.enemyHP = Math.min(bs.enemyHP + drain, bs.enemyMaxHP);
      bs.log.push(`🧛 Manananggal: Viscera Drain — Drained ${drain} HP from you!`);
    }
  },

  'aswang_shape_shift': (bs) => {
    // Every 4 turns: copy player current ATK for 2 turns
    if (bs.currentTurn % 4 === 0) {
      bs.flags.aswang_copied_atk = bs.playerATK;
      bs.flags.aswang_copy_turns = 2;
      bs.log.push(`👻 Aswang: Shape Shift — Copies your ATK (${bs.playerATK}) for 2 turns!`);
    }
    if (bs.flags.aswang_copy_turns > 0) {
      bs.flags.enemy_atk_override = bs.flags.aswang_copied_atk;
      bs.flags.aswang_copy_turns -= 1;
    } else {
      bs.flags.enemy_atk_override = null;
    }
  },

  'tikbalang_disorientation': everyNthPlayerDebuff(3,
    [{ tag: 'atk_down', turns: 1, value: 0.20 }],
    '🐴 Tikbalang: Disorientation — Your ATK -20% for 1 turn!'),

  'kapre_smoke_cloud': everyNthPlayerDebuff(4,
    [{ tag: 'crit_down', turns: 1, value: 0.30 }, { tag: 'atk_down', turns: 1, value: 0.10 }],
    '💨 Kapre: Smoke Cloud — Your CRIT -30%, ATK -10% for 1 turn!'),

  'sigbin_shadow_step': (bs) => {
    // Defer the event until hit resolution so Moira's no-miss property can
    // suppress both the evade and its log without suppressing absolute absorbs.
    bs.flags.sigbin_evade_check = bs.rng() < 0.20;
  },

  'batibat_sleep_paralysis': everyNthPlayerDebuff(4,
    [{ tag: 'paralyze', turns: 1 }],
    '👹 Batibat: Sleep Paralysis — You are paralyzed! Skip next turn!'),

  // ── MOB / BOSS SKILLS — Norse ────────────────────────────────────────────

  'troll_regeneration': regenEnemy(1, 0.05,
    (heal) => `🧌 Troll: Regeneration — Recovered ${heal} HP!`),

  'dwarves_stone_skin': (bs) => {
    // Every 4 turns: absorb the next player hit up to 20% max HP (engine consumes)
    if (bs.currentTurn % 4 === 0) {
      bs.flags.dwarf_shield_active = true;
      bs.flags.dwarf_shield_cap = Math.floor(bs.enemyMaxHP * 0.20);
      bs.log.push('⛏️ Dwarf: Stone Skin — Absorbing next hit (up to 20% max HP)!');
    }
  },

  'dark_elves_curse_of_decay': chanceEnemyLandedHitPlayerDebuff(0.25,
    [{ tag: 'def_down', turns: LANDED_STAT_DEBUFF_TURNS, value: 0.10 }],
    '🧝 Dark Elf: Curse of Decay — Your DEF -10% for 1 turn!'),

  'light_elves_radiant_strike': chancePlayerDebuff(0.20,
    [{ tag: 'crit_down', turns: 1, value: 1.00 }],
    '✨ Light Elf: Radiant Strike — Blinded! Your CRIT is 0% for 1 turn!'),

  'ratatoskr_slander': everyNthPlayerDebuff(3,
    [{ tag: 'atk_down', turns: 1, value: 0.20 }],
    '🐿️ Ratatoskr: Slander — Your ATK -20% for 1 turn!'),

  'fossegrim_enchanting_melody': everyNthPlayerDebuff(4,
    [{ tag: 'miss', turns: 1 }],
    '🎻 Fossegrim: Enchanting Melody — You will skip your next turn!'),

  'nokken_luring_form': everyNthPlayerDebuff(3,
    [{ tag: 'def_down', turns: 1, value: 0.20 }],
    '🌊 Nokken: Luring Form — Your DEF -20% for 1 turn!'),

  'valkyrie_battle_judgment': everyNthEnemyNuke(4, 2.00,
    '⚔️ Valkyrie: Battle Judgment — Next attack 200% ATK!'),

  // ── MOB / BOSS SKILLS — Greek ────────────────────────────────────────────

  'satyr_wild_revelry': chancePlayerDebuff(0.25,
    [{ tag: 'atk_down', turns: 1, value: 0.15 }],
    '🐐 Satyr: Wild Revelry — Your ATK -15% for 1 turn!'),

  'harpy_swooping_talons': everyNthEnemyNuke(3, 1.50,
    '🦅 Harpy: Swooping Talons — 150% ATK!',
    (bs) => {
      if (bs.applyPlayerDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.10)) {
        bs.log.push('🦅 Harpy: Swooping Talons — Your DEF -10% for 1 turn!');
      }
    }),

  'skeleton_warrior_undying_resolve': (bs) => {
    // Enemy HP < 30%: DEF +25% for the remainder of battle (latched)
    if (bs.enemyHP < bs.enemyMaxHP * 0.30) {
      bs.flags.skeleton_resolve_active = true;
    }
    if (bs.flags.skeleton_resolve_active) {
      bs.flags.enemy_def_mult = (bs.flags.enemy_def_mult || 1.0) + 0.25;
      if (!bs.flags.skeleton_resolve_logged) {
        bs.flags.skeleton_resolve_logged = true;
        bs.log.push('💀 Skeleton Warrior: Undying Resolve — DEF +25%!');
      }
    }
  },

  'lamia_serpent_bite': chanceEnemyLandedHitPlayerDebuff(0.30,
    [{ tag: 'bleed', turns: 2, valueFn: (bs) => bs.enemyATK * 0.15 }],
    '🐍 Lamia: Serpent Bite — Bleed applied! (15% enemy ATK for 2 turns)'),

  'minotaur_labyrinth_charge': everyNthEnemyNuke(3,
    (bs) => (bs.playerHP > bs.playerMaxHP * 0.70 ? 2.20 : 1.80),
    (pct) => `🐂 Minotaur: Labyrinth Charge — ${Math.round(pct * 100)}% ATK!`),

  'cyclops_boulder_throw': everyNthEnemyNuke(4, 1.60,
    '🗿 Cyclops: Boulder Throw — 160% ATK!',
    (bs) => {
      if (bs.applyPlayerDebuff('stun', 1)) {
        bs.log.push('🗿 Cyclops: Boulder Throw — Player Stunned for 1 turn!');
      }
    }),

  'chimera_tri_form_assault': (bs) => {
    // Rotates per round: Lion (140% ATK) → Goat (player DEF -20%) → Serpent (Burn)
    const phase = (bs.currentTurn - 1) % 3;
    if (phase === 0) {
      bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * 1.40; // 140% ATK total (mitigated)
      bs.log.push('🦁 Chimera: Lion Claw — 140% ATK!');
    } else if (phase === 1) {
      if (bs.applyPlayerDebuff('def_down', 1, 0.20)) {
        bs.log.push('🐐 Chimera: Goat Ram — Your DEF -20%!');
      }
    } else {
      if (bs.applyPlayerDebuff('burn', 2, bs.enemyATK * 0.20)) {
        bs.log.push('🐍 Chimera: Serpent Bite — Burn! 20% enemy ATK for 2 turns!');
      }
    }
  },

  'hydra_regen': (bs) => {
    // [Jun-2026 §4] Every 3rd turn: regen 1% max HP (was 5%) on the LOCAL instance only
    // (engine applies; the shared boss pool is never healed — only NET damage commits)
    if (bs.currentTurn % 3 === 0) {
      const regen = Math.floor(bs.enemyMaxHP * 0.01);
      bs.flags.hydra_local_regen = regen;
      bs.log.push(`🐉 Hydra: Regeneration — Local regen ${regen} HP (shared pool unaffected)!`);
    }
  },

  'stone_stare': everyNthPlayerDebuff(3,
    [{ tag: 'petrify', turns: 1 }],
    '🗿 Medusa: Stone Stare — You are petrified! Skip your next turn!'),

  'bakunawa_seven_moons': everyNthPlayerDebuff(4,
    [{ tag: 'darkened', turns: 1 }],
    'Bakunawa: Eclipse — your critical chance is reduced to 0 for 1 turn.'),

  'fenrir_gleipnirs_doom': fenrirGleipnirsDoom,

};

Object.defineProperties(PASSIVE_REGISTRY, {
  FENRIR_PASSIVE_KEY: { value: FENRIR_PASSIVE_KEY },
  FENRIR_PHASES: { value: FENRIR_PHASES },
  fenrirPhaseForHp: { value: fenrirPhaseForHp },
  fenrirPhaseFromState: { value: fenrirPhaseFromState },
  reconcileFenrirPhase: { value: reconcileFenrirPhase },
  fenrirPhaseAnnouncement: { value: fenrirPhaseAnnouncement },
});

module.exports = PASSIVE_REGISTRY;

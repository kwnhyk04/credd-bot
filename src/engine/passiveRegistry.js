'use strict';

/**
 * PASSIVE REGISTRY — CREDD BOT v4 (Phase 6 — factory build)
 *
 * One flat object keyed by passive_key / blessing_key / skill_key. Every key in
 * passive_registry_keys.md has a function here (coverage is asserted both ways by
 * scripts/battle-selftest.js). Functions are pure state-mutation over a perspective
 * `bs` object conforming to docs/ENGINE_HOOKS.md — they never deal damage, apply
 * mitigation, end the battle, or touch the DB.
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
 * bs scratch fields (reset by the engine every round, per docs/ENGINE_HOOKS.md §1):
 *   damageBonusPct (proc-granted damage %, summed with the weapon's bonusDmgPct),
 *   bonusIncomingDmgMult (0 = normal, additive delta), playerAtkMult, playerDefMult,
 *   ignoreDefPct, nextAttackAutoCrit, nextAttackDouble, log.
 * bs.flags.* persists for the whole battle (except the engine-managed per-round
 * derived flags — see battleEngine.js round-start reset list).
 *
 * Most keys are built from the archetype factories below; genuinely unique effects
 * stay bespoke. The key → archetype/bespoke audit matrix lives in
 * docs/phase6_registry_audit.md.
 */

const { CANONICAL_ON_HIT_EFFECTS } = require('./combatEffects');

// ───────────────────────────────────────────────────────────────────────────
// Archetype factories
// ───────────────────────────────────────────────────────────────────────────

/** Shared no-op (basic weapons, immunity-only bosses). */
const noop = () => {};

// A stat debuff applied after a landed hit is decremented at the end of that same
// round. Store it for two engine ticks so its user-facing one-turn window covers
// the attacker's next action instead of expiring before it can affect damage.
const LANDED_STAT_DEBUFF_TURNS = 2;

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
const stackingAtk = (flagKey, step, cap, everyN = 1) => (bs) => {
  if (!bs.flags[flagKey]) bs.flags[flagKey] = 0;
  if ((everyN === 1 || bs.currentTurn % everyN === 0) && bs.flags[flagKey] < cap) {
    bs.flags[flagKey] = Math.min(bs.flags[flagKey] + step, cap);
  }
  bs.playerAtkMult += bs.flags[flagKey];
};

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
  });
};

/** Roll and apply only after a hit lands. */
const chancePerLandedHitDebuff = (chance, tag, turns, valueFn, label) => (bs) => {
  bs.onLandedHit(() => {
    if (bs.rng() < chance && !bs.enemyImmune(tag)
        && bs.applyDebuff(tag, turns, valueFn ? valueFn(bs) : 0)) {
      bs.log.push(label);
    }
  });
};

/** Apply an enemy DOT on every hit (refreshes; highest value wins in the engine). */
const onHitEnemyDot = (tag, pct, label) => (bs) => {
  bs.onLandedHit(() => {
    if (!bs.enemyImmune(tag) && bs.applyDebuff(tag, 2, bs.playerATK * pct)) {
      bs.log.push(label);
    }
  });
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
  if (incoming) bs.bonusIncomingDmgMult += incoming;
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
  if (bs.currentTurn % n === 0) {
    const pct = typeof pctOrFn === 'function' ? pctOrFn(bs) : pctOrFn;
    bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * pct;
    if (extraFn) extraFn(bs);
    bs.log.push(typeof labelFn === 'function' ? labelFn(pct) : labelFn);
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
  },

  'gladius': attackChanceRider(0.30, 0.50,
    '⚔️ Gladius: Brutal Swing — +50% bonus ATK!'),

  'scimitar': stackingAtk('scimitar_stack', 0.03, 0.15),

  'roman_cestus': bonusVsState('enemy_is_stunned', 0.50,
    '👊 Roman Cestus: Executioner — +50% vs stunned!'),

  'pata': onHitEnemyDot('bleed', 0.05,
    '🗡️ Pata: Rending Claws — Bleed applied (5% ATK for 2 turns)!'),

  'bagh_nakh': stackingAtk('bagh_nakh_stack', 0.05, 0.25),

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
    if (bs.flags.egyptian_asa_pierce < 0.15) {
      bs.flags.egyptian_asa_pierce = Math.min(bs.flags.egyptian_asa_pierce + 0.03, 0.15);
    }
    if (bs.flags.egyptian_asa_pierce > bs.ignoreDefPct) {
      bs.ignoreDefPct = bs.flags.egyptian_asa_pierce;
    }
  },

  'pilgrims_bordone': chanceLandedHitDebuff(0.50, 'def_down', LANDED_STAT_DEBUFF_TURNS, () => 0.15,
    '🪄 Pilgrim\'s Bordone: Sundering Blow — Enemy DEF -15%!'),

  'vatican_aspis': constantSelfBuff(0.10, 0, -0.10),

  'battersea_shield': timedSelfBuff(2, 0, 0.25),

  // Reflection is logged by the engine after the hit that actually triggers it.
  'enderby_shield': chanceFlag(0.10, 'enderby_reflect_check', null),

  'holmegaard_bow': stackingAtk('holmegaard_stack', 0.03, 0.15),

  'scandinavian_glacial_wooden_bow': (bs) => {
    // 10% chance on an actual attack to take another turn (one attack rider).
    bs.onAttack(() => {
      bs.flags.extra_turn = bs.rng() < 0.10;
      if (bs.flags.extra_turn) {
        bs.log.push('🏹 Glacial Bow: Frostwind Volley — Taking another turn!');
      }
    });
  },

  'scythian_composite_bow': attackChanceRider(0.20, 0.50,
    '🏹 Scythian Composite Bow: Power Draw — +50% bonus ATK!'),

  'xiphos': stackingAtk('xiphos_stack', 0.04, 0.20),

  'kopis': attackChanceRider(0.25, 0.60,
    '⚔️ Kopis: Cleaving Blow — +60% bonus ATK!'),

  'caestus': attackChanceRider(0.35, 0.40,
    '👊 Caestus: Hammer Fists — +40% bonus ATK!'),

  'myrmex': bonusVsState('enemy_is_stunned', 0.40,
    '👊 Myrmex: Predator\'s Grip — +40% vs stunned!'),

  'dory': stackingAtk('dory_stack', 0.06, 0.18, 2),

  'thyrsus': chanceEnemyDebuff(0.20, 'bleed', 2, (bs) => bs.playerATK * 0.05,
    '🪄 Thyrsus: Maddening Touch — Bleed applied (5% ATK for 2 turns)!'),

  'dipylon_shield': timedSelfBuff(3, 0, 0.20),

  'pelte': chanceFlag(0.15, 'pelte_block_check', null,
    (bs) => { bs.flags.pelte_block_pct = 0.25; }),

  'arrow_of_eros': attackChanceRider(0.30, 0.45,
    '🏹 Arrow of Eros: Love\'s Arrow — +45% bonus ATK!'),

  'cretan_bow': stackingAtk('cretan_bow_stack', 0.04, 0.20),

  // ── WEAPON PASSIVES — Legendary PH & Norse ──────────────────────────────

  'juru_pakal': bonusVsState('enemy_is_bleeding', 0.50,
    '⚔️ Juru Pakal: Bloodhunter — +50% vs bleeding enemy!'),

  'gram': (bs) => {
    // Ignores 25% of enemy DEF; actual attacks gain +30% above 80% enemy HP.
    if (0.25 > bs.ignoreDefPct) bs.ignoreDefPct = 0.25;
    bs.onAttack(() => {
      if (bs.enemyHP > bs.enemyMaxHP * 0.80) {
        bs.playerAtkMult += 0.30;
        bs.log.push('⚔️ Gram: Dragonbane — +30% vs a healthy foe (>80% HP)!');
      }
    });
  },

  'tyrfing': (bs) => {
    // ATK +10%/turn stacking to +30%. Once the enemy drops below 30% HP the curse takes
    // hold: attacks can no longer miss or be evaded (engine reads tyrfing_no_miss, sticky).
    if (!bs.flags.tyrfing_stack) bs.flags.tyrfing_stack = 0;
    if (bs.flags.tyrfing_stack < 0.30) {
      bs.flags.tyrfing_stack = Math.min(bs.flags.tyrfing_stack + 0.10, 0.30);
    }
    bs.playerAtkMult += bs.flags.tyrfing_stack;
    if (bs.enemyHP < bs.enemyMaxHP * 0.30) {
      if (!bs.flags.tyrfing_no_miss) {
        bs.log.push('🗡️ Tyrfing: Cursed Edge — The curse takes hold; attacks cannot miss!');
      }
      bs.flags.tyrfing_no_miss = true;
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
    // The engine applies the +60% rider only when the attack really lands and its
    // Fighter stun succeeds after all immunity/evade checks.
    bs.flags.jarngreipr_on_stun = true;
  },

  'gridr_iron_gloves': chanceFlag(0.20, 'gridr_ignore_check', null),

  'alans_reversed_hands': (bs) => {
    bs.playerStatusImmune = true;
    bs.clearPlayerStatusEffects();
  },

  'knuckle_charm_anting_anting': (bs) => {
    // 5% on landed hit — engine blocks vs bosses and disables entirely in duels.
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.05; });
    bs.onLandedHit(() => {
      bs.flags.instakill_check = proc;
      if (bs.flags.instakill_check) {
        bs.log.push('💀 Knuckle Charm Anting-Anting: Death Charm — INSTANT KILL proc!');
      }
    });
  },

  'laevateinn_staff': (bs) => {
    // Ignores 15% of enemy DEF. The engine applies/refreshes the 10% ATK Burn
    // for 2 turns after each landed hit, so a skipped/evaded attack cannot burn.
    if (0.15 > bs.ignoreDefPct) bs.ignoreDefPct = 0.15;
    bs.flags.laevateinn_staff_on_hit = true;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GENESIS TIER — the five First Arms (specs/genesis_tier_weapons.md).
  // Tier above Supreme; weapon-only drops from the Genesis Chest.
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
    // evaded (engine reads tyrfing_no_miss).
    if (!bs.flags.moira_def_stack) bs.flags.moira_def_stack = 0;
    bs.onLandedHit(() => {
      if (!bs.enemyImmune('def_down') && bs.flags.moira_def_stack < 0.50) {
        const nextStack = Math.min(bs.flags.moira_def_stack + 0.10, 0.50);
        if (bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, nextStack)) {
          bs.flags.moira_def_stack = nextStack;
          bs.log.push(`🏹 Moira: Fate Ignores Iron — Enemy DEF reduced (total -${Math.round(nextStack * 100)}%)!`);
        }
      }
    });
    bs.flags.moira_pierce_vs_def_buff = true;
    if (!bs.flags.tyrfing_no_miss) {
      bs.log.push('🏹 Moira: Fate Ignores Iron — Every arrow was always meant to land.');
    }
    bs.flags.tyrfing_no_miss = true;
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
    bs.bonusIncomingDmgMult += 0.20;
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

  'galdrastafir': chanceLandedHitDebuff(0.50, 'def_down', LANDED_STAT_DEBUFF_TURNS, () => 0.30,
    '🪄 Galdrastafir: Runebreaker — Enemy DEF -30%!'),

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
    // 30% chance on landed hit: 10% enemy max HP (auto-blocked vs all bosses).
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.30; });
    bs.onLandedHit(() => {
      bs.flags.rupture_check = proc && !bs.enemyImmune('hp_pct_dot');
      if (bs.flags.rupture_check) {
        bs.flags.rupture_pct = 0.10;
        bs.log.push('🌿 Badiang Stalk: Venom Burst — Rupture! 10% enemy max HP!');
      }
    });
  },

  // ── WEAPON PASSIVES — Legendary Norse shields ───────────────────────────

  'shield_of_the_valkyrie': (bs) => {
    // Every individual hit received: DEF +5% and ATK +5%, stacking to 30% each.
    if (!bs.flags.valkyrie_shield_def) bs.flags.valkyrie_shield_def = 0;
    if (!bs.flags.valkyrie_shield_atk) bs.flags.valkyrie_shield_atk = 0;
    bs.flags.valkyrie_resolve_active = true;
    bs.playerDefMult += bs.flags.valkyrie_shield_def;
    bs.playerAtkMult += bs.flags.valkyrie_shield_atk;
  },

  'skjaldmaer': chanceFlag(0.15, 'skjaldmaer_ignore_check', null),

  'luzon_tribal_shield': (bs) => {
    // While debuffed: DEF +40% until the debuff expires
    if (bs.hasPlayerDebuff('any')) {
      bs.playerDefMult += 0.40;
      bs.log.push('🛡️ Luzon Tribal Shield: Tribal Ward — DEF +40% while debuffed!');
    }
  },

  'gusisnautar': (bs) => {
    // 50% on landed hit: 10% enemy max HP + DEF -15% (boss-blocked).
    let proc = false;
    bs.onAttack(() => { proc = bs.rng() < 0.50; });
    bs.onLandedHit(() => {
      bs.flags.hemorrhage_check = proc && !bs.enemyImmune('hp_pct_dot');
      if (bs.flags.hemorrhage_check) {
        bs.flags.hemorrhage_pct = 0.10;
        const shredded = !bs.enemyImmune('def_down')
          && bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.15);
        bs.log.push(
          `🏹 Gusisnautar: Hemorrhaging Shot — Hemorrhage! 10% max HP${shredded ? ' + DEF -15%' : ''}!`
        );
      }
    });
  },

  'freyrs_arrow': attackChanceRider(0.50, 1.00,
    '🏹 Freyr\'s Arrow: Auto-Fire — +100% ATK bonus hit!'),

  // ── WEAPON PASSIVES — Legendary Greek ───────────────────────────────────

  'harpe': flatPierce(0.30),

  'sword_of_damocles': (bs) => {
    // ATK +5%/turn stacking to +100%; while any stacks are active, +10% damage taken
    if (!bs.flags.damocles_stack) bs.flags.damocles_stack = 0;
    if (bs.flags.damocles_stack < 1.00) {
      bs.flags.damocles_stack = Math.min(bs.flags.damocles_stack + 0.05, 1.00);
    }
    bs.playerAtkMult += bs.flags.damocles_stack;
    if (bs.flags.damocles_stack > 0) bs.bonusIncomingDmgMult += 0.10;
  },

  'labrys': (bs) => {
    // Every 3rd turn's actual attack hits twice; skipped turns cannot carry it forward.
    if (bs.currentTurn % 3 === 0) {
      bs.onAttack(() => {
        bs.flags.labrys_double_hit = true;
        bs.flags.labrys_second_hit_pct = 0.70;
        bs.log.push('🪓 Labrys: Double Strike — Second hit (70% ATK) triggered!');
      });
    }
  },

  'hephaestus_hammer': (bs) => {
    // DEF +20% for the battle; every 4th actual attack gains the 150% ATK rider.
    bs.playerDefMult += 0.20;
    if (bs.currentTurn % 4 === 0) {
      bs.onAttack(() => {
        bs.playerAtkMult += 1.50;
        bs.log.push('🔨 Hephaestus Hammer: Forged Armor — Forge Strike! +150% ATK!');
      });
    }
  },

  'caduceus': (bs) => {
    // Every 3rd turn: cleanse all player debuffs + restore 8% max HP
    if (bs.currentTurn % 3 === 0) {
      bs.clearPlayerDebuffs();
      const heal = Math.floor(bs.playerMaxHP * 0.08);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🐍 Caduceus: Herald's Touch — Debuffs cleansed, healed ${heal} HP!`);
    }
  },

  // ATK +10% every turn, cap +40%. The engine grants one immediate stack on defeat.
  'spear_of_ares': stackingAtk('spear_of_ares_stack', 0.10, 0.40),

  // [v5] Promoted to Supreme Light armor — reworked from "enemy miss" to a DEF shred
  // (matches the v5 armor_roster seed): 30% chance each turn → enemy DEF -50% for 2 turns.
  'helm_of_darkness': chanceEnemyDebuff(0.30, 'def_down', 2, () => 0.50,
    '🪖 Helm of Darkness: Invisibility — Enemy DEF -50% for 2 turns!'),

  'aegis': (bs) => {
    // [v5] Promoted to Supreme armor — 50% chance per landed hit to add Stone.
    if (!bs.flags.aegis_stacks) bs.flags.aegis_stacks = 0;
    bs.onLandedHit(() => {
      if (bs.rng() < 0.50) {
        bs.flags.aegis_stacks += 1;
        bs.log.push(`🛡️ Aegis: Medusa's Gaze — Stone Stack! (${bs.flags.aegis_stacks}/3)`);
        if (bs.flags.aegis_stacks >= 3) {
          bs.flags.aegis_stacks = 0;
          if (!bs.enemyImmune('stun') && bs.applyDebuff('stun', 1)) {
            bs.log.push('🛡️ Aegis: Medusa\'s Gaze — 3 Stacks! Enemy STUNNED!');
          }
        }
      }
    });
  },

  'apollos_silver_bow': (bs) => {
    // Ignores 25% DEF; every 4th turn guaranteed CRIT
    if (0.25 > bs.ignoreDefPct) bs.ignoreDefPct = 0.25;
    if (bs.currentTurn % 4 === 0) {
      bs.onAttack(() => {
        bs.nextAttackAutoCrit = true;
        bs.log.push('🏹 Apollo\'s Silver Bow: Unerring Arrow — Guaranteed CRIT!');
      });
    }
  },

  // ── WEAPON PASSIVES — Supreme ────────────────────────────────────────────

  'mjolnir': (bs) => {
    // [Jun-2026 §4] Actual attacks gain +30%; every 3rd gets +200% more.
    bs.onAttack(() => {
      bs.playerAtkMult += 0.30;
      if (bs.currentTurn % 3 === 0) {
        bs.playerAtkMult += 2.00;
        bs.log.push('⚡ Mjolnir: Crushing Force — CRUSH! +200% ATK!');
      } else {
        bs.log.push('⚡ Mjolnir: Crushing Force — +30% ATK bonus!');
      }
    });
  },

  'gungnir': (bs) => {
    // [v5] Ignores 40% DEF; each actual attack has a 25% full-pierce chance.
    if (0.40 > bs.ignoreDefPct) bs.ignoreDefPct = 0.40;
    bs.onAttack(() => {
      bs.flags.gungnir_full_pierce = bs.rng() < 0.25;
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
        bs.playerAtkMult += 1.00;
        stunProc = bs.rng() < 0.30;
        bs.log.push('🔱 Trident of Poseidon: Tidal Wrath — +100% ATK!');
      });
      bs.onLandedHit(() => {
        const stunned = stunProc
          && !bs.enemyImmune('stun')
          && bs.applyDebuff('stun', 1);
        const shredded = !bs.enemyImmune('def_down')
          && bs.applyDebuff('def_down', LANDED_STAT_DEBUFF_TURNS, 0.20);
        if (stunned) bs.log.push('🔱 Trident of Poseidon: Enemy Stunned!');
        if (shredded) bs.log.push('🔱 Trident of Poseidon: Enemy DEF -20%!');
      });
    }
  },

  // ── ARMOR PASSIVES — v5 (defensive; fire alongside weapon/deity each round) ─
  // Mapped from credd_v5_new_armor_passives.js placeholder API → this engine's
  // real bs model (flags + scratch mults). aegis / helm_of_darkness already live
  // in the weapon section above (shared keys, updated for their Supreme armor form).

  // Kalasag — Bulwark Hide: incoming damage −3% (additive incoming lane, post-DEF).
  'kalasag': constantSelfBuff(0, 0, -0.03),

  // Hoplite Panoply — Phalanx Wall: incoming damage −15%.
  'hoplite_panoply': constantSelfBuff(0, 0, -0.15),

  // Mail of Brokkr — Dwarven Forge: incoming −30% AND reflect 15% of damage taken.
  // The engine adds mail_brokkr_reflect to the reflect sum on the FINAL applied hit.
  'mail_of_brokkr': (bs) => {
    bs.bonusIncomingDmgMult += -0.30;
    bs.flags.mail_brokkr_reflect = 0.15;
  },

  // Wolfskin Cloak — Wolf's Vigor: regen 10% max HP at the start of each round.
  'wolfskin_cloak': regenSelf(1, 0.10,
    (heal) => `🐺 Wolfskin Cloak: Wolf's Vigor — Regenerated ${heal} HP!`),

  // Salakot Ward — Spirit Ward: 20% chance to negate an incoming debuff. The roll
  // happens in the engine's addDebuff() at apply-time (see battleEngine §13.1 hook).
  'salakot_ward': (bs) => {
    bs.flags.salakot_negate_chance = 0.20;
  },

  // Anting-Anting Sash — Charmed Hide: immune to Stun / Petrify / Freeze (typed).
  // Other debuffs still land; engine addDebuff() honors immune_cc_types.
  'anting_anting_sash': (bs) => {
    bs.flags.immune_cc_types = ['stun', 'petrify', 'freeze'];
  },

  // Valkyrie's Mantle — Chooser's Grace: 20% evade, clamped so TOTAL evade across
  // all sources (amihan/loki/…) never exceeds 40% (v5 resolver cap). Always draws
  // once (stream stability), even when the cap leaves zero headroom.
  'valkyrie_mantle': (bs) => {
    const used = bs.flags.evade_chance_used || 0;
    const chance = Math.min(0.20, Math.max(0, 0.40 - used));
    bs.flags.evade_chance_used = used + chance;
    const roll = bs.rng();
    bs.flags.valkyrie_evade_check = roll < chance;
    // The engine logs only after the evade really stops a hit. A no-miss
    // attacker such as Moira must not produce a contradictory "evaded" event.
  },

  // Mantle of Bathala — Divine Aegis: +5% HP and +5% DEF every turn, stacking to
  // +50% each. DEF via the def multiplier; HP via the engine's Bathala HP ramp
  // (bathala_hp_fraction → applyBathala). Stack persists for the battle.
  'mantle_of_bathala': (bs) => {
    if (!bs.flags.mantle_bathala_stacks) bs.flags.mantle_bathala_stacks = 0;
    if (bs.flags.mantle_bathala_stacks < 0.50) {
      bs.flags.mantle_bathala_stacks = Math.min(bs.flags.mantle_bathala_stacks + 0.05, 0.50);
    }
    const frac = bs.flags.mantle_bathala_stacks;
    bs.playerDefMult += frac;
    bs.flags.bathala_hp_fraction = frac;
    bs.log.push(`🛡️ Mantle of Bathala: Divine Aegis — +${Math.round(frac * 100)}% HP/DEF!`);
  },

  // ── DEITY BLESSINGS — Philippine ─────────────────────────────────────────

  'bathala_divine_vessel': (bs) => {
    // At the start of each turn, add 10% of base battle ATK and DEF.
    // The additive ramp caps at 10 stacks, exactly +100% of each base stat.
    // NOT compounding. NO HP component anymore — ATK/DEF only. This is a self-buff window, NOT
    // a debuff: unaffected by the 1-turn rule and never cleansed off Bathala. The engine's HP
    // ramp stays inert because bathala_hp_fraction is left at its reset default (0).
    if (!bs.flags.bathala_stacks) bs.flags.bathala_stacks = 0;
    if (bs.flags.bathala_stacks < 10) bs.flags.bathala_stacks += 1;
    const frac = 0.10 * bs.flags.bathala_stacks;
    bs.playerAtkMult += frac;
    bs.playerDefMult += frac;
    bs.log.push(`🌅 Bathala: Divine Vessel — Divine ramp +${Math.round(frac * 100)}% ATK/DEF!`);
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
    // Engine heals 15% of dealt damage and grants the 20% max-HP soul claim on defeat.
    bs.flags.soul_drain_active = true;
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
      bs.bonusIncomingDmgMult -= 0.50;
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

  // Chain Lightning: 50% proc, +50% attack damage and a persistent 5% DEF-shred stack.
  'zeus_thunder_sovereign': (bs) => {
    if (bs.rng() >= 0.50) return;
    bs.playerAtkMult += 0.50;
    if (!bs.enemyImmune('def_down')) {
      bs.flags.zeus_def_shred_stacks = Math.min(6, (bs.flags.zeus_def_shred_stacks || 0) + 1);
    }
    const shred = Math.min(30, (bs.flags.zeus_def_shred_stacks || 0) * 5);
    bs.log.push(`⚡ Zeus: Chain Lightning — +50% damage! Enemy DEF -${shred}%!`);
  },

  'ares_blood_frenzy': (bs) => {
    // Earn +10% at each turn end, cap +50%; apply stacks earned on prior turns.
    const stacks = Math.min(Math.max(bs.currentTurn - 1, 0), 5);
    bs.playerAtkMult += stacks * 0.10;
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
    if (proc && !bs.enemyImmune('charm')) {
      bs.flags.aphrodite_charm_check = true;
      bs.applyDebuff('charm', 1);
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

  'echo_ares': stackingAtk('echo_ares_stack', 0.04, 0.16, 2),

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
      bs.flags.echo_vidar_revenge = true;
      bs.log.push('⚔️ Echo · Vidar: Silent Vengeance — Next attack +30% ATK!');
    }
    if (bs.flags.echo_vidar_revenge) {
      bs.playerAtkMult += 0.30;
      bs.flags.echo_vidar_revenge = false;
    }
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
    if (bs.currentTurn % 6 === 0) {
      bs.nextAttackDouble = true;
      bs.log.push('⚙️ Echo · Idiyanale: Persistence — Next attack deals double damage!');
    }
  },

  'echo_lakapati': regenSelf(1, 0.02,
    (heal) => `🌱 Echo · Lakapati: Abundance — Regenerated ${heal} HP!`),

  'echo_habagat': chanceRider(0.15, 0.30,
    '🌩️ Echo · Habagat: Monsoon Fury — +30% ATK!'),

  'echo_mandarangan': (bs) => {
    const stacks = Math.min(bs.currentTurn, 3);
    bs.playerAtkMult += stacks * 0.05;
  },

  'echo_magwayen': (bs) => {
    bs.flags.echo_soul_drain_active = true;
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

  'amalanhig_infectious_bite': chancePlayerDebuff(0.30,
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

  'dark_elves_curse_of_decay': chancePlayerDebuff(0.25,
    [{ tag: 'def_down', turns: 1, value: 0.10 }],
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
    '🦅 Harpy: Swooping Talons — 150% ATK! Your DEF -10%!',
    (bs) => {
      bs.applyPlayerDebuff('def_down', 1, 0.10);
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

  'lamia_serpent_bite': chancePlayerDebuff(0.30,
    [{ tag: 'bleed', turns: 2, valueFn: (bs) => bs.enemyATK * 0.15 }],
    '🐍 Lamia: Serpent Bite — Bleed applied! (15% enemy ATK for 2 turns)'),

  'minotaur_labyrinth_charge': everyNthEnemyNuke(3,
    (bs) => (bs.playerHP > bs.playerMaxHP * 0.70 ? 2.20 : 1.80),
    (pct) => `🐂 Minotaur: Labyrinth Charge — ${Math.round(pct * 100)}% ATK!`),

  'cyclops_boulder_throw': everyNthEnemyNuke(4, 1.60,
    '🗿 Cyclops: Boulder Throw — 160% ATK + Player Stunned!',
    (bs) => {
      bs.applyPlayerDebuff('stun', 1);
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

};

module.exports = PASSIVE_REGISTRY;

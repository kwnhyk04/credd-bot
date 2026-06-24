'use strict';

/**
 * PASSIVE REGISTRY — CREDD BOT v4 (Phase 6 — factory build)
 *
 * One flat object keyed by passive_key / blessing_key / skill_key. Every key in
 * passive_registry_keys.md has a function here (coverage is asserted both ways by
 * scripts/battle-selftest.js). Functions are pure state-mutation over a perspective
 * `bs` object conforming to ENGINE_HOOKS.md — they never deal damage, apply
 * mitigation, end the battle, or touch the DB.
 *
 * RANDOMNESS: every probability check draws from bs.rng() (the engine-injected
 * seeded stream). Math.random is forbidden in this file (statically checked by the
 * selftest). Draw discipline: a chance-based passive ALWAYS draws exactly once per
 * invocation (the draw happens before any gate), so the stream position never
 * depends on battle state.
 *
 * Timing rules (§35.1):
 *   - bs.currentTurn = ROUND counter (the only periodic clock)
 *   - CC + stat debuffs last 1 turn; Bleed/Burn DOTs tick 2 turns
 *   - "first hit / first N hits" → one-shot flag or small tally on bs.flags.*
 *   - Stacking buffs are per-turn; bonus/extra hits are riders (advance nothing)
 *   - bs.enemyImmune(tag) gates all enemy-targeted debuffs
 *
 * bs scratch fields (reset by the engine every round, per ENGINE_HOOKS §1):
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

// ───────────────────────────────────────────────────────────────────────────
// Archetype factories
// ───────────────────────────────────────────────────────────────────────────

/** Shared no-op (basic weapons, immunity-only bosses). */
const noop = () => {};

/** First player hit of the battle deals +pct of its damage (one-shot flag).
 *  Routed through the ATK multiplier (pre-mitigation), so the bonus is +pct of the
 *  damage actually dealt — NOT a flat ATK-fraction that bypasses the enemy's DEF. */
const firstHitBonus = (flagKey, pct, label) => (bs) => {
  if (!bs.flags[flagKey]) {
    bs.flags[flagKey] = true;
    bs.playerAtkMult += pct;
    bs.log.push(label);
  }
};

/** chance → +pct damage this round (ATK-mult lane; mitigated — see firstHitBonus). */
const chanceRider = (chance, pct, label) => (bs) => {
  if (bs.rng() < chance) {
    bs.playerAtkMult += pct;
    bs.log.push(label);
  }
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
  if (proc && !bs.enemyImmune(tag)) {
    bs.applyDebuff(tag, turns, valueFn ? valueFn(bs) : 0);
    bs.log.push(label);
  }
};

/** Apply an enemy DOT on every hit (refreshes; highest value wins in the engine). */
const onHitEnemyDot = (tag, pct, label) => (bs) => {
  if (!bs.enemyImmune(tag)) {
    bs.applyDebuff(tag, 2, bs.playerATK * pct);
    bs.log.push(label);
  }
};

/** +pct damage while an engine-set state flag is true (stunned/bleeding).
 *  ATK-mult lane (mitigated) — +pct of the damage dealt, not a DEF-bypassing flat add. */
const bonusVsState = (stateFlag, pct, label) => (bs) => {
  if (bs.flags[stateFlag]) {
    bs.playerAtkMult += pct;
    bs.log.push(label);
  }
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
  if (proc && !bs.playerStatusImmune) {
    for (const s of specs) {
      bs.applyPlayerDebuff(s.tag, s.turns, s.valueFn ? s.valueFn(bs) : (s.value || 0));
    }
    bs.log.push(label);
  }
};

/** Mob skill: every Nth round → apply player debuff(s). */
const everyNthPlayerDebuff = (n, specs, label) => (bs) => {
  if (bs.currentTurn % n === 0 && !bs.playerStatusImmune) {
    for (const s of specs) {
      bs.applyPlayerDebuff(s.tag, s.turns, s.valueFn ? s.valueFn(bs) : (s.value || 0));
    }
    bs.log.push(label);
  }
};

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

  'cutlass': chanceEnemyDebuff(0.10, 'bleed', 2, (bs) => bs.playerATK,
    '🗡️ Cutlass: Serrated Edge — Bleed applied!'),

  'kampilan': firstHitBonus('kampilan_used', 0.20,
    '⚔️ Kampilan: Opening Strike — +20% ATK bonus!'),

  'war_club': chanceEnemyDebuff(0.10, 'stun', 1, null,
    '🪓 War Club: Concussive Blow — Enemy stunned!'),

  'bone_crusher': firstHitBonus('bone_crusher_used', 0.20,
    '🦴 Bone Crusher: Opening Strike — +20% ATK bonus!'),

  'crystal_wand': chanceRider(0.10, 0.15,
    '🔮 Crystal Wand: Arcane Surge — +15% ATK bonus hit!'),

  'carved_totem': firstHitBonus('carved_totem_used', 0.20,
    '🪵 Carved Totem: Opening Strike — +20% ATK bonus!'),

  'steel_kite_shield': chanceFlag(0.10, 'steel_kite_shield_block',
    '🛡️ Steel Kite Shield: Bulwark — Blocked 15% incoming damage!'),

  'reinforced_targe': firstHitBonus('reinforced_targe_used', 0.20,
    '🛡️ Reinforced Targe: Opening Strike — +20% ATK bonus!'),

  'recurve_bow': chanceRider(0.10, 0.20,
    '🏹 Recurve Bow: Precise Shot — +20% ATK bonus hit!'),

  'crossbow': (bs) => {
    // First hit +20% ATK ignoring 25% DEF (engine consumes crossbow_pierce on that hit)
    if (!bs.flags.crossbow_used) {
      bs.flags.crossbow_used = true;
      bs.playerAtkMult += 0.20;
      bs.flags.crossbow_pierce = true;
      bs.log.push('🏹 Crossbow: Piercing Opener — +20% ATK, ignores 25% DEF!');
    }
  },

  // ── WEAPON PASSIVES — Mythic ─────────────────────────────────────────────

  'katana': (bs) => {
    // +30% damage (unified §35.2). Applies to crit AND non-crit: ×1.30 normal / ×2.30 crit.
    bs.damageBonusPct += 30;
  },

  'gladius': chanceRider(0.30, 0.50,
    '⚔️ Gladius: Brutal Swing — +50% bonus ATK!'),

  'scimitar': stackingAtk('scimitar_stack', 0.03, 0.15),

  'roman_cestus': bonusVsState('enemy_is_stunned', 0.50,
    '👊 Roman Cestus: Executioner — +50% vs stunned!'),

  'pata': onHitEnemyDot('bleed', 0.30,
    '🗡️ Pata: Rending Claws — Bleed applied (30% ATK)!'),

  'bagh_nakh': stackingAtk('bagh_nakh_stack', 0.05, 0.25),

  'japanese_bo': chanceFlag(0.25, 'japanese_bo_active',
    '🪄 Japanese Bo: Vital Siphon — Will heal 50% of damage dealt!'),

  'english_quarterstaff': chanceRider(0.20, 0.50,
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

  'pilgrims_bordone': chanceEnemyDebuff(0.50, 'def_down', 1, () => 0.15,
    '🪄 Pilgrim\'s Bordone: Sundering Blow — Enemy DEF -15%!'),

  'vatican_aspis': constantSelfBuff(0.10, 0, -0.10),

  'battersea_shield': timedSelfBuff(2, 0, 0.25),

  'enderby_shield': chanceFlag(0.10, 'enderby_reflect_check',
    '🛡️ Enderby Shield: Thornward — Will reflect 30% of incoming damage!'),

  'holmegaard_bow': stackingAtk('holmegaard_stack', 0.03, 0.15),

  'scandinavian_glacial_wooden_bow': (bs) => {
    // 10% chance take another turn (rider — engine re-runs one player attack)
    if (bs.rng() < 0.10) {
      bs.flags.extra_turn = true;
      bs.log.push('🏹 Glacial Bow: Frostwind Volley — Taking another turn!');
    }
  },

  'scythian_composite_bow': chanceRider(0.20, 0.50,
    '🏹 Scythian Composite Bow: Power Draw — +50% bonus ATK!'),

  'xiphos': stackingAtk('xiphos_stack', 0.04, 0.20),

  'kopis': chanceRider(0.25, 0.60,
    '⚔️ Kopis: Cleaving Blow — +60% bonus ATK!'),

  'caestus': chanceRider(0.35, 0.40,
    '👊 Caestus: Hammer Fists — +40% bonus ATK!'),

  'myrmex': bonusVsState('enemy_is_stunned', 0.40,
    '👊 Myrmex: Predator\'s Grip — +40% vs stunned!'),

  'dory': stackingAtk('dory_stack', 0.06, 0.18, 2),

  'thyrsus': chanceEnemyDebuff(0.20, 'bleed', 2, (bs) => bs.playerATK * 0.30,
    '🪄 Thyrsus: Maddening Touch — Bleed applied (30% ATK)!'),

  'dipylon_shield': timedSelfBuff(3, 0, 0.20),

  'pelte': chanceFlag(0.15, 'pelte_block_check',
    '🛡️ Pelte: Deflection — Will block 25% incoming damage!',
    (bs) => { bs.flags.pelte_block_pct = 0.25; }),

  'arrow_of_eros': chanceRider(0.30, 0.45,
    '🏹 Arrow of Eros: Love\'s Arrow — +45% bonus ATK!'),

  'cretan_bow': stackingAtk('cretan_bow_stack', 0.04, 0.20),

  // ── WEAPON PASSIVES — Legendary PH & Norse ──────────────────────────────

  'juru_pakal': bonusVsState('enemy_is_bleeding', 0.30,
    '⚔️ Juru Pakal: Bloodhunter — +30% vs bleeding enemy!'),

  'gram': flatPierce(0.20),

  'tyrfing': stackingAtk('tyrfing_stack', 0.10, 0.30),

  'laevateinn_sword': (bs) => {
    // Enemy DEF -10%/turn stacking to 30%. ONE def_down source whose value is the
    // stack — combined highest-wins with other def_down sources by the engine (R8).
    // Gated by def_down immunity; persists (does not expire each turn).
    if (!bs.flags.laevateinn_sword_def_stack) bs.flags.laevateinn_sword_def_stack = 0;
    if (!bs.enemyImmune('def_down') && bs.flags.laevateinn_sword_def_stack < 0.30) {
      bs.flags.laevateinn_sword_def_stack = Math.min(
        bs.flags.laevateinn_sword_def_stack + 0.10, 0.30
      );
      bs.log.push(`⚔️ Laevateinn Sword: Sundering Flame — Enemy DEF reduced (total -${Math.round(bs.flags.laevateinn_sword_def_stack * 100)}%)!`);
    }
  },

  'jarngreipr': (bs) => {
    // Stunning an enemy triggers Bash (rider). bs.flags.stun_just_applied is the
    // engine's pre-roll latch: true when this round's class-stun lands (R1).
    if (bs.flags.stun_just_applied && !bs.enemyImmune('stun')) {
      bs.playerAtkMult += 0.60;
      bs.log.push('⚡ Jarngreipr: Thunder Grip — Stun triggered Bash! +60% ATK!');
    }
  },

  'gridr_iron_gloves': chanceFlag(0.20, 'gridr_ignore_check',
    '👊 Gridr Iron Gloves: Ironhide — Ignored incoming damage!'),

  'alans_reversed_hands': (bs) => {
    // Immune to all status effects — engine + applyPlayerDebuff both honor this
    bs.playerStatusImmune = true;
  },

  'knuckle_charm_anting_anting': (bs) => {
    // 5% instant kill — engine blocks vs bosses and disables entirely in duels
    if (bs.rng() < 0.05) {
      bs.flags.instakill_check = true;
      bs.log.push('💀 Knuckle Charm Anting-Anting: Death Charm — INSTANT KILL proc!');
    }
  },

  'laevateinn_staff': flatPierce(0.15),

  'galdrastafir': chanceEnemyDebuff(0.50, 'def_down', 1, () => 0.30,
    '🪄 Galdrastafir: Runebreaker — Enemy DEF -30%!'),

  'babaylans_ritual_staff': (bs) => {
    // Auto-cleanse every turn; +100% ATK (1 turn) ONLY if the cleanse actually
    // removed ≥1 debuff (R9). An empty cleanse grants nothing.
    const hadDebuff = bs.hasPlayerDebuff('any');
    bs.clearPlayerDebuffs();
    if (hadDebuff) {
      bs.flags.babaylan_cleansed_this_turn = true;
      bs.playerAtkMult += 1.00;
      bs.log.push('🪄 Babaylan\'s Ritual Staff: Sacred Cleansing — Debuffs cleansed! ATK +100% this turn!');
    } else {
      bs.flags.babaylan_cleansed_this_turn = false;
    }
  },

  'badiang_stalk': (bs) => {
    // 30% chance Rupture: 10% enemy max HP (hp_pct_dot — auto-blocked vs all bosses)
    const proc = bs.rng() < 0.30;
    if (proc && !bs.enemyImmune('hp_pct_dot')) {
      bs.flags.rupture_check = true;
      bs.flags.rupture_pct = 0.10;
      bs.log.push('🌿 Badiang Stalk: Venom Burst — Rupture! 10% enemy max HP!');
    }
  },

  // ── WEAPON PASSIVES — Legendary Norse shields ───────────────────────────

  'shield_of_the_valkyrie': (bs) => {
    // Every hit received: DEF +5% and ATK +5%, stacking to 30% each.
    // bs.flags.hit_received_this_turn is the engine latch from the previous round.
    if (!bs.flags.valkyrie_shield_def) bs.flags.valkyrie_shield_def = 0;
    if (!bs.flags.valkyrie_shield_atk) bs.flags.valkyrie_shield_atk = 0;
    if (bs.flags.hit_received_this_turn) {
      bs.flags.valkyrie_shield_def = Math.min(bs.flags.valkyrie_shield_def + 0.05, 0.30);
      bs.flags.valkyrie_shield_atk = Math.min(bs.flags.valkyrie_shield_atk + 0.05, 0.30);
      bs.log.push(`🛡️ Shield of the Valkyrie: Valkyrie's Resolve — DEF +${Math.round(bs.flags.valkyrie_shield_def * 100)}%, ATK +${Math.round(bs.flags.valkyrie_shield_atk * 100)}%!`);
    }
    bs.playerDefMult += bs.flags.valkyrie_shield_def;
    bs.playerAtkMult += bs.flags.valkyrie_shield_atk;
  },

  'skjaldmaer': chanceFlag(0.15, 'skjaldmaer_ignore_check',
    '🛡️ Skjaldmaer: Shieldmaiden\'s Guard — Ignored incoming damage!'),

  'luzon_tribal_shield': (bs) => {
    // While debuffed: DEF +40% until the debuff expires
    if (bs.hasPlayerDebuff('any')) {
      bs.playerDefMult += 0.40;
      bs.log.push('🛡️ Luzon Tribal Shield: Tribal Ward — DEF +40% while debuffed!');
    }
  },

  'gusisnautar': (bs) => {
    // 50% Hemorrhage: 10% enemy max HP + DEF -15% during (hp_pct_dot — boss-blocked)
    const proc = bs.rng() < 0.50;
    if (proc && !bs.enemyImmune('hp_pct_dot')) {
      bs.flags.hemorrhage_check = true;
      bs.flags.hemorrhage_pct = 0.10;
      if (!bs.enemyImmune('def_down')) {
        bs.applyDebuff('def_down', 1, 0.15);
      }
      bs.log.push('🏹 Gusisnautar: Hemorrhaging Shot — Hemorrhage! 10% max HP + DEF -15%!');
    }
  },

  'freyrs_arrow': chanceRider(0.50, 1.00,
    '🏹 Freyr\'s Arrow: Auto-Fire — +100% ATK bonus hit!'),

  // ── WEAPON PASSIVES — Legendary Greek ───────────────────────────────────

  'harpe': flatPierce(0.30),

  'sword_of_damocles': (bs) => {
    // ATK +5%/turn stacking to +100%; constant +5% damage taken
    if (!bs.flags.damocles_stack) bs.flags.damocles_stack = 0;
    if (bs.flags.damocles_stack < 1.00) {
      bs.flags.damocles_stack = Math.min(bs.flags.damocles_stack + 0.05, 1.00);
    }
    bs.playerAtkMult += bs.flags.damocles_stack;
    bs.bonusIncomingDmgMult += 0.05;
  },

  'labrys': (bs) => {
    // Every 3rd turn the attack hits twice; 2nd hit 70% ATK; both can CRIT
    if (bs.currentTurn % 3 === 0) {
      bs.flags.labrys_double_hit = true;
      bs.flags.labrys_second_hit_pct = 0.70;
      bs.log.push('🪓 Labrys: Double Strike — Second hit (70% ATK) triggered!');
    }
  },

  'hephaestus_hammer': (bs) => {
    // DEF +20% for the battle; every 4th turn a 150% ATK forge strike (rider)
    bs.playerDefMult += 0.20;
    if (bs.currentTurn % 4 === 0) {
      bs.playerAtkMult += 1.50;
      bs.log.push('🔨 Hephaestus Hammer: Forged Armor — Forge Strike! +150% ATK!');
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

  'spear_of_ares': stackingAtk('spear_of_ares_stack', 0.08, 0.40, 2),

  // [v5] Promoted to Supreme Light armor — reworked from "enemy miss" to a DEF shred
  // (matches the v5 armor_roster seed): 30% chance each turn → enemy DEF -50% for 2 turns.
  'helm_of_darkness': chanceEnemyDebuff(0.30, 'def_down', 2, () => 0.50,
    '🪖 Helm of Darkness: Invisibility — Enemy DEF -50% for 2 turns!'),

  'aegis': (bs) => {
    // [v5] Promoted to Supreme armor — proc raised 20% → 50%.
    // 50% chance per turn: Stone Stack; at 3 stacks stun 1 turn and reset
    if (!bs.flags.aegis_stacks) bs.flags.aegis_stacks = 0;
    if (bs.rng() < 0.50) {
      bs.flags.aegis_stacks += 1;
      bs.log.push(`🛡️ Aegis: Medusa's Gaze — Stone Stack! (${bs.flags.aegis_stacks}/3)`);
      if (bs.flags.aegis_stacks >= 3) {
        bs.flags.aegis_stacks = 0;
        if (!bs.enemyImmune('stun')) {
          bs.applyDebuff('stun', 1);
          bs.log.push('🛡️ Aegis: Medusa\'s Gaze — 3 Stacks! Enemy STUNNED!');
        }
      }
    }
  },

  'apollos_silver_bow': (bs) => {
    // Ignores 25% DEF; every 4th turn guaranteed CRIT
    if (0.25 > bs.ignoreDefPct) bs.ignoreDefPct = 0.25;
    if (bs.currentTurn % 4 === 0) {
      bs.nextAttackAutoCrit = true;
      bs.log.push('🏹 Apollo\'s Silver Bow: Unerring Arrow — Guaranteed CRIT!');
    }
  },

  // ── WEAPON PASSIVES — Supreme ────────────────────────────────────────────

  'mjolnir': (bs) => {
    // [Jun-2026 §4] +30% damage every turn; every 3rd turn: +200% damage crush
    // (ATK-mult lane, mitigated). Was +20% / every 4th.
    bs.playerAtkMult += 0.30;
    if (bs.currentTurn % 3 === 0) {
      bs.playerAtkMult += 2.00;
      bs.log.push('⚡ Mjolnir: Crushing Force — CRUSH! +200% ATK!');
    } else {
      bs.log.push('⚡ Mjolnir: Crushing Force — +30% ATK bonus!');
    }
  },

  'gungnir': (bs) => {
    // [v5] Never Misses — Ignores 40% of enemy DEF; 25% chance to pierce ALL DEF (zero mitigation).
    if (0.40 > bs.ignoreDefPct) bs.ignoreDefPct = 0.40;
    if (bs.rng() < 0.25) {
      bs.flags.gungnir_full_pierce = true; // engine zeroes enemy DEF for this hit
      bs.log.push('🏹 Gungnir: Never Misses — ALL DEF PIERCED!');
    }
  },

  'thunderbolt_of_zeus': (bs) => {
    // [v5] Divine Thunder — on a CRIT: +100% bonus ATK and paralyze 1 turn. Crit-gated only
    // (the pre-roll latch crit_landed_this_hit marks this round's main hit as a crit).
    if (bs.flags.crit_landed_this_hit) {
      bs.playerAtkMult += 1.00;
      if (!bs.enemyImmune('paralyze')) {
        bs.applyDebuff('paralyze', 1);
      }
      bs.log.push('⚡ Thunderbolt of Zeus: Divine Thunder — +100% ATK + Paralyze!');
    }
  },

  'trident_of_poseidon': (bs) => {
    // [Jun-2026 §4] Every 2nd turn (was 3rd): +100% damage; 30% chance stun 1 turn (was 25%); enemy DEF -20% 1 turn
    if (bs.currentTurn % 2 === 0) {
      bs.playerAtkMult += 1.00;
      if (bs.rng() < 0.30 && !bs.enemyImmune('stun')) {
        bs.applyDebuff('stun', 1);
        bs.log.push('🔱 Trident of Poseidon: Tidal Wrath — +100% ATK, Stun!');
      } else {
        bs.log.push('🔱 Trident of Poseidon: Tidal Wrath — +100% ATK!');
      }
      if (!bs.enemyImmune('def_down')) {
        bs.applyDebuff('def_down', 1, 0.20);
        bs.log.push('🔱 Trident of Poseidon: Enemy DEF -20%!');
      }
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
    if (bs.flags.valkyrie_evade_check) {
      bs.log.push('🪽 Valkyrie\'s Mantle: Chooser\'s Grace — Attack evaded!');
    }
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
    // [Supporter-stage §9] REWORK. At the start of each turn (before attacking) add +20% to
    // ATK and DEF, stacking ADDITIVELY up to +100% (5 stacks; cap reached on turn 5, held at
    // cap thereafter). Implemented additive-on-base (base × (1 + 0.20 × stacks), stacks ≤ 5),
    // NOT compounding. NO HP component anymore — ATK/DEF only. This is a self-buff window, NOT
    // a debuff: unaffected by the 1-turn rule and never cleansed off Bathala. The engine's HP
    // ramp stays inert because bathala_hp_fraction is left at its reset default (0).
    if (!bs.flags.bathala_stacks) bs.flags.bathala_stacks = 0;
    if (bs.flags.bathala_stacks < 5) bs.flags.bathala_stacks += 1;
    const frac = 0.20 * bs.flags.bathala_stacks; // 0.20 → 1.00
    bs.playerAtkMult += frac;
    bs.playerDefMult += frac;
    bs.log.push(`🌅 Bathala: Divine Vessel — Divine ramp +${Math.round(frac * 100)}% ATK/DEF!`);
  },

  'sidapa_deaths_reprieve': (bs) => {
    // Once per battle: survive lethal damage at 1 HP (engine consumes on lethal hit)
    if (!bs.flags.sidapa_reprieve_used) {
      bs.flags.sidapa_reprieve_available = true;
    }
  },

  'magwayen_soul_drain': (bs) => {
    bs.flags.soul_drain_active = true; // engine heals 10% of each hit's damage
  },

  'mandarangan_war_frenzy': (bs) => {
    // ATK +10% every turn, capped at 30% (max stack at turn 3)
    const stacks = Math.min(bs.currentTurn, 3);
    bs.playerAtkMult += stacks * 0.10;
  },

  'apolaki_solar_burn': (bs) => {
    // Every 3rd turn: Burn 15% ATK flat for 2 turns
    if (bs.currentTurn % 3 === 0 && !bs.enemyImmune('burn')) {
      bs.applyDebuff('burn', 2, bs.playerATK * 0.15);
      bs.log.push('☀️ Apolaki: Solar Burn — Enemy ignited! 15% ATK Burn for 2 turns!');
    }
  },

  'mayari_lunar_veil': hpThresholdBuff(0.50, 0, 0.30),

  'dian_masalanta_devotion': hpThresholdBuff(0.30, 0.25, 0),

  'amihan_tailwind': (bs) => {
    // 20% evade. [v5] Registers its chance into the shared evade budget so the
    // armor evade (valkyrie_mantle) capping at 40% total can see it. One rng draw
    // (unchanged from the old chanceFlag — draw order is stable).
    bs.flags.evade_chance_used = (bs.flags.evade_chance_used || 0) + 0.20;
    bs.flags.amihan_evade_check = bs.rng() < 0.20;
    if (bs.flags.amihan_evade_check) bs.log.push('💨 Amihan: Tailwind — Attack evaded!');
  },

  'habagat_monsoon_fury': chanceRider(0.25, 0.50,
    '🌩️ Habagat: Monsoon Fury — Storm Strike! +50% ATK!'),

  'lakapati_abundance': regenSelf(1, 0.03,
    (heal) => `🌱 Lakapati: Abundance — Regenerated ${heal} HP!`),

  'idiyanale_persistence': (bs) => {
    // Every 5 turns: this round's attack deals double damage
    if (bs.currentTurn % 5 === 0) {
      bs.nextAttackDouble = true;
      bs.log.push('⚙️ Idiyanale: Persistence — Next attack deals double damage!');
    }
  },

  // ── DEITY BLESSINGS — Norse ──────────────────────────────────────────────

  'odin_all_fathers_wisdom': (bs) => {
    // Every even turn: 50% reduced incoming damage
    if (bs.currentTurn % 2 === 0) {
      bs.flags.odin_wisdom_block = true;
      bs.log.push('🪄 Odin: All-Father\'s Wisdom — 50% damage reduction this turn!');
    } else {
      bs.flags.odin_wisdom_block = false;
    }
  },

  'thor_mjolnirs_wrath': everyNthRider(3, 0.50, null, (bs) => {
    if (!bs.enemyImmune('stun')) {
      bs.applyDebuff('stun', 1);
      bs.log.push('⚡ Thor: Mjolnir\'s Wrath — +50% ATK + Enemy Stunned!');
    } else {
      bs.log.push('⚡ Thor: Mjolnir\'s Wrath — +50% ATK!');
    }
  }),

  'freya_valkyries_embrace': (bs) => {
    // Once/battle at ≤40% HP: heal 20% max HP + ATK +15% for 2 turns
    if (!bs.flags.freya_embrace_used && bs.playerHP <= bs.playerMaxHP * 0.40) {
      bs.flags.freya_embrace_used = true;
      const heal = Math.floor(bs.playerMaxHP * 0.20);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.flags.freya_atk_buff_turns = 2;
      bs.log.push(`🌸 Freya: Valkyrie's Embrace — Healed ${heal} HP! ATK +15% for 2 turns!`);
    }
    if (bs.flags.freya_atk_buff_turns > 0) {
      bs.playerAtkMult += 0.15;
      bs.flags.freya_atk_buff_turns -= 1;
    }
  },

  'loki_illusory_double': (bs) => {
    // 20% chance each turn: evade an attack and counter for 50% ATK (rider)
    // [v5] Registers its chance into the shared evade budget (40% total cap).
    bs.flags.evade_chance_used = (bs.flags.evade_chance_used || 0) + 0.20;
    bs.flags.loki_evade_check = bs.rng() < 0.20;
    if (bs.flags.loki_evade_check) {
      bs.flags.loki_counter_dmg = Math.floor(bs.playerATK * 0.50);
      bs.log.push('🃏 Loki: Illusory Double — Attack evaded! Counter incoming!');
    }
  },

  'tyr_oathkeeper': (bs) => {
    // DEF +20% all battle; while HP < 50%, reflect 15% of incoming
    bs.playerDefMult += 0.20;
    bs.flags.tyr_reflect = bs.playerHP < bs.playerMaxHP * 0.50 ? 0.15 : 0;
  },

  'skadi_winters_hunt': everyNthRider(3, 0.40, null, (bs) => {
    if (!bs.enemyImmune('freeze')) {
      bs.applyDebuff('freeze', 1);
      bs.log.push('❄️ Skadi: Winter\'s Hunt — +40% ATK + Enemy Frozen!');
    } else {
      bs.log.push('❄️ Skadi: Winter\'s Hunt — +40% ATK!');
    }
  }),

  'surt_muspells_flame': (bs) => {
    // Every attack applies Burn (25% ATK, 2 ticks); +50% bonus vs already-burning
    if (!bs.enemyImmune('burn')) {
      const burnDmg = bs.playerATK * 0.25;
      if (bs.flags.enemy_is_burning) {
        // +50% of the burn value as bonus hit damage (= +12.5% ATK), now mitigated
        bs.playerAtkMult += 0.25 * 0.50;
        bs.log.push('🔥 Surt: Muspell\'s Flame — Burn refreshed! +50% bonus vs burning!');
      }
      bs.applyDebuff('burn', 2, burnDmg);
    }
  },

  'heimdall_eternal_vigilance': (bs) => {
    // First hit taken each battle negated by 50% — engine consumes on that hit
    if (!bs.flags.heimdall_first_hit_used) {
      bs.flags.heimdall_first_hit_available = true;
    }
  },

  'baldur_invulnerability': (bs) => {
    // Once/battle, first turn debuffed OR below 50% HP: cleanse + heal 10% max HP
    if (!bs.flags.baldur_used &&
        (bs.hasPlayerDebuff('any') || bs.playerHP <= bs.playerMaxHP * 0.50)) {
      bs.flags.baldur_used = true;
      bs.clearPlayerDebuffs();
      const heal = Math.floor(bs.playerMaxHP * 0.10);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`✨ Baldur: Invulnerability — Debuffs cleansed! Healed ${heal} HP!`);
    }
  },

  'hel_half_dead': hpThresholdBuff(0.50, 0.15, 0.15),

  'mimir_runic_knowledge': (bs) => {
    // Every 4 turns: the next attack (this round's, passives precede actions)
    // deals 65% more damage — applied as a mitigated ATK multiplier (+65% of the hit).
    if (bs.currentTurn % 4 === 0) {
      bs.flags.mimir_next_attack_bonus = 0.65;
      bs.log.push('📖 Mimir: Runic Knowledge — Next attack +65% damage!');
    }
    if (bs.flags.mimir_next_attack_bonus > 0) {
      bs.playerAtkMult += bs.flags.mimir_next_attack_bonus; // mitigated +65% of damage dealt
      bs.flags.mimir_next_attack_bonus = 0;
    }
  },

  'freyr_harvest_bounty': regenSelf(2, 0.05,
    (heal) => `🌾 Freyr: Harvest Bounty — Restored ${heal} HP!`),

  'njord_seas_favor': chanceFlag(0.15, 'njord_block_check',
    '🌊 Njord: Sea\'s Favor — Incoming damage reduced by 30%!',
    (bs) => { bs.flags.njord_block_pct = 0.30; }),

  'bragi_battle_hymn': (bs) => {
    // Every 3 turns: ATK +8% for 2 turns (windowed buff)
    if (bs.currentTurn % 3 === 0) {
      bs.flags.bragi_buff_turns = 2;
      bs.log.push('🎵 Bragi: Battle Hymn — ATK +8% for 2 turns!');
    }
    if (bs.flags.bragi_buff_turns > 0) {
      bs.playerAtkMult += 0.08;
      bs.flags.bragi_buff_turns -= 1;
    }
  },

  'idunn_golden_apple': oncePerBattleHeal('idunn_used', 0.50, 0.15,
    (heal) => `🍎 Idunn: Golden Apple — Restored ${heal} HP!`, true),

  'vidar_silent_vengeance': (bs) => {
    // When hit by a crit (engine latch), the next attack auto-crits; consumes latch
    if (bs.flags.player_was_critted) {
      bs.nextAttackAutoCrit = true;
      bs.flags.player_was_critted = false;
      bs.log.push('⚔️ Vidar: Silent Vengeance — Auto-CRIT next attack!');
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

  // [Jun-2026 §4] +100% ATK (was +80%); unchanged: every 3rd turn, enemy DEF -20% for 1 turn.
  'zeus_thunder_sovereign': everyNthRider(3, 1.00, null, (bs) => {
    if (!bs.enemyImmune('def_down')) {
      bs.applyDebuff('def_down', 1, 0.20);
    }
    bs.log.push('⚡ Zeus: Thunder Sovereign — +100% ATK! Enemy DEF -20%!');
  }),

  'ares_blood_frenzy': stackingAtk('ares_stack', 0.08, 0.40, 2),

  'poseidon_tidal_force': everyNthRider(4, 0.60, null, (bs) => {
    if (bs.rng() < 0.40 && !bs.enemyImmune('stun')) {
      bs.applyDebuff('stun', 1);
      bs.log.push('🌊 Poseidon: Tidal Force — +60% ATK + Enemy Stunned!');
    } else {
      bs.log.push('🌊 Poseidon: Tidal Force — +60% ATK!');
    }
  }),

  'hades_soul_harvest': (bs) => {
    // When enemy HP < 30% (live %, shared pool % for bosses): ATK +35% latched
    if (bs.enemyHP / bs.enemyMaxHP < 0.30) {
      bs.flags.hades_harvest_active = true;
    }
    if (bs.flags.hades_harvest_active) {
      bs.playerAtkMult += 0.35;
      if (!bs.flags.hades_harvest_logged) {
        bs.flags.hades_harvest_logged = true;
        bs.log.push('💀 Hades: Soul Harvest — Enemy HP critical! ATK +35% for battle!');
      }
    }
  },

  'hera_divine_wrath': (bs) => {
    // When hit by crit: DEF +10% and ATK +10%, stacking up to 3× (latch not consumed)
    if (!bs.flags.hera_stacks) bs.flags.hera_stacks = 0;
    if (bs.flags.player_was_critted && bs.flags.hera_stacks < 3) {
      bs.flags.hera_stacks += 1;
      bs.log.push(`👑 Hera: Divine Wrath — Crit received! Stack ${bs.flags.hera_stacks}/3 — DEF+10%, ATK+10%!`);
    }
    if (bs.flags.hera_stacks > 0) {
      bs.playerAtkMult += bs.flags.hera_stacks * 0.10;
      bs.playerDefMult += bs.flags.hera_stacks * 0.10;
    }
  },

  'athena_aegis_shield': (bs) => {
    // First 2 hits received reduced 40% — engine owns the absorb counter (cap 2)
    if (!bs.flags.athena_hits_absorbed) bs.flags.athena_hits_absorbed = 0;
    bs.flags.athena_shield_active = bs.flags.athena_hits_absorbed < 2;
  },

  'apollo_solar_radiance': constantSelfBuff(0.20, 0, 0),

  'artemis_huntress_precision': (bs) => {
    // First attack each battle auto-crits; every 4 turns auto-crit
    if (!bs.flags.artemis_first_used) {
      bs.flags.artemis_first_used = true;
      bs.nextAttackAutoCrit = true;
      bs.log.push('🏹 Artemis: Huntress Precision — First attack auto-CRIT!');
    } else if (bs.currentTurn % 4 === 0) {
      bs.nextAttackAutoCrit = true;
      bs.log.push('🏹 Artemis: Huntress Precision — Auto-CRIT this turn!');
    }
  },

  'hephaestus_forged_armor': (bs) => {
    // DEF +20% all battle; HP < 50%: ATK +15%
    bs.playerDefMult += 0.20;
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerAtkMult += 0.15;
    }
  },

  'aphrodite_enchanting_aura': (bs) => {
    // 20% chance each turn to charm the enemy (skips its attack via the debuff)
    const proc = bs.rng() < 0.20;
    bs.flags.aphrodite_charm_check = false;
    if (proc && !bs.enemyImmune('charm')) {
      bs.flags.aphrodite_charm_check = true;
      bs.applyDebuff('charm', 1);
      bs.log.push('💗 Aphrodite: Enchanting Aura — Enemy charmed! Skips attack!');
    }
  },

  'persephone_cycle_of_renewal': oncePerBattleHeal('persephone_used', 0.50, 0.20,
    (heal) => `🌸 Persephone: Cycle of Renewal — Restored ${heal} HP!`),

  'dionysus_drunken_haze': (bs) => {
    // 30% chance each turn: enemy attacks itself (30% of its own ATK)
    if (bs.rng() < 0.30) {
      const selfDmg = Math.floor(bs.enemyATK * 0.30);
      bs.enemyHP = Math.max(bs.enemyHP - selfDmg, 0);
      bs.log.push(`🍷 Dionysus: Drunken Haze — Enemy attacks itself! ${selfDmg} DMG!`);
    }
  },

  'nike_wings_of_victory': constantSelfBuff(0.25, 0, 0),

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

  'sigbin_shadow_step': chanceFlag(0.20, 'sigbin_evade_check',
    '👤 Sigbin: Shadow Step — Evaded your attack!'),

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
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('def_down', 1, 0.10);
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

  'lamia_serpent_bite': chancePlayerDebuff(0.30,
    [{ tag: 'bleed', turns: 2, valueFn: (bs) => bs.enemyATK * 0.35 }],
    '🐍 Lamia: Serpent Bite — Bleed applied! (35% ATK for 2 turns)'),

  'minotaur_labyrinth_charge': everyNthEnemyNuke(3,
    (bs) => (bs.playerHP > bs.playerMaxHP * 0.70 ? 2.20 : 1.80),
    (pct) => `🐂 Minotaur: Labyrinth Charge — ${Math.round(pct * 100)}% ATK!`),

  'cyclops_boulder_throw': everyNthEnemyNuke(4, 1.60,
    '🗿 Cyclops: Boulder Throw — 160% ATK + Player Stunned!',
    (bs) => {
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('stun', 1);
      }
    }),

  'chimera_tri_form_assault': (bs) => {
    // Rotates per round: Lion (140% ATK) → Goat (player DEF -20%) → Serpent (Burn)
    const phase = (bs.currentTurn - 1) % 3;
    if (phase === 0) {
      bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * 1.40; // 140% ATK total (mitigated)
      bs.log.push('🦁 Chimera: Lion Claw — 140% ATK!');
    } else if (phase === 1) {
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('def_down', 1, 0.20);
      }
      bs.log.push('🐐 Chimera: Goat Ram — Your DEF -20%!');
    } else {
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('burn', 2, bs.enemyATK * 0.30);
      }
      bs.log.push('🐍 Chimera: Serpent Bite — Burn! 30% ATK for 2 turns!');
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

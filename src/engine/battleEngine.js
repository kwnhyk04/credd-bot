'use strict';

/**
 * BATTLE ENGINE — CREDD BOT v4 (Phase 6)
 *
 * The pure combat resolver every battle feature (raid / duel / boss) calls.
 * PURITY CONTRACT: no DB, no Discord, no Math.random. All randomness comes from
 * one seeded stream (rngOf(seed), injectable for tests via opts.rng). Given the
 * same fighters + seed the result is byte-identical.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RNG DRAW ORDER (part of the contract — a seed fully determines a battle):
 *   PRE-BATTLE
 *     1. actor-order roll (raid consumes the legacy order draw for stream stability but
 *        always starts with the player. Boss skips the draw and starts with the player
 *        unless special_flags.first_strike is set. Duel/PvP consumes the 50/50 draw.)
 *   PER ROUND
 *     2. pre-rolls, in actor order, for each PLAYER-kind side:
 *        a. crit pre-roll (1 draw, ALWAYS — voided if the side is skip-CC'd; also voided,
 *           with the draw still consumed, on a Mage's overcharge round (every 3rd) where the
 *           entire attack cannot crit — §13.1)
 *        b. Fighter 25% class-stun pre-roll (1 draw, only if class passive is 'stun')
 *     3. passive phase (round-bound registry draws, in invocation order):
 *        raid/boss → A.weapon → A.deity → mob skill (all on A's perspective)
 *        duel      → first actor's weapon → deity, then second actor's weapon → deity
 *     4. actions in actor order:
 *        PLAYER attack: attack-start weapon draws → main-hit variance (1 draw) →
 *        landed-hit weapon draws → [Swordsman] bleed draw (1, only
 *        when the main hit lands — RESERVED for stream stability; the bleed value is now
 *        a deterministic 4%/stack) → primary-only additional-attack generator
 *        rolls → queued additional attacks in Labrys → Glacial Bow → Archer order.
 *        Each additional attack receives fresh attack-bound, class, crit, variance,
 *        landed-hit, and defensive rolls, but generator hooks are disabled.
 *        MOB attack: per sub-hit → crit (1 draw) + variance (1 draw)
 *
 * ROUND PIPELINE (§35.1/§13.1, rulings R1–R9):
 *   round start → reset per-round scratch + derived flags → latch input flags
 *   (enemy_is_* / player_was_critted) → determine skip-CC →
 *   crit/class-stun pre-rolls → passive phase (each passive exactly once per round;
 *   attack-bound work is queued for the action/landed-hit hooks; death
 *   check after every registry call) → consume hydra local regen / bathala HP flag →
 *   clear consumed latches → actions in actor order; after each side acts, its DOT
 *   ticks before the next side can act → stat-debuff expiry, sudden-death drain (round ≥ 30),
 *   snapshot per mode cadence. Hard cap round 50 (§35.3).
 *
 * LOG DISPLAY ORDER ([Jun-2026]): round passives resolve before attacks; queued weapon
 *   hooks resolve with their attack. Each round's log is re-sequenced for readability to
 *   [attacks + their own DOT] → [passive procs] → [sudden-death], so a side's proc reads
 *   as the consequence shown after its attack. Only sim.rounds[].events ordering changes.
 *
 * SNAPSHOT CADENCE ([v4.2], mode-dependent — the renderer's edit loop consumes
 *   whatever arrives; the start + final snapshots are always present):
 *     duel/raid → rounds 1,4,16,…   boss → every 3rd round
 *
 * MAGE OVERCHARGE (§11/§13.1): on every 3rd round (rounds 3,6,9,…) the Mage's PRIMARY
 *   attack is ×(2.75 + damage%/100) and cannot crit. The pre-roll latch and
 *   nextAttackAutoCrit are ignored for that attack. Additional attacks in the same
 *   action never inherit Overcharge; they keep fresh crit rolls and normal multipliers.
 *   Skip-CC on a multiple of 3 → the action never runs → that overcharge is simply lost
 *   (no carry-over); the next fires on the next multiple of 3.
 *
 * DAMAGE PIPELINE (per hit) — ONE unified rule (§35.2 / config/combat):
 *   base = effATK × (1 − effDEF/(effDEF+200)) × variance(0.90–1.10)
 *   then exactly one multiplier:
 *     overcharge (Mage 3rd-round primary): ×(2.75 + damage%/100), no crit
 *     otherwise:                   ×((critLevel ? 2.0 : 1) + damage%/100)
 *   critLevel = a rolled crit OR a Double (Idiyanale, a guaranteed crit-level hit that DOES
 *   take the rider). damage% = weapon bonusDmgPct + procced sources (Katana +30, future
 *   deity blessings via scratch.damageBonusPct), summed additively, applied to crit AND
 *   non-crit. Supreme 50% → ×1.5 / ×2.5; Supreme + double → ×2.5; Supreme + deity 50% (proc)
 *   → ×2.0 / ×3.0. Mob "X% ATK" nukes are a clean ×(pct) and do
 *   not also crit. (+X% ATK riders scale effATK pre-mitigation — see playerAtkMult.)
 *   → floor → defender stack (R3) → apply → death check (§35.3 first-to-0, R5)
 *
 * DEFENDER STACK (R3, fixed order):
 *   player defender: evasion -> full-hit negation -> raw post-DEF damage ->
 *   collect every damage-reduction source into one additive total (capped at
 *   70%) -> apply incoming-damage increases -> Brokkr per-hit cap -> apply
 *   damage -> resolve each reflect source separately on final damage taken ->
 *   on-hit armor stacks. Reflected damage never enters this defender stack, so
 *   it cannot itself be reflected.
 *   mob defender: sigbin evade (round-scoped) → dwarf stone-skin absorb (consumed).
 *
 * DEF_DOWN COMBINATION (R8): all def_down sources (the def_down debuff — itself
 * merged highest-value — and the Laevateinn stack) combine HIGHEST-WINS, never
 * multiplicatively. Armor pierce is a separate highest-wins lane, gated by
 * armor_pierce immunity (incl. Gungnir full pierce and Archer class pierce).
 */

const PASSIVE_REGISTRY = require('./passiveRegistry');
const {
  FENRIR_PASSIVE_KEY,
  reconcileFenrirPhase,
  fenrirPhaseAnnouncement,
} = PASSIVE_REGISTRY;
const {
  LOG_PRIORITY: LOG,
  CombatLog,
  orderEvents,
  finalizeRound,
  dotOrderIndex,
} = require('./combatLog');
const {
  CRIT_MULT, OVERCHARGE_MULT, hitMultiplier,
  AEGIS_DR_PER_STACK, AEGIS_STACKS_TO_PETRIFY, AEGIS_PETRIFY_DAMAGE_AMP,
  PETRIFY_DEFAULT_DAMAGE_AMP,
} = require('../config/combat');
const { CLASS_PASSIVE_VALUES } = require('../config/classes');
const {
  EFFECT_CATEGORY,
  EFFECT_DEFINITIONS,
  CANONICAL_ON_HIT_EFFECTS,
  BLEED_TAG,
  effectCategory,
  effectHasTag,
  isCrowdControlEffect,
  isStatusEffect,
  isRecurringDamageEffect,
  removeEffectsByCategory,
} = require('./combatEffects');

const MAX_ROUNDS = 50;
const SUDDEN_DEATH_FROM = 30;     // player sides lose 10% max HP at end of every round ≥ 30 (mobs/bosses exempt)
const SUDDEN_DEATH_PCT = 0.10;
const SNAPSHOT_EVERY = 3;
// A debuff applied after a landed hit is armed for the next action window. The
// end-of-round decrement makes turnsLeft=2 equivalent to one affected turn.
const LANDED_STAT_DEBUFF_TURNS = 2;
const MITIGATION_K = 200;         // §12: 1 − DEF/(DEF+200)
const ARCHER_PIERCE = CLASS_PASSIVE_VALUES.Archer.defenseIgnore;
const ARCHER_DOUBLE_ATTACK_CHANCE = CLASS_PASSIVE_VALUES.Archer.doubleAttackChance;
const FIGHTER_DAMAGE_BONUS = CLASS_PASSIVE_VALUES.Fighter.damageBonus;
const FIGHTER_STUN_CHANCE = CLASS_PASSIVE_VALUES.Fighter.stunChance;
const FIGHTER_STUN_TURNS = CLASS_PASSIVE_VALUES.Fighter.stunTurns;
const FIGHTER_BASH_DAMAGE_PCT = CLASS_PASSIVE_VALUES.Fighter.bashDamage;
const FIGHTER_DIZZY_MISS_CHANCE = CLASS_PASSIVE_VALUES.Fighter.dizzyMissChance;
const KNIGHT_DAMAGE_REDUCTION = CLASS_PASSIVE_VALUES.Knight.damageReduction;
const KNIGHT_HEAL_PCT = CLASS_PASSIVE_VALUES.Knight.regeneration;
const SWORDSMAN_ATK_PER_TURN = CLASS_PASSIVE_VALUES.Swordsman.atkPerTurn;
const SWORDSMAN_ATK_MAX = CLASS_PASSIVE_VALUES.Swordsman.atkMax;
const MAX_DAMAGE_REDUCTION = 0.70;

// Charmed Hide's ongoing resist covers only these three. The first-CC nullify is
// separate and applies to any crowd-control tag.
const CHARMED_HIDE_RESIST_TAGS = new Set(['stun', 'petrify', 'freeze']);
// Bosses are immune to every target-max-HP damage lane and its marker effects.
// This remains true even for roster rows carrying `no_immunities`.
const ABSOLUTE_BOSS_IMMUNITY_TAGS = new Set([
  'boss_immune', 'hp_pct_dot', 'rupture', 'hemorrhage',
]);

// Tyrfing execute thresholds, as a fraction of the target's max HP. Player-character
// targets (both sides of a duel are kind 'player') use the lower bar; bosses are
// immune entirely and are checked before either threshold applies.
const TYRFING_EXECUTE_PCT_MOB = 0.10;
const TYRFING_EXECUTE_PCT_PLAYER = 0.05;
const OVERCHARGE_EVERY = 3;       // [v4.2] fires on rounds 3, 6, 9, …
const BLEED_PCT_PER_STACK = CLASS_PASSIVE_VALUES.Swordsman.bleedPerAttack;
const BLEED_MAX_PCT = CLASS_PASSIVE_VALUES.Swordsman.bleedMax;
const BLEED_MAX_STACKS = Math.ceil(BLEED_MAX_PCT / BLEED_PCT_PER_STACK);
const KNIGHT_OUTGOING_BONUS = CLASS_PASSIVE_VALUES.Knight.outgoingDamageBonus;

const SKIP_TAGS = ['stun', 'paralyze', 'freeze', 'petrify', 'charm', 'confuse', 'miss'];
// Thor uses separate linked status and DOT IDs so status immunity never blocks damage.
const DOT_TAGS = Object.keys(EFFECT_DEFINITIONS).filter(isRecurringDamageEffect);
const DOT_DEATH_TEXT = {
  bleed: 'bleeding',
  burn: 'burning',
  venom: 'poisoning',
  poison: 'poisoning',
  hp_pct_dot: 'rot',
  thor_paralyze_dot: 'paralysis',
};
const DOT_DEATH_CAUSE = {
  venom: 'Venom',
  poison: 'Poison',
  bleed: 'Bleed',
  burn: 'Burn',
  hp_pct_dot: 'Rot',
  thor_paralyze_dot: 'Paralysis',
};

const ACTION_TAG_LABELS = {
  bleed: 'Bleed', burn: 'Burn', venom: 'Poison', poison: 'Poison', hp_pct_dot: 'Rot', stun: 'Stun', freeze: 'Freeze',
  paralyze: 'Paralyze', petrify: 'Petrify', charm: 'Charm', confuse: 'Confuse',
  miss: 'Miss', def_down: 'DEF Down', atk_down: 'ATK Down', crit_down: 'CRIT Down', darkened: 'Darkened',
  thor_paralyze: 'Paralyze', thor_paralyze_dot: 'Paralysis', frostbite: 'Frostbite',
};

const OVERCHARGE_DEBUFFS = Object.freeze([
  Object.freeze({ tag: 'paralyze', label: 'Paralyze' }),
  Object.freeze({ tag: 'burn', label: 'Burn' }),
  Object.freeze({ tag: 'def_down', label: 'DEF Down' }),
  Object.freeze({ tag: 'atk_down', label: 'ATK Down' }),
]);

/** Map one injected RNG draw onto exactly one equal-probability Overcharge effect. */
function selectOverchargeDebuff(roll) {
  const normalized = Number.isFinite(Number(roll))
    ? Math.max(0, Math.min(0.9999999999999999, Number(roll)))
    : 0;
  return OVERCHARGE_DEBUFFS[Math.floor(normalized * OVERCHARGE_DEBUFFS.length)];
}

function actionState(side) {
  return {
    hp: side.hp,
    debuffs: side.debuffs.map((d) => ({
      tag: d.tag,
      category: d.category,
      turnsLeft: d.turnsLeft,
      value: d.value,
    })),
  };
}

function combatantName(side) {
  return String(side?.name || side?.in?.username || side?.in?.displayName || side?.in?.name || 'Combatant');
}

function actionNameForWeapon(name) {
  const n = String(name || '').toLowerCase();
  if (/bow|crossbow/.test(n)) return 'Arrow Volley';
  if (/staff|wand|caduceus/.test(n)) return 'Arcane Burst';
  if (/hammer|mjolnir/.test(n)) return 'Crushing Blow';
  if (/spear|trident|gungnir/.test(n)) return 'Piercing Thrust';
  if (/shield|aegis/.test(n)) return 'Shield Bash';
  if (/fist|knuckle|glove|jarngreipr/.test(n)) return 'Heavy Blow';
  if (/sword|blade|katana|cutlass|labrys|axe/.test(n)) return 'Blade Strike';
  return 'Battle Strike';
}

function passiveActionName(side, events) {
  const sources = [side.in.weaponName, side.in.deityName].filter(Boolean);
  for (let i = events.length - 1; i >= 0; i--) {
    for (const source of sources) {
      const marker = `${source}:`;
      const at = events[i].indexOf(marker);
      if (at < 0) continue;
      const action = events[i].slice(at + marker.length).split('—')[0].trim();
      if (action) return action;
    }
  }
  return null;
}

function damageFromEvents(side, events) {
  let damage = 0;
  let crit = false;
  let evaded = false;
  for (const event of events) {
    const isOwnHit = event.includes(`${side.name} attacks`) ||
      event.includes(`${side.name} strikes again`) ||
      event.includes(`${side.name} strikes`) ||
      event.includes(`${side.name}'s Auto-Fire`);
    if (!isOwnHit) continue;
    const m = /for \*\*(\d+) DMG\*\*/.exec(event);
    if (m) damage += Number(m[1]);
    if (event.includes('CRIT!')) crit = true;
    if (event.includes('Evaded!') || event.includes('evaded')) evaded = true;
  }
  return { damage, crit, evaded };
}

function inflictedDebuffs(before, after) {
  const old = new Map(before.debuffs.map((d) => [d.tag, d]));
  return after.debuffs.filter((d) => {
    const prev = old.get(d.tag);
    return !prev || d.turnsLeft > prev.turnsLeft || Number(d.value) > Number(prev.value);
  });
}

/** Compact, structured turn text for layout-driven battle action boxes. */
function summarizeAction(side, opp, beforeSelf, beforeOpp, afterSelf, afterOpp, events) {
  const unable = events.some((e) => e.includes(`${side.name} is unable to act`));
  const hit = damageFromEvents(side, events);
  const effects = inflictedDebuffs(beforeOpp, afterOpp);

  let title;
  if (unable) title = 'Unable to act';
  else if (side.kind === 'mob') title = side.in.skillName || 'Enemy Strike';
  else title = `Casts ${passiveActionName(side, events) || actionNameForWeapon(side.in.weaponName)}`;

  const detail = [];
  if (hit.damage > 0) detail.push(`−${hit.damage.toLocaleString()} HP to ${opp.name}${hit.crit ? ' (CRIT)' : ''}`);
  else if (hit.evaded) detail.push('Attack evaded');

  for (const effect of effects.slice(0, 2)) {
    const label = ACTION_TAG_LABELS[effect.tag] || effect.tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    detail.push(`${label} inflicted (${effect.turnsLeft} turn${effect.turnsLeft === 1 ? '' : 's'})`);
  }

  const healed = Math.max(0, afterSelf.hp - beforeSelf.hp);
  if (healed > 0) detail.push(`+${healed.toLocaleString()} HP recovered`);
  if (unable && detail.length === 0) {
    const tags = beforeSelf.debuffs.filter((d) => SKIP_TAGS.includes(d.tag)).map((d) => d.tag);
    if (tags.length) detail.push(tags.join(', '));
  }
  if (detail.length === 0) detail.push('No damage dealt');

  return { title, detail: detail.join(' • ') };
}

function isPowerOfFourRound(round) {
  if (round < 1) return false;
  let n = round;
  while (n > 1 && n % 4 === 0) n /= 4;
  return n === 1;
}

const findDebuff = (side, tag) => side.debuffs.find((d) => d.tag === tag);
const debuffValue = (side, tag) => { const d = findDebuff(side, tag); return d ? d.value : 0; };

const sideImmune = (side, tag) => {
  // These are absolute boss protections. `no_immunities` only strips the
  // ordinary roster immunity tags; it never enables execute or max-HP
  // percentage damage against a boss.
  if (side.isBoss && ABSOLUTE_BOSS_IMMUNITY_TAGS.has(tag)) return true;
  if (side.isBoss && side.specialFlags.no_immunities === true) return false;
  if (side.kind !== 'mob') return false;
  return side.immunityTags.includes('all_debuffs') || side.immunityTags.includes(tag);
};

const debuffImmune = (side, tag) =>
  sideImmune(side, tag) || (side.kind === 'player' && side.statusImmune && isStatusEffect(tag));

/** True when the weapon OR the equipped armor carries this passive key. */
const hasEquippedPassive = (side, key) =>
  side.weaponPassiveKey === key || side.armorPassiveKey === key;

/** Seeded LCG in [0,1). Same generator the renderer's replay relies on. */
function rngOf(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const applyHitToDefender = (bt, fx, S, O, dmg, info = {}) => {
  const prepareConfirmedHit = () => {
    if (typeof info.prepareLandedHit !== 'function') return;
    const prepared = info.prepareLandedHit(dmg);
    if (Number.isFinite(prepared)) dmg = prepared;
  };
  if (O.kind === 'mob') {
    // mob defenses live on the attacking player's flags (mob skills run there)
    if (S.flags.sigbin_evade_check && !S.flags.attacks_cannot_miss) {
      bt.shared.events.push(`👤 ${O.name} evades the attack (Shadow Step)!`);
      return { applied: 0, negated: true, evaded: true };
    }
    prepareConfirmedHit();
    if (S.flags.dwarf_shield_active) {
      const absorbed = Math.min(dmg, S.flags.dwarf_shield_cap || 0);
      dmg -= absorbed;
      S.flags.dwarf_shield_active = false;
      if (absorbed > 0) bt.shared.events.push(`⛏️ ${O.name}'s Stone Skin absorbs ${absorbed} damage!`);
    }
    dmg = fx.effectDamage(O, dmg);
    fx.damage(O, dmg);
    fx.checkDeaths('attack');
    return { applied: Math.floor(dmg), negated: false };
  }

  const F = O.flags;
  if (F.amihan_evade_check && !S.flags.attacks_cannot_miss) {
    bt.shared.events.push(`💨 ${O.name} evades the attack (Tailwind)!`);
    F.amihan_evade_bonus_stacks = (F.amihan_evade_bonus_stacks || 0) + 1;
    return { applied: 0, negated: true, evaded: true };
  }
  if (F.loki_evade_check && !S.flags.attacks_cannot_miss) {
    bt.shared.events.push(`🃏 ${O.name} evades the attack (Illusory Double)!`);
    const counter = Math.max(0, Math.floor(F.loki_counter_dmg || 0));
    // Illusory Double evades one attack per successful turn roll. Consume it
    // before countering so multi-hit attackers do not trigger unlimited counters.
    F.loki_evade_check = false;
    F.loki_counter_dmg = 0;
    if (counter > 0) {
      const appliedCounter = Math.floor(fx.effectDamage(S, counter));
      const counterTargetHpBefore = S.hp;
      fx.damage(S, appliedCounter);
      fx.logAt(LOG.REFLECT, `🃏 Loki's counter strikes ${S.name} for ${appliedCounter} DMG!`);
      if (appliedCounter > 0 && O.hp > 0 && O.flags.soul_drain_pct > 0) {
        fx.applyLifesteal(
          O,
          Math.min(appliedCounter, counterTargetHpBefore),
          O.flags.soul_drain_pct,
          'Soul Drain',
        );
      }
      fx.checkDeaths('counter');
    }
    return { applied: 0, negated: true, evaded: true };
  }

  if (F.chooser_grace_active && !S.flags.attacks_cannot_miss) {
    const chance = Number.isFinite(F.chooser_grace_chance) ? F.chooser_grace_chance : 0.22;
    if (bt.rng() < chance) {
      F.chooser_grace_chance = 0.22;
      bt.shared.events.push("👻 Chooser's Grace — evaded! (chance reset to 22%)");
      return { applied: 0, negated: true, evaded: true };
    }
  }
  if (F.helm_darkness_active && !S.flags.attacks_cannot_miss && bt.rng() < 0.30) {
    F.unseen_pending = true;
    bt.shared.events.push('🌑 Veil of Hades — evaded! You are Unseen: next attack ignores 50% DEF.');
    return { applied: 0, negated: true, evaded: true };
  }

  if (F.gridr_ironhide_active && bt.rng() < 0.20) {
    bt.shared.events.push('🛡️ Ironhide — incoming hit ignored entirely!');
    return { applied: 0, negated: true };
  }

  // Shieldmaiden's Guard: 10% chance to fully negate a hit and reflect 60% of it.
  // Returning here is what prevents the double-dip — the flat 20% reflect entry in
  // reflectSources below is never reached on a negated hit.
  //
  // 60% of WHAT: `wouldBeDamage` is post-DEF-mitigation and post Frostbite/Petrify
  // amplification, but before the defender's percentage reduction lane. That lane
  // never runs on a negated hit, so no post-reduction figure exists to use instead —
  // this is the only well-defined basis, and it is the same one the passive already
  // used at 100%.
  const wouldBeDamage = fx.effectDamage(O, dmg);
  if (F.skjaldmaer_active && bt.rng() < 0.10) {
    bt.shared.events.push("🛡️ Shieldmaiden's Guard — incoming hit negated!");
    fx.applyReflectedDamage(O, S, wouldBeDamage, 0.60, "Shieldmaiden's Guard");
    return { applied: 0, negated: true };
  }

  prepareConfirmedHit();
  dmg = fx.effectDamage(O, dmg);

  const postDefDmg = dmg;
  let damageReduction = Math.max(0, O.scratch.damageReductionPct || 0);
  const incomingIncrease = Math.max(0, O.scratch.incomingDamageIncreasePct || 0);
  let odinReduction = 0;

  // Phalanx Wall: the registry already folded its base 20% into damageReductionPct
  // this round. The first incoming hit of the battle adds the 30% first-hit bonus and
  // reports the COMBINED 50%; every later hit reports the base 20%. Exactly one line
  // per incoming attack, at DEFENSIVE priority so it sits directly under the attack
  // that triggered it and above Thorns/DOT. Numbers are unchanged — only the logging.
  if (F.phalanx_wall_active) {
    if (!F.phalanx_first_hit_used) {
      F.phalanx_first_hit_used = true;
      damageReduction += 0.30;
      bt.shared.events.push(`🛡️ ${O.name}'s Phalanx Wall — first hit absorbed, damage reduced by 50%.`);
    } else {
      bt.shared.events.push(`🛡️ ${O.name}'s Phalanx Wall — damage taken reduced by 20%.`);
    }
  }
  if (F.heimdall_first_hit_available && !F.heimdall_first_hit_used) {
    damageReduction += 0.50;
    F.heimdall_first_hit_used = true;
    F.heimdall_first_hit_available = false;
    bt.shared.events.push(`👁️ Heimdall negates 50% of the first hit on ${O.name}!`);
  } else if (info.crit && F.heimdall_crit_guard) {
    damageReduction += 0.30;
    bt.shared.events.push(`👁️ Heimdall blunts a critical hit on ${O.name} (-30%)!`);
  }
  if (F.athena_shield_active && (F.athena_hits_absorbed || 0) < 2) {
    damageReduction += 0.40;
    F.athena_hits_absorbed = (F.athena_hits_absorbed || 0) + 1;
    if (F.athena_hits_absorbed >= 2) F.athena_shield_active = false;
    bt.shared.events.push(`🛡️ Athena's Aegis absorbs 40% (${F.athena_hits_absorbed}/2)!`);
  } else if ((F.athena_hits_absorbed || 0) >= 2) {
    damageReduction += 0.10;
    bt.shared.events.push("🛡️ Athena's Aegis reduces the incoming hit by 10%!");
  }
  if (F.odin_foresight_block) {
    odinReduction = 0.25;
    damageReduction += odinReduction;
    bt.shared.events.push(`🪄 Odin: All-Father's Foresight — Reduced incoming damage by 25%!`);
  }
  if (F.steel_kite_shield_block) {
    damageReduction += 0.15;
    bt.shared.events.push('🛡️ Steel Kite Shield: Bulwark — Blocked 15% incoming damage!');
  }
  if (F.pelte_active && bt.rng() < 0.20) {
    damageReduction += 0.50;
    bt.shared.events.push('🛡️ Deflection — blocked half of the incoming hit!');
  }
  if (F.njord_block_check) {
    damageReduction += F.njord_block_pct || 0;
    bt.shared.events.push("🌊 Njord: Sea's Favor — Reduced incoming damage by 30%!");
  }
  if (F.echo_njord_block_check) {
    damageReduction += F.echo_njord_block_pct || 0;
    bt.shared.events.push("🌊 Echo · Njord: Sea's Favor — Reduced incoming damage by 20%!");
  }
  if (O.classPassive === 'damage_reduction') damageReduction += KNIGHT_DAMAGE_REDUCTION;

  const cappedReduction = Math.min(MAX_DAMAGE_REDUCTION, damageReduction);
  dmg *= Math.max(0, 1 - cappedReduction + incomingIncrease);
  dmg = Math.max(0, Math.floor(dmg));
  if (odinReduction > 0) {
    const withoutOdinReduction = Math.min(
      MAX_DAMAGE_REDUCTION,
      Math.max(0, damageReduction - odinReduction),
    );
    const withoutOdin = Math.max(
      0,
      Math.floor(postDefDmg * Math.max(0, 1 - withoutOdinReduction + incomingIncrease)),
    );
    const prevented = Math.max(0, withoutOdin - dmg);
    F.odin_prevented_damage = (F.odin_prevented_damage || 0) + prevented;
  }

  if (F.mail_brokkr_hit_cap > 0) {
    const cap = Math.floor(O.maxHp * F.mail_brokkr_hit_cap);
    if (dmg > cap) {
      const uncapped = dmg;
      dmg = cap;
      bt.shared.events.push(`⚒️ Dwarven Forge — hit capped at 15% max HP (${uncapped} -> ${cap}).`);
    }
  }

  if (dmg >= O.hp && F.sidapa_reprieve_available && !F.sidapa_reprieve_used) {
    F.sidapa_reprieve_used = true;
    F.sidapa_reprieve_available = false;
    const applied = O.hp - 1;
    fx.setHp(O, 1);
    const revive = Math.floor(O.maxHp * 0.30);
    fx.setHp(O, Math.min(1 + revive, O.maxHp));
    F.sidapa_atk_bonus = 0.50;
    if (info.crit) fx.recordReceivedCrit(O);
    bt.shared.events.push(`🌙 Sidapa's Death's Reprieve! ${O.name} survives, heals ${revive} HP, ATK +50%!`);
    fx.grantValkyrieResolve(O);
    fx.grantAegisStone(O, S);
    return { applied, negated: false };
  }

  if (dmg >= O.hp && F.titan_reprieve_available && !F.titan_reprieve_used) {
    F.titan_reprieve_used = true;
    F.titan_reprieve_available = false;
    const applied = O.hp - 1;
    fx.setHp(O, 1);
    F.titan_atk_bonus = 1.00;
    if (info.crit) fx.recordReceivedCrit(O);
    bt.shared.events.push(`🔥 Titan: Forgefire Veins — ${O.name} survives at 1 HP, damage +100%!`);
    fx.grantValkyrieResolve(O);
    fx.grantAegisStone(O, S);
    return { applied, negated: false };
  }

  const beforeHp = O.hp;
  fx.damage(O, dmg);
  const damageTaken = beforeHp - O.hp;
  if (fx.checkDeaths('attack')) return { applied: dmg, negated: false };

  const reflectSources = [
    [F.enderby_reflect_pct || 0, 'Thornward'],
    [F.skjaldmaer_reflect_pct || 0, "Shieldmaiden's Guard"],
    [F.mail_brokkr_reflect || 0, 'Dwarven Forge'],
    [F.tyr_reflect || 0, 'Oathkeeper'],
    [F.mayari_reflect || 0, 'Lunar Veil'],
    [F.rune_thorns_reflect || 0, 'Thorns Rune'],
  ];
  for (const [pct, source] of reflectSources) {
    if (pct > 0 && damageTaken > 0 && fx.applyReflectedDamage(O, S, damageTaken, pct, source)) {
      return { applied: dmg, negated: false };
    }
  }

  if (F.chooser_grace_active) {
    const current = Number.isFinite(F.chooser_grace_chance) ? F.chooser_grace_chance : 0.22;
    F.chooser_grace_chance = Math.min(1, current + 0.08);
    bt.shared.events.push(
      `👻 Chooser's Grace — hit taken, evade chance now ${Math.round(F.chooser_grace_chance * 100)}%`
    );
  }
  fx.grantValkyrieResolve(O);
  fx.grantAegisStone(O, S);
  if (info.crit) fx.recordReceivedCrit(O);
  if (info.crit && S.flags.atlas_crit_atk_down) {
    if (fx.tryApplyDebuff(O, 'atk_down', 2, 0.30, S)) {
      bt.shared.events.push(`🥊 Atlas: Worldbreaker's Grip — ${O.name}'s ATK reduced 30%!`);
    }
  }
  if (O.hp > 0) fx.armLowHpAttackPassives(O);
  return { applied: dmg, negated: false };
};

/**
 * Resolve a full battle.
 * @param {object} a  player fighter (statAssembly.buildPlayerFighter shape)
 * @param {object} b  mob fighter (raid/boss) or second player fighter (duel)
 * @param {object} opts { mode: 'raid'|'duel'|'boss', seed, rng? (test override) }
 * @returns {{ winner:'a'|'b', outcome:string, rounds:Array, snapshots:Array,
 *             a:object, b:object, seed:number, mode:string, totals:object }}
 */
function resolveBattle(a, b, opts = {}) {
  const mode = opts.mode || 'raid';
  const seed = (opts.seed != null ? opts.seed : Date.now()) >>> 0;
  const rng = opts.rng || rngOf(seed);

  // ── per-side battle state ─────────────────────────────────────────────────
  const initSide = (f, fallbackKind) => ({
    in: f,
    kind: f.kind || fallbackKind,
    name: f.name,
    hp: f.hp, maxHp: f.hp,
    atk: f.atk, def: f.def, crit: Number(f.crit) || 0,
    bonusDmgPct: Number(f.bonusDmgPct) || 0,   // unified damage % from the weapon (§35.2)
    classPassive: f.classPassive || null,
    weaponPassiveKey: f.weaponPassiveKey || 'none',
    armorPassiveKey: f.armorPassiveKey || 'none',   // [v5] equipped-armor passive
    deityBlessingKey: f.deityBlessingKey || 'none',
    echoBlessingKey: f.echoBlessingKey || 'none',
    skillKey: f.skillKey || 'none',
    immunityTags: Array.isArray(f.immunityTags) ? f.immunityTags : [],
    specialFlags: f.specialFlags || {},
    bossPassiveState: f.bossPassiveState || {},
    isBoss: f.mobType === 'boss',
    debuffs: [],            // [{tag, turnsLeft, value}]
    flags: {},              // durable bs.flags.* state for the current battle
    // Alan's immunity is intrinsic and must exist before either duelist's passive
    // phase; otherwise the first actor could land a round-1 debuff before Alan ran.
    statusImmune: f.weaponPassiveKey === 'alans_reversed_hands'
      || f.armorPassiveKey === 'alans_reversed_hands',
    scratch: null,          // per-round (reset before passives)
    skipped: false,         // skip-CC'd this round
    critRollValue: 1,       // pre-rolled crit draw for this round's main hit
    stunPreRoll: 0,         // Fighter class stun turns rolled for this round (0/1)
    bathalaExtraHp: 0,      // currently-applied Bathala HP bonus
  });

  const A = initSide(a, 'player');
  const B = initSide(b, mode === 'duel' ? 'player' : 'mob');
  // Boss fights read the SHARED pool % (§35.4) — Phase 7 passes poolHp/poolMaxHp.
  if (b.poolMaxHp != null) B.maxHp = b.poolMaxHp;
  if (b.poolHp != null) B.hp = Math.min(b.poolHp, B.maxHp);

  const bossThresholdEvents = [];
  const moonThresholds = [85, 70, 55, 40, 25, 10];
  const moonState = {
    crossedThresholds: Array.isArray(B.bossPassiveState?.crossedThresholds)
      ? B.bossPassiveState.crossedThresholds.map(Number).filter((n) => moonThresholds.includes(n))
      : [],
    atkBonusPct: Number(B.bossPassiveState?.atkBonusPct) || 0,
  };
  B.flags.bakunawa_atk_bonus_pct = moonState.atkBonusPct;

  // damageDealtToEnemy/enemyLocalRegen feed the boss net-damage rule;
  // damageDealtToPlayer is the symmetric A-side tally (pvp_logs opponent_damage).
  const totals = { damageDealtToEnemy: 0, damageDealtToPlayer: 0, enemyLocalRegen: 0, netDamage: 0 };
  const shared = { round: 0, events: new CombatLog() };
  // One handle for the mutable battle state the closures below share. These are
  // the same objects, not copies, so bt.A === A for the whole battle; the closures
  // read through bt so 4.3/4.4 can lift them out without dragging the scope along.
  const bt = { A, B, totals, shared, moonState, rng };
  /** Push under an explicit source category (see combatLog.LOG_PRIORITY). */
  const logAt = (priority, ...texts) => bt.shared.events.at(priority, () => bt.shared.events.push(...texts));
  const refreshFenrirPhase = () => {
    if (!bt.B.isBoss || bt.B.skillKey !== FENRIR_PASSIVE_KEY) return;
    const reconciled = reconcileFenrirPhase(bt.B.bossPassiveState, bt.B.hp, bt.B.maxHp);
    bt.B.bossPassiveState = reconciled.state;
    bt.A.flags.enemy_damage_mult = reconciled.phase.outgoingDamageMultiplier;
    bt.A.flags.enemy_ignore_def_pct = reconciled.phase.armorPenetration;
    if ((reconciled.advanced || !reconciled.initialized) && reconciled.phase.index > 0) {
      const announcement = fenrirPhaseAnnouncement(reconciled.phase);
      if (announcement) logAt(LOG.MOB_SKILL, announcement);
    }
  };

  // ── HP mutation hub (totals accounting) ────────────────────────────────────
  const setHp = (side, v) => {
    const nv = Math.max(0, Math.min(Math.round(v), side.maxHp));
    const delta = nv - side.hp;
    side.hp = nv;
    if (side === bt.B) {
      refreshFenrirPhase();
      if (delta < 0 && bt.B.skillKey === 'bakunawa_seven_moons' && bt.B.maxHp > 0) {
        const beforePct = (bt.B.hp - delta) / bt.B.maxHp * 100;
        const afterPct = bt.B.hp / bt.B.maxHp * 100;
        for (const threshold of moonThresholds) {
          if (beforePct > threshold && afterPct <= threshold && !bt.moonState.crossedThresholds.includes(threshold)) {
            bt.moonState.crossedThresholds.push(threshold);
            bt.moonState.atkBonusPct = Math.min(0.60, bt.moonState.atkBonusPct + 0.10);
            bt.B.flags.bakunawa_atk_bonus_pct = bt.moonState.atkBonusPct;
            bossThresholdEvents.push({ threshold, atkBonusPct: bt.moonState.atkBonusPct });
            logAt(LOG.MOB_SKILL, `Bakunawa: Seven Moons — ATK rises by ${Math.round(bt.moonState.atkBonusPct * 100)}%.`);
          }
        }
      }
      if (delta < 0) bt.totals.damageDealtToEnemy += -delta;
      else if (delta > 0) bt.totals.enemyLocalRegen += delta;
    } else if (delta < 0) {
      bt.totals.damageDealtToPlayer += -delta;
    }
  };
  const damage = (side, amount) => setHp(side, side.hp - Math.max(0, Math.floor(amount)));
  const heal = (side, amount) => setHp(side, side.hp + Math.max(0, Math.floor(amount)));
  const applyLifesteal = (side, damageDealt, percentage, passiveName) => {
    const requested = Math.max(0, Math.floor(damageDealt * percentage));
    const before = side.hp;
    heal(side, requested);
    const restored = side.hp - before;
    const icon = passiveName === 'Soul Drain' ? '🌊' : '🩸';
    logAt(LOG.POST_ATTACK, `${icon} ${passiveName} — healed ${restored.toLocaleString()} HP.`);
  };

  // ── debuff helpers (§13.1: refresh don't stack/extend; highest value wins) ─
  const effectDamage = (side, amount) => {
    let adjusted = amount;
    if (findDebuff(side, 'frostbite')) adjusted *= 1.5;
    const petrify = findDebuff(side, 'petrify');
    if (petrify) {
      // The petrify debuff carries its own damage amplification as `value`, so a
      // source can specify how much more damage its victim takes. Aegis passes 0.50
      // (+50%); every other source passes 0 and keeps the default +25%, which is why
      // buffing Aegis does not silently buff Medusa mobs' stone_stare by proxy.
      // Petrify is a SKIP_TAG whose `value` was previously unused, and addDebuff's
      // Math.max merge means the strongest amp wins on refresh.
      adjusted *= 1 + (petrify.value > 0 ? petrify.value : PETRIFY_DEFAULT_DAMAGE_AMP);
    }
    return adjusted;
  };
  const healTribalWard = (side, removedCount, reason) => {
    if (!hasEquippedPassive(side, 'luzon_tribal_shield') || removedCount < 1) return;
    for (let i = 0; i < removedCount; i++) {
      const before = side.hp;
      heal(side, side.maxHp * 0.08);
      logAt(LOG.ARMOR,
        `🪶 Tribal Ward — debuff ${reason}, restored ${(side.hp - before).toLocaleString()} HP.`);
    }
  };
  const removePlayerEffects = (side, categories, reason = 'cleansed') => {
    const removed = removeEffectsByCategory(side.debuffs, categories);
    healTribalWard(side, removed, reason);
    return removed;
  };
  const addDebuff = (side, tag, turns, value = 0) => {
    const category = effectCategory(tag);
    if (!category) throw new Error(`Unknown combat effect ID: ${tag}`);
    // Stuns never refresh while active, regardless of source. Once a stun expires,
    // every source also respects the one-round recovery window. Keeping this in the
    // central debuff path prevents Fighter + stun-deity combinations from bypassing
    // the class-level guard and producing a permanent lock.
    if (tag === 'stun') {
      if (findDebuff(side, 'stun')) return false;
      if (side.flags.stun_immune_until != null && bt.shared.round <= side.flags.stun_immune_until) {
        return false;
      }
    }
    if (side.kind === 'player') {
      if (side.flags.charmed_hide_active && isCrowdControlEffect(tag)) {
        if (!side.flags.charmed_hide_first_cc_used) {
          side.flags.charmed_hide_first_cc_used = true;
          bt.shared.events.push('🪬 Charmed Hide — the first crowd-control effect was nullified!');
          return false;
        }
        // After the one-time nullify is spent, the 40% resist applies ONLY to Stun,
        // Petrify and Freeze — not to every crowd-control tag. The nullify itself is
        // deliberately broad ("the first crowd-control effect of any type"); the
        // ongoing resist is deliberately narrow. That asymmetry is the description.
        if (CHARMED_HIDE_RESIST_TAGS.has(tag) && bt.rng() < 0.40) {
          bt.shared.events.push(`🪬 Charmed Hide — resisted ${ACTION_TAG_LABELS[tag] || tag}!`);
          return false;
        }
      }
      const negate = side.flags.salakot_negate_chance || 0;
      if (negate > 0 && bt.rng() < negate) {
        bt.shared.events.push(`🪬 Spirit Ward — negated ${ACTION_TAG_LABELS[tag] || tag}!`);
        return false;
      }
    }
    const ex = findDebuff(side, tag);
    if (ex) {
      ex.turnsLeft = Math.max(ex.turnsLeft, turns);
      ex.value = Math.max(ex.value, value);
      ex.category = category;
    } else {
      // Skip-CC applied this round is directional and gates the recipient's next
      // turn. It arms at round start, so it never cancels an action already due.
      side.debuffs.push({ tag, category, turnsLeft: turns, value, armed: false });
    }
    return true;
  };
  const tryApplyDebuff = (
    side,
    tag,
    turns,
    value = 0,
    source = null,
  ) => {
    const immune = debuffImmune(side, tag);
    if (immune) {
      if (side.kind === 'player' && side.statusImmune && isStatusEffect(tag)) {
        bt.shared.events.push('✋ Untouchable — status effect blocked!');
      }
      return false;
    }
    const applied = addDebuff(side, tag, turns, value);
    if (applied && source) {
      const effect = findDebuff(side, tag);
      if (effect) effect.source = source;
    }
    return applied;
  };
  const canApplyFighterStun = (target) => {
    if (debuffImmune(target, 'stun')) return false;
    if (findDebuff(target, 'stun')) return false;
    return target.flags.stun_immune_until == null || bt.shared.round > target.flags.stun_immune_until;
  };

  // Perspectives (the registry's bs view).
  const makePerspective = (self, opp) => ({
    rng: bt.rng,
    get currentTurn() { return bt.shared.round; },
    get playerATK() { return self.atk; },
    get playerHP() { return self.hp; },
    set playerHP(v) { setHp(self, v); },
    get playerMaxHP() { return self.maxHp; },
    get playerDEF() { return self.def; },
    get playerCrit() { return self.crit; },
    get enemyATK() { return opp.atk; },
    get enemyHP() { return opp.hp; },
    set enemyHP(v) { setHp(opp, v); },
    get enemyMaxHP() { return opp.maxHp; },
    get enemyDEF() { return opp.def; },
    get flags() { return self.flags; },
    get log() { return bt.shared.events; },
    get playerStatusImmune() { return self.statusImmune; },
    set playerStatusImmune(v) { self.statusImmune = !!v; },
    get damageBonusPct() { return self.scratch.damageBonusPct; },
    set damageBonusPct(v) { self.scratch.damageBonusPct = v; },
    get damageReductionPct() { return self.scratch.damageReductionPct; },
    set damageReductionPct(v) { self.scratch.damageReductionPct = v; },
    get incomingDamageIncreasePct() { return self.scratch.incomingDamageIncreasePct; },
    set incomingDamageIncreasePct(v) { self.scratch.incomingDamageIncreasePct = v; },
    get playerAtkMult() { return self.scratch.playerAtkMult; },
    set playerAtkMult(v) { self.scratch.playerAtkMult = v; },
    get playerDefMult() { return self.scratch.playerDefMult; },
    set playerDefMult(v) { self.scratch.playerDefMult = v; },
    get ignoreDefPct() { return self.scratch.ignoreDefPct; },
    set ignoreDefPct(v) { self.scratch.ignoreDefPct = v; },
    get nextAttackAutoCrit() { return self.scratch.nextAttackAutoCrit; },
    set nextAttackAutoCrit(v) { self.scratch.nextAttackAutoCrit = v; },
    get nextAttackDouble() { return self.scratch.nextAttackDouble; },
    set nextAttackDouble(v) { self.scratch.nextAttackDouble = v; },
    refreshEnemyBossPhase: refreshFenrirPhase,
    get isPrimaryAttack() {
      return self.scratch?.attackContext?.isPrimaryAttack !== false;
    },
    get isAdditionalAttack() {
      return self.scratch?.attackContext?.isAdditionalAttack === true;
    },
    get allowAdditionalAttackProcs() {
      return self.scratch?.attackContext?.allowAdditionalAttackProcs !== false;
    },
    // Attack-bound hooks are registered in the passive phase but fire inside the
    // action. By default they keep their source category; status-producing hooks can
    // explicitly use STATUS so their application logs follow all damage modifiers.
    onAttack: (fn, priority = bt.shared.events.channel) => {
      if (typeof fn === 'function') self.scratch.attackHooks.push(bt.shared.events.bind(priority, fn));
    },
    onLandedHit: (fn, priority = bt.shared.events.channel) => {
      if (typeof fn === 'function') self.scratch.landedHitHooks.push(bt.shared.events.bind(priority, fn));
    },
    onEnemyAttack: (fn, priority = bt.shared.events.channel) => {
      if (typeof fn === 'function') self.scratch.enemyAttackHooks.push(bt.shared.events.bind(priority, fn));
    },
    onEnemyLandedHit: (fn, priority = bt.shared.events.channel) => {
      if (typeof fn === 'function') self.scratch.enemyLandedHitHooks.push(bt.shared.events.bind(priority, fn));
    },
    enemyImmune: (tag) => {
      const immune = debuffImmune(opp, tag);
      if (immune && opp.kind === 'player' && opp.statusImmune && isStatusEffect(tag)) {
        bt.shared.events.push('✋ Untouchable — status effect blocked!');
      }
      return immune;
    },
    applyDebuff: (tag, turns, value = 0) =>
      tryApplyDebuff(opp, tag, turns, value, self),
    applyPlayerDebuff: (tag, turns, value = 0) => tryApplyDebuff(self, tag, turns, value, opp),
    enemyHasEffectTag: (tag) => opp.debuffs.some((effect) => effectHasTag(effect.tag, tag)),
    hasPlayerDebuff: (tag) => (tag === 'any' ? self.debuffs.length > 0 : !!findDebuff(self, tag)),
    clearPlayerStatusEffects: () =>
      removePlayerEffects(self, [EFFECT_CATEGORY.STATUS], 'cleansed'),
    clearPlayerDebuffs: () =>
      removePlayerEffects(self, [EFFECT_CATEGORY.STATUS, EFFECT_CATEGORY.DOT], 'cleansed'),
  });

  const PA = makePerspective(bt.A, bt.B);
  const PB = bt.B.kind === 'player' ? makePerspective(bt.B, bt.A) : null;
  const perspectiveOf = (side) => (side === bt.A ? PA : PB);
  const oppOf = (side) => (side === bt.A ? bt.B : bt.A);

  // ── battle result ──────────────────────────────────────────────────────────
  let result = null;
  const win = (side, outcome, causeOfDeath = null) => {
    if (result) return;
    // Every branch below is a defeat message: DEFEAT priority guarantees the logger
    // hoists it to the very end of the round, so nothing can print after a death.
    bt.shared.events.channel = LOG.DEFEAT;
    result = { winner: side === bt.A ? 'a' : 'b', outcome, causeOfDeath };
    const loser = side === bt.A ? bt.B : bt.A;
    const tag = (f) => (f.kind === 'player' ? (f.in?.mention || f.name) : f.name);
    const winTag = tag(side);
    const loseTag = tag(loser);
    if (causeOfDeath?.type === 'reflect') {
      bt.shared.events.push(`💀 ${loseTag} was defeated by ${causeOfDeath.source}'s reflected damage!`);
    } else if (causeOfDeath?.type === 'execute' && causeOfDeath.source === 'Cursed Edge') {
      bt.shared.events.push(`💀 ${loseTag} was executed by Cursed Edge!`);
    } else if (causeOfDeath?.type === 'execute' && causeOfDeath.source === 'Death Charm') {
      bt.shared.events.push(`💀 ${loseTag} was slain by Death Charm!`);
    } else if (causeOfDeath?.type === 'dot') {
      bt.shared.events.push(`💀 ${loseTag} was defeated by ${causeOfDeath.source}!`);
    } else if (side.kind === 'player' && loser.kind === 'player') {
      bt.shared.events.push(`💫 ${loseTag} fainted and was defeated by ${winTag}!`); // PvP KO
    } else if (loser.kind === 'player') {
      bt.shared.events.push(`💫 ${loseTag} was defeated by ${winTag}!`); // player fell to a mob/boss
    } else {
      bt.shared.events.push(`💀 ${loseTag} was defeated by ${winTag}!`); // mob/boss slain by the player
    }
    bt.shared.events.channel = LOG.STATUS;
  };
  /** Death check in causal order (§35.3 first-to-0). Returns true if battle over. */
  const checkDeaths = (outcome, causeOfDeath = null) => {
    if (result) return true;
    if (bt.A.hp <= 0) { win(bt.B, outcome, causeOfDeath); return true; }
    if (bt.B.hp <= 0) { win(bt.A, outcome, causeOfDeath); return true; }
    return false;
  };

  // ── effective stats ────────────────────────────────────────────────────────
  const effAtk = (S, extraAtkMult = 0) => {
    const mult = S.kind === 'player' ? S.scratch.playerAtkMult : 0;
    const classBonus = S.classPassive === 'damage_reduction'
      ? KNIGHT_OUTGOING_BONUS
      : S.classPassive === 'stun'
        ? FIGHTER_DAMAGE_BONUS
        : 0;
    const raw = S.atk * (1 + mult + extraAtkMult + classBonus - debuffValue(S, 'atk_down'));
    // Keep exact percentage stacks such as 10% + 5% from becoming 114.999999...
    // and being truncated to 114 by the downstream integer damage floor.
    const epsilon = Number.EPSILON * Math.max(1, Math.abs(raw)) * 16;
    return Math.max(0, raw + epsilon);
  };
  const effCritChance = (S) =>
    findDebuff(S, 'darkened') ? 0 : Math.max(0, S.crit * (1 - debuffValue(S, 'crit_down')));

  /** Defender's effective DEF vs attacker S (R8 def_down highest-wins; pierce gated). */
  const effDef = (S, O, { mainHit = false } = {}) => {
    let def = O.def;
    if (O.kind === 'player') {
      const shred = Math.max(
        debuffValue(O, 'def_down'),
        S.flags.laevateinn_sword_def_stack || 0,
        (S.flags.zeus_def_shred_stacks || 0) * 0.05
      );
      def *= Math.max(0, 1 + O.scratch.playerDefMult - shred);
    } else {
      def *= (S.flags.enemy_def_mult || 1.0);
      const shred = Math.max(
        debuffValue(O, 'def_down'),
        S.flags.laevateinn_sword_def_stack || 0,
        (S.flags.zeus_def_shred_stacks || 0) * 0.05
      );
      def *= Math.max(0, 1 - shred);
    }
    const pierceImmune = sideImmune(O, 'armor_pierce');
    if (!pierceImmune) {
      if (S.kind === 'player') {
        if (mainHit && S.flags.gungnir_full_pierce) return 0;
        let pierce = S.scratch.ignoreDefPct;
        if (S.classPassive === 'pierce') pierce = Math.max(pierce, ARCHER_PIERCE);
        if (mainHit && S.flags.crossbow_pierce) pierce = Math.max(pierce, 0.25);
        // [Genesis] Moira ignores 50% DEF while the target's DEF is buffed —
        // the defender's own per-round DEF multiplier is the buff signal.
        if (S.flags.moira_pierce_vs_def_buff && (O.scratch?.playerDefMult || 0) > 0) {
          pierce = Math.max(pierce, 0.50);
        }
        def *= Math.max(0, 1 - pierce);
      } else if (S.kind === 'mob') {
        const pierce = Math.max(0, Math.min(1, Number(O.flags.enemy_ignore_def_pct) || 0));
        def *= Math.max(0, 1 - pierce);
      }
    }
    return Math.max(0, def);
  };

  const mitigated = (atkValue, defValue) =>
    atkValue * (1 - defValue / (defValue + MITIGATION_K));

  // ── defender stack (R3) ────────────────────────────────────────────────────
  /**
   * Apply one computed hit to the defender. Returns { applied, negated, evaded? }.
   * `negated` controls landed-hit mechanics; `evaded` distinguishes presentation
   * from full damage absorption/ignore effects that also apply zero damage.
   * info: { crit, attacker } — crit drives player_was_critted latch & reflects.
   */
  const recordReceivedCrit = (side) => {
    side.flags.player_was_critted = true;
    side.flags.player_crits_received = (side.flags.player_crits_received || 0) + 1;
    if (side.deityBlessingKey === 'vidar_silent_vengeance') {
      if (!side.flags.vidar_auto_crit_pending) {
        side.flags.vidar_auto_crit_pending = true;
        bt.shared.events.push('⚔️ Vidar: Silent Vengeance — Auto-CRIT next attack!');
      }
      side.flags.vidar_crit_latch_handled = true;
    }
  };
  const grantValkyrieResolve = (side) => {
    if (!side.flags.valkyrie_resolve_active) return;
    const oldDr = side.flags.valkyrie_shield_dr || 0;
    const oldAtk = side.flags.valkyrie_shield_atk || 0;
    const nextDr = Math.min(oldDr + 0.05, 0.25);
    const nextAtk = Math.min(oldAtk + 0.05, 0.25);
    side.flags.valkyrie_shield_dr = nextDr;
    side.flags.valkyrie_shield_atk = nextAtk;
    side.scratch.damageReductionPct += nextDr - oldDr;
    side.scratch.playerAtkMult += nextAtk - oldAtk;
    if (nextDr > oldDr || nextAtk > oldAtk) {
      const stacks = Math.round(nextDr / 0.05);
      bt.shared.events.push(
        `⚔️ Valkyrie's Resolve — ${stacks} stacks · ${Math.round(nextDr * 100)}% reduction · +${Math.round(nextAtk * 100)}% ATK`
      );
    }
  };
  const grantAegisStone = (defender, attacker) => {
    if (!defender.flags.aegis_active) return;
    const oldStacks = defender.flags.aegis_stacks || 0;
    const nextStacks = oldStacks + 1;
    if (nextStacks >= AEGIS_STACKS_TO_PETRIFY) {
      // The third stack becomes the Petrify rather than more damage reduction: stacks
      // reset to zero and the accrued reduction is rolled back in the same step, so the
      // effective maximum is 2 stacks / 20%. Deliberate — 30% stacking reduction plus a
      // Petrify would strictly dominate Mail of Brokkr's flat 30%.
      defender.flags.aegis_stacks = 0;
      defender.scratch.damageReductionPct = Math.max(
        0,
        defender.scratch.damageReductionPct - oldStacks * AEGIS_DR_PER_STACK,
      );
      // The amp rides on the debuff's `value`, so it dies with the Petrify — nothing
      // leaks if the attacker cleanses it, and no side flag needs tearing down.
      const petrified = tryApplyDebuff(
        attacker, 'petrify', 1, AEGIS_PETRIFY_DAMAGE_AMP, defender,
      );
      bt.shared.events.push(
        petrified
          ? `🗿 Medusa's Gaze — 3 Stone stacks! ${attacker.name} is Petrified for 1 turn `
            + `and takes ${Math.round(AEGIS_PETRIFY_DAMAGE_AMP * 100)}% more damage.`
          : "🗿 Medusa's Gaze — 3 Stone stacks! Petrify was resisted."
      );
      return;
    }
    defender.flags.aegis_stacks = nextStacks;
    defender.scratch.damageReductionPct += AEGIS_DR_PER_STACK;
    bt.shared.events.push(
      `🗿 Medusa's Gaze — ${nextStacks} Stone stack${nextStacks === 1 ? '' : 's'} `
      + `(${Math.round(nextStacks * AEGIS_DR_PER_STACK * 100)}% reduction)`
    );
  };
  const applyReflectedDamage = (defender, attacker, baseDamage, pct, source) => {
    // Reflect is an exact percentage of the triggering hit's final damage. Do
    // not pass it through Frostbite/Petrify again or a 12% reflect can exceed 12%.
    const reflected = Math.floor(baseDamage * pct);
    if (reflected <= 0) return false;
    const before = attacker.hp;
    damage(attacker, reflected);
    const applied = before - attacker.hp;
    logAt(LOG.REFLECT, `🌵 ${source} reflects ${applied} damage back to ${attacker.name}.`);
    if (applied > 0 && defender.hp > 0 && defender.flags.soul_drain_pct > 0) {
      applyLifesteal(defender, applied, defender.flags.soul_drain_pct, 'Soul Drain');
    }
    return checkDeaths('reflect', { type: 'reflect', source });
  };
  const armLowHpAttackPassives = (side) => {
    if (side.deityBlessingKey === 'vidar_silent_vengeance'
        && !side.flags.vidar_low_hp_used
        && side.hp < side.maxHp * 0.50) {
      side.flags.vidar_low_hp_used = true;
      side.flags.vidar_auto_crit_pending = true;
      bt.shared.events.push('⚔️ Vidar: Silent Vengeance — Wounded! Guaranteed CRIT!');
    }
  };
  // applyHitToDefender lives at module scope now, but its body still drives
  // these closure-bound helpers (they own `shared` and the event log, so they
  // cannot be hoisted). One handle carries them across the call boundary.
  const fx = {
    setHp, logAt, damage, applyLifesteal,
    effectDamage, tryApplyDebuff, checkDeaths, recordReceivedCrit,
    grantValkyrieResolve, grantAegisStone, applyReflectedDamage, armLowHpAttackPassives,
  };

  // Defender reactions resolve immediately inside applyHitToDefender, but their
  // log lines belong after the attack that caused them.
  const applyHitWithReactions = (S, O, dmg, info = {}) => {
    const reactionStart = bt.shared.events.length;
    // Everything the defender stack logs is a defensive reaction unless it overrides
    // the channel itself (reflect, counter, defeat) — so guards, evades, absorbs and
    // damage-reduction lines all land right after the attack that caused them.
    const hit = bt.shared.events.at(LOG.DEFENSIVE, () => applyHitToDefender(bt, fx, S, O, dmg, info));
    const reactions = bt.shared.events.splice(reactionStart);
    return { hit, reactions };
  };

  /** Resolve effects whose final text says an attack/hit applies or rolls them. */
  const applyLandedHitPassives = (S, O, info = {}) => {
    // A dead target takes no new stacks: every effect below needs a living victim.
    if (result || O.hp <= 0) return;
    bt.shared.events.channel = LOG.STATUS;
    const targetWasStunned = Boolean(findDebuff(O, 'stun'));
    for (const hook of S.scratch.landedHitHooks) hook(info);
    if (S.flags.laevateinn_staff_on_hit) {
      if (tryApplyDebuff(O, 'burn', 2, S.atk * 0.10, S)) {
        bt.shared.events.push('🔥 Laevateinn Staff: Flickering Flame — Burn (10% ATK, 2 turns)!');
      }
    }
    const apolaki = CANONICAL_ON_HIT_EFFECTS.apolaki;
    if (S.flags[apolaki.flag]) {
      if (tryApplyDebuff(O, apolaki.tag, apolaki.turns, S.atk * apolaki.atkPctPerHit, S)) {
        bt.shared.events.push('☀️ Apolaki: Solar Burn — Enemy scorched (10% ATK Burn)!');
      }
    }
    const surt = CANONICAL_ON_HIT_EFFECTS.surt;
    if (S.flags[surt.flag]) {
      const nextStack = Math.min(
        (S.flags.surt_burn_stack || 0) + surt.atkPctPerHit,
        surt.maxAtkPct,
      );
      if (tryApplyDebuff(O, surt.tag, surt.turns, S.atk * nextStack, S)) {
        S.flags.surt_burn_stack = nextStack;
        bt.shared.events.push(`🔥 Surt: Muspell's Flame — Burn ${Math.round(nextStack * 100)}% ATK/turn!`);
      }
    }
    if (S.flags.thor_on_hit && bt.rng() < 0.30) {
      const stunned = tryApplyDebuff(O, 'stun', 1, 0, S);
      const paralyzed = tryApplyDebuff(O, 'thor_paralyze', 3, 0, S);
      const paralysisDot = tryApplyDebuff(O, 'thor_paralyze_dot', 3, S.atk * 0.20, S);
      const effects = [
        stunned ? 'Stunned' : '',
        paralyzed ? 'Paralyzed (3 turns)' : '',
        !paralyzed && paralysisDot ? 'Paralysis damage (3 turns)' : '',
      ].filter(Boolean);
      if (effects.length) bt.shared.events.push(`⚡ Thor: Mjolnir's Wrath — Enemy ${effects.join(' & ')}!`);
    }
    if (S.flags.skadi_on_hit && bt.rng() < 0.30) {
      if (tryApplyDebuff(O, 'freeze', 1, 0, S)) {
        bt.shared.events.push("❄️ Skadi: Winter's Hunt — Enemy Frozen!");
      }
    }
    if (S.flags.poseidon_on_hit && bt.rng() < 0.30) {
      const stunned = tryApplyDebuff(O, 'stun', 1, 0, S);
      const shredded = tryApplyDebuff(O, 'def_down', 2, 0.30, S);
      if (stunned || shredded) {
        const effects = [stunned ? 'Stunned' : '', shredded ? 'DEF -30% for 2 turns' : ''].filter(Boolean);
        bt.shared.events.push(`🌊 Poseidon: Tidal Force — Enemy ${effects.join(' & ')}!`);
      }
    }
    if (S.flags.jarngreipr_on_stun && !targetWasStunned && findDebuff(O, 'stun') && !result) {
      const bash = Math.max(0, Math.floor((Number(info.damage) || 0) * 0.50));
      const targetHpBeforeBash = O.hp;
      const { hit, reactions } = applyHitWithReactions(S, O, bash, { crit: false });
      logAt(LOG.ATTACK, `⚡ Thunder Grip — enemy Stunned, Bash deals ${hit.applied} bonus damage!`);
      bt.shared.events.push(...reactions);
      if (hit.applied > 0 && S.hp > 0 && S.flags.soul_drain_pct > 0) {
        applyLifesteal(
          S,
          Math.min(hit.applied, targetHpBeforeBash),
          S.flags.soul_drain_pct,
          'Soul Drain',
        );
      }
    }
  };

  /**
   * An additional attack is a new attack instance, so chance-based defenses get
   * fresh seeded rolls before it enters the normal defender pipeline. Durable
   * one-shot defenses (Heimdall, Athena, Stone Skin, etc.) are deliberately not
   * refreshed here; their existing consumption rules still apply.
   */
  const rerollDefensiveChecks = (S, O) => {
    if (O.kind === 'mob') {
      if (O.skillKey === 'sigbin_shadow_step') {
        S.flags.sigbin_evade_check = bt.rng() < 0.20;
      }
      return;
    }

    const F = O.flags;
    const hasPassive = (key) =>
      O.weaponPassiveKey === key || O.armorPassiveKey === key;

    F.steel_kite_shield_block = hasPassive('steel_kite_shield') && bt.rng() < 0.10;

    let evadeChanceUsed = 0;
    if (O.deityBlessingKey === 'amihan_tailwind') {
      evadeChanceUsed += 0.20;
      F.amihan_evade_check = bt.rng() < 0.20;
    } else {
      F.amihan_evade_check = false;
    }
    if (O.deityBlessingKey === 'loki_illusory_double') {
      evadeChanceUsed += 0.25;
      F.loki_evade_check = bt.rng() < 0.25;
      F.loki_counter_dmg = F.loki_evade_check ? Math.floor(O.atk) : 0;
    } else {
      F.loki_evade_check = false;
      F.loki_counter_dmg = 0;
    }
    F.njord_block_check =
      O.deityBlessingKey === 'njord_seas_favor' && bt.rng() < 0.15;
    F.echo_njord_block_check =
      O.echoBlessingKey === 'echo_njord' && bt.rng() < 0.10;

  };

  // ── player attack action ───────────────────────────────────────────────────
  const collectAdditionalAttacks = (S, allowAdditionalAttackProcs) => {
    const additionalAttacks = [];
    if (allowAdditionalAttackProcs) {
      if (S.flags.labrys_double_hit) {
        additionalAttacks.push({
          source: 'labrys',
          atkScale: S.flags.labrys_second_hit_pct || 0.70,
          log: '🪓 Labrys: Double Strike activated! (70% ATK additional attack)',
          logPriority: LOG.WEAPON,
        });
      }
      if (S.flags.extra_turn) {
        additionalAttacks.push({
          source: 'glacial_bow',
          atkScale: 1,
          log: '🏹 Glacial Bow: Frostwind Volley activated!',
          logPriority: LOG.WEAPON,
        });
      }
      if (S.flags.auto_fire_shot) {
        additionalAttacks.push({
          source: 'auto_fire',
          atkScale: 1,
        });
      }
      if (S.classPassive === 'pierce' && bt.rng() < ARCHER_DOUBLE_ATTACK_CHANCE) {
        additionalAttacks.push({
          source: 'archer',
          atkScale: 1,
          log: `🏹 ${S.name}'s Double Attack activated!`,
          logPriority: LOG.CLASS,
        });
      }
    }
    S.flags.labrys_double_hit = false;
    S.flags.extra_turn = false;
    S.flags.auto_fire_shot = false;
    return additionalAttacks;
  };

  const consumeNextAttackFlags = (S, attackHookEvents) => {
    // Durable "next attack" effects are consumed only when an attack actually begins.
    // A stun, freeze, charm, or Dizzy/Stun skip cannot silently discard them.
    const amihanStacks = Math.max(0, Number(S.flags.amihan_evade_bonus_stacks) || 0);
    if (amihanStacks > 0) {
      S.scratch.playerAtkMult += amihanStacks * 0.20;
      S.flags.amihan_evade_bonus_stacks = 0;
      attackHookEvents.push(`💨 Amihan: Tailwind — Evade momentum! ATK +${amihanStacks * 20}%!`);
    }
    if (S.flags.idiyanale_attack_bonus_pending) {
      S.scratch.playerAtkMult += S.flags.idiyanale_attack_bonus_pending;
      S.flags.idiyanale_attack_bonus_pending = 0;
    }
    if (S.flags.mimir_attack_bonus_pending) {
      S.scratch.playerAtkMult += S.flags.mimir_attack_bonus_pending;
      S.flags.mimir_attack_bonus_pending = 0;
    }
    if (S.flags.artemis_auto_crit_pending) {
      S.scratch.nextAttackAutoCrit = true;
      S.flags.artemis_auto_crit_pending = false;
      if (S.flags.artemis_first_attack_pending) {
        S.flags.artemis_first_attack_pending = false;
        S.flags.artemis_first_used = true;
      }
    }
    if (S.flags.vidar_auto_crit_pending) {
      S.scratch.nextAttackAutoCrit = true;
      S.flags.vidar_auto_crit_pending = false;
    }
    if (S.flags.unseen_pending) {
      S.scratch.ignoreDefPct = Math.max(S.scratch.ignoreDefPct, 0.50);
      S.flags.unseen_pending = false;
      attackHookEvents.push('🌑 Veil of Hades — Unseen consumed; 50% of enemy DEF ignored.');
    }
  };

  /** Adds or refreshes one Swordsman Bleed stack, capped at BLEED_MAX_STACKS. */
  const applySwordsmanBleedStack = (S, O) => {
    bt.rng(); // reserved draw — stream stability (bleed value is deterministic now)
    const ex = findDebuff(O, 'bleed');
    const stacks = Math.min(BLEED_MAX_STACKS, (ex && ex.stacks ? ex.stacks : 0) + 1);
    const value = Math.min(BLEED_MAX_PCT, stacks * BLEED_PCT_PER_STACK) * S.atk;
    if (ex) {
      ex.turnsLeft = 2;
      ex.value = Math.max(ex.value, value);
      ex.stacks = stacks;
      ex.category = EFFECT_CATEGORY.DOT;
    } else {
      O.debuffs.push({
        tag: 'bleed',
        category: EFFECT_CATEGORY.DOT,
        turnsLeft: 2,
        value,
        stacks,
        armed: false,
        source: S,
      });
    }
    const pct = Math.round(Math.min(BLEED_MAX_PCT, stacks * BLEED_PCT_PER_STACK) * 100);
    logAt(LOG.CLASS,
      `🩸 Swordsman Passive — applied Bleed. Current stack: ${stacks}/${BLEED_MAX_STACKS} (${pct}% ATK/turn).`);
  };

  /** Overcharge's single post-hit effect: select one debuff, apply it, log the outcome. */
  const applyOverchargeDebuff = (S, O) => {
    const selected = selectOverchargeDebuff(bt.rng());
    let applied = false;
    if (selected.tag === 'paralyze') {
      applied = tryApplyDebuff(O, selected.tag, 1, 0, S);
      if (applied) logAt(LOG.STATUS, '⚡ Overcharge: Paralyze applied!');
    } else if (selected.tag === 'burn') {
      const burnDamage = Math.max(0, effAtk(S) * 0.10);
      applied = tryApplyDebuff(O, selected.tag, 1, burnDamage, S);
      if (applied) {
        const burn = findDebuff(O, 'burn');
        if (burn) burn.overcharge = true;
        logAt(LOG.STATUS, '🔥 Overcharge: Burn applied for 1 turn.');
      }
    } else if (selected.tag === 'def_down') {
      applied = tryApplyDebuff(O, selected.tag, LANDED_STAT_DEBUFF_TURNS, 0.25, S);
      if (applied) logAt(LOG.STATUS, '🛡️ Overcharge: Opponent DEF reduced by 25% for 1 turn.');
    } else {
      applied = tryApplyDebuff(O, selected.tag, LANDED_STAT_DEBUFF_TURNS, 0.25, S);
      if (applied) logAt(LOG.STATUS, '⚔️ Overcharge: Opponent ATK reduced by 25% for 1 turn.');
    }
    if (!applied) logAt(LOG.STATUS, `🔮 Overcharge: ${selected.label} was resisted.`);
  };

  const playerAttack = (S, O, context = {}) => {
    const isPrimaryAttack = context.isPrimaryAttack !== false;
    const isAdditionalAttack = !isPrimaryAttack;
    const allowAdditionalAttackProcs =
      isPrimaryAttack && context.allowAdditionalAttackProcs !== false;
    const attackSource = context.source || (isPrimaryAttack ? 'primary' : 'additional');
    const attackScale = Number.isFinite(context.atkScale) ? context.atkScale : 1;
    const scratchBaseline = context.scratchBaseline || {
      damageBonusPct: S.scratch.damageBonusPct,
      damageReductionPct: S.scratch.damageReductionPct,
      incomingDamageIncreasePct: S.scratch.incomingDamageIncreasePct,
      playerAtkMult: S.scratch.playerAtkMult,
      playerDefMult: S.scratch.playerDefMult,
      ignoreDefPct: S.scratch.ignoreDefPct,
      nextAttackAutoCrit: S.scratch.nextAttackAutoCrit,
      nextAttackDouble: S.scratch.nextAttackDouble,
    };
    if (isAdditionalAttack) {
      S.scratch.damageBonusPct = scratchBaseline.damageBonusPct;
      S.scratch.damageReductionPct = scratchBaseline.damageReductionPct;
      S.scratch.incomingDamageIncreasePct = scratchBaseline.incomingDamageIncreasePct;
      S.scratch.playerAtkMult = scratchBaseline.playerAtkMult;
      S.scratch.playerDefMult = scratchBaseline.playerDefMult;
      S.scratch.ignoreDefPct = scratchBaseline.ignoreDefPct;
      // Durable "next attack" guarantees belong to Attack #1. Attack-bound hooks
      // below can still independently arm these values for Attack #2.
      S.scratch.nextAttackAutoCrit = false;
      S.scratch.nextAttackDouble = false;
    }
    S.scratch.attackContext = {
      isPrimaryAttack,
      isAdditionalAttack,
      allowAdditionalAttackProcs,
      source: attackSource,
    };
    const tyrfingThreshold = O.kind === 'player'
      ? TYRFING_EXECUTE_PCT_PLAYER
      : TYRFING_EXECUTE_PCT_MOB;
    if (S.weaponPassiveKey === 'tyrfing' && O.hp < O.maxHp * tyrfingThreshold) {
      if (sideImmune(O, 'boss_immune')) {
        bt.shared.events.push('🚫 Cursed Edge has no effect on bosses.');
      } else {
        const remaining = O.hp;
        setHp(O, 0);
        bt.shared.events.push(`🗡️ Cursed Edge — the curse takes hold! Tyrfing strikes for ${remaining} damage.`);
        checkDeaths('execute', { type: 'execute', source: 'Cursed Edge' });
        return;
      }
    }
    // These hooks run only when an action really begins. A CC or Dizzy/Stun skip
    // cannot consume first-action effects, roll offensive procs, or leak a proc.
    const attackHookEventStart = bt.shared.events.length;
    for (const hook of S.scratch.attackHooks) hook();
    const attackHookEvents = bt.shared.events.splice(attackHookEventStart);

    consumeNextAttackFlags(S, attackHookEvents);
    // Mage Overcharge is a turn-based modifier consumed only by the primary
    // attack on every 3rd round. Any Labrys, Archer, Glacial Bow, or future
    // additional attack gets the normal multiplier and a fresh crit roll.
    const overchargeRound = isPrimaryAttack
      && S.classPassive === 'overcharge'
      && bt.shared.round % OVERCHARGE_EVERY === 0;
    const fighterStunTurns = S.classPassive === 'stun'
      ? (isPrimaryAttack
        ? S.stunPreRoll
        : (bt.rng() < FIGHTER_STUN_CHANCE ? FIGHTER_STUN_TURNS : 0))
      : 0;

    const doHit = ({ atkScale, mainHit, critKnown }) => {
      if (result) return;
      const preHitEvents = [];
      const def = effDef(S, O, { mainHit });
      let crit;
      if (critKnown != null) crit = critKnown;
      else crit = bt.rng() * 100 < effCritChance(S); // secondary hits roll fresh
      const variance = 0.9 + bt.rng() * 0.2;

      // Damage multiplier — ONE unified rule (§35.2 / config/combat). The damage-% bonus
      // (weapon bonusDmgPct + procced sources via scratch.damageBonusPct, e.g. Katana or a
      // deity) stacks additively and applies to BOTH crit and non-crit:
      //   hit = base × ((critLevel ? 2.0 : 1.0) + damage%/100)
      // Double (Idiyanale) is a GUARANTEED crit-level hit — same 2.0 base + damage%, so it
      // stacks with the rider (Supreme + double → ×2.5; Supreme + deity 50% + double → ×3.0).
      // Overcharge (Mage 3rd-round primary attack) is its own lane:
      // ×(2.75 + damage%/100), no crit.
      const overchargeFired = mainHit && overchargeRound;
      const doubled = mainHit && S.scratch.nextAttackDouble && !overchargeFired;
      const critApplied = crit && !overchargeFired && !doubled;
      const critLevel = critApplied || doubled; // double = guaranteed crit-level multiplier

      const surtVsBurning = Boolean(S.flags.surt_on_hit && findDebuff(O, 'burn'));
      const willFighterStun = mainHit
        && S.classPassive === 'stun'
        && fighterStunTurns > 0
        && canApplyFighterStun(O);
      const jarngreiprEligible = willFighterStun && S.flags.jarngreipr_on_stun;
      const thunderboltTriggered = mainHit && S.flags.thunderbolt_on_crit && critApplied;
      const reactiveAtkMult = (surtVsBurning ? 0.50 : 0)
        + (thunderboltTriggered ? 1.00 : 0);
      const damagePct = S.bonusDmgPct + S.scratch.damageBonusPct;
      const rolledDamage = (extraAtkMult) => {
        let amount = mitigated(effAtk(S, extraAtkMult) * atkScale, def) * variance;
        if (overchargeFired) {
          // Overcharge stacks the damage-% lane ADDITIVELY onto the ×2.75 base,
          // still with NO crit. ATK-mult procs already fold in through effAtk.
          amount *= OVERCHARGE_MULT + damagePct / 100;
        } else {
          amount *= hitMultiplier(critLevel, damagePct);
        }
        return amount;
      };
      let dmg = rolledDamage(reactiveAtkMult);
      let fighterBashDmg = willFighterStun
        ? rolledDamage(reactiveAtkMult + FIGHTER_BASH_DAMAGE_PCT)
        : null;
      let jarngreiprDmg = jarngreiprEligible
        ? rolledDamage(reactiveAtkMult + FIGHTER_BASH_DAMAGE_PCT + 0.50)
        : null;
      if (mainHit && S.flags.odin_foresight_bonus > 0) {
        const bonus = Math.floor(S.flags.odin_foresight_bonus);
        dmg += bonus;
        if (fighterBashDmg != null) fighterBashDmg += bonus;
        if (jarngreiprDmg != null) jarngreiprDmg += bonus;
        S.flags.odin_foresight_bonus = 0;
        preHitEvents.push(`🪄 Odin: All-Father's Foresight — released ${bonus} stored damage!`);
      }
      dmg = Math.max(0, Math.floor(dmg));
      if (fighterBashDmg != null) {
        fighterBashDmg = Math.max(0, Math.floor(fighterBashDmg));
      }
      if (jarngreiprDmg != null) {
        jarngreiprDmg = Math.max(0, Math.floor(jarngreiprDmg));
      }

      let fighterStunResolved = false;
      let fighterStunned = false;
      let jarngreiprTriggered = false;
      const prepareLandedHit = willFighterStun
        ? () => {
          fighterStunResolved = true;
          fighterStunned = tryApplyDebuff(O, 'stun', fighterStunTurns, 0, S);
          jarngreiprTriggered = fighterStunned && jarngreiprEligible;
          if (fighterStunned) dmg = jarngreiprTriggered ? jarngreiprDmg : fighterBashDmg;
          return dmg;
        }
        : null;

      let tag = overchargeFired ? ' *(Overcharge!)*'
        : doubled ? ' *(Double!)*'
        : critApplied ? ' *(CRIT!)*' : '';
      const targetHpBeforeHit = O.hp;
      const { hit: res, reactions } = applyHitWithReactions(
        S,
        O,
        dmg,
        { crit: critApplied, prepareLandedHit },
      );
      if (fighterStunned) tag += ' *(Bash!)*';
      const actualDamageDealt = Math.min(res.applied, targetHpBeforeHit);
      const attackLabel = attackSource === 'auto_fire'
        ? `🏹 ${S.name}'s Auto-Fire triggered — additional shot`
        : `⚔️ ${S.name} ${mainHit ? 'attacks' : 'strikes again'}`;
      // ATTACK priority also opens a new ordering block, so this attack's modifiers
      // can never be sorted under the previous attack's line.
      logAt(LOG.ATTACK, res.evaded
        ? `${attackLabel} — **Evaded!**`
        : `${attackLabel} for **${res.applied} DMG**${tag}`);
      // Queued hook entries already carry their source category; the two bare strings
      // pushed into this buffer below are deity effects, hence the BLESSING channel.
      if (mainHit) bt.shared.events.at(LOG.BLESSING, () => bt.shared.events.push(...attackHookEvents.splice(0)));
      bt.shared.events.at(LOG.BLESSING, () => bt.shared.events.push(...preHitEvents));
      bt.shared.events.push(...reactions);
      if (!res.negated && surtVsBurning) {
        logAt(LOG.BLESSING, "🔥 Surt: Muspell's Flame — +50% vs a burning enemy!");
      }
      if (!res.negated && thunderboltTriggered) {
        const paralyzed = !result && tryApplyDebuff(O, 'paralyze', 1, 0, S);
        logAt(LOG.WEAPON, '⚡ Thunderbolt of Zeus: Divine Thunder — +100% ATK!');
        if (paralyzed) logAt(LOG.STATUS, `⚡ ${O.name} is Paralyzed!`);
      }
      // Lifesteal is based on damage dealt, including a lethal blow. This must run
      // before the result return so Japanese Bo does not lose its finishing-hit heal.
      if (res.applied > 0 && S.hp > 0) {
        if (S.flags.japanese_bo_active) {
          applyLifesteal(S, res.applied, 0.50, 'Vital Siphon');
        }
        if (S.flags.soul_drain_pct > 0) {
          applyLifesteal(S, actualDamageDealt, S.flags.soul_drain_pct, 'Soul Drain');
        }
        if (S.flags.rune_lifesteal_pct > 0) {
          applyLifesteal(S, res.applied, S.flags.rune_lifesteal_pct, 'Vampiric Rune');
        }
        // [Genesis] Titan: Forgefire Veins — 30% of damage dealt (50% below 50% HP).
        if (S.flags.titan_lifesteal_pct > 0) {
          applyLifesteal(S, res.applied, S.flags.titan_lifesteal_pct, 'Forgefire Veins');
        }
      }
      if (result) {
        return;
      }

      // Overcharge's one effect is selected only after the primary hit lands and
      // normal damage has been logged/resolved. The engine's immunity path may still
      // resist the selected effect, but there is never a second roll or a second effect.
      if (mainHit && overchargeFired && !res.negated && O.hp > 0) {
        applyOverchargeDebuff(S, O);
      }

      // class on-hit effects (landed main hit only)
      if (mainHit && !res.negated) {
        if (willFighterStun) {
          // Stun-lock guard: a new Fighter stun cannot be applied while the target is
          // already stunned or during the recovery round. addDebuff() enforces the same
          // rule centrally for every other stun source, so mixed passives cannot refresh it.
          const stunned = fighterStunResolved
            ? fighterStunned
            : addDebuff(O, 'stun', fighterStunTurns);
          if (stunned) {
            logAt(LOG.CLASS, `👊 ${S.name}'s Bash stuns ${O.name} for ${fighterStunTurns} turn!`);
            if (jarngreiprTriggered) {
              logAt(LOG.WEAPON, '⚡ Thunder Grip — enemy Stunned, Bash deals +50% bonus damage!');
            }
            O.flags.dizzy_pending = true;
            logAt(LOG.CLASS,
              `💫 ${O.name} becomes Dizzy — ${Math.round(FIGHTER_DIZZY_MISS_CHANCE * 100)}% chance to miss the next attack.`);
          }
        }
      }
      if (!res.negated) {
        applyLandedHitPassives(S, O, { mainHit, crit: critApplied, damage: res.applied });
      }
      if (result) return;
      // Every landed Swordsman attack adds one 4% Bleed stack and refreshes it to 2 turns.
      // Five stacks cap the additive value at 20%; later hits only refresh the duration.
      // Requires the swordsman to actually act — a skip-CC'd turn never reaches here.
      // The per-attack rng draw is KEPT (consumed, unused) for draw-order stream stability
      // now that the value is deterministic.
      // `O.hp > 0` is the death gate: a stack can only be applied to a target that
      // survived the damage that triggered it. `result` alone is not enough, because a
      // boss pool can reach 0 without ending the battle.
      if (S.classPassive === 'bleed' && !res.negated && O.hp > 0 && !debuffImmune(O, 'bleed')) {
        applySwordsmanBleedStack(S, O);
      }
      if (mainHit) {
        S.flags.crossbow_pierce = false;
        S.flags.gungnir_full_pierce = false;
      }
    };

    // main hit (crit pre-rolled at round start; auto-crit flags can upgrade it) —
    // an overcharge round suppresses the crit entirely (§13.1), latch and all.
    const mainCritRoll = isAdditionalAttack ? bt.rng() : S.critRollValue;
    const mainCrit = !overchargeRound
      && ((mainCritRoll * 100 < effCritChance(S)) || S.scratch.nextAttackAutoCrit);
    doHit({ atkScale: attackScale, mainHit: true, critKnown: mainCrit });
    if (result) return;

    // Post-hit burst procs. Their landed-hit hooks arm these flags, so evasion and
    // crowd-control skips cannot trigger or carry them into a later turn.
    if (S.flags.instakill_check) {
      S.flags.instakill_check = false;
      bt.shared.events.push('🔮 Death Charm — instant kill!');
      setHp(O, 0);
      if (checkDeaths('instakill', { type: 'execute', source: 'Death Charm' })) return;
    }
    if (S.flags.rupture_check || S.flags.rupture_boss_blocked) {
      const ruptured = S.flags.rupture_check;
      const bossBlocked = S.flags.rupture_boss_blocked;
      S.flags.rupture_check = false;
      S.flags.rupture_boss_blocked = false;
      const percentDamageBlocked = sideImmune(O, 'boss_immune');
      if (ruptured && !percentDamageBlocked) {
        const burst = Math.floor(effectDamage(O, O.maxHp * (S.flags.rupture_pct || 0)));
        const before = O.hp;
        damage(O, burst);
        const applied = before - O.hp;
        bt.shared.events.push(
          `☠️ Venom Burst — Rupture deals ${applied} damage!` +
          `${S.flags.venom_burst_applied ? ' Venom applied for 2 turns.' : ''}`
        );
        if (applied > 0 && S.hp > 0 && S.flags.soul_drain_pct > 0) {
          applyLifesteal(S, applied, S.flags.soul_drain_pct, 'Soul Drain');
        }
        if (checkDeaths('rupture')) return;
      } else if (bossBlocked || percentDamageBlocked) {
        bt.shared.events.push(
          '🚫 Venom Burst — Rupture has no effect on bosses.' +
          `${S.flags.venom_burst_applied ? ' Venom applied for 2 turns.' : ''}`
        );
      }
      S.flags.venom_burst_applied = false;
    }
    if (S.flags.hemorrhage_check) {
      S.flags.hemorrhage_check = false;
      if (sideImmune(O, 'boss_immune')) {
        bt.shared.events.push('🚫 Hemorrhaging Shot has no effect on bosses.');
      } else {
        const burst = Math.floor(effectDamage(O, O.maxHp * (S.flags.hemorrhage_pct || 0)));
        const before = O.hp;
        damage(O, burst);
        const applied = before - O.hp;
        bt.shared.events.push(
          `🩸 Hemorrhaging Shot — Hemorrhage deals ${applied} damage` +
          `${S.flags.hemorrhage_shredded ? ', enemy DEF -15% for 1 turn.' : '.'}`
        );
        if (applied > 0 && S.hp > 0 && S.flags.soul_drain_pct > 0) {
          applyLifesteal(S, applied, S.flags.soul_drain_pct, 'Soul Drain');
        }
        if (checkDeaths('hemorrhage')) return;
      }
      S.flags.hemorrhage_shredded = false;
    }

    // Additional-attack generators are evaluated only by the primary attack.
    // Their deterministic order is Labrys → Glacial Bow → Archer. Every generated
    // attack is otherwise a complete regular attack instance, but its context
    // disables every additional-attack generator to prevent recursion.
    const additionalAttacks = collectAdditionalAttacks(S, allowAdditionalAttackProcs);

    for (const additional of additionalAttacks) {
      if (result || O.hp <= 0) break;
      if (additional.log) logAt(additional.logPriority || LOG.WEAPON, additional.log);
      rerollDefensiveChecks(S, O);
      playerAttack(S, O, {
        isPrimaryAttack: false,
        allowAdditionalAttackProcs: false,
        source: additional.source,
        atkScale: additional.atkScale,
        scratchBaseline,
      });
    }
  };

  // ── mob attack action ──────────────────────────────────────────────────────
  const mobAttack = (S, O) => {
    // mob offense riders live on the defending player's flags (registry wrote them there)
    const F = O.flags;
    const attackHookEventStart = bt.shared.events.length;
    for (const hook of O.scratch.enemyAttackHooks) hook();
    const attackHookEvents = bt.shared.events.splice(attackHookEventStart);
    const subHits = Math.max(1, Number(S.specialFlags.multi_attack) || 1);
    const subPct = subHits > 1 ? Number(S.specialFlags.multi_attack_pct) || 1 : 1;
    const rawAtkBase = F.enemy_atk_override != null
      ? F.enemy_atk_override
      : S.atk * (1 + (S.flags.bakunawa_atk_bonus_pct || 0)) * (F.enemy_atk_mult || 1.0);
    // ATK Down is a shared effective-ATK debuff, so it must also cover the mob
    // attack path (which does not use the player-only effAtk helper).
    const atkBase = Math.max(0, rawAtkBase * (1 - debuffValue(S, 'atk_down')));

    // A "X% ATK" nuke round (enemy_atk_mult set by the mob skill) IS the mob's big hit —
    // it does not also crit-multiply, so a nuke stays a clean ×(pct) and never spikes to
    // ×4 (mirrors the player overcharge/double rule). Plain rounds still crit normally.
    const nukeRound = (F.enemy_atk_mult || 1) > 1;
    for (let i = 0; i < subHits && !result; i++) {
      const crit = bt.rng() * 100 < S.crit;          // enemy authored crit, uncapped
      const critApplied = crit && !nukeRound;
      const variance = 0.9 + bt.rng() * 0.2;
      const outgoingDamageMultiplier = Math.max(0, Number(F.enemy_damage_mult) || 1);
      let dmg = mitigated(atkBase * subPct, effDef(S, O)) * variance * outgoingDamageMultiplier;
      if (i === 0) dmg += F.enemy_bonus_damage || 0;  // rider once per round (R4)
      if (critApplied) dmg *= CRIT_MULT;
      dmg = Math.max(0, Math.floor(dmg));
      const { hit: res, reactions } = applyHitWithReactions(S, O, dmg, { crit: critApplied });
      const attackLabel = `💀 ${S.name} strikes${subHits > 1 ? ` (hit ${i + 1}/${subHits})` : ''}`;
      logAt(LOG.ATTACK, res.evaded
        ? `${attackLabel} — **Evaded!**`
        : `${attackLabel} for **${res.applied} DMG**${critApplied ? ' *(CRIT!)*' : ''}`);
      if (i === 0) bt.shared.events.at(LOG.MOB_SKILL, () => bt.shared.events.push(...attackHookEvents));
      bt.shared.events.push(...reactions);
      if (!res.negated && !result) {
        for (const hook of O.scratch.enemyLandedHitHooks) {
          hook({
            crit: critApplied,
            damage: res.applied,
            hitIndex: i,
            hitCount: subHits,
          });
        }
      }
    }
  };

  const act = (S) => {
    if (result) return;
    // Pre-action lines (CC skips, Dizzy recovery, Mage charge) are class/status
    // reporting; the attack itself re-channels to ATTACK when it fires.
    bt.shared.events.channel = LOG.CLASS;
    const O = oppOf(S);
    if (S.flags.attacks_cannot_miss) {
      const armedMisses = S.debuffs.filter((d) => d.tag === 'miss' && d.armed);
      if (armedMisses.length) {
        for (const debuff of armedMisses) debuff.turnsLeft -= 1;
        const expiredCount = armedMisses.filter((d) => d.turnsLeft <= 0).length;
        S.debuffs = S.debuffs.filter((d) => d.turnsLeft > 0);
        healTribalWard(S, expiredCount, 'expired');
        bt.shared.events.push(`🏹 ${S.name}'s Moira overcomes Miss; the attack cannot miss.`);
      }
    }
    // Skip-CC gates only on ARMED tags. Existing CC arms at round start; new
    // skip-CC applied during this round gates the recipient's next turn.
    const skipTags = S.debuffs.filter((d) => SKIP_TAGS.includes(d.tag) && d.armed);
    if (skipTags.length > 0) {
      const hadStun = skipTags.some((d) => d.tag === 'stun');
      const hadFreeze = skipTags.some((d) => d.tag === 'freeze');
      const paralyze = skipTags.find((d) => d.tag === 'paralyze');
      if (paralyze && paralyze.source) {
        const paralyzeDamage = Math.max(0, Math.floor(effAtk(paralyze.source) * 0.05));
        const before = S.hp;
        damage(S, paralyzeDamage);
        const applied = before - S.hp;
        bt.shared.events.push(
          `⚡ Paralyzed: ${S.name} takes ${applied} damage and skips this turn.`
        );
        if (checkDeaths('paralyze', { type: 'dot', source: 'Paralyze' })) return;
      }

      for (const d of skipTags) d.turnsLeft -= 1;
      const expiredCount = skipTags.filter((d) => d.turnsLeft <= 0).length;
      S.debuffs = S.debuffs.filter((d) => d.turnsLeft > 0);
      healTribalWard(S, expiredCount, 'expired');
      // On the round a stun wears off, grant a 1-round immunity window so the Fighter
      // class passive can't immediately re-chain it (see the stun-lock guard above).
      if (hadStun && !S.debuffs.some((d) => d.tag === 'stun')) {
        S.flags.stun_immune_until = bt.shared.round + 1;
      }
      // Skadi: when a Freeze wears off the victim is left Frostbitten (+50% damage taken).
      // turnsLeft 2 so it reliably covers the next round's incoming attack ("1 turn").
      if (hadFreeze && !S.debuffs.some((d) => d.tag === 'freeze')) {
        addDebuff(S, 'frostbite', 2);
        bt.shared.events.push(`🧊 ${S.name} is Frostbitten — takes +50% damage!`);
      }
      bt.shared.events.push(`⏸️ ${S.name} is unable to act (${skipTags.map((d) => d.tag).join(', ')})!`);
      return;
    }
    // Thor's linked Paralyze status controls the 10% action-skip chance while its
    // separate DOT continues independently through status immunity and cleansing.
    if (S.debuffs.some((d) => d.tag === 'thor_paralyze') && bt.rng() < 0.10) {
      bt.shared.events.push(`⚡ ${S.name} is paralyzed and cannot move!`);
      return;
    }
    // Fighter Bash leaves one pending miss check. Stun/other skips are not attack
    // attempts, so Dizzy survives them; the next real attempt consumes it whether
    // the roll misses or the attack proceeds normally.
    if (S.flags.dizzy_pending) {
      S.flags.dizzy_pending = false;
      const dizzyMissed = bt.rng() < FIGHTER_DIZZY_MISS_CHANCE;
      if (dizzyMissed && !S.flags.attacks_cannot_miss) {
        bt.shared.events.push(`💫 ${S.name} misses the attack (Dizzy)!`);
        return;
      }
      if (dizzyMissed) {
        bt.shared.events.push(`🏹 ${S.name}'s Moira overcomes Dizzy; the attack cannot miss.`);
      }
    }
    if (S.kind === 'player') {
      if (S.classPassive === 'overcharge') {
        const charge = ((bt.shared.round - 1) % OVERCHARGE_EVERY) + 1;
        bt.shared.events.push(
          `🔮 Mage Passive: Overcharge — Charge ${charge}/${OVERCHARGE_EVERY}` +
          `${charge === OVERCHARGE_EVERY ? ' — Released!' : ''}`
        );
      }
      playerAttack(S, O);
    } else {
      mobAttack(S, O);
    }
  };

  // ── round-start bookkeeping ────────────────────────────────────────────────
  const resetScratch = (side) => {
    side.scratch = {
      damageBonusPct: 0,
      damageReductionPct: 0,
      incomingDamageIncreasePct: 0,
      playerAtkMult: 0,
      playerDefMult: 0,
      ignoreDefPct: 0,
      nextAttackAutoCrit: false,
      nextAttackDouble: false,
      attackContext: null,
      attackHooks: [],
      landedHitHooks: [],
      enemyAttackHooks: [],
      enemyLandedHitHooks: [],
    };
    // per-round DERIVED flags the registry re-establishes every round
    side.flags.enemy_bonus_damage = 0;
    side.flags.enemy_atk_mult = undefined;
    side.flags.enemy_damage_mult = 1;
    side.flags.enemy_ignore_def_pct = 0;
    side.flags.enemy_def_mult = undefined;
    side.flags.enemy_atk_override = null;
    side.flags.bathala_hp_fraction = 0;
    side.flags.mail_brokkr_reflect = 0;
    side.flags.mail_brokkr_hit_cap = 0;
    side.flags.mantle_bathala_heal_pct = 0;
    side.flags.salakot_negate_chance = hasEquippedPassive(side, 'salakot_ward') ? 0.35 : 0;
    side.flags.charmed_hide_active = hasEquippedPassive(side, 'anting_anting_sash');
    // [v5 Phase 2] socketed effect-rune per-round flags (the rune runner re-sets them).
    side.flags.rune_thorns_reflect = 0;
    side.flags.rune_warding_pct = 0;
    // [Caduceus] Its own flag rather than sharing rune_warding_pct, which the rune
    // runner overwrites every round — sharing would make the two clobber each other.
    side.flags.caduceus_dot_reduction = 0;
    side.flags.rune_lifesteal_pct = 0;
  };

  const setInputFlags = (side) => {
    const O = oppOf(side);
    side.flags.enemy_is_stunned = !!findDebuff(O, 'stun');
    side.flags.enemy_is_bleeding = O.debuffs.some((effect) => effectHasTag(effect.tag, BLEED_TAG));
    side.flags.enemy_is_burning = !!findDebuff(O, 'burn');
  };

  const applyBathala = (side) => {
    const target = Math.floor(side.in.hp * (side.flags.bathala_hp_fraction || 0));
    const delta = target - side.bathalaExtraHp;
    if (delta !== 0) {
      side.maxHp += delta;
      side.bathalaExtraHp = target;
      setHp(side, side.hp + (delta > 0 ? delta : 0));
    }
    if (side.flags.mantle_bathala_heal_pct > 0) {
      const before = side.hp;
      heal(side, side.maxHp * side.flags.mantle_bathala_heal_pct);
      bt.shared.events.push(
        `✨ Divine Aegis — max stacks restored ${(side.hp - before).toLocaleString()} HP.`
      );
    }
  };

  /** Resolve class passives at the shared round passive point. */
  const processClassPassive = (side) => {
    if (side.kind !== 'player' || side.hp <= 0) return;

    if (side.classPassive === 'damage_reduction') {
      const before = side.hp;
      heal(side, side.maxHp * KNIGHT_HEAL_PCT);
      const restored = side.hp - before;
      if (restored > 0) {
        logAt(LOG.CLASS,
          `🛡️ Knight Passive: Restored ${KNIGHT_HEAL_PCT * 100}% max HP (+${restored.toLocaleString()} HP).`);
      }
    }

    if (side.classPassive === 'bleed') {
      const previous = Number(side.flags.swordsman_atk_bonus_pct) || 0;
      const next = Math.min(SWORDSMAN_ATK_MAX, previous + SWORDSMAN_ATK_PER_TURN);
      side.flags.swordsman_atk_bonus_pct = next;
      side.scratch.playerAtkMult += next;
      if (next > previous) {
        logAt(LOG.CLASS,
          `⚔️ Swordsman Passive: ATK increased by ${Math.round((next - previous) * 100)}%. ` +
          `Current bonus: ${Math.round(next * 100)}%.`);
      }
    }
  };

  const runRegistry = (key, perspective) => {
    if (result) return;
    const fn = PASSIVE_REGISTRY[key] || PASSIVE_REGISTRY.none;
    fn(perspective);
    checkDeaths('passive');
  };

  /**
   * [v5 Phase 2 §2.4] Apply a player's socketed EFFECT runes for this round. Runs
   * in the passive phase (after the armor passive, before actions) on the bearer's
   * perspective. Stat-% runes already folded into base stats at assembly — here we
   * only handle combat-effect families. Sums within a family across sockets:
   *   piercing → ignoreDefPct (highest-wins lane) · aegis_rune → incoming reduction
   *   thorns → reflect % · warding → incoming-DOT cut · vampiric → lifesteal %
   *   venom → on-hit flat Poison DOT (2 turns). No runes → no-op (byte-identical).
   */
  const applyRunes = (side, P) => {
    if (result) return;
    const runes = side.in.effectRunes;
    if (!Array.isArray(runes) || runes.length === 0) return;
    let pierce = 0, incoming = 0, thorns = 0, warding = 0, lifesteal = 0, venom = 0;
    for (const r of runes) {
      const v = Number(r.value) || 0;
      switch (r.effect_key) {
        case 'piercing':   pierce += v; break;
        case 'aegis_rune': incoming += v; break;
        case 'thorns':     thorns += v; break;
        case 'warding':    warding += v; break;
        case 'vampiric':   lifesteal += v; break;
        case 'venom':      venom = Math.max(venom, v); break; // refresh, highest-wins
        default: break;
      }
    }
    if (pierce > 0) P.ignoreDefPct = Math.max(P.ignoreDefPct, Math.min(pierce, 100) / 100);
    if (incoming > 0) P.damageReductionPct += Math.min(incoming, 100) / 100;
    side.flags.rune_thorns_reflect = thorns / 100;
    side.flags.rune_warding_pct = Math.min(warding, 100) / 100;
    side.flags.rune_lifesteal_pct = lifesteal / 100;
    if (venom > 0) {
      const poisonPct = venom / 100;
      P.onLandedHit(() => {
        if (!P.enemyImmune('poison')) {
          P.applyDebuff('poison', 2, P.playerATK * poisonPct);
        }
      }, LOG.STATUS);
    }
    checkDeaths('passive');
  };

  // ── snapshots ──────────────────────────────────────────────────────────────
  const snapSide = (side) => ({
    hp: side.hp,
    maxHp: side.maxHp,
    debuffs: side.debuffs.map((d) => ({
      tag: d.tag,
      category: d.category,
      turnsLeft: d.turnsLeft,
    })),
  });
  let lastActions = {
    a: { title: 'Ready', detail: 'Awaiting first action' },
    b: { title: 'Ready', detail: 'Awaiting first action' },
  };
  const snap = (round, tag = null) => ({
    round,
    a: snapSide(bt.A),
    b: snapSide(bt.B),
    actions: { a: { ...lastActions.a }, b: { ...lastActions.b } },
    ...(tag ? { tag } : {}),
  });
  const snapshots = [snap(0, 'start')];

  // ── actor order ────────────────────────────────────────────────────────────
  let aFirst;
  if (mode === 'raid') {
    bt.rng(); // Preserve the legacy stream position; raid always starts with the user.
    aFirst = true;
  } else if (mode === 'boss') {
    aFirst = !bt.B.specialFlags.first_strike; // Boss first-strike passives override the default.
  } else {
    aFirst = bt.rng() < 0.5; // Duel/PvP uses a fair 50/50 order roll.
  }
  const order = aFirst ? [bt.A, bt.B] : [bt.B, bt.A];

  // ── main loop ──────────────────────────────────────────────────────────────
  const rounds = [];
  for (let round = 1; round <= MAX_ROUNDS && !result; round++) {
    bt.shared.round = round;
    bt.shared.events = new CombatLog();
    const actionStartA = actionState(bt.A);
    const actionStartB = actionState(bt.B);

    const captureActions = () => {
      const actionEndA = actionState(bt.A);
      const actionEndB = actionState(bt.B);
      lastActions = {
        a: summarizeAction(bt.A, bt.B, actionStartA, actionStartB, actionEndA, actionEndB, bt.shared.events.texts()),
        b: summarizeAction(bt.B, bt.A, actionStartB, actionStartA, actionEndB, actionEndA, bt.shared.events.texts()),
      };
    };
    const captureActionFor = (actor) => {
      const actionEndA = actionState(bt.A);
      const actionEndB = actionState(bt.B);
      if (actor === bt.A) {
        lastActions.a = summarizeAction(bt.A, bt.B, actionStartA, actionStartB, actionEndA, actionEndB, bt.shared.events.texts());
      } else {
        lastActions.b = summarizeAction(bt.B, bt.A, actionStartB, actionStartA, actionEndB, actionEndA, bt.shared.events.texts());
      }
    };
    const tickDotsForSide = (side) => {
      if (result) return;
      bt.shared.events.channel = LOG.DOT;
      let expired = 0;
      // combatLog.DOT_RESOLUTION_ORDER is the single source of truth for DOT sequence
      // (Poison → Burn → Bleed → …), so raid, boss, duel and ranked all resolve and
      // print them identically no matter what order the debuffs were applied in.
      const dots = side.debuffs
        .filter((d) => DOT_TAGS.includes(d.tag))
        .sort((a, b) => dotOrderIndex(a.tag) - dotOrderIndex(b.tag));
      for (const d of dots) {
        // A DOT that kills the target ends the tick: nothing else resolves against a
        // defeated combatant, and the remaining stacks keep their turn counters.
        if (result || side.hp <= 0) break;
        let tick = d.tag === 'hp_pct_dot'
          ? Math.floor(side.maxHp * d.value)
          : Math.floor(d.value);
        tick = Math.floor(effectDamage(side, tick));
        // [v5 Phase 2] Warding rune reduces incoming DOT damage on the bearer.
        if (side.flags.rune_warding_pct > 0) tick = Math.floor(tick * (1 - side.flags.rune_warding_pct));
        // [Caduceus] Herald's Touch reduces incoming DOT by 10%. Applied AFTER the
        // Warding rune and multiplicatively, so the two compound rather than one
        // overwriting the other.
        if (side.flags.caduceus_dot_reduction > 0) {
          tick = Math.floor(tick * (1 - side.flags.caduceus_dot_reduction));
        }
        if (tick > 0) {
          const before = side.hp;
          damage(side, tick);
          const applied = before - side.hp;
          const name = combatantName(side);
          const remaining = Math.max(0, d.turnsLeft - 1);
          if (d.overcharge && d.tag === 'burn') {
            bt.shared.events.push(`🔥 Burn deals ${applied} damage.`);
          } else if (d.tag === 'venom') {
            bt.shared.events.push(
              `☠️ Venom ticks for ${applied} damage.` +
              `${remaining > 0 ? ` (${remaining} turn remaining)` : ''}`
            );
          } else {
            bt.shared.events.push(`🩸 ${name} suffers ${applied} ${ACTION_TAG_LABELS[d.tag] || 'DOT'} damage!`);
          }
          if (d.source?.flags?.soul_drain_pct > 0 && d.source.hp > 0 && applied > 0) {
            applyLifesteal(d.source, applied, d.source.flags.soul_drain_pct, 'Soul Drain');
          }
          const dotSource = DOT_DEATH_CAUSE[d.tag] || DOT_DEATH_TEXT[d.tag] || 'damage over time';
          if (checkDeaths('dot', { type: 'dot', source: dotSource })) {
            d.turnsLeft -= 1;
            if (d.turnsLeft <= 0) expired += 1;
            break;
          }
        }
        d.turnsLeft -= 1;
        if (d.turnsLeft <= 0) expired += 1;
      }
      side.debuffs = side.debuffs.filter((d) => !DOT_TAGS.includes(d.tag) || d.turnsLeft > 0);
      if (!result && side.hp > 0) healTribalWard(side, expired, 'expired');
    };

    // 1. round start: scratch + latches
    for (const side of order) resetScratch(side);
    for (const side of order) setInputFlags(side);
    // [Jun-2026 §2] ARM the skip-CC carried in from PREVIOUS rounds. Only an armed CC gates
    // an action this round; CC procced later this round (passive phase / the opponent's
    // attack) stays unarmed → it can't cancel an action already due, and can't deadlock two
    // opposing CC passives. side.skipped (armed CC present) voids this side's pre-rolls.
    for (const side of order) {
      let armedCC = false;
      for (const d of side.debuffs) {
        if (SKIP_TAGS.includes(d.tag)) { d.armed = true; armedCC = true; }
      }
      side.skipped = armedCC;
    }
    // 2. pre-rolls (R1) — always drawn for stream stability, voided when skip-CC'd
    for (const side of order) {
      if (side.kind !== 'player') continue;
      side.critRollValue = bt.rng();
      if (side.classPassive === 'stun') {
        const r = bt.rng();
        side.stunPreRoll = side.skipped || r >= FIGHTER_STUN_CHANCE
          ? 0
          : FIGHTER_STUN_TURNS;
      } else {
        side.stunPreRoll = 0;
      }
    }

    // 3. passive phase — each active passive exactly once per round (§35.1)
    const passiveEvents = new Map([[bt.A, []], [bt.B, []]]);
    // The SOURCE decides the category — never the passive's name. Anything a registry
    // entry logs (and anything its queued hooks log later) inherits the channel set
    // here, so a new weapon/blessing/rune slots into the right place for free.
    const collectPassiveEvents = (side, priority, fn) => {
      const start = bt.shared.events.length;
      bt.shared.events.at(priority, fn);
      if (bt.shared.events.length > start) {
        passiveEvents.get(side).push(...bt.shared.events.slice(start));
      }
    };
    for (const side of order) {
      collectPassiveEvents(side, LOG.CLASS, () => processClassPassive(side));
    }
    if (mode === 'duel') {
      for (const side of order) {
        const P = perspectiveOf(side);
        collectPassiveEvents(side, LOG.WEAPON, () => runRegistry(side.weaponPassiveKey, P));
        collectPassiveEvents(side, LOG.BLESSING, () => runRegistry(side.deityBlessingKey, P));
        collectPassiveEvents(side, LOG.ECHO_BLESSING, () => runRegistry(side.echoBlessingKey, P));  // [v5 Phase 3] echo blessing
        collectPassiveEvents(side, LOG.ARMOR, () => runRegistry(side.armorPassiveKey, P));
        collectPassiveEvents(side, LOG.RUNE, () => applyRunes(side, P));
      }
    } else {
      collectPassiveEvents(bt.A, LOG.WEAPON, () => runRegistry(bt.A.weaponPassiveKey, PA));
      collectPassiveEvents(bt.A, LOG.BLESSING, () => runRegistry(bt.A.deityBlessingKey, PA));
      collectPassiveEvents(bt.A, LOG.ECHO_BLESSING, () => runRegistry(bt.A.echoBlessingKey, PA));      // [v5 Phase 3] echo blessing
      collectPassiveEvents(bt.A, LOG.ARMOR, () => runRegistry(bt.A.armorPassiveKey, PA));
      collectPassiveEvents(bt.A, LOG.RUNE, () => applyRunes(bt.A, PA));
      collectPassiveEvents(bt.B, LOG.MOB_SKILL, () => runRegistry(bt.B.skillKey, PA));
    }
    // consume hydra local regen (local mirror only — never the shared pool)
    if (!result && bt.A.flags.hydra_local_regen > 0) {
      heal(bt.B, bt.A.flags.hydra_local_regen);
      bt.A.flags.hydra_local_regen = 0;
    }
    for (const side of order) {
      if (side.kind === 'player') collectPassiveEvents(side, LOG.BLESSING, () => applyBathala(side));
    }
    for (const side of order) {
      side.flags.player_was_critted = false; // latches consumed by deity/echo passives
      side.flags.player_crits_received = 0;
    }
    if (result) {
      captureActions();
      rounds.push({
        round,
        events: finalizeRound(orderEvents(bt.shared.events.slice(0))).map((e) => e.text),
        actions: lastActions,
      });
      break;
    }

    // 4. actions
    const procEnd = bt.shared.events.length; // events so far = this round's passive procs
    let act1DotStart = -1;                 // index where actor 1's post-action DOT begins
    let act2Start = -1;                    // index where the SECOND actor's segment begins
    let act2DotStart = -1;                 // index where actor 2's post-action DOT begins
    for (let oi = 0; oi < order.length; oi++) {
      const actor = order[oi];
      act(actor);
      captureActionFor(actor);
      if (oi === 0) act1DotStart = bt.shared.events.length;
      else if (oi === 1) act2DotStart = bt.shared.events.length;
      tickDotsForSide(actor);
      if (oi === 0) act2Start = bt.shared.events.length; // close the first actor's segment
      if (result) break;
    }
    const actionEnd = bt.shared.events.length; // procEnd..actionEnd = attack + action-DOT events

    // 5. end of round
    if (!result) {
      // 1-turn stat debuffs expire at end of round (§35.1)
      for (const side of order) {
        for (const d of side.debuffs) {
          if (!DOT_TAGS.includes(d.tag) && !SKIP_TAGS.includes(d.tag)) d.turnsLeft -= 1;
        }
        const expired = side.debuffs.filter(
          (d) => !DOT_TAGS.includes(d.tag) && !SKIP_TAGS.includes(d.tag) && d.turnsLeft <= 0
        ).length;
        side.debuffs = side.debuffs.filter((d) => d.turnsLeft > 0);
        healTribalWard(side, expired, 'expired');
      }
      // sudden death (§35.3): drain only hits player (user) sides — mobs and bosses are
      // exempt, so in PvE the user bleeds out while the enemy does not; a PvP duel has two
      // player sides, so both users still drain. Both dead → mob/challenged wins (R5).
      if (!result && round >= SUDDEN_DEATH_FROM) {
        const drained = [];
        for (const side of [bt.A, bt.B]) {
          if (side.kind !== 'player') continue;
          const drain = Math.floor(side.maxHp * SUDDEN_DEATH_PCT);
          damage(side, drain);
          drained.push(`${side.name} -${drain}`);
        }
        if (drained.length) {
          const who = drained.length > 1 ? 'Both combatants lose' : 'The challenger loses';
          logAt(LOG.ROUND_END, `☠️ Sudden death! ${who} 10% max HP (${drained.join(', ')}).`);
          if (bt.A.hp <= 0 && bt.B.hp <= 0) win(bt.B, 'sudden_death');
          else checkDeaths('sudden_death');
        }
      }
    }

    // Log DISPLAY order only — execution is unchanged (passives still resolve before
    // the attacks to set up the hits). Each actor's own segment is [its action events]
    // PLUS [its registry logs], merged rather than appended: combatLog then sorts the
    // merged run by source category, so an outgoing-damage modifier from the passive
    // phase lands immediately under the attack it modified instead of after the whole
    // segment (which is what used to push it past the defeat message).
    const seg2 = act2Start < 0 ? actionEnd : act2Start;
    const seg1Dot = act1DotStart < 0 ? seg2 : act1DotStart;
    const seg2Dot = act2DotStart < 0 ? actionEnd : act2DotStart;
    const actor1 = order[0];
    const actor2 = order[1];
    const segments = [
      [...bt.shared.events.slice(procEnd, seg1Dot), ...(passiveEvents.get(actor1) || [])],
      bt.shared.events.slice(seg1Dot, seg2),        // actor 1: post-action DOT
      [...bt.shared.events.slice(seg2, seg2Dot), ...(passiveEvents.get(actor2) || [])],
      bt.shared.events.slice(seg2Dot, actionEnd),   // actor 2: post-action DOT
      bt.shared.events.slice(actionEnd),            // end-of-round bookkeeping
    ];
    const orderedRound = finalizeRound(segments.flatMap((segment) => orderEvents(segment)));
    rounds.push({ round, events: orderedRound.map((e) => e.text), actions: lastActions });
    // [v4.8] snapshot cadence is mode-dependent: raid + duel snapshot on rounds 1,4,16,…
    // (multiplying the previous snapshot turn by 4), boss every 3rd (3,6,9…).
    // The start + final snapshots are always present regardless.
    const snapDue = (mode === 'duel' || mode === 'raid')
      ? isPowerOfFourRound(round)
      : round % SNAPSHOT_EVERY === 0;
    if (!result && snapDue) {
      snapshots.push(snap(round));
    }
  }

  // hard cap round 50 (§35.3)
  let outcome;
  if (result) {
    outcome = result.outcome;
  } else if (mode === 'boss') {
    result = { winner: 'b', outcome: 'boss_timeout' }; // "timeout, survived" — damage committed
    outcome = 'boss_timeout';
  } else {
    const pctA = bt.A.hp / bt.A.maxHp;
    const pctB = bt.B.hp / bt.B.maxHp;
    result = { winner: pctA > pctB ? 'a' : 'b', outcome: 'cap_hp_pct' }; // tie → mob/challenged
    outcome = 'cap_hp_pct';
  }

  snapshots.push(snap(rounds.length, 'end'));
  bt.totals.netDamage = Math.max(0, bt.totals.damageDealtToEnemy - bt.totals.enemyLocalRegen);

  const summary = (side) => ({
    name: side.name,
    kind: side.kind,
    cls: side.kind === 'player' ? (side.in.class || '') : (side.in.mobType || 'mob'),
    level: side.in.level,
    weapon: side.in.weaponName || null,
    armor: side.kind === 'player' ? (side.in.armorName || null) : null, // [v5] equipped armor
    deity: side.in.deityName || null,
    // mob/boss passive skill name + description for the render (null for players)
    skill: side.kind === 'player' ? null : (side.in.skillName || null),
    skillDesc: side.kind === 'player' ? null : (side.in.skillDescription || null),
    atk: side.atk, def: side.def, crit: side.crit,
    hp: side.hp, maxHp: side.maxHp,
    bossPassiveState: side.isBoss
      ? side.skillKey === FENRIR_PASSIVE_KEY
        ? { ...side.bossPassiveState }
        : {
          ...side.bossPassiveState,
          crossedThresholds: [...bt.moonState.crossedThresholds].sort((x, y) => y - x),
          atkBonusPct: bt.moonState.atkBonusPct,
        }
      : null,
  });

  return {
    winner: result.winner,
    outcome,
    causeOfDeath: result.causeOfDeath || null,
    rounds,
    snapshots,
    a: summary(bt.A),
    b: summary(bt.B),
    seed,
    mode,
    playerFirst: aFirst,
    totals: bt.totals,
    bossThresholdEvents,
  };
}

module.exports = {
  resolveBattle,
  rngOf,
  selectOverchargeDebuff,
  MAX_ROUNDS,
  SUDDEN_DEATH_FROM,
  SNAPSHOT_EVERY,
  ARCHER_DOUBLE_ATTACK_CHANCE,
  FIGHTER_STUN_CHANCE,
  FIGHTER_STUN_TURNS,
  FIGHTER_BASH_DAMAGE_PCT,
  BLEED_PCT_PER_STACK,
  BLEED_MAX_PCT,
  BLEED_MAX_STACKS,
};

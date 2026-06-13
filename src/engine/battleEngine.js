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
 *     1. actor-order roll (1 draw; SKIPPED when the mob has special_flags.first_strike
 *        OR when mode === 'boss' — [v4.2] the player always acts first vs a boss, so no
 *        draw is consumed. first_strike (Sleipnir) is checked BEFORE the boss branch and
 *        still keeps the boss first. raid/duel always consume the order draw.)
 *   PER ROUND
 *     2. pre-rolls, in actor order, for each PLAYER-kind side:
 *        a. crit pre-roll (1 draw, ALWAYS — voided if the side is skip-CC'd; also voided,
 *           with the draw still consumed, on a Mage's overcharge round (every 3rd) where the
 *           entire attack cannot crit — §13.1)
 *        b. class-stun pre-roll (1 draw, only if class passive is 'stun')
 *     3. passive phase (registry-internal draws, in invocation order):
 *        raid/boss → A.weapon → A.deity → mob skill (all on A's perspective)
 *        duel      → first actor's weapon → deity, then second actor's weapon → deity
 *     4. actions in actor order:
 *        PLAYER attack: main-hit variance (1 draw) → [Swordsman] bleed-value roll
 *        (1 draw, only when the main hit lands) → [labrys 2nd hit] crit (1) +
 *        variance (1) → [extra_turn] crit (1) + variance (1) + [Swordsman] bleed (1)
 *        MOB attack: per sub-hit → crit (1 draw) + variance (1 draw)
 *
 * ROUND PIPELINE (§35.1/§13.1, rulings R1–R9):
 *   round start → reset per-round scratch + derived flags → latch input flags
 *   (enemy_is_* / hit_received / player_was_critted) → determine skip-CC →
 *   pre-rolls (R1 latch: crit_landed_this_hit / stun_just_applied refer to THIS
 *   round's main hit) → passive phase (each passive exactly once per round; death
 *   check after every registry call) → consume hydra local regen / bathala HP flag →
 *   clear consumed latches → actions in actor order → end of round: DOT ticks
 *   (death check per tick), stat-debuff expiry, sudden-death drain (round ≥ 30),
 *   snapshot per mode cadence. Hard cap round 50 (§35.3).
 *
 * SNAPSHOT CADENCE ([v4.2], mode-dependent — the renderer's edit loop consumes
 *   whatever arrives; the start + final snapshots are always present):
 *     duel → every round   raid → odd rounds (1,3,5,…)   boss → every 3rd round
 *
 * MAGE OVERCHARGE ([v4.2], §11/§13.1): the charge accumulator is gone. On every
 *   3rd round of the battle clock (rounds 3,6,9,…) the Mage's MAIN hit gains +200% ATK
 *   (×3, applied pre-mitigation so DEF still reduces it) AND the entire attack's crit is
 *   suppressed (pre-roll latch voided, nextAttackAutoCrit ignored). Rider hits in the
 *   same action (Labrys 2nd, Glacial Bow extra) are NOT the overcharge attack — they keep
 *   fresh crit rolls and get no bonus.
 *   Skip-CC on a multiple of 3 → the action never runs → that overcharge is simply lost
 *   (no carry-over); the next fires on the next multiple of 3.
 *
 * DAMAGE PIPELINE (per hit, approved plan §4):
 *   base = effATK × (1 − effDEF/(effDEF+200)) × variance(0.90–1.10)
 *   + riders (bonusDamage / enemy_bonus_damage — first hit of the action only, R4)
 *   × critMult on crit (2.0; 2.3 Katana; + bonus_crit_dmg_pct/100)
 *   Mage Overcharge: main hit every 3rd round scales ATK ×3 (+200%) BEFORE mitigation
 *     and cannot crit (§13.1) — lands ~3× a normal hit, not a raw flat spike
 *   × (1 + bonus_dmg_pct/100)  × 2 if nextAttackDouble
 *   → floor → defender stack (R3) → apply → death check (§35.3 first-to-0, R5)
 *
 * DEFENDER STACK (R3, fixed order):
 *   player defender: negations (amihan → loki+counter → gridr → skjaldmaer; a fully
 *   evaded hit consumes nothing) → multiplicative reductions (heimdall 50% one-shot →
 *   athena 40% ×2 → odin 50% → steel kite 15% → pelte 25% → njord 30%) →
 *   ×(1 + Σ bonusIncomingDmgMult) → Knight ×0.80 → sidapa lethal reprieve →
 *   apply → reflects on FINAL applied damage (enderby 30% + tyr 15%; skipped when
 *   the hit was lethal — R5).
 *   mob defender: sigbin evade (round-scoped) → dwarf stone-skin absorb (consumed).
 *
 * DEF_DOWN COMBINATION (R8): all def_down sources (the def_down debuff — itself
 * merged highest-value — and the Laevateinn stack) combine HIGHEST-WINS, never
 * multiplicatively. Armor pierce is a separate highest-wins lane, gated by
 * armor_pierce immunity (incl. Gungnir full pierce and Archer class pierce).
 */

const PASSIVE_REGISTRY = require('./passiveRegistry');

const MAX_ROUNDS = 50;
const SUDDEN_DEATH_FROM = 30;     // both lose 10% max HP at end of every round ≥ 30
const SUDDEN_DEATH_PCT = 0.10;
const SNAPSHOT_EVERY = 3;
const MITIGATION_K = 200;         // §12: 1 − DEF/(DEF+200)
const CRIT_MULT = 2.0;
const KATANA_CRIT_MULT = 2.3;
const ARCHER_PIERCE = 0.25;
const KNIGHT_DR = 0.80;
const OVERCHARGE_EVERY = 3;       // [v4.2] fires on rounds 3, 6, 9, …
const OVERCHARGE_RIDER = 2.0;     // +200% ATK (×3 total) on the main hit, pre-mitigation; cannot crit

const SKIP_TAGS = ['stun', 'paralyze', 'freeze', 'petrify', 'charm', 'confuse', 'miss'];
const DOT_TAGS = ['bleed', 'burn', 'hp_pct_dot'];

/** Seeded LCG in [0,1). Same generator the renderer's replay relies on. */
function rngOf(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

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
    bonusDmgPct: Number(f.bonusDmgPct) || 0,
    bonusCritDmgPct: Number(f.bonusCritDmgPct) || 0,
    classPassive: f.classPassive || null,
    weaponPassiveKey: f.weaponPassiveKey || 'none',
    deityBlessingKey: f.deityBlessingKey || 'none',
    skillKey: f.skillKey || 'none',
    immunityTags: Array.isArray(f.immunityTags) ? f.immunityTags : [],
    specialFlags: f.specialFlags || {},
    isBoss: f.mobType === 'boss',
    debuffs: [],            // [{tag, turnsLeft, value}]
    flags: {},              // durable bs.flags.* (ENGINE_HOOKS)
    statusImmune: false,
    scratch: null,          // per-round (reset before passives)
    skipped: false,         // skip-CC'd this round
    critRollValue: 1,       // pre-rolled crit draw for this round's main hit
    stunPreRoll: 0,         // Fighter class stun turns rolled for this round (0/1/2)
    tookHitThisRound: false,
    tookHitLastRound: false,
    bathalaExtraHp: 0,      // currently-applied Bathala HP bonus
  });

  const A = initSide(a, 'player');
  const B = initSide(b, mode === 'duel' ? 'player' : 'mob');
  // Boss fights read the SHARED pool % (§35.4) — Phase 7 passes poolHp/poolMaxHp.
  if (b.poolMaxHp != null) B.maxHp = b.poolMaxHp;
  if (b.poolHp != null) B.hp = Math.min(b.poolHp, B.maxHp);

  // damageDealtToEnemy/enemyLocalRegen feed the boss net-damage rule;
  // damageDealtToPlayer is the symmetric A-side tally (pvp_logs opponent_damage).
  const totals = { damageDealtToEnemy: 0, damageDealtToPlayer: 0, enemyLocalRegen: 0, netDamage: 0 };
  const shared = { round: 0, events: [] };

  // ── HP mutation hub (totals accounting) ────────────────────────────────────
  const setHp = (side, v) => {
    const nv = Math.max(0, Math.min(Math.round(v), side.maxHp));
    const delta = nv - side.hp;
    side.hp = nv;
    if (side === B) {
      if (delta < 0) totals.damageDealtToEnemy += -delta;
      else if (delta > 0) totals.enemyLocalRegen += delta;
    } else if (delta < 0) {
      totals.damageDealtToPlayer += -delta;
    }
  };
  const damage = (side, amount) => setHp(side, side.hp - Math.max(0, Math.floor(amount)));
  const heal = (side, amount) => setHp(side, side.hp + Math.max(0, Math.floor(amount)));

  // ── debuff helpers (§13.1: refresh don't stack/extend; highest value wins) ─
  const findDebuff = (side, tag) => side.debuffs.find((d) => d.tag === tag);
  const debuffValue = (side, tag) => { const d = findDebuff(side, tag); return d ? d.value : 0; };
  const addDebuff = (side, tag, turns, value = 0) => {
    const ex = findDebuff(side, tag);
    if (ex) {
      ex.turnsLeft = Math.max(ex.turnsLeft, turns);
      ex.value = Math.max(ex.value, value);
    } else {
      side.debuffs.push({ tag, turnsLeft: turns, value });
    }
  };
  const sideImmune = (side, tag) => {
    if (side.kind !== 'mob') return false;
    if (side.isBoss && tag === 'hp_pct_dot') return true; // §35.4 auto-immunity
    return side.immunityTags.includes('all_debuffs') || side.immunityTags.includes(tag);
  };

  // ── perspectives (the registry's bs view; ENGINE_HOOKS contract) ──────────
  const makePerspective = (self, opp) => ({
    rng,
    get currentTurn() { return shared.round; },
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
    get log() { return shared.events; },
    get playerStatusImmune() { return self.statusImmune; },
    set playerStatusImmune(v) { self.statusImmune = !!v; },
    get bonusDamage() { return self.scratch.bonusDamage; },
    set bonusDamage(v) { self.scratch.bonusDamage = v; },
    get bonusIncomingDmgMult() { return self.scratch.bonusIncomingDmgMult; },
    set bonusIncomingDmgMult(v) { self.scratch.bonusIncomingDmgMult = v; },
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
    enemyImmune: (tag) => sideImmune(opp, tag),
    applyDebuff: (tag, turns, value = 0) => {
      if (sideImmune(opp, tag)) return;
      if (opp.kind === 'player' && opp.statusImmune) return; // duel: defender immunity
      addDebuff(opp, tag, turns, value);
    },
    applyPlayerDebuff: (tag, turns, value = 0) => {
      if (self.statusImmune) return;
      addDebuff(self, tag, turns, value);
    },
    hasPlayerDebuff: (tag) => (tag === 'any' ? self.debuffs.length > 0 : !!findDebuff(self, tag)),
    clearPlayerDebuffs: () => { self.debuffs.length = 0; },
  });

  const PA = makePerspective(A, B);
  const PB = B.kind === 'player' ? makePerspective(B, A) : null;
  const perspectiveOf = (side) => (side === A ? PA : PB);
  const oppOf = (side) => (side === A ? B : A);

  // ── battle result ──────────────────────────────────────────────────────────
  let result = null; // { winner: 'a'|'b', outcome: string }
  const win = (side, outcome) => { if (!result) result = { winner: side === A ? 'a' : 'b', outcome }; };
  /** Death check in causal order (§35.3 first-to-0). Returns true if battle over. */
  const checkDeaths = (outcome) => {
    if (result) return true;
    if (A.hp <= 0) { win(B, outcome); return true; }
    if (B.hp <= 0) { win(A, outcome); return true; }
    return false;
  };

  // ── effective stats ────────────────────────────────────────────────────────
  const effAtk = (S) => {
    const mult = S.kind === 'player' ? S.scratch.playerAtkMult : 0;
    return Math.max(0, S.atk * (1 + mult - debuffValue(S, 'atk_down')));
  };
  const effCritChance = (S) =>
    Math.max(0, S.crit * (1 - debuffValue(S, 'crit_down')));

  /** Defender's effective DEF vs attacker S (R8 def_down highest-wins; pierce gated). */
  const effDef = (S, O, { mainHit = false } = {}) => {
    let def = O.def;
    if (O.kind === 'player') {
      def *= Math.max(0, 1 + O.scratch.playerDefMult - debuffValue(O, 'def_down'));
    } else {
      def *= (S.flags.enemy_def_mult || 1.0);
      const shred = Math.max(debuffValue(O, 'def_down'), S.flags.laevateinn_sword_def_stack || 0);
      def *= Math.max(0, 1 - shred);
    }
    if (S.kind === 'player') {
      const pierceImmune = sideImmune(O, 'armor_pierce');
      if (!pierceImmune) {
        if (mainHit && S.flags.gungnir_full_pierce) return 0;
        let pierce = S.scratch.ignoreDefPct;
        if (S.classPassive === 'pierce') pierce = Math.max(pierce, ARCHER_PIERCE);
        if (mainHit && S.flags.crossbow_pierce) pierce = Math.max(pierce, 0.25);
        def *= Math.max(0, 1 - pierce);
      }
    }
    return Math.max(0, def);
  };

  const mitigated = (atkValue, defValue) =>
    atkValue * (1 - defValue / (defValue + MITIGATION_K));

  // ── defender stack (R3) ────────────────────────────────────────────────────
  /**
   * Apply one computed hit to the defender. Returns { applied, negated }.
   * info: { crit, attacker } — crit drives player_was_critted latch & reflects.
   */
  const applyHitToDefender = (S, O, dmg, info = {}) => {
    if (O.kind === 'mob') {
      // mob defenses live on the attacking player's flags (mob skills run there)
      if (S.flags.sigbin_evade_check) {
        shared.events.push(`👤 ${O.name} evades the attack!`);
        return { applied: 0, negated: true };
      }
      if (S.flags.dwarf_shield_active) {
        const absorbed = Math.min(dmg, S.flags.dwarf_shield_cap || 0);
        dmg -= absorbed;
        S.flags.dwarf_shield_active = false;
        if (absorbed > 0) shared.events.push(`⛏️ ${O.name}'s Stone Skin absorbs ${absorbed} damage!`);
      }
      damage(O, dmg);
      checkDeaths('attack');
      return { applied: Math.floor(dmg), negated: false };
    }

    // player defender — negation rolls first (consume nothing on full evade, R3)
    const F = O.flags;
    if (F.amihan_evade_check) {
      shared.events.push(`💨 ${O.name} evades the attack (Tailwind)!`);
      return { applied: 0, negated: true };
    }
    if (F.loki_evade_check) {
      shared.events.push(`🃏 ${O.name} evades the attack (Illusory Double)!`);
      const counter = Math.max(0, Math.floor(F.loki_counter_dmg || 0));
      if (counter > 0) {
        damage(S, counter);
        shared.events.push(`🃏 Loki's counter strikes ${S.name} for ${counter} DMG!`);
        checkDeaths('counter');
      }
      return { applied: 0, negated: true };
    }
    if (F.gridr_ignore_check) {
      shared.events.push(`👊 ${O.name} ignores the incoming damage (Ironhide)!`);
      return { applied: 0, negated: true };
    }
    if (F.skjaldmaer_ignore_check) {
      shared.events.push(`🛡️ ${O.name} ignores the incoming damage (Shieldmaiden's Guard)!`);
      return { applied: 0, negated: true };
    }

    // multiplicative reductions, fixed order (R3)
    if (F.heimdall_first_hit_available && !F.heimdall_first_hit_used) {
      dmg *= 0.5;
      F.heimdall_first_hit_used = true;
      F.heimdall_first_hit_available = false;
      shared.events.push(`👁️ Heimdall negates 50% of the first hit on ${O.name}!`);
    }
    if (F.athena_shield_active && (F.athena_hits_absorbed || 0) < 2) {
      dmg *= 0.6;
      F.athena_hits_absorbed = (F.athena_hits_absorbed || 0) + 1;
      if (F.athena_hits_absorbed >= 2) F.athena_shield_active = false;
      shared.events.push(`🛡️ Athena's Aegis absorbs 40% (${F.athena_hits_absorbed}/2)!`);
    }
    if (F.odin_wisdom_block) dmg *= 0.5;
    if (F.steel_kite_shield_block) dmg *= 0.85;
    if (F.pelte_block_check) dmg *= 1 - (F.pelte_block_pct || 0);
    if (F.njord_block_check) dmg *= 1 - (F.njord_block_pct || 0);

    dmg *= 1 + O.scratch.bonusIncomingDmgMult;       // additive lane (damocles/vatican)
    if (O.classPassive === 'damage_reduction') dmg *= KNIGHT_DR;
    dmg = Math.max(0, Math.floor(dmg));

    // sidapa lethal reprieve (once per battle)
    if (dmg >= O.hp && F.sidapa_reprieve_available && !F.sidapa_reprieve_used) {
      F.sidapa_reprieve_used = true;
      F.sidapa_reprieve_available = false;
      const applied = O.hp - 1;
      setHp(O, 1);
      O.tookHitThisRound = true;
      if (info.crit) F.player_was_critted = true;
      shared.events.push(`🌙 Sidapa's Death's Reprieve! ${O.name} survives at 1 HP!`);
      return { applied, negated: false };
    }

    damage(O, dmg);
    O.tookHitThisRound = true;
    if (info.crit) F.player_was_critted = true;

    if (checkDeaths('attack')) return { applied: dmg, negated: false }; // R5: lethal hit ends battle pre-reflect

    // reflects on the FINAL applied damage
    let reflectPct = 0;
    if (F.enderby_reflect_check) reflectPct += 0.30;
    if (F.tyr_reflect > 0) reflectPct += F.tyr_reflect;
    if (reflectPct > 0 && dmg > 0) {
      const refl = Math.floor(dmg * reflectPct);
      if (refl > 0) {
        damage(S, refl);
        shared.events.push(`🔁 ${O.name} reflects ${refl} damage back at ${S.name}!`);
        checkDeaths('reflect');
      }
    }
    return { applied: dmg, negated: false };
  };

  // ── player attack action ───────────────────────────────────────────────────
  const playerAttack = (S, O) => {
    // [v4.2] Mage Overcharge: on every 3rd round the MAIN hit gains +200% ATK AND the
    // entire attack's crit is suppressed (pre-roll latch & nextAttackAutoCrit both
    // voided). The +200% applies to ATK *before* DEF mitigation (so it lands around 3× a
    // normal hit, NOT a raw unmitigated spike). Only the main hit qualifies — rider hits
    // later in the same action (Labrys 2nd, Glacial Bow extra) keep their own crit rolls
    // and get NO overcharge bonus.
    const overchargeRound = S.classPassive === 'overcharge' && shared.round % OVERCHARGE_EVERY === 0;

    const doHit = ({ atkScale, mainHit, critKnown }) => {
      if (result) return;
      const def = effDef(S, O, { mainHit });
      let crit;
      if (critKnown != null) crit = critKnown;
      else crit = rng() * 100 < effCritChance(S); // secondary hits roll fresh
      const variance = 0.9 + rng() * 0.2;
      // overcharge scales ATK pre-mitigation (1 + 2.0 = ×3); never crits (§13.1)
      const overchargeFired = mainHit && overchargeRound;
      const ocScale = overchargeFired ? (1 + OVERCHARGE_RIDER) : 1;
      let dmg = mitigated(effAtk(S) * atkScale * ocScale, def) * variance;
      if (mainHit) {
        dmg += S.scratch.bonusDamage;             // riders ride the first hit only
        S.scratch.bonusDamage = 0;
      }
      if (crit) {
        let mult = S.flags.katana ? KATANA_CRIT_MULT : CRIT_MULT;
        mult += S.bonusCritDmgPct / 100;          // Legendary/Supreme crit-dmg rider
        dmg *= mult;
      }
      dmg *= 1 + S.bonusDmgPct / 100;             // Supreme +50% flat / Legendary +25%
      if (mainHit && S.scratch.nextAttackDouble) dmg *= 2;
      dmg = Math.max(0, Math.floor(dmg));

      const res = applyHitToDefender(S, O, dmg, { crit });
      shared.events.push(
        `⚔️ ${S.name} ${mainHit ? 'attacks' : 'strikes again'} for **${res.applied} DMG**` +
        `${crit ? ' *(CRIT!)*' : ''}${overchargeFired ? ' *(Overcharge!)*' : ''}${res.negated ? ' *(evaded)*' : ''}`
      );
      if (result) return;

      // on-hit effects (landed main hit only)
      if (mainHit && !res.negated) {
        if (S.flags.crossbow_pierce) S.flags.crossbow_pierce = false;
        if (S.classPassive === 'stun' && S.stunPreRoll > 0 && !sideImmune(O, 'stun')) {
          if (O.kind !== 'player' || !O.statusImmune) {
            addDebuff(O, 'stun', S.stunPreRoll);
            shared.events.push(`👊 ${S.name}'s blow stuns ${O.name} for ${S.stunPreRoll} turn${S.stunPreRoll > 1 ? 's' : ''}!`);
          }
        }
      }
      // Swordsman bleed: refreshes on every attack; value rolled per attack (draw
      // happens only when the hit landed — documented in the draw-order contract)
      if (S.classPassive === 'bleed' && !res.negated && !sideImmune(O, 'bleed')) {
        if (O.kind !== 'player' || !O.statusImmune) {
          const bleedVal = S.atk * (0.30 + rng() * 0.20);
          addDebuff(O, 'bleed', 2, bleedVal);
        }
      }
      // per-instance heals
      if (res.applied > 0) {
        if (S.flags.japanese_bo_active) heal(S, res.applied * 0.5);
        if (S.flags.soul_drain_active) heal(S, res.applied * 0.1);
      }
      if (mainHit && S.flags.gungnir_full_pierce) S.flags.gungnir_full_pierce = false;
    };

    // main hit (crit pre-rolled at round start; auto-crit flags can upgrade it) —
    // an overcharge round suppresses the crit entirely (§13.1), latch and all.
    const mainCrit = !overchargeRound
      && ((S.critRollValue * 100 < effCritChance(S)) || S.scratch.nextAttackAutoCrit);
    doHit({ atkScale: 1, mainHit: true, critKnown: mainCrit });
    if (result) return;

    // labrys 2nd hit (rider — both hits crit-eligible)
    if (S.flags.labrys_double_hit) {
      S.flags.labrys_double_hit = false;
      doHit({ atkScale: S.flags.labrys_second_hit_pct || 0.70, mainHit: false });
      if (result) return;
    }

    // post-attack burst procs (resolve even if the attack was evaded — they are
    // separate effects, not attack damage)
    if (S.flags.instakill_check) {
      S.flags.instakill_check = false;
      if (mode !== 'duel' && !O.isBoss) {
        shared.events.push(`💀 Death Charm! ${O.name} is instantly slain!`);
        setHp(O, 0);
        if (checkDeaths('instakill')) return;
      }
    }
    if (S.flags.rupture_check) {
      S.flags.rupture_check = false;
      if (!O.isBoss && !sideImmune(O, 'hp_pct_dot')) {
        const burst = Math.floor(O.maxHp * (S.flags.rupture_pct || 0));
        damage(O, burst);
        shared.events.push(`🌿 Rupture bursts ${O.name} for ${burst} DMG!`);
        if (checkDeaths('rupture')) return;
      }
    }
    if (S.flags.hemorrhage_check) {
      S.flags.hemorrhage_check = false;
      if (!O.isBoss && !sideImmune(O, 'hp_pct_dot')) {
        const burst = Math.floor(O.maxHp * (S.flags.hemorrhage_pct || 0));
        damage(O, burst);
        shared.events.push(`🏹 Hemorrhage tears ${O.name} for ${burst} DMG!`);
        if (checkDeaths('hemorrhage')) return;
      }
    }

    // extra turn rider (Glacial Bow) — one additional attack, same round, no
    // re-run of passives, riders already consumed, fresh crit roll
    if (S.flags.extra_turn) {
      S.flags.extra_turn = false;
      doHit({ atkScale: 1, mainHit: false });
    }
  };

  // ── mob attack action ──────────────────────────────────────────────────────
  const mobAttack = (S, O) => {
    // mob offense riders live on the defending player's flags (registry wrote them there)
    const F = O.flags;
    const subHits = Math.max(1, Number(S.specialFlags.multi_attack) || 1);
    const subPct = subHits > 1 ? Number(S.specialFlags.multi_attack_pct) || 1 : 1;
    const atkBase = F.enemy_atk_override != null
      ? F.enemy_atk_override
      : S.atk * (F.enemy_atk_mult || 1.0);

    for (let i = 0; i < subHits && !result; i++) {
      const crit = rng() * 100 < S.crit;          // enemy authored crit, uncapped
      const variance = 0.9 + rng() * 0.2;
      let dmg = mitigated(atkBase * subPct, effDef(S, O)) * variance;
      if (i === 0) dmg += F.enemy_bonus_damage || 0;  // rider once per round (R4)
      if (crit) dmg *= CRIT_MULT;
      dmg = Math.max(0, Math.floor(dmg));
      const res = applyHitToDefender(S, O, dmg, { crit });
      shared.events.push(
        `💀 ${S.name} strikes ${subHits > 1 ? `(hit ${i + 1}/${subHits}) ` : ''}for **${res.applied} DMG**` +
        `${crit ? ' *(CRIT!)*' : ''}${res.negated ? ' *(evaded)*' : ''}`
      );
    }
  };

  const act = (S) => {
    if (result) return;
    const O = oppOf(S);
    // Skip-CC is evaluated at ACTION time (§35.1: a skip-CC blocks the afflicted
    // actor's single next action — including CCs applied earlier this same round,
    // in the passive phase or by the opponent's attack). Consumes one charge from
    // every active skip tag.
    const skipTags = S.debuffs.filter((d) => SKIP_TAGS.includes(d.tag));
    if (skipTags.length > 0) {
      for (const d of skipTags) d.turnsLeft -= 1;
      S.debuffs = S.debuffs.filter((d) => d.turnsLeft > 0);
      shared.events.push(`⏸️ ${S.name} is unable to act (${skipTags.map((d) => d.tag).join(', ')})!`);
      return;
    }
    if (S.kind === 'player') playerAttack(S, O);
    else mobAttack(S, O);
  };

  // ── round-start bookkeeping ────────────────────────────────────────────────
  const resetScratch = (side) => {
    side.scratch = {
      bonusDamage: 0,
      bonusIncomingDmgMult: 0,
      playerAtkMult: 0,
      playerDefMult: 0,
      ignoreDefPct: 0,
      nextAttackAutoCrit: false,
      nextAttackDouble: false,
    };
    // per-round DERIVED flags the registry re-establishes every round
    side.flags.enemy_bonus_damage = 0;
    side.flags.enemy_atk_mult = undefined;
    side.flags.enemy_def_mult = undefined;
    side.flags.enemy_atk_override = null;
    side.flags.bathala_hp_bonus = false;
    // input latches (engine-set, read by the registry this round)
    side.tookHitLastRound = side.tookHitThisRound;
    side.tookHitThisRound = false;
    side.flags.hit_received_this_turn = side.tookHitLastRound;
  };

  const setInputFlags = (side) => {
    const O = oppOf(side);
    side.flags.enemy_is_stunned = !!findDebuff(O, 'stun');
    side.flags.enemy_is_bleeding = !!findDebuff(O, 'bleed');
    side.flags.enemy_is_burning = !!findDebuff(O, 'burn');
  };

  const applyBathala = (side) => {
    if (side.flags.bathala_hp_bonus && side.bathalaExtraHp === 0) {
      const extra = Math.floor(side.in.hp * 0.20);
      side.bathalaExtraHp = extra;
      side.maxHp += extra;
      setHp(side, side.hp + extra);
    } else if (!side.flags.bathala_hp_bonus && side.bathalaExtraHp > 0) {
      side.maxHp -= side.bathalaExtraHp;
      side.bathalaExtraHp = 0;
      setHp(side, side.hp); // clamp back to the restored max
    }
  };

  const runRegistry = (key, perspective) => {
    if (result) return;
    const fn = PASSIVE_REGISTRY[key] || PASSIVE_REGISTRY.none;
    fn(perspective);
    checkDeaths('passive');
  };

  // ── snapshots ──────────────────────────────────────────────────────────────
  const snapSide = (side) => ({
    hp: side.hp,
    maxHp: side.maxHp,
    debuffs: side.debuffs.map((d) => ({ tag: d.tag, turnsLeft: d.turnsLeft })),
  });
  const snapshots = [{ round: 0, a: snapSide(A), b: snapSide(B), tag: 'start' }];

  // ── actor order ────────────────────────────────────────────────────────────
  let aFirst;
  if (B.specialFlags.first_strike) {
    aFirst = false; // Sleipnir: boss takes the very first action (checked before mode, no roll)
  } else if (A.specialFlags.first_strike) {
    aFirst = true;
  } else if (mode === 'boss') {
    aFirst = true;  // [v4.2] player ALWAYS attacks first vs a boss — no order draw consumed
  } else {
    aFirst = rng() < 0.5; // raid/duel keep the 50/50 roll
  }
  const order = aFirst ? [A, B] : [B, A];

  // ── main loop ──────────────────────────────────────────────────────────────
  const rounds = [];
  for (let round = 1; round <= MAX_ROUNDS && !result; round++) {
    shared.round = round;
    shared.events = [];

    // 1. round start: scratch + latches
    for (const side of order) resetScratch(side);
    for (const side of order) setInputFlags(side);
    for (const side of order) {
      side.skipped = side.debuffs.some((d) => SKIP_TAGS.includes(d.tag));
    }

    // 2. pre-rolls (R1) — always drawn for stream stability, voided when skip-CC'd
    for (const side of order) {
      if (side.kind !== 'player') continue;
      const O = oppOf(side);
      side.critRollValue = rng();
      // [v4.2] a Mage's overcharge round (every 3rd) suppresses the crit entirely, so
      // the latch reads false even though the draw is consumed (stream stability).
      const overchargeRound = side.classPassive === 'overcharge' && round % OVERCHARGE_EVERY === 0;
      side.flags.crit_landed_this_hit =
        !side.skipped && !overchargeRound && side.critRollValue * 100 < effCritChance(side);
      if (side.classPassive === 'stun') {
        const r = rng();
        side.stunPreRoll = side.skipped ? 0 : (r < 0.10 ? 2 : (r < 0.35 ? 1 : 0));
        side.flags.stun_just_applied = side.stunPreRoll > 0 && !sideImmune(O, 'stun')
          && !(O.kind === 'player' && O.statusImmune);
      } else {
        side.stunPreRoll = 0;
        side.flags.stun_just_applied = false;
      }
    }

    // 3. passive phase — each active passive exactly once per round (§35.1)
    if (mode === 'duel') {
      for (const side of order) {
        const P = perspectiveOf(side);
        runRegistry(side.weaponPassiveKey, P);
        runRegistry(side.deityBlessingKey, P);
      }
    } else {
      runRegistry(A.weaponPassiveKey, PA);
      runRegistry(A.deityBlessingKey, PA);
      runRegistry(B.skillKey, PA); // mob skill runs on the player's perspective
    }
    // consume hydra local regen (local mirror only — never the shared pool)
    if (!result && A.flags.hydra_local_regen > 0) {
      heal(B, A.flags.hydra_local_regen);
      A.flags.hydra_local_regen = 0;
    }
    for (const side of order) if (side.kind === 'player') applyBathala(side);
    for (const side of order) side.flags.player_was_critted = false; // latch consumed
    if (result) { rounds.push({ round, events: shared.events }); break; }

    // 4. actions
    for (const side of order) act(side);

    // 5. end of round
    if (!result) {
      // DOT ticks in actor order; death check after each tick (§35.3)
      for (const side of order) {
        if (result) break;
        for (const d of side.debuffs) {
          if (!DOT_TAGS.includes(d.tag)) continue;
          const tick = d.tag === 'hp_pct_dot'
            ? Math.floor(side.maxHp * d.value)
            : Math.floor(d.value);
          if (tick > 0) {
            damage(side, tick);
            shared.events.push(`🩸 ${side.name} suffers ${tick} ${d.tag === 'burn' ? 'Burn' : d.tag === 'bleed' ? 'Bleed' : 'Rot'} damage!`);
            if (checkDeaths('dot')) break;
          }
          d.turnsLeft -= 1;
        }
        side.debuffs = side.debuffs.filter((d) => !DOT_TAGS.includes(d.tag) || d.turnsLeft > 0);
      }
      // 1-turn stat debuffs expire at end of round (§35.1)
      if (!result) {
        for (const side of order) {
          for (const d of side.debuffs) {
            if (!DOT_TAGS.includes(d.tag) && !SKIP_TAGS.includes(d.tag)) d.turnsLeft -= 1;
          }
          side.debuffs = side.debuffs.filter((d) => d.turnsLeft > 0);
        }
      }
      // sudden death (§35.3): simultaneous drain; both dead → mob/challenged wins (R5)
      if (!result && round >= SUDDEN_DEATH_FROM) {
        const drainA = Math.floor(A.maxHp * SUDDEN_DEATH_PCT);
        const drainB = Math.floor(B.maxHp * SUDDEN_DEATH_PCT);
        damage(A, drainA);
        damage(B, drainB);
        shared.events.push(`☠️ Sudden death! Both combatants lose 10% max HP (${A.name} -${drainA}, ${B.name} -${drainB}).`);
        if (A.hp <= 0 && B.hp <= 0) win(B, 'sudden_death');
        else checkDeaths('sudden_death');
      }
    }

    rounds.push({ round, events: shared.events });
    // [v4.2] snapshot cadence is mode-dependent: duels animate every round (they end
    // fast — HP must visibly drop per turn), raids on odd rounds, boss every 3rd. The
    // start + final snapshots are always present regardless.
    const snapDue = mode === 'duel'
      ? true
      : mode === 'raid'
        ? round % 2 === 1
        : round % SNAPSHOT_EVERY === 0;
    if (!result && snapDue) {
      snapshots.push({ round, a: snapSide(A), b: snapSide(B) });
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
    const pctA = A.hp / A.maxHp;
    const pctB = B.hp / B.maxHp;
    result = { winner: pctA > pctB ? 'a' : 'b', outcome: 'cap_hp_pct' }; // tie → mob/challenged
    outcome = 'cap_hp_pct';
  }

  snapshots.push({ round: rounds.length, a: snapSide(A), b: snapSide(B), tag: 'end' });
  totals.netDamage = Math.max(0, totals.damageDealtToEnemy - totals.enemyLocalRegen);

  const summary = (side) => ({
    name: side.name,
    kind: side.kind,
    cls: side.kind === 'player' ? (side.in.class || '') : (side.in.mobType || 'mob'),
    level: side.in.level,
    weapon: side.in.weaponName || null,
    deity: side.in.deityName || null,
    // mob/boss passive skill name + description for the render (null for players)
    skill: side.kind === 'player' ? null : (side.in.skillName || null),
    skillDesc: side.kind === 'player' ? null : (side.in.skillDescription || null),
    atk: side.atk, def: side.def, crit: side.crit,
    hp: side.hp, maxHp: side.maxHp,
  });

  return {
    winner: result.winner,
    outcome,
    rounds,
    snapshots,
    a: summary(A),
    b: summary(B),
    seed,
    mode,
    playerFirst: aFirst,
    totals,
  };
}

module.exports = {
  resolveBattle,
  rngOf,
  MAX_ROUNDS,
  SUDDEN_DEATH_FROM,
  SNAPSHOT_EVERY,
};

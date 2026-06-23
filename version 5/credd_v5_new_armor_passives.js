// =====================================================================
// CREDD v5 — NEW ARMOR PASSIVES  (passiveRegistry.js additions)
// 8 new defensive passives for the v5 armor roster. Drop these into /engine/passiveRegistry.js
// alongside the existing weapon/deity/mob entries. Conventions follow Master §35.1 / §35.5:
//   - one round-based clock (bs.turn); "every Nth turn" = bs.turn % N === 0
//   - CC + stat-debuffs last 1 turn; regen applies at turn start
//   - flat damage-reduction applies AFTER DEF mitigation, same hook Knight uses
//   - first-X-each-battle effects use a per-battle flag on bs.self
//   - bs API names below mirror the existing registry; rename to your actual helpers if they differ
// NOTE: 'none' (Initiate's Garb, Iron Buckler, Wooden Shield, Baluti Vest) uses the shared no-op —
//       no new code. Only the 8 keys below need functions.
// =====================================================================

const NEW_ARMOR_PASSIVES = {
  // --- RARE -----------------------------------------------------------

  // Kalasag — Bulwark Hide: reduces incoming damage by 3% (flat, post-DEF).
  kalasag: (bs) => {
    if (bs.phase === 'incoming') {
      bs.incomingDamage *= 0.97;
    }
  },

  // --- MYTHIC ---------------------------------------------------------

  // Salakot Ward — Spirit Ward: 20% chance to negate an incoming debuff.
  // Hook fires when an enemy effect tries to apply a debuff to the wearer.
  salakot_ward: (bs) => {
    if (bs.phase === 'onDebuffApply' && bs.roll() < 0.2) {
      bs.negateIncomingDebuff(); // cancel this debuff application; log "Spirit Ward negates <debuff>"
    }
  },

  // Wolfskin Cloak — Wolf's Vigor: regenerate 10% max HP at the start of each turn.
  wolfskin_cloak: (bs) => {
    if (bs.phase === 'turnStart') {
      bs.healSelf(bs.selfMaxHP * 0.1);
    }
  },

  // --- LEGENDARY ------------------------------------------------------

  // Hoplite Panoply — Phalanx Wall: reduces incoming damage by 15% (flat, post-DEF).
  hoplite_panoply: (bs) => {
    if (bs.phase === 'incoming') {
      bs.incomingDamage *= 0.85;
    }
  },

  // Anting-Anting Sash — Charmed Hide: immune to Stun / Petrify / Freeze.
  // Hook fires when a CC of those types tries to apply; negate it. (Other debuffs still land.)
  anting_anting_sash: (bs) => {
    if (
      bs.phase === 'onDebuffApply' &&
      ['stun', 'petrify', 'freeze'].includes(bs.incomingDebuffType)
    ) {
      bs.negateIncomingDebuff(); // log "Charmed Hide — immune to <type>"
    }
  },

  // Valkyrie's Mantle — Chooser's Grace: 15% chance to evade an incoming attack.
  // IMPORTANT: evasion is an INDEPENDENT roll per §13.1, but enforce the v5 TOTAL evade cap (40%)
  //            at the resolver level so mantle + Amihan/Loki/Tailwind can't approach immunity.
  valkyrie_mantle: (bs) => {
    if (bs.phase === 'incoming' && bs.rollEvade(0.2)) {
      // rollEvade clamps cumulative evade <= 0.40
      bs.evadeAttack(); // negate this hit entirely; log "Chooser's Grace — evaded!"
    }
  },

  // --- SUPREME --------------------------------------------------------

  // Mail of Brokkr — Dwarven Forge: all incoming damage -30% AND reflect 15% of damage taken.
  mail_of_brokkr: (bs) => {
    if (bs.phase === 'incoming') {
      bs.incomingDamage *= 0.7;
      bs.reflectToAttacker(bs.incomingDamage * 0.15); // reflect uses the post-reduction amount
    }
  },

  // Mantle of Bathala — Divine Aegis: +5% HP and +5% DEF every turn, stacking up to +50% each.
  // ⚠ POWER: unbounded-feeling ramp; by ~turn 20 the wearer has ~2x HP and DEF. Model in Phase 6;
  //   consider a lower cap (e.g. +50%) or slower ramp if it dominates the budget.
  mantle_of_bathala: (bs) => {
    if (bs.phase === 'turnStart') {
      bs.self.bathalaStacks = Math.min((bs.self.bathalaStacks || 0) + 5, 50); // % per stat, cap 50
      bs.applyStatBuff('HP', bs.self.bathalaStacks); // set (not add) to current stack %
      bs.applyStatBuff('DEF', bs.self.bathalaStacks);
    }
  },

  // Aegis — Medusa's Gaze: 50% chance on hit to add a Stone stack; at 3 stacks, stun 1 turn, reset.
  // (Promoted Supreme; proc raised 20% -> 50%.)
  aegis: (bs) => {
    if (bs.phase === 'onHit' && bs.roll() < 0.5) {
      bs.enemy.stoneStacks = (bs.enemy.stoneStacks || 0) + 1;
      if (bs.enemy.stoneStacks >= 3) {
        bs.stunEnemy(1);
        bs.enemy.stoneStacks = 0;
      }
    }
  },

  // Helm of Darkness — Invisibility (revised to offensive): 30% chance each turn to reduce enemy DEF
  // by 50% for 2 turns. ⚠ Offensive passive living on Light armor (breaks strict armor=defense line).
  helm_of_darkness: (bs) => {
    if (bs.phase === 'turnStart' && bs.roll() < 0.3) {
      bs.applyEnemyDebuff('DEF', -50, 2); // -50% enemy DEF for 2 turns
    }
  },
};

module.exports = { NEW_ARMOR_PASSIVES };

// =====================================================================
// PER-BATTLE FLAGS TO RESET on battle start (in your battle-init):
//   bs.self.bathalaStacks = 0;       // Mantle of Bathala (ramp resets each battle)
//   bs.enemy.stoneStacks  = 0;       // Aegis (per-enemy stone counter)
// (Kalasag/Hoplite/Mail/Wolfskin/Salakot/Valkyrie/Anting/Helm are stateless per turn — no reset.)
//
// HOOK PHASES referenced (map to your engine's actual phase names if different):
//   "turnStart"     — start of the wearer's round (regen, periodic cleanse)
//   "incoming"      — an enemy hit is being resolved against the wearer (after DEF mitigation,
//                     same insertion point as Knight's Damage Reduction)
//   "onDebuffApply" — a debuff is about to be written onto the wearer
//
// POWER-BUDGET CAPS to enforce at the resolver (NOT inside these functions):
//   * TOTAL evade  <= 40%  across all sources (valkyrie_mantle + Amihan + Loki + Tailwind + ...).
//   * COMBINED flat damage-reduction: kalasag(8%) / hoplite_panoply(15%) / mail_of_brokkr(20%)
//     stack multiplicatively with Knight(20%) / Vatican Aspis(10%). Decide a floor (e.g. incoming
//     damage can never be reduced below 25% of post-DEF value) so a wall build can't reach immunity.
// =====================================================================

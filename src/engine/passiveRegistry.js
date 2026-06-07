'use strict';

/**
 * PASSIVE REGISTRY — CREDD BOT v4
 *
 * One flat object keyed by passive_key / blessing_key / skill_key.
 * Every key in passive_registry_keys.md MUST have a function here.
 * Timing rules (§35.1):
 *   - bs.currentTurn  = ROUND counter (only periodic clock)
 *   - CC + stat debuffs last 1 turn; Bleed/Burn DOTs tick 2 turns
 *   - "first hit / first N hits" → first-action flag or small tally on bs.flags.*
 *   - Stacking buffs are per-turn; bonus/extra hits are riders (advance nothing)
 *   - bs.enemyImmune(tag) gates all enemy-targeted debuffs
 *   - bs.applyDebuff(tag, turns, value?) adds to bs.activeDebuffs
 *   - bs.applyPlayerDebuff(tag, turns, value?) applies to player
 *
 * bs shape (populated by the battle engine — Phase 6):
 * {
 *   currentTurn, playerATK, playerHP, playerMaxHP, playerDEF, playerCrit,
 *   enemyATK, enemyHP, enemyMaxHP, enemyDEF,
 *   bonusDamage,          // rider damage added this hit (does NOT advance turn)
 *   bonusIncomingDmgMult, // multiplier on damage player receives (1.0 = normal)
 *   playerAtkMult,        // cumulative ATK multiplier this turn (additive stacks)
 *   playerDefMult,        // cumulative DEF multiplier
 *   ignoreDefPct,         // armor pierce pct (highest wins; see §13.1)
 *   nextAttackAutoCrit,   // boolean flag for engine
 *   nextAttackDouble,     // boolean flag — double damage next attack
 *   flags: {},            // per-battle state: once-per-battle, counters, shields, etc.
 *   log: [],              // array of string log entries for this turn
 *   enemyImmune(tag),     // fn: returns true if mob's immunity_tags includes tag or all_debuffs
 *   applyDebuff(tag, turns, value),       // add/refresh enemy debuff
 *   applyPlayerDebuff(tag, turns, value), // add/refresh player debuff
 *   hasPlayerDebuff(tag),                 // check player active debuffs
 *   clearPlayerDebuffs(),                 // remove all player debuffs
 *   playerStatusImmune,   // boolean — set by alans_reversed_hands
 * }
 */

const PASSIVE_REGISTRY = {

  // ─────────────────────────────────────────────────────────────────────────
  // SENTINEL — no passive / no skill
  // ─────────────────────────────────────────────────────────────────────────

  'none': () => {},

  // ─────────────────────────────────────────────────────────────────────────
  // WEAPON PASSIVES
  // ─────────────────────────────────────────────────────────────────────────

  // Rare ───────────────────────────────────────────────────────────────────

  'cutlass': (bs) => {
    // 10% chance flat Bleed on hit
    if (Math.random() < 0.10 && !bs.enemyImmune('bleed')) {
      bs.applyDebuff('bleed', 2, bs.playerATK);
      bs.log.push('🗡️ Cutlass: Serrated Edge — Bleed applied!');
    }
  },

  'kampilan': (bs) => {
    // First hit +20% ATK
    if (!bs.flags.kampilan_used) {
      bs.flags.kampilan_used = true;
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.log.push('⚔️ Kampilan: Opening Strike — +20% ATK bonus!');
    }
  },

  'war_club': (bs) => {
    // 10% chance Stun 1 turn
    if (Math.random() < 0.10 && !bs.enemyImmune('stun')) {
      bs.applyDebuff('stun', 1);
      bs.log.push('🪓 War Club: Concussive Blow — Enemy stunned!');
    }
  },

  'bone_crusher': (bs) => {
    // First hit +20% ATK
    if (!bs.flags.bone_crusher_used) {
      bs.flags.bone_crusher_used = true;
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.log.push('🦴 Bone Crusher: Opening Strike — +20% ATK bonus!');
    }
  },

  'crystal_wand': (bs) => {
    // 10% chance +15% ATK bonus hit (rider)
    if (Math.random() < 0.10) {
      bs.bonusDamage += bs.playerATK * 0.15;
      bs.log.push('🔮 Crystal Wand: Arcane Surge — +15% ATK bonus hit!');
    }
  },

  'carved_totem': (bs) => {
    // First hit +20% ATK
    if (!bs.flags.carved_totem_used) {
      bs.flags.carved_totem_used = true;
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.log.push('🪵 Carved Totem: Opening Strike — +20% ATK bonus!');
    }
  },

  'steel_kite_shield': (bs) => {
    // 10% chance to block 15% of incoming damage — re-rolled each turn (on-hit-received hook).
    bs.flags.steel_kite_shield_block = Math.random() < 0.10;
    if (bs.flags.steel_kite_shield_block) {
      bs.log.push('🛡️ Steel Kite Shield: Bulwark — Blocked 15% incoming damage!');
    }
  },

  'reinforced_targe': (bs) => {
    // First hit +20% ATK
    if (!bs.flags.reinforced_targe_used) {
      bs.flags.reinforced_targe_used = true;
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.log.push('🛡️ Reinforced Targe: Opening Strike — +20% ATK bonus!');
    }
  },

  'recurve_bow': (bs) => {
    // 10% chance +20% ATK bonus hit (rider)
    if (Math.random() < 0.10) {
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.log.push('🏹 Recurve Bow: Precise Shot — +20% ATK bonus hit!');
    }
  },

  'crossbow': (bs) => {
    // First hit +20% ATK ignoring 25% DEF
    if (!bs.flags.crossbow_used) {
      bs.flags.crossbow_used = true;
      bs.bonusDamage += bs.playerATK * 0.20;
      bs.flags.crossbow_pierce = true; // engine applies 25% DEF ignore for this hit
      bs.log.push('🏹 Crossbow: Piercing Opener — +20% ATK, ignores 25% DEF!');
    }
  },

  // Mythic ─────────────────────────────────────────────────────────────────

  'katana': (bs) => {
    // CRIT multiplier becomes ×2.30 instead of ×2.00 — engine reads bs.flags.katana
    bs.flags.katana = true;
  },

  'gladius': (bs) => {
    // 30% chance +50% bonus ATK (rider)
    if (Math.random() < 0.30) {
      bs.bonusDamage += bs.playerATK * 0.50;
      bs.log.push('⚔️ Gladius: Brutal Swing — +50% bonus ATK!');
    }
  },

  'scimitar': (bs) => {
    // ATK +3% every turn, stack up to 15%
    if (!bs.flags.scimitar_stack) bs.flags.scimitar_stack = 0;
    if (bs.flags.scimitar_stack < 0.15) {
      bs.flags.scimitar_stack = Math.min(bs.flags.scimitar_stack + 0.03, 0.15);
    }
    bs.playerAtkMult += bs.flags.scimitar_stack;
  },

  'roman_cestus': (bs) => {
    // +50% damage to stunned enemies
    if (bs.flags.enemy_is_stunned) {
      bs.bonusDamage += bs.playerATK * 0.50;
      bs.log.push('👊 Roman Cestus: Executioner — +50% vs stunned!');
    }
  },

  'pata': (bs) => {
    // Flat Bleed on every hit: 30% ATK per turn for 2 turns (refresh)
    if (!bs.enemyImmune('bleed')) {
      bs.applyDebuff('bleed', 2, bs.playerATK * 0.30);
      bs.log.push('🗡️ Pata: Rending Claws — Bleed applied (30% ATK)!');
    }
  },

  'bagh_nakh': (bs) => {
    // ATK +5% every turn, stack up to 25%
    if (!bs.flags.bagh_nakh_stack) bs.flags.bagh_nakh_stack = 0;
    if (bs.flags.bagh_nakh_stack < 0.25) {
      bs.flags.bagh_nakh_stack = Math.min(bs.flags.bagh_nakh_stack + 0.05, 0.25);
    }
    bs.playerAtkMult += bs.flags.bagh_nakh_stack;
  },

  'japanese_bo': (bs) => {
    // 25% chance heal 50% of damage dealt — engine sets bs.flags.japanese_bo_heal after dmg calc
    bs.flags.japanese_bo_active = Math.random() < 0.25;
    if (bs.flags.japanese_bo_active) {
      bs.log.push('🪄 Japanese Bo: Vital Siphon — Will heal 50% of damage dealt!');
    }
  },

  'english_quarterstaff': (bs) => {
    // 20% chance +50% bonus ATK (rider)
    if (Math.random() < 0.20) {
      bs.bonusDamage += bs.playerATK * 0.50;
      bs.log.push('🪄 English Quarterstaff: Sweeping Strike — +50% bonus ATK!');
    }
  },

  'egyptian_asa': (bs) => {
    // +3% DEF ignore every turn, stacking to 15% (armor_pierce pct)
    if (!bs.flags.egyptian_asa_pierce) bs.flags.egyptian_asa_pierce = 0;
    if (bs.flags.egyptian_asa_pierce < 0.15) {
      bs.flags.egyptian_asa_pierce = Math.min(bs.flags.egyptian_asa_pierce + 0.03, 0.15);
    }
    // Engine picks highest ignoreDefPct; set it if this weapon's stack is highest
    if (bs.flags.egyptian_asa_pierce > bs.ignoreDefPct) {
      bs.ignoreDefPct = bs.flags.egyptian_asa_pierce;
    }
  },

  'pilgrims_bordone': (bs) => {
    // 50% chance enemy DEF -15% for 1 turn
    if (Math.random() < 0.50 && !bs.enemyImmune('def_down')) {
      bs.applyDebuff('def_down', 1, 0.15);
      bs.log.push('🪄 Pilgrim\'s Bordone: Sundering Blow — Enemy DEF -15%!');
    }
  },

  'vatican_aspis': (bs) => {
    // All damage received -10%; ATK +10% — both constant for the whole battle.
    // playerAtkMult and bonusIncomingDmgMult are per-turn deltas (0 = normal),
    // re-applied every turn so the effect stays constant (matches sword_of_damocles).
    bs.playerAtkMult += 0.10;
    bs.bonusIncomingDmgMult -= 0.10;
  },

  'battersea_shield': (bs) => {
    // DEF +25% for first 2 turns
    if (bs.currentTurn <= 2) {
      bs.playerDefMult += 0.25;
    }
  },

  'enderby_shield': (bs) => {
    // 10% chance reflect 30% incoming — engine hook on-hit-received
    bs.flags.enderby_reflect_check = Math.random() < 0.10;
    if (bs.flags.enderby_reflect_check) {
      bs.log.push('🛡️ Enderby Shield: Thornward — Will reflect 30% incoming damage!');
    }
  },

  'holmegaard_bow': (bs) => {
    // ATK +3% every turn, stack up to 15%
    if (!bs.flags.holmegaard_stack) bs.flags.holmegaard_stack = 0;
    if (bs.flags.holmegaard_stack < 0.15) {
      bs.flags.holmegaard_stack = Math.min(bs.flags.holmegaard_stack + 0.03, 0.15);
    }
    bs.playerAtkMult += bs.flags.holmegaard_stack;
  },

  'scandinavian_glacial_wooden_bow': (bs) => {
    // 10% chance take another turn (rider — engine re-runs player action)
    if (Math.random() < 0.10) {
      bs.flags.extra_turn = true;
      bs.log.push('🏹 Glacial Bow: Frostwind Volley — Taking another turn!');
    }
  },

  'scythian_composite_bow': (bs) => {
    // 20% chance +50% ATK bonus damage (rider)
    if (Math.random() < 0.20) {
      bs.bonusDamage += bs.playerATK * 0.50;
      bs.log.push('🏹 Scythian Composite Bow: Power Draw — +50% bonus ATK!');
    }
  },

  'xiphos': (bs) => {
    // ATK +4% every turn, stack up to 20%
    if (!bs.flags.xiphos_stack) bs.flags.xiphos_stack = 0;
    if (bs.flags.xiphos_stack < 0.20) {
      bs.flags.xiphos_stack = Math.min(bs.flags.xiphos_stack + 0.04, 0.20);
    }
    bs.playerAtkMult += bs.flags.xiphos_stack;
  },

  'kopis': (bs) => {
    // 25% chance +60% bonus ATK (rider)
    if (Math.random() < 0.25) {
      bs.bonusDamage += bs.playerATK * 0.60;
      bs.log.push('⚔️ Kopis: Cleaving Blow — +60% bonus ATK!');
    }
  },

  'caestus': (bs) => {
    // 35% chance +40% bonus ATK (rider)
    if (Math.random() < 0.35) {
      bs.bonusDamage += bs.playerATK * 0.40;
      bs.log.push('👊 Caestus: Hammer Fists — +40% bonus ATK!');
    }
  },

  'myrmex': (bs) => {
    // +40% damage to stunned enemies
    if (bs.flags.enemy_is_stunned) {
      bs.bonusDamage += bs.playerATK * 0.40;
      bs.log.push('👊 Myrmex: Predator\'s Grip — +40% vs stunned!');
    }
  },

  'dory': (bs) => {
    // ATK +6% every 2 turns, stack up to 18%
    if (!bs.flags.dory_stack) bs.flags.dory_stack = 0;
    if (bs.currentTurn % 2 === 0 && bs.flags.dory_stack < 0.18) {
      bs.flags.dory_stack = Math.min(bs.flags.dory_stack + 0.06, 0.18);
    }
    bs.playerAtkMult += bs.flags.dory_stack;
  },

  'thyrsus': (bs) => {
    // 20% chance each turn to apply flat Bleed (ATK×0.30 for 2 turns)
    if (Math.random() < 0.20 && !bs.enemyImmune('bleed')) {
      bs.applyDebuff('bleed', 2, bs.playerATK * 0.30);
      bs.log.push('🪄 Thyrsus: Maddening Touch — Bleed applied (30% ATK)!');
    }
  },

  'dipylon_shield': (bs) => {
    // DEF +20% for first 3 turns
    if (bs.currentTurn <= 3) {
      bs.playerDefMult += 0.20;
    }
  },

  'pelte': (bs) => {
    // 15% chance block 25% incoming — on-hit-received hook
    bs.flags.pelte_block_check = Math.random() < 0.15;
    if (bs.flags.pelte_block_check) {
      bs.flags.pelte_block_pct = 0.25;
      bs.log.push('🛡️ Pelte: Deflection — Will block 25% incoming damage!');
    }
  },

  'arrow_of_eros': (bs) => {
    // 30% chance +45% ATK bonus damage (rider)
    if (Math.random() < 0.30) {
      bs.bonusDamage += bs.playerATK * 0.45;
      bs.log.push('🏹 Arrow of Eros: Love\'s Arrow — +45% bonus ATK!');
    }
  },

  'cretan_bow': (bs) => {
    // ATK +4% every turn, stack up to 20%
    if (!bs.flags.cretan_bow_stack) bs.flags.cretan_bow_stack = 0;
    if (bs.flags.cretan_bow_stack < 0.20) {
      bs.flags.cretan_bow_stack = Math.min(bs.flags.cretan_bow_stack + 0.04, 0.20);
    }
    bs.playerAtkMult += bs.flags.cretan_bow_stack;
  },

  // Legendary PH & Norse ───────────────────────────────────────────────────

  'juru_pakal': (bs) => {
    // +30% damage to bleeding enemies
    if (bs.flags.enemy_is_bleeding) {
      bs.bonusDamage += bs.playerATK * 0.30;
      bs.log.push('⚔️ Juru Pakal: Bloodhunter — +30% vs bleeding enemy!');
    }
  },

  'gram': (bs) => {
    // Ignores 20% of enemy DEF (armor_pierce pct; highest wins)
    if (0.20 > bs.ignoreDefPct) bs.ignoreDefPct = 0.20;
  },

  'tyrfing': (bs) => {
    // ATK +10% every turn, stack up to 30%
    if (!bs.flags.tyrfing_stack) bs.flags.tyrfing_stack = 0;
    if (bs.flags.tyrfing_stack < 0.30) {
      bs.flags.tyrfing_stack = Math.min(bs.flags.tyrfing_stack + 0.10, 0.30);
    }
    bs.playerAtkMult += bs.flags.tyrfing_stack;
  },

  'laevateinn_sword': (bs) => {
    // Reduces enemy DEF by 10% every turn, stacking up to 30%.
    // Gated by def_down immunity. Persists (does not expire each turn).
    if (!bs.flags.laevateinn_sword_def_stack) bs.flags.laevateinn_sword_def_stack = 0;
    if (!bs.enemyImmune('def_down') && bs.flags.laevateinn_sword_def_stack < 0.30) {
      bs.flags.laevateinn_sword_def_stack = Math.min(
        bs.flags.laevateinn_sword_def_stack + 0.10, 0.30
      );
      bs.log.push(`⚔️ Laevateinn Sword: Sundering Flame — Enemy DEF reduced (total -${Math.round(bs.flags.laevateinn_sword_def_stack * 100)}%)!`);
    }
    // Engine reads bs.flags.laevateinn_sword_def_stack to reduce enemy effective DEF
  },

  'jarngreipr': (bs) => {
    // Stunning an enemy triggers Bash: +60% bonus damage (rider)
    // Engine sets bs.flags.stun_just_applied when stun lands this hit
    if (bs.flags.stun_just_applied && !bs.enemyImmune('stun')) {
      bs.bonusDamage += bs.playerATK * 0.60;
      bs.log.push('⚡ Jarngreipr: Thunder Grip — Stun triggered Bash! +60% ATK!');
    }
  },

  'gridr_iron_gloves': (bs) => {
    // 20% chance to ignore incoming damage — on-hit-received hook
    bs.flags.gridr_ignore_check = Math.random() < 0.20;
    if (bs.flags.gridr_ignore_check) {
      bs.log.push('👊 Gridr Iron Gloves: Ironhide — Ignored incoming damage!');
    }
  },

  'alans_reversed_hands': (bs) => {
    // Immune to all status effects — engine checks bs.playerStatusImmune
    bs.playerStatusImmune = true;
  },

  'knuckle_charm_anting_anting': (bs) => {
    // 5% chance instant kill (blocked vs bosses, disabled in duels)
    // Engine checks bs.flags.instakill_check and mob_type
    if (Math.random() < 0.05) {
      bs.flags.instakill_check = true;
      bs.log.push('💀 Knuckle Charm Anting-Anting: Death Charm — INSTANT KILL proc!');
    }
  },

  'laevateinn_staff': (bs) => {
    // Ignores 15% of enemy DEF permanently (highest wins)
    if (0.15 > bs.ignoreDefPct) bs.ignoreDefPct = 0.15;
  },

  'galdrastafir': (bs) => {
    // 50% chance enemy DEF -30% for 1 turn
    if (Math.random() < 0.50 && !bs.enemyImmune('def_down')) {
      bs.applyDebuff('def_down', 1, 0.30);
      bs.log.push('🪄 Galdrastafir: Runebreaker — Enemy DEF -30%!');
    }
  },

  'babaylans_ritual_staff': (bs) => {
    // Auto-cleanse all debuffs every turn; ATK +100% for 1 turn if a debuff was actually removed
    const hadDebuff = bs.hasPlayerDebuff('any');
    if (hadDebuff) {
      bs.clearPlayerDebuffs();
      bs.flags.babaylan_cleansed_this_turn = true;
      bs.playerAtkMult += 1.00; // +100% for this turn only
      bs.log.push('🪄 Babaylan\'s Ritual Staff: Sacred Cleansing — Debuffs cleansed! ATK +100% this turn!');
    } else {
      bs.clearPlayerDebuffs(); // still runs (no-op if empty)
      bs.flags.babaylan_cleansed_this_turn = false;
    }
  },

  'badiang_stalk': (bs) => {
    // 30% chance Rupture: 10% enemy max HP (hp_pct_dot — blocked by ALL bosses via engine)
    if (Math.random() < 0.30 && !bs.enemyImmune('hp_pct_dot')) {
      bs.flags.rupture_check = true;
      bs.flags.rupture_pct = 0.10;
      bs.log.push('🌿 Badiang Stalk: Venom Burst — Rupture! 10% enemy max HP!');
    }
  },

  // Legendary Norse shields ─────────────────────────────────────────────────

  'shield_of_the_valkyrie': (bs) => {
    // Every hit received: DEF +5% and ATK +5%, stacking up to 30% each
    // Engine calls this in the on-hit-received hook; flag incremented there
    if (!bs.flags.valkyrie_shield_def) bs.flags.valkyrie_shield_def = 0;
    if (!bs.flags.valkyrie_shield_atk) bs.flags.valkyrie_shield_atk = 0;
    if (bs.flags.hit_received_this_turn) {
      bs.flags.valkyrie_shield_def = Math.min(bs.flags.valkyrie_shield_def + 0.05, 0.30);
      bs.flags.valkyrie_shield_atk = Math.min(bs.flags.valkyrie_shield_atk + 0.05, 0.30);
      bs.log.push(`🛡️ Shield of the Valkyrie: Valkyrie's Resolve — DEF +${Math.round(bs.flags.valkyrie_shield_def*100)}%, ATK +${Math.round(bs.flags.valkyrie_shield_atk*100)}%!`);
    }
    bs.playerDefMult += bs.flags.valkyrie_shield_def;
    bs.playerAtkMult += bs.flags.valkyrie_shield_atk;
  },

  'skjaldmaer': (bs) => {
    // 15% chance to ignore incoming damage — on-hit-received hook
    bs.flags.skjaldmaer_ignore_check = Math.random() < 0.15;
    if (bs.flags.skjaldmaer_ignore_check) {
      bs.log.push('🛡️ Skjaldmaer: Shieldmaiden\'s Guard — Ignored incoming damage!');
    }
  },

  'luzon_tribal_shield': (bs) => {
    // While debuffed: gains 40% DEF boost until the debuff expires
    if (bs.hasPlayerDebuff('any')) {
      bs.playerDefMult += 0.40;
      bs.log.push('🛡️ Luzon Tribal Shield: Tribal Ward — DEF +40% while debuffed!');
    }
  },

  'gusisnautar': (bs) => {
    // 50% chance Hemorrhage: 10% enemy max HP for 1 turn + DEF -15% during (blocked by bosses)
    if (Math.random() < 0.50 && !bs.enemyImmune('hp_pct_dot')) {
      bs.flags.hemorrhage_check = true;
      bs.flags.hemorrhage_pct = 0.10;
      if (!bs.enemyImmune('def_down')) {
        bs.applyDebuff('def_down', 1, 0.15);
      }
      bs.log.push('🏹 Gusisnautar: Hemorrhaging Shot — Hemorrhage! 10% max HP + DEF -15%!');
    }
  },

  'freyrs_arrow': (bs) => {
    // 50% chance auto-fire 100% ATK bonus damage (rider)
    if (Math.random() < 0.50) {
      bs.bonusDamage += bs.playerATK * 1.00;
      bs.log.push('🏹 Freyr\'s Arrow: Auto-Fire — +100% ATK bonus hit!');
    }
  },

  // Legendary Greek ─────────────────────────────────────────────────────────

  'harpe': (bs) => {
    // Ignores 30% DEF (highest wins)
    if (0.30 > bs.ignoreDefPct) bs.ignoreDefPct = 0.30;
  },

  'sword_of_damocles': (bs) => {
    // ATK +5% every turn, stack up to +100%
    // Constant 5% incoming damage penalty (set once; engine reads flag)
    if (!bs.flags.damocles_stack) bs.flags.damocles_stack = 0;
    if (!bs.flags.damocles_penalty_set) {
      bs.flags.damocles_penalty_set = true;
      bs.flags.damocles_incoming_penalty = 0.05; // constant 5% more damage taken
    }
    if (bs.flags.damocles_stack < 1.00) {
      bs.flags.damocles_stack = Math.min(bs.flags.damocles_stack + 0.05, 1.00);
    }
    bs.playerAtkMult += bs.flags.damocles_stack;
    bs.bonusIncomingDmgMult += bs.flags.damocles_incoming_penalty;
  },

  'labrys': (bs) => {
    // Every 3rd turn: attack hits twice; 2nd hit 70% ATK (rider); both can CRIT
    if (bs.currentTurn % 3 === 0) {
      bs.flags.labrys_double_hit = true;
      bs.flags.labrys_second_hit_pct = 0.70;
      bs.log.push('🪓 Labrys: Double Strike — Second hit (70% ATK) triggered!');
    }
  },

  'hephaestus_hammer': (bs) => {
    // DEF +20% for the battle; every 4th turn 150% ATK forge strike (rider)
    bs.playerDefMult += 0.20;
    if (bs.currentTurn % 4 === 0) {
      bs.bonusDamage += bs.playerATK * 1.50;
      bs.log.push('🔨 Hephaestus Hammer: Forged Armor — Forge Strike! +150% ATK!');
    }
  },

  'caduceus': (bs) => {
    // Every 3rd turn: cleanse all debuffs + restore 8% max HP
    if (bs.currentTurn % 3 === 0) {
      bs.clearPlayerDebuffs();
      const heal = Math.floor(bs.playerMaxHP * 0.08);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🐍 Caduceus: Herald's Touch — Debuffs cleansed, healed ${heal} HP!`);
    }
  },

  'spear_of_ares': (bs) => {
    // ATK +8% every 2 turns, stack up to 40%
    if (!bs.flags.spear_of_ares_stack) bs.flags.spear_of_ares_stack = 0;
    if (bs.currentTurn % 2 === 0 && bs.flags.spear_of_ares_stack < 0.40) {
      bs.flags.spear_of_ares_stack = Math.min(bs.flags.spear_of_ares_stack + 0.08, 0.40);
    }
    bs.playerAtkMult += bs.flags.spear_of_ares_stack;
  },

  'helm_of_darkness': (bs) => {
    // 25% chance each turn: enemy misses next attack
    if (Math.random() < 0.25 && !bs.enemyImmune('miss')) {
      bs.applyDebuff('miss', 1);
      bs.log.push('🪖 Helm of Darkness: Invisibility — Enemy will miss next attack!');
    }
  },

  'aegis': (bs) => {
    // 20% chance on hit: Stone Stack; at 3 stacks: stun 1 turn, reset
    if (!bs.flags.aegis_stacks) bs.flags.aegis_stacks = 0;
    if (Math.random() < 0.20) {
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

  // Supreme ─────────────────────────────────────────────────────────────────

  'mjolnir': (bs) => {
    // +20% ATK bonus rider every turn; every 4th turn: 200% ATK crush (rider)
    bs.bonusDamage += bs.playerATK * 0.20;
    if (bs.currentTurn % 4 === 0) {
      bs.bonusDamage += bs.playerATK * 2.00;
      bs.log.push('⚡ Mjolnir: Crushing Force — CRUSH! +200% ATK!');
    } else {
      bs.log.push('⚡ Mjolnir: Crushing Force — +20% ATK bonus!');
    }
  },

  'gungnir': (bs) => {
    // Ignores 40% DEF; 30% chance pierce ALL DEF; on pierce: DEF -25% 1 turn
    if (0.40 > bs.ignoreDefPct) bs.ignoreDefPct = 0.40;
    if (Math.random() < 0.30) {
      bs.flags.gungnir_full_pierce = true; // engine sets DEF to 0 for this hit
      if (!bs.enemyImmune('def_down')) {
        bs.applyDebuff('def_down', 1, 0.25);
      }
      bs.log.push('🏹 Gungnir: Never Misses — ALL DEF PIERCED! DEF -25%!');
    }
  },

  'thunderbolt_of_zeus': (bs) => {
    // 30% chance: +80% ATK bonus + paralyze 1 turn; auto-triggers on CRIT
    const triggers = Math.random() < 0.30 || bs.flags.crit_landed_this_hit;
    if (triggers) {
      bs.bonusDamage += bs.playerATK * 0.80;
      if (!bs.enemyImmune('paralyze')) {
        bs.applyDebuff('paralyze', 1);
      }
      bs.log.push('⚡ Thunderbolt of Zeus: Divine Thunder — +80% ATK + Paralyze!');
    }
  },

  'trident_of_poseidon': (bs) => {
    // Every 3rd turn: 100% ATK bonus; 25% chance stun 1 turn; DEF -20% 1 turn
    if (bs.currentTurn % 3 === 0) {
      bs.bonusDamage += bs.playerATK * 1.00;
      if (Math.random() < 0.25 && !bs.enemyImmune('stun')) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // DEITY BLESSINGS
  // ─────────────────────────────────────────────────────────────────────────

  'bathala_divine_vessel': (bs) => {
    // All stats +20% for the first 3 turns
    if (bs.currentTurn <= 3) {
      bs.playerAtkMult += 0.20;
      bs.playerDefMult += 0.20;
      bs.flags.bathala_hp_bonus = true; // engine also boosts effective HP by 20% first 3 turns
    }
  },

  'sidapa_deaths_reprieve': (bs) => {
    // Once per battle: survive lethal damage at 1 HP
    // Engine checks bs.flags.sidapa_reprieve before applying fatal damage
    if (!bs.flags.sidapa_reprieve_used) {
      bs.flags.sidapa_reprieve_available = true;
    }
  },

  'magwayen_soul_drain': (bs) => {
    // Each attack steals 10% of damage dealt as HP — engine reads flag after dmg
    bs.flags.soul_drain_active = true; // engine heals 10% of dealt damage
  },

  'mandarangan_war_frenzy': (bs) => {
    // ATK +10% every turn, capped at 30% (max turn 3 stacking)
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

  'mayari_lunar_veil': (bs) => {
    // HP < 50%: DEF +30%
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerDefMult += 0.30;
    }
  },

  'dian_masalanta_devotion': (bs) => {
    // HP < 30%: ATK +25%
    if (bs.playerHP < bs.playerMaxHP * 0.30) {
      bs.playerAtkMult += 0.25;
    }
  },

  'amihan_tailwind': (bs) => {
    // 20% chance to evade any incoming attack — on-hit-received hook
    bs.flags.amihan_evade_check = Math.random() < 0.20;
    if (bs.flags.amihan_evade_check) {
      bs.log.push('💨 Amihan: Tailwind — Attack evaded!');
    }
  },

  'habagat_monsoon_fury': (bs) => {
    // Every turn, 25% chance: storm strike +50% ATK bonus damage (rider)
    if (Math.random() < 0.25) {
      bs.bonusDamage += bs.playerATK * 0.50;
      bs.log.push('🌩️ Habagat: Monsoon Fury — Storm Strike! +50% ATK!');
    }
  },

  'lakapati_abundance': (bs) => {
    // Regenerate 3% max HP at start of each turn
    const regen = Math.floor(bs.playerMaxHP * 0.03);
    bs.playerHP = Math.min(bs.playerHP + regen, bs.playerMaxHP);
    bs.log.push(`🌱 Lakapati: Abundance — Regenerated ${regen} HP!`);
  },

  'idiyanale_persistence': (bs) => {
    // Every 5 turns: next attack deals double damage
    if (bs.currentTurn % 5 === 0) {
      bs.nextAttackDouble = true;
      bs.log.push('⚙️ Idiyanale: Persistence — Next attack deals double damage!');
    }
  },

  'odin_all_fathers_wisdom': (bs) => {
    // Every even turn (2/4/6…): character takes 50% reduced damage
    if (bs.currentTurn % 2 === 0) {
      bs.flags.odin_wisdom_block = true; // engine reads this to halve incoming
      bs.log.push('🪄 Odin: All-Father\'s Wisdom — 50% damage reduction this turn!');
    } else {
      bs.flags.odin_wisdom_block = false;
    }
  },

  'thor_mjolnirs_wrath': (bs) => {
    // Every 3rd turn: +50% ATK bonus + stun enemy 1 turn
    if (bs.currentTurn % 3 === 0) {
      bs.bonusDamage += bs.playerATK * 0.50;
      if (!bs.enemyImmune('stun')) {
        bs.applyDebuff('stun', 1);
        bs.log.push('⚡ Thor: Mjolnir\'s Wrath — +50% ATK + Enemy Stunned!');
      } else {
        bs.log.push('⚡ Thor: Mjolnir\'s Wrath — +50% ATK!');
      }
    }
  },

  'freya_valkyries_embrace': (bs) => {
    // Once/battle at ≤40% HP: restore 20% max HP and ATK +15% for 2 turns
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
    // 20% chance each turn: evade attack and counter for 50% ATK (rider)
    bs.flags.loki_evade_check = Math.random() < 0.20;
    if (bs.flags.loki_evade_check) {
      bs.flags.loki_counter_dmg = Math.floor(bs.playerATK * 0.50); // engine applies after evade
      bs.log.push('🃏 Loki: Illusory Double — Attack evaded! Counter incoming!');
    }
  },

  'tyr_oathkeeper': (bs) => {
    // DEF +20% all battle; while HP < 50%, reflect 15% incoming
    bs.playerDefMult += 0.20;
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.flags.tyr_reflect = 0.15; // engine reflects 15% of incoming back to enemy
    } else {
      bs.flags.tyr_reflect = 0;
    }
  },

  'skadi_winters_hunt': (bs) => {
    // Every 3rd turn: +40% ATK and apply Freeze (enemy skips next turn)
    if (bs.currentTurn % 3 === 0) {
      bs.bonusDamage += bs.playerATK * 0.40;
      if (!bs.enemyImmune('freeze')) {
        bs.applyDebuff('freeze', 1);
        bs.log.push('❄️ Skadi: Winter\'s Hunt — +40% ATK + Enemy Frozen!');
      } else {
        bs.log.push('❄️ Skadi: Winter\'s Hunt — +40% ATK!');
      }
    }
  },

  'surt_muspells_flame': (bs) => {
    // Every attack: Burn 25% ATK for 2 turns; +50% bonus vs already-burning
    if (!bs.enemyImmune('burn')) {
      const burnDmg = bs.playerATK * 0.25;
      if (bs.flags.enemy_is_burning) {
        bs.bonusDamage += burnDmg * 0.50; // +50% bonus vs already burning
        bs.log.push('🔥 Surt: Muspell\'s Flame — Burn refreshed! +50% bonus vs burning!');
      }
      bs.applyDebuff('burn', 2, burnDmg);
    }
  },

  'heimdall_eternal_vigilance': (bs) => {
    // First hit taken each battle is negated by 50% — on-hit-received hook
    if (!bs.flags.heimdall_first_hit_used) {
      bs.flags.heimdall_first_hit_available = true;
    }
  },

  'baldur_invulnerability': (bs) => {
    // Once/battle: when player is debuffed OR HP < 50% → cleanse + heal 10%
    if (!bs.flags.baldur_used &&
        (bs.hasPlayerDebuff('any') || bs.playerHP <= bs.playerMaxHP * 0.50)) {
      bs.flags.baldur_used = true;
      bs.clearPlayerDebuffs();
      const heal = Math.floor(bs.playerMaxHP * 0.10);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`✨ Baldur: Invulnerability — Debuffs cleansed! Healed ${heal} HP!`);
    }
  },

  'hel_half_dead': (bs) => {
    // HP < 50%: DEF +15% and ATK +15%
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerDefMult += 0.15;
      bs.playerAtkMult += 0.15;
    }
  },

  'mimir_runic_knowledge': (bs) => {
    // Every 4 turns: next attack deals 65% more damage
    if (bs.currentTurn % 4 === 0) {
      bs.flags.mimir_next_attack_bonus = 0.65;
      bs.log.push('📖 Mimir: Runic Knowledge — Next attack +65% damage!');
    }
    if (bs.flags.mimir_next_attack_bonus > 0) {
      bs.bonusDamage += bs.playerATK * bs.flags.mimir_next_attack_bonus;
      bs.flags.mimir_next_attack_bonus = 0;
    }
  },

  'freyr_harvest_bounty': (bs) => {
    // Restore 5% max HP every 2 turns
    if (bs.currentTurn % 2 === 0) {
      const heal = Math.floor(bs.playerMaxHP * 0.05);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🌾 Freyr: Harvest Bounty — Restored ${heal} HP!`);
    }
  },

  'njord_seas_favor': (bs) => {
    // 15% chance each turn to reduce incoming damage by 30% — on-hit-received hook
    bs.flags.njord_block_check = Math.random() < 0.15;
    if (bs.flags.njord_block_check) {
      bs.flags.njord_block_pct = 0.30;
      bs.log.push('🌊 Njord: Sea\'s Favor — Incoming damage reduced by 30%!');
    }
  },

  'bragi_battle_hymn': (bs) => {
    // Every 3 turns: ATK +8% for 2 turns
    if (bs.currentTurn % 3 === 0) {
      bs.flags.bragi_buff_turns = 2;
      bs.log.push('🎵 Bragi: Battle Hymn — ATK +8% for 2 turns!');
    }
    if (bs.flags.bragi_buff_turns > 0) {
      bs.playerAtkMult += 0.08;
      bs.flags.bragi_buff_turns -= 1;
    }
  },

  'idunn_golden_apple': (bs) => {
    // Once/battle at ≤50% HP: restore 15% max HP
    if (!bs.flags.idunn_used && bs.playerHP <= bs.playerMaxHP * 0.50) {
      bs.flags.idunn_used = true;
      const heal = Math.floor(bs.playerMaxHP * 0.15);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🍎 Idunn: Golden Apple — Restored ${heal} HP!`);
    }
  },

  'vidar_silent_vengeance': (bs) => {
    // When hit by a crit, next attack auto-crits
    // Engine sets bs.flags.player_was_critted this turn; we set the auto-crit flag
    if (bs.flags.player_was_critted) {
      bs.nextAttackAutoCrit = true;
      bs.flags.player_was_critted = false;
      bs.log.push('⚔️ Vidar: Silent Vengeance — Auto-CRIT next attack!');
    }
  },

  'magni_might_of_magni': (bs) => {
    // ATK +5% per 10% max HP lost, capped at 25%
    const hpLostPct = (bs.playerMaxHP - bs.playerHP) / bs.playerMaxHP;
    const stacks = Math.min(Math.floor(hpLostPct / 0.10), 5); // max 5 stacks = 25%
    if (stacks > 0) {
      bs.playerAtkMult += stacks * 0.05;
    }
  },

  // Greek deity blessings ───────────────────────────────────────────────────

  'zeus_thunder_sovereign': (bs) => {
    // Every 3rd turn: +80% ATK bonus + enemy DEF -20% for 1 turn
    if (bs.currentTurn % 3 === 0) {
      bs.bonusDamage += bs.playerATK * 0.80;
      if (!bs.enemyImmune('def_down')) {
        bs.applyDebuff('def_down', 1, 0.20);
      }
      bs.log.push('⚡ Zeus: Thunder Sovereign — +80% ATK! Enemy DEF -20%!');
    }
  },

  'ares_blood_frenzy': (bs) => {
    // ATK +8% every 2 turns, stack up to 40% (max turn 10)
    if (!bs.flags.ares_stack) bs.flags.ares_stack = 0;
    if (bs.currentTurn % 2 === 0 && bs.flags.ares_stack < 0.40) {
      bs.flags.ares_stack = Math.min(bs.flags.ares_stack + 0.08, 0.40);
    }
    bs.playerAtkMult += bs.flags.ares_stack;
  },

  'poseidon_tidal_force': (bs) => {
    // Every 4 turns: +60% ATK bonus + 40% chance stun 1 turn
    if (bs.currentTurn % 4 === 0) {
      bs.bonusDamage += bs.playerATK * 0.60;
      if (Math.random() < 0.40 && !bs.enemyImmune('stun')) {
        bs.applyDebuff('stun', 1);
        bs.log.push('🌊 Poseidon: Tidal Force — +60% ATK + Enemy Stunned!');
      } else {
        bs.log.push('🌊 Poseidon: Tidal Force — +60% ATK!');
      }
    }
  },

  'hades_soul_harvest': (bs) => {
    // When enemy HP < 30%: ATK +35% for remainder of battle (once activated)
    const enemyHpPct = bs.enemyHP / bs.enemyMaxHP;
    if (enemyHpPct < 0.30) {
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
    // When hit by crit: DEF +10% and ATK +10%, stacking up to 3×
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
    // First 2 hits received each battle reduced by 40%
    if (!bs.flags.athena_hits_absorbed) bs.flags.athena_hits_absorbed = 0;
    if (bs.flags.athena_hits_absorbed < 2) {
      bs.flags.athena_shield_active = true; // engine reduces this hit by 40%
    } else {
      bs.flags.athena_shield_active = false;
    }
  },

  'apollo_solar_radiance': (bs) => {
    // ATK +20% for the duration of battle
    bs.playerAtkMult += 0.20;
  },

  'artemis_huntress_precision': (bs) => {
    // First attack auto-crit; every 4 turns auto-crit
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
    // DEF +20% for duration of battle; HP < 50%: ATK +15%
    bs.playerDefMult += 0.20;
    if (bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.playerAtkMult += 0.15;
    }
  },

  'aphrodite_enchanting_aura': (bs) => {
    // 20% chance each turn to charm enemy (skips attack) — on-enemy-attack hook
    bs.flags.aphrodite_charm_check = Math.random() < 0.20;
    if (bs.flags.aphrodite_charm_check && !bs.enemyImmune('charm')) {
      bs.applyDebuff('charm', 1);
      bs.log.push('💗 Aphrodite: Enchanting Aura — Enemy charmed! Skips attack!');
    }
  },

  'persephone_cycle_of_renewal': (bs) => {
    // HP < 50%: restore 20% max HP, once per battle
    if (!bs.flags.persephone_used && bs.playerHP < bs.playerMaxHP * 0.50) {
      bs.flags.persephone_used = true;
      const heal = Math.floor(bs.playerMaxHP * 0.20);
      bs.playerHP = Math.min(bs.playerHP + heal, bs.playerMaxHP);
      bs.log.push(`🌸 Persephone: Cycle of Renewal — Restored ${heal} HP!`);
    }
  },

  'dionysus_drunken_haze': (bs) => {
    // 30% chance each turn: enemy attacks itself (30% of its own ATK as damage)
    if (Math.random() < 0.30) {
      const selfDmg = Math.floor(bs.enemyATK * 0.30);
      bs.enemyHP = Math.max(bs.enemyHP - selfDmg, 0);
      bs.log.push(`🍷 Dionysus: Drunken Haze — Enemy attacks itself! ${selfDmg} DMG!`);
    }
  },

  'nike_wings_of_victory': (bs) => {
    // ATK +25% for duration of battle
    bs.playerAtkMult += 0.25;
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MOB / BOSS SKILLS
  // ─────────────────────────────────────────────────────────────────────────

  'dwende_black_hex': (bs) => {
    // 25% chance: player ATK -15% for 1 turn
    if (Math.random() < 0.25 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('atk_down', 1, 0.15);
      bs.log.push('👺 Dwende (Black): Hex — Your ATK -15% for 1 turn!');
    }
  },

  'dwende_white_daze': (bs) => {
    // 20% chance: player CRIT -50% for 1 turn
    if (Math.random() < 0.20 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('crit_down', 1, 0.50);
      bs.log.push('👺 Dwende (White): Daze — Your CRIT -50% for 1 turn!');
    }
  },

  'amalanhig_infectious_bite': (bs) => {
    // 30% on hit: Rot 5% max HP per turn for 2 turns (hp_pct_dot — blocked by bosses via engine)
    if (Math.random() < 0.30 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('hp_pct_dot', 2, 0.05);
      bs.log.push('🧟 Amalanhig: Infectious Bite — Rot! 5% max HP/turn for 2 turns!');
    }
  },

  'amomongo_rend': (bs) => {
    // Every 3rd turn: 150% ATK
    if (bs.currentTurn % 3 === 0) {
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * 1.50;
      bs.log.push('🦍 Amomongo: Rend — 150% ATK!');
    }
  },

  'bal_bal_carrion_sense': (bs) => {
    // When player HP < 30%: enemy ATK +20%
    if (bs.playerHP < bs.playerMaxHP * 0.30) {
      bs.flags.enemy_atk_mult = (bs.flags.enemy_atk_mult || 1.0) * 1.20;
      bs.log.push('💀 Bal-Bal: Carrion Sense — Player HP critical! Enemy ATK +20%!');
    }
  },

  'santelmo_will_o_wisp': (bs) => {
    // 20% chance each turn: player skips next attack
    if (Math.random() < 0.20 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('miss', 1);
      bs.log.push('🔥 Santelmo: Will-o-Wisp — You will skip your next attack!');
    }
  },

  'manananggal_viscera_drain': (bs) => {
    // Every 3 turns: drain 15% of player max HP, heal self
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

  'tikbalang_disorientation': (bs) => {
    // Every 3 turns: player ATK -20% for 1 turn
    if (bs.currentTurn % 3 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('atk_down', 1, 0.20);
      bs.log.push('🐴 Tikbalang: Disorientation — Your ATK -20% for 1 turn!');
    }
  },

  'kapre_smoke_cloud': (bs) => {
    // Every 4 turns: player CRIT -30% and ATK -10% for 1 turn
    if (bs.currentTurn % 4 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('crit_down', 1, 0.30);
      bs.applyPlayerDebuff('atk_down', 1, 0.10);
      bs.log.push('💨 Kapre: Smoke Cloud — Your CRIT -30%, ATK -10% for 1 turn!');
    }
  },

  'sigbin_shadow_step': (bs) => {
    // 20% chance to evade any incoming attack — on-hit-received hook
    bs.flags.sigbin_evade_check = Math.random() < 0.20;
    if (bs.flags.sigbin_evade_check) {
      bs.log.push('👤 Sigbin: Shadow Step — Evaded your attack!');
    }
  },

  'batibat_sleep_paralysis': (bs) => {
    // Every 4 turns: paralyze player 1 turn (guaranteed skip)
    if (bs.currentTurn % 4 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('paralyze', 1);
      bs.log.push('👹 Batibat: Sleep Paralysis — You are paralyzed! Skip next turn!');
    }
  },

  'troll_regeneration': (bs) => {
    // Recovers 5% max HP at start of each turn
    const regen = Math.floor(bs.enemyMaxHP * 0.05);
    bs.enemyHP = Math.min(bs.enemyHP + regen, bs.enemyMaxHP);
    bs.log.push(`🧌 Troll: Regeneration — Recovered ${regen} HP!`);
  },

  'dwarves_stone_skin': (bs) => {
    // Every 4 turns: absorb next hit up to 20% max HP
    if (bs.currentTurn % 4 === 0) {
      bs.flags.dwarf_shield_active = true;
      bs.flags.dwarf_shield_cap = Math.floor(bs.enemyMaxHP * 0.20);
      bs.log.push('⛏️ Dwarves: Stone Skin — Absorbing next hit (up to 20% max HP)!');
    }
  },

  'dark_elves_curse_of_decay': (bs) => {
    // 25% on hit: player DEF -10% for 1 turn
    if (Math.random() < 0.25 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('def_down', 1, 0.10);
      bs.log.push('🧝 Dark Elves: Curse of Decay — Your DEF -10% for 1 turn!');
    }
  },

  'light_elves_radiant_strike': (bs) => {
    // 20% chance: player CRIT → 0% for 1 turn (blind = crit_down to 0)
    if (Math.random() < 0.20 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('crit_down', 1, 1.00); // 100% crit reduction = blind
      bs.log.push('✨ Light Elves: Radiant Strike — Blinded! Your CRIT is 0% for 1 turn!');
    }
  },

  'ratatoskr_slander': (bs) => {
    // Every 3 turns: player ATK -20% for 1 turn
    if (bs.currentTurn % 3 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('atk_down', 1, 0.20);
      bs.log.push('🐿️ Ratatoskr: Slander — Your ATK -20% for 1 turn!');
    }
  },

  'fossegrim_enchanting_melody': (bs) => {
    // Every 4 turns: player skips next turn
    if (bs.currentTurn % 4 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('miss', 1);
      bs.log.push('🎻 Fossegrim: Enchanting Melody — You will skip your next turn!');
    }
  },

  'nokken_luring_form': (bs) => {
    // Every 3 turns: player DEF -20% for 1 turn
    if (bs.currentTurn % 3 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('def_down', 1, 0.20);
      bs.log.push('🌊 Nokken: Luring Form — Your DEF -20% for 1 turn!');
    }
  },

  'valkyrie_battle_judgment': (bs) => {
    // Every 4 turns: next attack deals 200% ATK
    if (bs.currentTurn % 4 === 0) {
      bs.flags.valkyrie_judgment_active = true;
      bs.log.push('⚔️ Valkyrie: Battle Judgment — Next attack 200% ATK!');
    }
    if (bs.flags.valkyrie_judgment_active) {
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * 2.00;
      bs.flags.valkyrie_judgment_active = false;
    }
  },

  'satyr_wild_revelry': (bs) => {
    // 25% chance each turn: player ATK -15% for 1 turn
    if (Math.random() < 0.25 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('atk_down', 1, 0.15);
      bs.log.push('🐐 Satyr: Wild Revelry — Your ATK -15% for 1 turn!');
    }
  },

  'harpy_swooping_talons': (bs) => {
    // Every 3rd turn: 150% ATK + player DEF -10% for 1 turn
    if (bs.currentTurn % 3 === 0) {
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * 1.50;
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('def_down', 1, 0.10);
      }
      bs.log.push('🦅 Harpy: Swooping Talons — 150% ATK! Your DEF -10%!');
    }
  },

  'skeleton_warrior_undying_resolve': (bs) => {
    // HP < 30%: DEF +25% for remainder of battle (once activated)
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

  'lamia_serpent_bite': (bs) => {
    // 30% on hit: flat Bleed ATK×0.35 per turn for 2 turns
    if (Math.random() < 0.30 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('bleed', 2, bs.enemyATK * 0.35);
      bs.log.push('🐍 Lamia: Serpent Bite — Bleed applied! (35% ATK for 2 turns)');
    }
  },

  'minotaur_labyrinth_charge': (bs) => {
    // Every 3 turns: 180% ATK; if player HP > 70%: 220% ATK
    if (bs.currentTurn % 3 === 0) {
      const pct = bs.playerHP > bs.playerMaxHP * 0.70 ? 2.20 : 1.80;
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * pct;
      bs.log.push(`🐂 Minotaur: Labyrinth Charge — ${Math.round(pct * 100)}% ATK!`);
    }
  },

  'cyclops_boulder_throw': (bs) => {
    // Every 4 turns: 160% ATK + stun player 1 turn
    if (bs.currentTurn % 4 === 0) {
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * 1.60;
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('stun', 1);
      }
      bs.log.push('🗿 Cyclops: Boulder Throw — 160% ATK + Player Stunned!');
    }
  },

  'chimera_tri_form_assault': (bs) => {
    // Rotates per round: Turn%3==0 → Lion (140% ATK), Turn%3==1 → Goat (DEF-20%), Turn%3==2 → Serpent (Burn)
    const phase = (bs.currentTurn - 1) % 3;
    if (phase === 0) {
      // Lion Claw: 140% ATK
      bs.flags.enemy_bonus_damage = (bs.flags.enemy_bonus_damage || 0) + bs.enemyATK * 1.40;
      bs.log.push('🦁 Chimera: Lion Claw — 140% ATK!');
    } else if (phase === 1) {
      // Goat Ram: player DEF -20%
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('def_down', 1, 0.20);
      }
      bs.log.push('🐐 Chimera: Goat Ram — Your DEF -20%!');
    } else {
      // Serpent Bite: Burn ATK×0.30 for 2 turns
      if (!bs.playerStatusImmune) {
        bs.applyPlayerDebuff('burn', 2, bs.enemyATK * 0.30);
      }
      bs.log.push('🐍 Chimera: Serpent Bite — Burn! 30% ATK for 2 turns!');
    }
  },

  'hydra_regen': (bs) => {
    // Every 3rd turn: regen 5% max HP on local instance only
    // (shared pool is NOT healed; only the local enemyHP mirror is adjusted)
    if (bs.currentTurn % 3 === 0) {
      const regen = Math.floor(bs.enemyMaxHP * 0.05);
      bs.flags.hydra_local_regen = regen; // engine heals local hp only, does NOT commit to boss_state
      bs.log.push(`🐉 Hydra: Regeneration — Local regen ${regen} HP (shared pool unaffected)!`);
    }
  },

  'stone_stare': (bs) => {
    // Every 3rd turn: petrify player 1 turn, then reset counter
    if (bs.currentTurn % 3 === 0 && !bs.playerStatusImmune) {
      bs.applyPlayerDebuff('petrify', 1);
      bs.log.push('🗿 Medusa: Stone Stare — You are petrified! Skip your next turn!');
    }
  },

};

module.exports = PASSIVE_REGISTRY;

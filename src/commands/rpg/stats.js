'use strict';

const { MediaGalleryBuilder, MessageFlags } = require('discord.js');
const { makeOptimizedAttachment } = require('../../utils/imageOutput');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const pool = require('../../db/pool');
const { assemblePlayerStats, accumulateRuneStats } = require('../../engine/statAssembly');
const { computeResonanceMods } = require('../../config/blessings');
const { EXP_REQUIRED, MAX_COMBAT_LEVEL } = require('../../config/combatExp');
const { BELIEVER_EXP_PER_LEVEL, believerTitle } = require('../../config/believerProgression');
const { renderStatsImage } = require('../../engine/renderStats');
const { resolveSkin, resolveProfileLabel } = require('../../engine/skinResolver');
const { resolveProfileTarget } = require('../../utils/profileTarget');

// Bump when renderStats output changes visually (busts every cached stats card).
const STATS_RENDER_REV = 1;

/**
 * `crd profile [@user]` / `crd stats [@user]` — full Canvas profile card.
 * Totals come through assemblePlayerStats — the SAME path the battle engine uses —
 * so the displayed numbers match what actually fights. Display name + avatar are read
 * from the target's Discord member/user, not the DB. With no mention, shows your own.
 */
async function execute(message) {
  // Target: a mentioned/option user, else the author. Member gives the server nickname.
  // [v4.9] ctx.getMention works on both the prefix (@mention) and slash (user option) paths.
  const {
    isOther,
    discordId,
    displayName,
    avatarUrl,
    fallbackAvatarUrl,
  } = resolveProfileTarget(message);
  const [characterResult, raidStreakResult, rankedResult] = await Promise.all([
    pool.query(
      `SELECT uc.class, uc.combat_level, uc.combat_exp,
            uc.believer_level, uc.believer_exp,
            uc.raids_won, uc.raids_lost, uc.pvp_wins, uc.pvp_losses,
            wr.name  AS weapon_name,
            uw.enhancement AS weapon_enh,
            uw.curr_atk AS w_atk, uw.crit AS w_crit, uw.native_sockets AS w_native,
            ar.name  AS armor_name, ar.type AS armor_type,
            ua.enhancement AS armor_enh, ua.curr_hp AS a_hp, ua.curr_def AS a_def,
            ua.native_sockets AS a_native,
            dr.name  AS deity_name, dr.blessing_name, ud.enhancement AS deity_enh,
            ud.curr_atk AS d_atk, ud.curr_hp AS d_hp, ud.curr_def AS d_def,
            dr.mythology AS d1_myth,
            d2r.name AS deity2_name, ud2.curr_atk AS d2_atk, ud2.curr_hp AS d2_hp, ud2.curr_def AS d2_def,
            d2r.mythology AS d2_myth,
            d3r.name AS deity3_name, ud3.curr_atk AS d3_atk, ud3.curr_hp AS d3_hp, ud3.curr_def AS d3_def,
            d3r.mythology AS d3_myth,
            d2r.blessing_name AS deity2_blessing, d3r.blessing_name AS deity3_blessing,
            tcq.display AS equipped_title
       FROM user_character uc
       LEFT JOIN user_weapons  uw ON uc.equipped_weapon_id = uw.weapon_id
       LEFT JOIN weapon_roster wr ON uw.weapon_roster_id   = wr.weapon_roster_id
       LEFT JOIN user_armors   ua ON uc.equipped_armor_id  = ua.armor_id
       LEFT JOIN armor_roster  ar ON ua.armor_roster_id    = ar.armor_roster_id
       LEFT JOIN user_deities  ud ON uc.active_deity_id     = ud.user_deity_id
       LEFT JOIN deity_roster  dr ON ud.deity_id            = dr.deity_id
       LEFT JOIN user_deities  ud2 ON uc.active_deity_id_2  = ud2.user_deity_id
       LEFT JOIN deity_roster  d2r ON ud2.deity_id          = d2r.deity_id
       LEFT JOIN user_deities  ud3 ON uc.active_deity_id_3  = ud3.user_deity_id
       LEFT JOIN deity_roster  d3r ON ud3.deity_id          = d3r.deity_id
       LEFT JOIN title_catalog tcq ON tcq.title_id          = uc.equipped_title_id
       WHERE uc.discord_id = $1`,
      [discordId]
    ),
    // Raid streak = CURRENT win streak: count leading wins from the most recent raid backwards
    // (stops at the first non-win), per "Raid Streak (current winstreak)".
    pool.query(
      `WITH ordered AS (
         SELECT result, ROW_NUMBER() OVER (ORDER BY timestamp DESC, id DESC) AS rn
           FROM raid_logs
          WHERE discord_id = $1 AND battle_type = 'raid'
       )
       SELECT COUNT(*)::int AS current
         FROM ordered
        WHERE result = 'win'
          AND rn < COALESCE((SELECT MIN(rn) FROM ordered WHERE result <> 'win'), 2147483647)`,
      [discordId]
    ),
    // Ranked record ("rank duels / rank wins / rank streak") from ranked_logs (challenger-only
    // rows; result is win|loss). rank streak = CURRENT ranked win streak.
    pool.query(
      `WITH ordered AS (
         SELECT result, ROW_NUMBER() OVER (ORDER BY timestamp DESC, id DESC) AS rn
           FROM ranked_logs
          WHERE player_id = $1
       )
       SELECT
         (SELECT COUNT(*)::int FROM ordered)                          AS total,
         (SELECT COUNT(*)::int FROM ordered WHERE result = 'win')     AS wins,
         (SELECT COUNT(*)::int FROM ordered
            WHERE result = 'win'
              AND rn < COALESCE((SELECT MIN(rn) FROM ordered WHERE result <> 'win'), 2147483647)) AS streak`,
      [discordId]
    ),
  ]);
  const { rows } = characterResult;

  if (rows.length === 0) {
    // For self this is unreachable (middleware requiresCharacter); for a mentioned
    // user it's a real "they have no character" case.
    await message.reply({
      content: isOther
        ? `<@${discordId}> doesn't have a character yet.`
        : 'You don\'t have a character yet. Use `crd create character` to get started.',
      allowedMentions: { parse: [] },
    });
    return;
  }

  const r = rows[0];

  // Assemble totals through the engine's stat path ([v5]: class + weapon ATK/CRIT +
  // armor HP/DEF + active deity curr_*).
  const weapon = r.w_atk != null
    ? { curr_atk: r.w_atk, crit: r.w_crit }
    : null;
  const armor = r.a_hp != null
    ? { curr_hp: r.a_hp, curr_def: r.a_def }
    : null;
  const deity = r.d_atk != null
    ? { curr_atk: r.d_atk, curr_hp: r.d_hp, curr_def: r.d_def }
    : null;
  const slot2 = r.d2_atk != null ? { curr_atk: r.d2_atk, curr_hp: r.d2_hp, curr_def: r.d2_def } : null;
  const slot3 = r.d3_atk != null ? { curr_atk: r.d3_atk, curr_hp: r.d3_hp, curr_def: r.d3_def } : null;
  const deityInfos = [
    r.deity_name ? { name: r.deity_name, mythology: r.d1_myth } : null,
    r.deity2_name ? { name: r.deity2_name, mythology: r.d2_myth } : null,
    r.deity3_name ? { name: r.deity3_name, mythology: r.d3_myth } : null,
  ];
  const resonance = computeResonanceMods(deityInfos);
  const pantheonMods = (slot2 || slot3 || resonance.atkPct || resonance.hpPct || resonance.defPct || resonance.critPts)
    ? { slot2, slot3, resonance } : null;
  const { mods: runeMods } = await accumulateRuneStats(pool, r);
  const stats = assemblePlayerStats(r.class, r.combat_level, weapon, armor, deity, runeMods, pantheonMods);

  // enhancement column: 1 = +0; display level is enhancement − 1.
  const weaponEnh = r.weapon_name ? Math.max(0, (r.weapon_enh || 1) - 1) : 0;
  const armorEnh  = r.armor_name  ? Math.max(0, (r.armor_enh  || 1) - 1) : 0;
  const deityEnh  = r.deity_name  ? Math.max(0, (r.deity_enh  || 1) - 1) : 0;

  const combatAtCap = r.combat_level >= MAX_COMBAT_LEVEL;

  const data = {
    displayName,
    discordId,
    avatarUrl,
    fallbackAvatarUrl,

    believerLevel: r.believer_level,
    believerTitle: believerTitle(r.believer_level),
    equippedTitle: r.equipped_title || null,
    believerExp: Number(r.believer_exp),
    believerExpMax: BELIEVER_EXP_PER_LEVEL,

    className: r.class,
    combatLevel: r.combat_level,
    combatExp: Number(r.combat_exp),
    combatExpMax: combatAtCap ? null : (EXP_REQUIRED[r.combat_level] ?? null),

    weaponName: r.weapon_name || null,
    weaponEnh,
    armorName: r.armor_name || null,
    armorType: r.armor_type || null,
    armorEnh,
    deityName: r.deity_name || null,
    deity2Name: r.deity2_name || null,
    deity3Name: r.deity3_name || null,
    deityEnh,
    // Divine Blessing = slot-1 deity's blessing. Echo Blessing = the blessings carried by the
    // slot-2/slot-3 (echo) deities, joined; null when no echo deities are equipped.
    blessingName: r.deity_name ? (r.blessing_name || null) : null,
    echoBlessing: [r.deity2_blessing, r.deity3_blessing].filter(Boolean).join(' · ') || null,

    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,

    // "Combat Stats" record row. raidStreak = CURRENT win streak. The duels/duelWins/duelStreak
    // keys now carry RANKED data ("rank duels / rank wins / rank streak"); the renderers relabel
    // them to RANK. (Keys kept so per-skin stats.layout.json record cols still resolve by key.)
    records: {
      raids: (r.raids_won || 0) + (r.raids_lost || 0),
      raidsWon: r.raids_won || 0,
      raidStreak: raidStreakResult.rows[0]?.current || 0,
      duels: rankedResult.rows[0]?.total || 0,
      duelWins: rankedResult.rows[0]?.wins || 0,
      duelStreak: rankedResult.rows[0]?.streak || 0,
    },
  };

  // [Supporter-stage §6] Resolve the equipped/override/base profile skin + top-label word.
  const skin = await resolveSkin(pool, discordId, 'profile');
  data.skinPath = skin.path; // null → renderer keeps the default template
  data.topLabel = await resolveProfileLabel(pool, discordId);

  // [egress] Render-once cache — see profile.js; same pattern.
  const cached = await getCachedCanvasUrl(
    ['stats', STATS_RENDER_REV, data],
    () => renderStatsImage(data)
  );
  if (cached) {
    await message.reply({
      components: [new MediaGalleryBuilder().addItems((item) => item.setURL(cached.url))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const image = await makeOptimizedAttachment(await renderStatsImage(data), 'stats');

  // Image only — no embed/container wrapper (RenderTweaks Tweak 2).
  await message.reply({
    files: [image.file],
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute, believerTitle };

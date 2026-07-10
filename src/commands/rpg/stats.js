'use strict';

const { MediaGalleryBuilder, MessageFlags } = require('discord.js');
const { makeOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const pool = require('../../db/pool');
const { assemblePlayerStats, accumulateRuneStats } = require('../../engine/statAssembly');
const { computeResonanceMods } = require('../../config/blessings');
const { computeSigilStats } = require('../../config/ascension');
const { EXP_REQUIRED, MAX_COMBAT_LEVEL } = require('../../config/combatExp');
const { BELIEVER_EXP_PER_LEVEL, believerTitle } = require('../../config/believerProgression');
const { renderStatsImage } = require('../../engine/renderStats');
const { resolveStatsSkin, resolveProfileLabel } = require('../../engine/skinResolver');
const { resolveDefaultClassAvatarPath, resolveStatsAvatar } = require('../../engine/avatarSystem');
const { resolveProfileTarget } = require('../../utils/profileTarget');
const { envNumber, performanceLog } = require('../../utils/runtimeLogs');
const { safeAssetKey } = require('../../engine/avatarImageLoader');
const {
  isRemoteAssetsEnabled, isRemoteSource, remoteAssetAvailable, relativeAssetPath,
  assetPath, assetExistsSync,
} = require('../../utils/assets');
const { getSupporter, effectiveTier } = require('../../engine/supporterEntitlements');
const { SUPPORTER_BADGE_DIR, SUPPORTER_BADGE_FILE } = require('../../config/cosmetics');

// Bump when renderStats output changes visually (busts every cached stats card).
// 9: §1.3 — busts cards cached while an equipped avatar's art was missing on R2.
// 10: §2.5 — supporter badge below the Title.
// 11: badge enlarged (SUPPORTER_BADGE_HEIGHT 30 → 52) + name clamp to panel.
const STATS_RENDER_REV = 11;
const STATS_IMAGE_OPTIONS = Object.freeze({
  quality: 50,
  maxWidth: Math.floor(envNumber('STATS_IMAGE_MAX_WIDTH', 0, { min: 0, max: 4096 })),
  minSavings: 0.02,
  preserveTransparency: false,
  allowWebp: true,
});

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
            dr.name  AS deity_name, dr.blessing_name, ud.sigils AS d1_sigils, ud.ascended AS d1_ascended,
            dr.base_atk AS d1_batk, dr.base_hp AS d1_bhp, dr.base_def AS d1_bdef,
            dr.mythology AS d1_myth,
            d2r.name AS deity2_name, ud2.sigils AS d2_sigils,
            d2r.base_atk AS d2_batk, d2r.base_hp AS d2_bhp, d2r.base_def AS d2_bdef,
            d2r.mythology AS d2_myth,
            d3r.name AS deity3_name, ud3.sigils AS d3_sigils,
            d3r.base_atk AS d3_batk, d3r.base_hp AS d3_bhp, d3r.base_def AS d3_bdef,
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
  // [Ascension §3.5] Deity stats computed at read time: base × (0.50 + 0.05 × sigils).
  const deity = r.deity_name != null
    ? computeSigilStats({ base_atk: r.d1_batk, base_hp: r.d1_bhp, base_def: r.d1_bdef }, r.d1_sigils)
    : null;
  const slot2 = r.deity2_name != null
    ? computeSigilStats({ base_atk: r.d2_batk, base_hp: r.d2_bhp, base_def: r.d2_bdef }, r.d2_sigils)
    : null;
  const slot3 = r.deity3_name != null
    ? computeSigilStats({ base_atk: r.d3_batk, base_hp: r.d3_bhp, base_def: r.d3_bdef }, r.d3_sigils)
    : null;
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
  // [Ascension] Deity "+n" now shows the Sigil count (0–10).
  const deityEnh  = r.deity_name  ? Math.max(0, Number(r.d1_sigils) || 0) : 0;

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
  const logContext = {
    system: 'stats',
    command: 'stats',
    imageType: 'stats',
    guildId: message.guild?.id,
    userId: discordId,
  };

  const skin = await resolveStatsSkin(pool, discordId);
  data.skinPath = skin.path; // null → renderer keeps the default template
  data.topLabel = await resolveProfileLabel(pool, discordId);
  performanceLog('stats skin selected', {
    ...logContext,
    skinCategory: 'stats',
    skinSource: skin.source,
    cosmeticKey: skin.cosmetic?.cosmetic_key,
    assetKey: safeAssetKey(skin.path),
  });
  data.avatarPath = await resolveStatsAvatar(pool, discordId, r.class, logContext);
  data.avatarFallbackPath = resolveDefaultClassAvatarPath(r.class);
  // [§1.3] Cache-poisoning guard: the canvas cache assumes the render is a pure
  // function of its inputs, but the avatar layer also depends on whether the art
  // is fetchable AT RENDER TIME. If the equipped avatar's file is missing, null
  // the path so the fallback render is keyed AS a fallback — once the art is
  // uploaded, remoteAssetAvailable flips (10-min TTL re-check) → new cache key →
  // fresh render. Uses the existing cached HEAD probe (no per-render egress).
  if (data.avatarPath && isRemoteAssetsEnabled() && isRemoteSource(data.avatarPath)
      && !(await remoteAssetAvailable(relativeAssetPath(data.avatarPath)))) {
    performanceLog('stats avatar art missing — keyed as fallback', {
      ...logContext,
      assetKey: safeAssetKey(data.avatarPath),
    });
    data.avatarPath = null;
  }

  // [§2.5] Supporter badge: active subscribers only (effectiveTier → null when
  // lapsed; eternal is permanent). Resolved to a fetchable path HERE so the
  // badge identity (tier + availability) is part of the canvas cache key via
  // `data`; missing art (not uploaded yet) → null → renderer skips the layer.
  data.supporterBadgePath = null;
  const supporterTier = effectiveTier(await getSupporter(pool, discordId));
  if (supporterTier && SUPPORTER_BADGE_FILE[supporterTier]) {
    const badgeRel = `${SUPPORTER_BADGE_DIR}/${SUPPORTER_BADGE_FILE[supporterTier]}.png`;
    if (isRemoteAssetsEnabled()) {
      if (await remoteAssetAvailable(badgeRel)) data.supporterBadgePath = assetPath(badgeRel);
    } else if (assetExistsSync(assetPath(badgeRel))) {
      data.supporterBadgePath = assetPath(badgeRel);
    }
  }

  // [egress] Render-once cache — see profile.js; same pattern.
  const cached = await getCachedCanvasUrl(
    ['stats', STATS_RENDER_REV, data],
    () => renderStatsImage(data),
    STATS_IMAGE_OPTIONS,
    { returnImageOnFailure: true, logContext }
  );
  if (cached?.url) {
    await message.reply({
      components: [new MediaGalleryBuilder().addItems((item) => item.setURL(cached.url))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const image = cached?.image
    ? attachmentFromOptimizedImage(cached.image, 'stats', { ...logContext, reusedBuffer: true })
    : await makeOptimizedAttachment(await renderStatsImage(data), 'stats', { ...STATS_IMAGE_OPTIONS, logContext });

  // Image only — no embed/container wrapper (RenderTweaks Tweak 2).
  await message.reply({
    files: [image.file],
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute, believerTitle };

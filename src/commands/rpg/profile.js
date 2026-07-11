'use strict';

const { EmbedBuilder, MediaGalleryBuilder, MessageFlags } = require('discord.js');
const { renderOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const pool = require('../../db/pool');
const { assemblePlayerStats, accumulateRuneStats } = require('../../engine/statAssembly');
const { computeResonanceMods } = require('../../config/blessings');
const { computeDeityProgressionStats } = require('../../engine/deityEnhancement');
const { EXP_REQUIRED, MAX_COMBAT_LEVEL } = require('../../config/combatExp');
const { BELIEVER_EXP_PER_LEVEL, believerTitle } = require('../../config/believerProgression');
const { renderProfileImage } = require('../../engine/renderProfile');
const { resolveSkin, resolveProfileLabel } = require('../../engine/skinResolver');
const { resolveProfileTarget } = require('../../utils/profileTarget');
const { envNumber, performanceLog } = require('../../utils/runtimeLogs');
const { safeAssetKey } = require('../../engine/avatarImageLoader');
const {
  isRemoteAssetsEnabled, remoteAssetAvailable, assetPath, assetExistsSync,
} = require('../../utils/assets');
const { getSupporter, effectiveTier } = require('../../engine/supporterEntitlements');
const { SUPPORTER_BADGE_DIR, SUPPORTER_BADGE_FILE } = require('../../config/cosmetics');
const {
  signature: profileImageSignature,
  getProfileImageCache,
  setProfileImageCache,
} = require('../../utils/profileImageCache');

// Bump when renderProfile output changes visually (busts every cached profile card).
// 4: §2.5 — supporter badge below the Title.
// 5: shared supporter badge dimensions and identity-stack spacing.
const PROFILE_RENDER_REV = 7;
const PROFILE_IMAGE_OPTIONS = Object.freeze({
  maxWidth: Math.floor(envNumber('PROFILE_IMAGE_MAX_WIDTH', 0, { min: 0, max: 4096 })),
});

/**
 * `crd profile [@user]` / `crd stats [@user]` — full Canvas profile card.
 * Totals come through assemblePlayerStats — the SAME path the battle engine uses —
 * so the displayed numbers match what actually fights. Display name + avatar are read
 * from the target's Discord member/user, not the DB. With no mention, shows your own.
 */
async function executeProfile(message, db = pool) {
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
    db.query(
      `SELECT uc.class, uc.combat_level, uc.combat_exp,
            uc.believer_level, uc.believer_exp,
            uc.raids_won, uc.raids_lost, uc.pvp_wins, uc.pvp_losses,
            wr.name  AS weapon_name,
            uw.enhancement AS weapon_enh,
            uw.curr_atk AS w_atk, uw.crit AS w_crit, uw.native_sockets AS w_native,
            ar.name  AS armor_name, ar.type AS armor_type,
            ua.enhancement AS armor_enh, ua.curr_hp AS a_hp, ua.curr_def AS a_def,
            ua.native_sockets AS a_native,
            dr.name AS deity_name, dr.blessing_name,
            COALESCE(ud.sigils, 0) AS d1_unlocked_sigils,
            COALESCE(ud.ascended, FALSE) AS d1_ascended, ud.enhancement AS d1_enhancement,
            dr.base_atk AS d1_batk, dr.base_hp AS d1_bhp, dr.base_def AS d1_bdef,
            dr.mythology AS d1_myth,
            d2r.name AS deity2_name, COALESCE(ud2.sigils, 0) AS d2_unlocked_sigils,
            COALESCE(ud2.ascended, FALSE) AS d2_ascended, ud2.enhancement AS d2_enhancement,
            d2r.base_atk AS d2_batk, d2r.base_hp AS d2_bhp, d2r.base_def AS d2_bdef,
            d2r.mythology AS d2_myth,
            d3r.name AS deity3_name, COALESCE(ud3.sigils, 0) AS d3_unlocked_sigils,
            COALESCE(ud3.ascended, FALSE) AS d3_ascended, ud3.enhancement AS d3_enhancement,
            d3r.base_atk AS d3_batk, d3r.base_hp AS d3_bhp, d3r.base_def AS d3_bdef,
            d3r.mythology AS d3_myth,
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
    // Raid streak = CURRENT win streak (leading wins from the most recent raid).
    db.query(
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
    // Rank record from ranked_logs (challenger-only rows; result win|loss). rank streak = CURRENT.
    db.query(
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
  const deity = r.deity_name != null
    ? computeDeityProgressionStats({ base_atk: r.d1_batk, base_hp: r.d1_bhp, base_def: r.d1_bdef }, {
      sigils: r.d1_unlocked_sigils, ascended: r.d1_ascended, enhancement: r.d1_enhancement,
    })
    : null;
  const slot2 = r.deity2_name != null
    ? computeDeityProgressionStats({ base_atk: r.d2_batk, base_hp: r.d2_bhp, base_def: r.d2_bdef }, {
      sigils: r.d2_unlocked_sigils, ascended: r.d2_ascended, enhancement: r.d2_enhancement,
    })
    : null;
  const slot3 = r.deity3_name != null
    ? computeDeityProgressionStats({ base_atk: r.d3_batk, base_hp: r.d3_bhp, base_def: r.d3_bdef }, {
      sigils: r.d3_unlocked_sigils, ascended: r.d3_ascended, enhancement: r.d3_enhancement,
    })
    : null;
  const deityInfos = [
    r.deity_name ? { name: r.deity_name, mythology: r.d1_myth } : null,
    r.deity2_name ? { name: r.deity2_name, mythology: r.d2_myth } : null,
    r.deity3_name ? { name: r.deity3_name, mythology: r.d3_myth } : null,
  ];
  const resonance = computeResonanceMods(deityInfos);
  const pantheonMods = (slot2 || slot3 || resonance.atkPct || resonance.hpPct || resonance.defPct || resonance.critPts)
    ? { slot2, slot3, resonance } : null;
  const { mods: runeMods } = await accumulateRuneStats(db, r);
  const stats = assemblePlayerStats(r.class, r.combat_level, weapon, armor, deity, runeMods, pantheonMods);

  // enhancement column: 1 = +0; display level is enhancement − 1.
  const weaponEnh = r.weapon_name ? Math.max(0, (r.weapon_enh || 1) - 1) : 0;
  const armorEnh  = r.armor_name  ? Math.max(0, (r.armor_enh  || 1) - 1) : 0;
  const deityEnh  = r.deity_name ? Math.max(0, (Number(r.d1_enhancement) || 1) - 1) : 0;

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
    blessingName: r.deity_name ? (r.blessing_name || null) : null,

    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,

    // Rank Combat Record. raidStreak = current raid win streak; the duel* keys carry RANKED data
    // (rank duels/wins/current rank streak) — renderers relabel them to RANK.
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
    system: 'profile',
    command: 'profile',
    imageType: 'profile',
    guildId: message.guild?.id,
    userId: discordId,
  };

  const skin = await resolveSkin(db, discordId, 'profile');
  data.skinPath = skin.path; // null → renderer keeps the default template
  data.topLabel = await resolveProfileLabel(db, discordId);
  // [§2.5] Supporter badge — active subscribers only; resolved here so the badge
  // identity is part of the cache key via `data`; missing art → renderer skips.
  data.supporterBadgePath = null;
  const supporterTier = effectiveTier(await getSupporter(db, discordId));
  if (supporterTier && SUPPORTER_BADGE_FILE[supporterTier]) {
    const badgeRel = `${SUPPORTER_BADGE_DIR}/${SUPPORTER_BADGE_FILE[supporterTier]}.png`;
    if (isRemoteAssetsEnabled()) {
      if (await remoteAssetAvailable(badgeRel)) data.supporterBadgePath = assetPath(badgeRel);
    } else if (assetExistsSync(assetPath(badgeRel))) {
      data.supporterBadgePath = assetPath(badgeRel);
    }
  }
  performanceLog('profile skin selected', {
    ...logContext,
    skinCategory: 'profile',
    skinSource: skin.source,
    cosmeticKey: skin.cosmetic?.cosmetic_key,
    assetKey: safeAssetKey(skin.path),
  });

  // [egress] Render-once cache: same profile state → same key → served from R2
  // by URL (zero upload). PROFILE_RENDER_REV must be bumped when renderProfile
  // visuals change so old cached images stop matching.
  const memorySignature = profileImageSignature([PROFILE_RENDER_REV, data]);
  const memoryUrl = getProfileImageCache(discordId, memorySignature, logContext);
  if (memoryUrl) {
    await message.reply({
      components: [new MediaGalleryBuilder().addItems((item) => item.setURL(memoryUrl))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { repliedUser: false },
    });
    return;
  }
  const cached = await getCachedCanvasUrl(
    ['profile', PROFILE_RENDER_REV, data],
    () => renderProfileImage(data),
    PROFILE_IMAGE_OPTIONS,
    { returnImageOnFailure: true, logContext }
  );
  if (cached?.url) {
    setProfileImageCache(discordId, memorySignature, cached.url);
    await message.reply({
      components: [new MediaGalleryBuilder().addItems((item) => item.setURL(cached.url))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const image = cached?.image
    ? attachmentFromOptimizedImage(cached.image, `profile-${discordId}`, { ...logContext, reusedBuffer: true })
    : await renderOptimizedAttachment(() => renderProfileImage(data), `profile-${discordId}`, { ...PROFILE_IMAGE_OPTIONS, logContext });

  // Reference the uploaded buffer by its exact attachment filename.
  const filename = `profile-${discordId}.webp`;
  if (image.name !== filename || image.format !== 'webp') {
    throw new Error(`Profile image output mismatch: expected ${filename}, received ${image.name} (${image.format}).`);
  }
  const embed = new EmbedBuilder().setImage(`attachment://${filename}`);
  await message.reply({
    embeds: [embed],
    files: [{ attachment: image.buffer, name: filename }],
    allowedMentions: { repliedUser: false },
  });
}

async function execute(message, options = {}) {
  try {
    await executeProfile(message, options.db || pool);
  } catch (err) {
    console.error('[profile] command failed', {
      command: 'profile',
      operation: 'load-and-render-profile',
      userId: message.author?.id,
      guildId: message.guild?.id,
      error: err,
    });
    await message.reply({
      content: 'Profile is temporarily unavailable. Please try again later.',
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
  }
}

module.exports = { execute, executeProfile, believerTitle };

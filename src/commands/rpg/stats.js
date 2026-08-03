'use strict';

const { EmbedBuilder, MediaGalleryBuilder, MessageFlags } = require('discord.js');
const { renderOptimizedAttachment, attachmentFromOptimizedImage } = require('../../utils/imageOutput');
const { getCachedCanvasUrl } = require('../../utils/canvasCache');
const pool = require('../../db/pool');
const { assemblePlayerStats, accumulateRuneStats } = require('../../engine/statAssembly');
const { computeResonanceMods, resolveBlessingSlots, SLOT_UNLOCK_GATES } = require('../../config/blessings');
const { computeDeityProgressionStats } = require('../../engine/deityEnhancement');
const { getActiveLoadout } = require('../../engine/loadout');
const { characterRecords } = require('../../engine/characterRecords');
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
// 11: shared supporter badge dimensions + name clamp to panel.
// 19: keep the equipped avatar path when the advisory R2 HEAD probe fails.
// 22: remove the active preset label from the stats card.
// 23: show global PvP rank instead of the current rating points.
const STATS_RENDER_REV = 23;
const STATS_IMAGE_OPTIONS = Object.freeze({
  quality: 50,
  maxWidth: Math.floor(envNumber('STATS_IMAGE_MAX_WIDTH', 0, { min: 0, max: 4096 })),
  minSavings: 0.02,
  preserveTransparency: false,
  allowWebp: true,
});

/**
 * `crd stats [@user]` — full Canvas stats card.
 * Totals come through assemblePlayerStats — the SAME path the battle engine uses —
 * so the displayed numbers match what actually fights. The display name comes from the
 * target's Discord member/user; the character image comes from equipped_avatars.
 * With no mention, shows your own.
 */
async function execute(message) {
  // Target: a mentioned/option user, else the author. Member gives the server nickname.
  // [v4.9] ctx.getMention works on both the prefix (@mention) and slash (user option) paths.
  const {
    isOther,
    discordId,
    displayName,
  } = resolveProfileTarget(message);
  const [characterResult, raidStreakResult, rankedResult] = await Promise.all([
    getActiveLoadout(pool, discordId),
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
    // Ranked record from ranked_logs (challenger-only rows; result is win|loss).
    // rank streak = CURRENT ranked win streak; global_rank is the player's position
    // across all current user_character.pvp_rating values (ties share a position).
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
              AND rn < COALESCE((SELECT MIN(rn) FROM ordered WHERE result <> 'win'), 2147483647)) AS streak,
         (SELECT 1 + COUNT(*)::int
            FROM user_character higher
           WHERE higher.pvp_rating > (
             SELECT target.pvp_rating
               FROM user_character target
              WHERE target.discord_id = $1
           )) AS global_rank`,
      [discordId]
    ),
  ]);
  if (!characterResult) {
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

  const r = characterResult;

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
  const { mods: runeMods } = await accumulateRuneStats(pool, r);
  const stats = assemblePlayerStats(r.class, r.combat_level, weapon, armor, deity, runeMods, pantheonMods);

  // enhancement column: 1 = +0; display level is enhancement − 1.
  const weaponEnh = r.weapon_name ? Math.max(0, (r.weapon_enh || 1) - 1) : 0;
  const armorEnh  = r.armor_name  ? Math.max(0, (r.armor_enh  || 1) - 1) : 0;
  const deityEnh  = r.deity_name ? Math.max(0, (Number(r.d1_enhancement) || 1) - 1) : 0;

  const combatAtCap = r.combat_level >= MAX_COMBAT_LEVEL;

  // Blessing channels use the same resolver as combat, so the
  // display can never disagree with which blessing actually fires.
  const blessingSlots = resolveBlessingSlots({
    slot1Name: r.deity_name,
    slot1BlessingName: r.deity_blessing_name,
    slot1BlessingKey: r.blessing_key,
    slot1Ascended: r.d1_ascended,
    echoName: r.echo_deity_name,
    echoBlessingName: r.echo_blessing_name,
    echoBlessingKey: r.echo_blessing_key,
    echoAscended: r.echo_ascended,
  });

  // Slot 1 has no believer-level gate.
  const primaryBlessingText = !blessingSlots.primary.deityName
    ? 'None'
    : !blessingSlots.primary.ascended
      ? 'Deity not ascended'
      : blessingSlots.primary.key === 'none'
        ? 'None'
        : (blessingSlots.primary.blessingName || 'None');

  // Which slot the chosen Echo deity occupies, for the believer-level gate.
  const echoSlot =
    r.equipped_echo_deity_id && r.equipped_echo_deity_id === r.equipped_deity_2_id ? 2 :
      r.equipped_echo_deity_id && r.equipped_echo_deity_id === r.equipped_deity_3_id ? 3 :
        null;
  const believerLevel = Number(r.believer_level) || 0;

  // Gate order matters: the slot-2 gate is checked BEFORE "is an echo deity
  // selected", so an early-progression character reads Locked, not None.
  let secondaryBlessingText;
  if (believerLevel < SLOT_UNLOCK_GATES[2]) {
    secondaryBlessingText = 'Locked';
  } else if (echoSlot == null || !blessingSlots.secondary.deityName) {
    // Nothing selected, or a stale pointer matching neither slot 2 nor slot 3.
    secondaryBlessingText = 'None';
  } else if (believerLevel < (SLOT_UNLOCK_GATES[echoSlot] ?? 0)) {
    secondaryBlessingText = 'Locked';
  } else if (!blessingSlots.secondary.ascended) {
    secondaryBlessingText = 'Deity not ascended';
  } else if (blessingSlots.secondary.key === 'none') {
    secondaryBlessingText = 'None';
  } else {
    secondaryBlessingText = blessingSlots.secondary.blessingName || 'None';
  }

  const data = {
    displayName,
    discordId,

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
    // Primary/Secondary describe the combat channel, not the Divine/Echo blessing
    // type. An Echo-type deity in slot 1 still supplies the primary channel.
    // Keys stay `blessingName`/`echoBlessing` so per-skin stats layouts resolve.
    blessingName: primaryBlessingText,
    echoBlessing: secondaryBlessingText,

    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,

    records: characterRecords(r, raidStreakResult, rankedResult),
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
  // The HEAD probe is advisory. A transient HEAD failure must not erase a valid
  // equipped path before the renderer can attempt the real image GET. Keep its
  // result in the canvas input so a genuinely missing object renders under a
  // different key once the probe later succeeds, preventing fallback-cache
  // poisoning without hiding an available avatar.
  data.avatarAssetAvailable = null;
  if (data.avatarPath && isRemoteAssetsEnabled() && isRemoteSource(data.avatarPath)) {
    data.avatarAssetAvailable = await remoteAssetAvailable(relativeAssetPath(data.avatarPath));
  }
  if (data.avatarAssetAvailable === false) {
    performanceLog('stats avatar HEAD unavailable — renderer will attempt source', {
      ...logContext,
      assetKey: safeAssetKey(data.avatarPath),
    });
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
    ? attachmentFromOptimizedImage(cached.image, `stats-${discordId}`, { ...logContext, reusedBuffer: true })
    : await renderOptimizedAttachment(() => renderStatsImage(data), `stats-${discordId}`, { ...STATS_IMAGE_OPTIONS, logContext });

  // Reference the uploaded buffer by its exact attachment filename.
  const filename = `stats-${discordId}.webp`;
  if (image.name !== filename || image.format !== 'webp') {
    throw new Error(`Stats image output mismatch: expected ${filename}, received ${image.name} (${image.format}).`);
  }
  const embed = new EmbedBuilder().setImage(`attachment://${filename}`);
  await message.reply({
    embeds: [embed],
    files: [{ attachment: image.buffer, name: filename }],
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute, believerTitle };

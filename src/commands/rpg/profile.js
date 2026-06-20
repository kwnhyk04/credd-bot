'use strict';

const { AttachmentBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { assemblePlayerStats } = require('../../engine/statAssembly');
const { EXP_REQUIRED, MAX_COMBAT_LEVEL } = require('../../config/combatExp');
const { renderProfileImage } = require('../../engine/renderProfile');
const { resolveSkin, resolveProfileLabel } = require('../../engine/skinResolver');

const BELIEVER_EXP_PER_LEVEL = 3000; // §18 (3,000 flat per level)

// §18 Believer Level Titles (Master §18 table).
function believerTitle(level) {
  if (level >= 500) return 'Last Believer';
  if (level >= 200) return 'Chosen One';
  if (level >= 100) return 'Champion of Faith';
  if (level >= 50)  return 'Zealot';
  if (level >= 25)  return 'Disciple';
  if (level >= 10)  return 'Devotee';
  return 'Wanderer';
}

/**
 * `crd profile [@user]` / `crd stats [@user]` — full Canvas profile card.
 * Totals come through assemblePlayerStats — the SAME path the battle engine uses —
 * so the displayed numbers match what actually fights. Display name + avatar are read
 * from the target's Discord member/user, not the DB. With no mention, shows your own.
 */
async function execute(message) {
  // Target: a mentioned/option user, else the author. Member gives the server nickname.
  // [v4.9] ctx.getMention works on both the prefix (@mention) and slash (user option) paths.
  const targetUser = message.getMention(0) || message.author;
  const targetMember = message.guild?.members?.cache?.get(targetUser.id) || null;
  const isOther = targetUser.id !== message.author.id;
  const discordId = targetUser.id;
  const [characterResult, raidStreakResult, duelStreakResult] = await Promise.all([
    pool.query(
      `SELECT uc.class, uc.combat_level, uc.combat_exp,
            uc.believer_level, uc.believer_exp,
            uc.raids_won, uc.raids_lost, uc.pvp_wins, uc.pvp_losses,
            wr.name  AS weapon_name,
            uw.enhancement AS weapon_enh,
            uw.curr_atk AS w_atk, uw.curr_hp AS w_hp, uw.curr_def AS w_def, uw.crit AS w_crit,
            dr.name  AS deity_name, dr.blessing_name, ud.enhancement AS deity_enh,
            ud.curr_atk AS d_atk, ud.curr_hp AS d_hp, ud.curr_def AS d_def
       FROM user_character uc
       LEFT JOIN user_weapons  uw ON uc.equipped_weapon_id = uw.weapon_id
       LEFT JOIN weapon_roster wr ON uw.weapon_roster_id   = wr.weapon_roster_id
       LEFT JOIN user_deities  ud ON uc.active_deity_id     = ud.user_deity_id
       LEFT JOIN deity_roster  dr ON ud.deity_id            = dr.deity_id
       WHERE uc.discord_id = $1`,
      [discordId]
    ),
    pool.query(
      `WITH ordered AS (
         SELECT result,
                ROW_NUMBER() OVER (ORDER BY timestamp, id)
                - ROW_NUMBER() OVER (PARTITION BY result ORDER BY timestamp, id) AS run_id
           FROM raid_logs
          WHERE discord_id = $1 AND battle_type = 'raid'
       ), win_runs AS (
         SELECT COUNT(*)::int AS streak
           FROM ordered
          WHERE result = 'win'
          GROUP BY run_id
       )
       SELECT COALESCE(MAX(streak), 0)::int AS highest FROM win_runs`,
      [discordId]
    ),
    pool.query(
      `WITH ordered AS (
         SELECT winner_id = $1 AS won,
                ROW_NUMBER() OVER (ORDER BY timestamp, id)
                - ROW_NUMBER() OVER (
                    PARTITION BY (winner_id = $1) ORDER BY timestamp, id
                  ) AS run_id
           FROM pvp_logs
          WHERE challenger_id = $1 OR opponent_id = $1
       ), win_runs AS (
         SELECT COUNT(*)::int AS streak
           FROM ordered
          WHERE won
          GROUP BY run_id
       )
       SELECT COALESCE(MAX(streak), 0)::int AS highest FROM win_runs`,
      [discordId]
    ),
  ]);
  const { rows } = characterResult;

  if (rows.length === 0) {
    // For self this is unreachable (middleware requiresCharacter); for a mentioned
    // user it's a real "they have no character" case.
    const name = targetMember?.displayName || targetUser.globalName || targetUser.username;
    await message.reply({
      content: isOther
        ? `**${name}** doesn't have a character yet.`
        : 'You don\'t have a character yet. Use `crd create character` to get started.',
      allowedMentions: { parse: [] },
    });
    return;
  }

  const r = rows[0];

  // Assemble totals through the engine's stat path (class + weapon curr_* + active deity curr_*).
  const weapon = r.w_atk != null
    ? { curr_atk: r.w_atk, curr_hp: r.w_hp, curr_def: r.w_def, crit: r.w_crit }
    : null;
  const deity = r.d_atk != null
    ? { curr_atk: r.d_atk, curr_hp: r.d_hp, curr_def: r.d_def }
    : null;
  const stats = assemblePlayerStats(r.class, r.combat_level, weapon, deity);

  // enhancement column: 1 = +0; display level is enhancement − 1.
  const weaponEnh = r.weapon_name ? Math.max(0, (r.weapon_enh || 1) - 1) : 0;
  const deityEnh  = r.deity_name  ? Math.max(0, (r.deity_enh  || 1) - 1) : 0;

  const combatAtCap = r.combat_level >= MAX_COMBAT_LEVEL;

  // Display name + avatar from the TARGET's member/user, NOT the DB.
  const displayName = targetMember?.displayName
    || targetUser.globalName
    || targetUser.username;

  const data = {
    displayName,
    discordId,
    avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 512 }),
    fallbackAvatarUrl: targetUser.defaultAvatarURL,

    believerLevel: r.believer_level,
    believerTitle: believerTitle(r.believer_level),
    believerExp: Number(r.believer_exp),
    believerExpMax: BELIEVER_EXP_PER_LEVEL,

    className: r.class,
    combatLevel: r.combat_level,
    combatExp: Number(r.combat_exp),
    combatExpMax: combatAtCap ? null : (EXP_REQUIRED[r.combat_level] ?? null),

    weaponName: r.weapon_name || null,
    weaponEnh,
    deityName: r.deity_name || null,
    deityEnh,
    blessingName: r.deity_name ? (r.blessing_name || null) : null,

    atk: stats.atk,
    hp: stats.hp,
    def: stats.def,
    crit: stats.crit,

    records: {
      raids: (r.raids_won || 0) + (r.raids_lost || 0),
      raidsWon: r.raids_won || 0,
      raidStreak: raidStreakResult.rows[0]?.highest || 0,
      duels: (r.pvp_wins || 0) + (r.pvp_losses || 0),
      duelWins: r.pvp_wins || 0,
      duelStreak: duelStreakResult.rows[0]?.highest || 0,
    },
  };

  // [Supporter-stage §6] Resolve the equipped/override/base profile skin + top-label word.
  const skin = await resolveSkin(pool, discordId, 'profile');
  data.skinPath = skin.path; // null → renderer keeps the default template
  data.topLabel = await resolveProfileLabel(pool, discordId);

  const buffer = await renderProfileImage(data);
  const file = new AttachmentBuilder(buffer, { name: 'profile.png' });

  // Image only — no embed/container wrapper (RenderTweaks Tweak 2).
  await message.reply({
    files: [file],
    allowedMentions: { repliedUser: false },
  });
}

module.exports = { execute, believerTitle };

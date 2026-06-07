'use strict';

const { EmbedBuilder } = require('discord.js');
const pool = require('../../db/pool');
const { computeClassStats } = require('../../config/classes');

const BRAND = 0x9b59b6;
const BELIEVER_EXP_PER_LEVEL = 3000; // §18
const TOTAL_CRIT_CAP = 45.0;         // §35.2

// §18 believer titles
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
 * `crd profile` / `crd stats` — read-only character embed.
 * Interim display: full Canvas profile card is Phase 9. Stats use the display-only
 * class helper (Phase 6 calculator supersedes).
 */
async function execute(message) {
  const discordId = message.author.id;
  const { rows } = await pool.query(
    `SELECT uc.class, uc.combat_level, uc.combat_exp,
            uc.believer_level, uc.believer_exp,
            uc.raids_won, uc.raids_lost, uc.pvp_wins, uc.pvp_losses,
            wr.name  AS weapon_name, wr.tier AS weapon_tier,
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
  );

  if (rows.length === 0) {
    // Should be unreachable (middleware requiresCharacter), but guard anyway.
    await message.reply({ content: 'You don\'t have a character yet. Use `crd create character` to get started.', allowedMentions: { repliedUser: false } });
    return;
  }

  const r = rows[0];
  const cs = computeClassStats(r.class, r.combat_level);

  const wAtk = r.w_atk || 0, wHp = r.w_hp || 0, wDef = r.w_def || 0;
  const wCrit = r.w_crit != null ? Number(r.w_crit) : 0;
  const dAtk = r.d_atk || 0, dHp = r.d_hp || 0, dDef = r.d_def || 0;

  const totalAtk = cs.atk + wAtk + dAtk;
  const totalHp  = cs.hp  + wHp  + dHp;
  const totalDef = cs.def + wDef + dDef;
  const totalCrit = Math.min(cs.crit + wCrit, TOTAL_CRIT_CAP); // deities grant no crit (§35.2)

  const weaponText = r.weapon_name
    ? `${r.weapon_name} (${r.weapon_tier}) +${r.weapon_enh - 1}`
    : 'None';
  const deityText = r.deity_name
    ? `${r.deity_name} — ${r.blessing_name} (+${r.deity_enh - 1})`
    : 'None';

  const title = believerTitle(r.believer_level);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle(`${message.author.username}'s Profile`)
    .setThumbnail(message.author.displayAvatarURL())
    .addFields(
      { name: 'Class', value: r.class, inline: true },
      { name: 'Combat Level', value: `Lv ${r.combat_level} · ${Number(r.combat_exp).toLocaleString()} EXP`, inline: true },
      { name: 'Believer Level', value: `Lv ${r.believer_level} — ${title}\n${Number(r.believer_exp).toLocaleString()} / ${BELIEVER_EXP_PER_LEVEL.toLocaleString()} EXP`, inline: true },
      { name: 'Equipped Weapon', value: weaponText, inline: false },
      { name: 'Active Deity', value: deityText, inline: false },
      { name: 'Total Stats', value: `⚔️ ATK ${totalAtk} · 🛡️ DEF ${totalDef} · ❤️ HP ${totalHp} · 🎯 CRIT ${totalCrit.toFixed(1)}%`, inline: false },
      { name: 'Record', value: `Raids ${r.raids_won}W / ${r.raids_lost}L · Duels ${r.pvp_wins}W / ${r.pvp_losses}L`, inline: false },
    )
    .setFooter({ text: 'Stats shown are an interim view — a full profile card arrives later.' });

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
}

module.exports = { execute };

'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const { CLASSES, CLASS_NAMES } = require('../config/classes');
const { DEV_ACCOUNT_IDS, TESTER_AVATAR_VARIANTS } = require('../config/cosmetics');
const { assetPath } = require('../utils/assets');
const { smallDivider: sep } = require('../utils/componentsV2');
const { envBool, performanceLog } = require('../utils/runtimeLogs');
const { safeAssetKey } = require('./avatarImageLoader');
const { iconToken, iconShop } = require('./skinEmojis');

const BRAND = 0x9b59b6;
const PER_PAGE = 10;
const STYLE_COST = Object.freeze({ cyber: 9, anime: 12, webtoon: 15 });
const STYLE_LABEL = Object.freeze({ cyber: 'Cyber', anime: 'Anime', webtoon: 'Webtoon' });
const GENDER_LABEL = Object.freeze({ male: 'Male', female: 'Female' });
const SEED_CLASSES = Object.freeze(CLASS_NAMES.map((name) => ({ name, folder: name.toLowerCase() })));
const SEED_GENDERS = Object.freeze(['male', 'female']);
const SEED_STYLES = Object.freeze(['cyber', 'anime', 'webtoon']);
let catalogSeedAttempted = false;

function isMissingAvatarTable(err) {
  return err && (err.code === '42P01' || /avatar_catalog|user_avatars|equipped_avatars/i.test(err.message || ''));
}

function avatarDevUnlocksEnabled() {
  const railwayEnv = String(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '').toLowerCase();
  const railwayNonProd = railwayEnv && !['production', 'prod'].includes(railwayEnv);
  const nodeNonProd = process.env.NODE_ENV !== 'production';
  const nonProd = railwayEnv ? railwayNonProd : (nodeNonProd || envBool('BETA_MODE', false));
  return nonProd && envBool('AVATAR_DEV_UNLOCKS', true);
}

function isAvatarDevAccount(userId) {
  return avatarDevUnlocksEnabled() && DEV_ACCOUNT_IDS.includes(String(userId));
}

// Env-INDEPENDENT dev-account membership. Unlike isAvatarDevAccount (which also
// requires avatarDevUnlocksEnabled()), this is true for any configured dev id
// regardless of the environment flag — so dev renders/ownership stay consistent
// even when AVATAR_DEV_UNLOCKS / non-prod detection is off.
function isDevAccountId(userId) {
  return DEV_ACCOUNT_IDS.includes(String(userId));
}

// [Patch 2 §2.2/§2.4] Founder + tester avatars are grant-only (dev command /
// manual insert), never purchasable — kept out of the supporter avatar shop.
const GRANT_ONLY_AVATAR_STYLES = new Set(['founder', 'tester']);
function isGrantOnlyAvatarRow(row) {
  return !!row && GRANT_ONLY_AVATAR_STYLES.has(String(row.style || '').toLowerCase());
}

function normalizeClass(className) {
  const raw = String(className || '').trim().toLowerCase();
  return CLASS_NAMES.find((name) => name.toLowerCase() === raw) || null;
}

function classFolder(className) {
  return String(className || '').trim().toLowerCase();
}

function defaultClassAvatar(className) {
  const canonical = normalizeClass(className) || className;
  return {
    avatar_id: null,
    avatar_key: 'default',
    display_name: `${canonical} Default`,
    class_name: canonical,
    gender: 'class',
    style: 'default',
    token_cost: 0,
    asset_path: `classes/${classFolder(canonical)}.png`,
    is_default: true,
  };
}

function resolveAvatarImagePath(row) {
  if (!row) return null;
  const rel = String(row.asset_path || '').replace(/^\/+/, '');
  return rel ? assetPath(rel) : null;
}

function canonicalAvatarAssetPath(row) {
  if (!row || row.is_default) return null;
  const gender = String(row.gender || '').trim().toLowerCase();
  const style = String(row.style || '').trim().toLowerCase();
  const folder = classFolder(row.class_name);
  if (!gender || !style || !folder || gender === 'class' || style === 'default') return null;
  // Only the store styles follow the <gender>/<class>/<class>_<style>.png layout.
  // Grant-only rows (founder/tester, gender='avatar') store their real path in
  // asset_path — rebuilding would fabricate a nonexistent key (the crd stats
  // equipped-avatar bug). Fall through to the stored asset_path for them.
  if (!STYLE_COST[style] || !['male', 'female'].includes(gender)) return null;
  return `skins/avatars/${gender}/${folder}/${folder}_${style}.png`;
}

function resolveCanonicalAvatarImagePath(row) {
  const rel = canonicalAvatarAssetPath(row);
  return rel ? assetPath(rel) : resolveAvatarImagePath(row);
}

function resolveDefaultClassAvatarPath(className) {
  return resolveAvatarImagePath(defaultClassAvatar(className));
}

function withPricing(row) {
  if (!row || row.is_default) return row;
  return { ...row, token_cost: STYLE_COST[row.style] || Number(row.token_cost) || 0 };
}

function titleCase(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function seedRows() {
  const rows = [];
  for (const cls of SEED_CLASSES) {
    for (const gender of SEED_GENDERS) {
      for (const style of SEED_STYLES) {
        const avatarId = avatarShortId({ style, gender });
        rows.push({
          avatar_key: `${cls.folder}_${avatarId}`,
          display_name: `${titleCase(style)} ${titleCase(gender)} Avatar`,
          class_name: cls.name,
          gender,
          style,
          token_cost: STYLE_COST[style],
          asset_path: `skins/avatars/${gender}/${cls.folder}/${cls.folder}_${style}.png`,
        });
      }
    }
  }
  rows.push(...TESTER_AVATAR_VARIANTS.map((row) => ({ ...row })));
  return rows;
}

function avatarShortId(row) {
  if (!row || row.is_default) return 'default';
  const s = String(row.style || '').charAt(0).toLowerCase();
  const g = String(row.gender || '').charAt(0).toLowerCase();
  return `${s}${g}`;
}

function displayName(row) {
  if (!row || row.is_default) return row?.display_name || 'Default Avatar';
  // Founder/tester are genderless single-set avatars — use their stored name.
  if (isGrantOnlyAvatarRow(row)) return row.display_name || `${titleCase(row.style)} Avatar`;
  const style = STYLE_LABEL[row.style] || titleCase(row.style);
  const gender = GENDER_LABEL[row.gender] || titleCase(row.gender);
  return `${style} ${gender} Avatar`;
}

async function ensureDefaultCatalog(db) {
  if (catalogSeedAttempted) return;
  catalogSeedAttempted = true;
  const rows = seedRows();
  try {
    for (const row of rows) {
      await db.query(
        `INSERT INTO avatar_catalog
           (avatar_key, display_name, class_name, gender, style, token_cost, asset_path, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
         ON CONFLICT (avatar_key)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           class_name = EXCLUDED.class_name,
           gender = EXCLUDED.gender,
           style = EXCLUDED.style,
           token_cost = EXCLUDED.token_cost,
           asset_path = EXCLUDED.asset_path,
           is_active = TRUE,
           updated_at = NOW()`,
        [row.avatar_key, row.display_name, row.class_name, row.gender, row.style, row.token_cost, row.asset_path]
      );
    }
    for (const cls of SEED_CLASSES) {
      for (const gender of SEED_GENDERS) {
        for (const style of SEED_STYLES) {
          await db.query(
            `UPDATE avatar_catalog
                SET is_active = FALSE, updated_at = NOW()
              WHERE avatar_key = $1`,
            [`${cls.folder}_${gender}_${style}`]
          );
        }
      }
    }
  } catch (err) {
    if (!isMissingAvatarTable(err)) throw err;
  }
}

async function getCharacter(pool, userId) {
  const res = await pool.query('SELECT class FROM user_character WHERE discord_id = $1', [userId]);
  return res.rows[0] || null;
}

async function queryClassAvatars(db, className, { purchasableOnly = false } = {}) {
  const shopFilter = purchasableOnly ? 'AND token_cost > 0' : '';
  const res = await db.query(
    `SELECT avatar_id, avatar_key, display_name, class_name, gender, style, token_cost, asset_path
       FROM avatar_catalog
      WHERE is_active = TRUE
        AND lower(class_name) = lower($1)
        ${shopFilter}
      ORDER BY
        COALESCE(CASE style WHEN 'cyber' THEN 1 WHEN 'anime' THEN 2 WHEN 'webtoon' THEN 3 ELSE 99 END, 99),
        COALESCE(CASE gender WHEN 'male' THEN 1 WHEN 'female' THEN 2 ELSE 99 END, 99),
        display_name ASC,
        avatar_key ASC`,
    [className]
  );
  return res.rows.map(withPricing);
}

async function getEquippedAvatarId(db, userId, className) {
  const res = await db.query(
    `SELECT ac.avatar_id
       FROM equipped_avatars ea
       JOIN avatar_catalog ac ON ac.avatar_id = ea.avatar_id
      WHERE ea.discord_id = $1
        AND ac.is_active = TRUE
        AND lower(ac.class_name) = lower($2)`,
    [userId, className]
  );
  return res.rows[0]?.avatar_id || null;
}

async function getOwnedAvatarIds(db, userId, className) {
  if (isAvatarDevAccount(userId)) {
    const all = await queryClassAvatars(db, className);
    return new Set(all.map((row) => Number(row.avatar_id)));
  }
  const res = await db.query(
    `SELECT ua.avatar_id
       FROM user_avatars ua
       JOIN avatar_catalog ac ON ac.avatar_id = ua.avatar_id
      WHERE ua.discord_id = $1
        AND ac.is_active = TRUE
        AND lower(ac.class_name) = lower($2)`,
    [userId, className]
  );
  return new Set(res.rows.map((row) => Number(row.avatar_id)));
}

/**
 * Grant a dev account REAL ownership rows for every active avatar of its class
 * (class is the ONLY restriction). Idempotent — safe to call on any read path.
 * No-op for non-dev accounts. This replaces reliance on the env-gated virtual
 * dev unlock so equipped-avatar rendering (crd stats) and collection ownership
 * are consistent for dev accounts regardless of environment flags.
 */
async function ensureDevAvatarOwnership(db, userId, className) {
  if (!isDevAccountId(userId)) return;
  const canonical = normalizeClass(className) || className;
  if (!canonical) return;
  try {
    await ensureDefaultCatalog(db);
    await db.query(
      `INSERT INTO user_avatars (discord_id, avatar_id, source, acquired_at)
       SELECT $1, ac.avatar_id, 'dev', NOW()
         FROM avatar_catalog ac
        WHERE ac.is_active = TRUE
          AND lower(ac.class_name) = lower($2)
       ON CONFLICT (discord_id, avatar_id) DO NOTHING`,
      [userId, canonical]
    );
  } catch (err) {
    if (!isMissingAvatarTable(err)) throw err;
  }
}

async function buildRows(pool, userId, mode) {
  const character = await getCharacter(pool, userId);
  if (!character) return { className: null, rows: [], ownedIds: new Set(), equippedId: null };
  const className = normalizeClass(character.class) || character.class;
  const fallback = defaultClassAvatar(className);
  try {
    await ensureDefaultCatalog(pool);
    // Dev accounts own every avatar of their class (idempotent, class-only).
    await ensureDevAvatarOwnership(pool, userId, className);
    const [catalogRows, ownedIds, equippedId] = await Promise.all([
      queryClassAvatars(pool, className, { purchasableOnly: mode === 'shop' }),
      getOwnedAvatarIds(pool, userId, className),
      getEquippedAvatarId(pool, userId, className),
    ]);
    const rows = mode === 'collection'
      ? [fallback, ...catalogRows.filter((row) => ownedIds.has(Number(row.avatar_id)))]
      // Shop: only positive-cost catalog rows; founder/tester remain grant-only.
      : catalogRows.filter((row) => !isGrantOnlyAvatarRow(row));
    return { className, rows, ownedIds, equippedId, devUnlocked: isAvatarDevAccount(userId) };
  } catch (err) {
    if (!isMissingAvatarTable(err)) throw err;
    return { className, rows: [fallback], ownedIds: new Set(), equippedId: null, devUnlocked: false, missingSchema: true };
  }
}

function marker(row, ownedIds, equippedId) {
  if (row.is_default) return equippedId ? 'Available' : 'Equipped';
  if (Number(row.avatar_id) === Number(equippedId)) return 'Equipped';
  if (ownedIds.has(Number(row.avatar_id))) return 'Owned';
  return `${row.token_cost} supporter tokens`;
}

function formatRow(row, ownedIds, equippedId, mode) {
  if (row.is_default) return `-# \`default\` :frame_photo: **Default Avatar** | ${marker(row, ownedIds, equippedId)}`;
  const id = avatarShortId(row);
  const name = displayName(row);
  // Token price is shop-only; the collection shows ownership status instead.
  if (mode === 'shop') return `-# ${iconToken()} ${row.token_cost} | \`${id}\` | :frame_photo: **${name}**`;
  return `-# \`${id}\` | :frame_photo: **${name}** | ${marker(row, ownedIds, equippedId)}`;
}

function pagePayload(state, userId, page, mode) {
  const rows = state.rows || [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.max(0, Math.min(page || 0, pageCount - 1));
  const shown = rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const title = mode === 'shop' ? `${iconShop()} Supporter Shop` : `${iconShop()} Avatar Collection`;
  const empty = mode === 'shop'
    ? `No shop avatars are cataloged yet for **${state.className}**.`
    : `No owned shop avatars yet for **${state.className}**. Your default class avatar is always available.`;
  const hint = mode === 'shop'
    ? 'Use `crd avatar buy <id>` then `crd avatar equip <id>`.'
    : 'Use `crd avatar equip <id>` or `crd avatar default`.';
  const body = shown.length
    ? shown.map((row) => formatRow(row, state.ownedIds, state.equippedId, mode)).join('\n')
    : empty;

  const container = new ContainerBuilder()
    .setAccentColor(BRAND)
    .addTextDisplayComponents((td) => td.setContent(`## ${title}`))
    .addTextDisplayComponents((td) => td.setContent(
      mode === 'shop'
        ? '-# Browse all supporter avatars for your current class. Spend supporter tokens to claim, then equip it.'
        : '-# Browse your owned avatars for your current class. Equip an avatar to show it on stats.'
    ))
    .addTextDisplayComponents((td) => td.setContent(`-# Page **${safePage + 1}/${pageCount}** · ${state.className || 'No Character'} Avatars`))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(body))
    .addSeparatorComponents(sep)
    .addTextDisplayComponents((td) => td.setContent(`-# ${hint}`));

  if (state.missingSchema) {
    container.addTextDisplayComponents((td) =>
      td.setContent('-# Avatar tables are not installed yet; only the default class avatar can be shown.')
    );
  } else if (state.devUnlocked) {
    container.addTextDisplayComponents((td) =>
      td.setContent('-# Developer unlock is active on this non-production environment.')
    );
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`avat:${mode}:${userId}:${safePage - 1}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`avat:${mode}:${userId}:${safePage + 1}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= pageCount - 1)
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

async function buildAvatarPage(pool, userId, { page = 0, mode = 'collection' } = {}) {
  const state = await buildRows(pool, userId, mode);
  return pagePayload(state, userId, page, mode);
}

async function getAvatarByKey(db, key, className = null) {
  await ensureDefaultCatalog(db);
  const code = String(key || '').trim().toLowerCase();
  const classFilter = className
    ? 'AND lower(class_name) = lower($2)'
    : '';
  const params = className ? [code, className] : [code];
  const res = await db.query(
    `SELECT avatar_id, avatar_key, display_name, class_name, gender, style, token_cost, asset_path
       FROM avatar_catalog
      WHERE (
          lower(avatar_key) = lower($1)
          OR lower(right(avatar_key, 2)) = lower($1)
          OR lower(left(style, 1) || left(gender, 1)) = lower($1)
        )
        ${classFilter}
        AND is_active = TRUE`,
    params
  );
  return withPricing(res.rows[0] || null);
}

async function ownsAvatar(db, userId, avatarId, className) {
  if (isAvatarDevAccount(userId)) return true;
  const res = await db.query(
    `SELECT 1
       FROM user_avatars ua
       JOIN avatar_catalog ac ON ac.avatar_id = ua.avatar_id
      WHERE ua.discord_id = $1
        AND ua.avatar_id = $2
        AND ac.is_active = TRUE
        AND lower(ac.class_name) = lower($3)`,
    [userId, avatarId, className]
  );
  return res.rowCount > 0;
}

async function equipAvatarTx(client, userId, avatarId) {
  await client.query(
    `INSERT INTO equipped_avatars (discord_id, avatar_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (discord_id)
     DO UPDATE SET avatar_id = EXCLUDED.avatar_id, updated_at = NOW()`,
    [userId, avatarId]
  );
}

async function clearEquippedAvatar(db, userId) {
  await db.query('DELETE FROM equipped_avatars WHERE discord_id = $1', [userId]);
}

async function resolveStatsAvatar(pool, userId, className, logContext = {}) {
  const canonical = normalizeClass(className) || className;
  const fallback = defaultClassAvatar(canonical);
  try {
    // Dev accounts own every avatar of their class (idempotent, class-only) so the
    // equipped avatar resolves as owned here regardless of the env dev-unlock flag.
    await ensureDevAvatarOwnership(pool, userId, canonical);
    const res = await pool.query(
      `SELECT ac.avatar_id, ac.asset_path, ac.avatar_key, ac.class_name, ac.gender, ac.style,
              (ua.avatar_id IS NOT NULL) AS owned
         FROM equipped_avatars ea
         JOIN avatar_catalog ac ON ac.avatar_id = ea.avatar_id
         LEFT JOIN user_avatars ua
           ON ua.discord_id = ea.discord_id
          AND ua.avatar_id = ea.avatar_id
        WHERE ea.discord_id = $1
          AND ac.is_active = TRUE
          AND lower(ac.class_name) = lower($2)`,
      [userId, canonical]
    );
    const equipped = res.rows[0] || null;
    const canUseEquipped = equipped && (isAvatarDevAccount(userId) || isDevAccountId(userId) || equipped.owned);
    const selected = canUseEquipped ? equipped : fallback;
    const avatarSource = canUseEquipped ? 'equipped-avatar' : 'class-fallback';
    const fallbackReason = equipped && !canUseEquipped ? 'equipped-avatar-not-owned' : null;
    performanceLog('stats avatar source', {
      ...logContext,
      avatarSource,
      avatarKey: selected.avatar_key,
      assetKey: safeAssetKey(canonicalAvatarAssetPath(selected) || selected.asset_path),
      reason: fallbackReason,
    });
    return resolveCanonicalAvatarImagePath(selected);
  } catch (err) {
    if (!isMissingAvatarTable(err)) throw err;
    performanceLog('stats avatar source', {
      ...logContext,
      avatarSource: 'class-fallback',
      avatarKey: fallback.avatar_key,
      assetKey: safeAssetKey(fallback.asset_path),
      reason: 'avatar-tables-missing',
    });
    return resolveAvatarImagePath(fallback);
  }
}

module.exports = {
  STYLE_COST,
  avatarShortId,
  buildAvatarPage,
  clearEquippedAvatar,
  defaultClassAvatar,
  displayName,
  ensureDevAvatarOwnership,
  equipAvatarTx,
  isDevAccountId,
  getAvatarByKey,
  getCharacter,
  isAvatarDevAccount,
  isGrantOnlyAvatarRow,
  ownsAvatar,
  resolveAvatarImagePath,
  resolveDefaultClassAvatarPath,
  resolveStatsAvatar,
  seedRows,
};

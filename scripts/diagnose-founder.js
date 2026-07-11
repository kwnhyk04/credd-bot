'use strict';

require('dotenv').config();
const pool = require('../src/db/pool');
const { buildShopPage, PAGES } = require('../src/engine/skinShopViews');

async function main() {
  const userId = String(process.argv[2] || '').trim();
  if (!/^\d{17,20}$/.test(userId)) {
    throw new Error('Usage: node scripts/diagnose-founder.js <discord_id>');
  }
  const queries = [
    ['supporter', 'SELECT tier, status, founder_number, token_balance FROM supporters WHERE discord_id = $1', [userId]],
    ['catalog', `SELECT cosmetic_id, cosmetic_key, category, skin_code, is_active,
                        render_filename, victory_filename, defeated_filename
                   FROM cosmetic_catalog
                  WHERE cosmetic_key LIKE 'founder\\_%'
                  ORDER BY category`, []],
    ['owned', `SELECT cc.cosmetic_key, cc.category, cc.skin_code, uc.source
                 FROM user_cosmetics uc
                 JOIN cosmetic_catalog cc USING (cosmetic_id)
                WHERE uc.discord_id = $1
                  AND cc.cosmetic_key LIKE 'founder\\_%'
                ORDER BY cc.category`, [userId]],
    ['equipped', `SELECT es.category, cc.cosmetic_key, es.override_path
                    FROM equipped_skins es
                    LEFT JOIN cosmetic_catalog cc USING (cosmetic_id)
                   WHERE es.discord_id = $1
                   ORDER BY es.category`, [userId]],
    ['avatars', `SELECT ac.avatar_key, ac.class_name, ac.style, ua.source
                   FROM user_avatars ua
                   JOIN avatar_catalog ac USING (avatar_id)
                  WHERE ua.discord_id = $1 AND ac.style = 'founder'
                  ORDER BY ac.class_name`, [userId]],
  ];
  for (const [label, sql, values] of queries) {
    const result = await pool.query(sql, values);
    console.log(`${label}: ${JSON.stringify(result.rows)}`);
  }
  for (let page = 0; page < PAGES.length; page++) {
    const payload = await buildShopPage(pool, userId, { page, ctx: 'coll' });
    const json = payload.components[0].toJSON();
    const content = JSON.stringify(json);
    const founderRows = [...content.matchAll(/Founder [^"\\]+/g)].map((match) => match[0]);
    console.log(`page-${page + 1}-${PAGES[page]}: ${JSON.stringify(founderRows)}`);
  }
  const coverage = await pool.query(
    `WITH expected AS (
       SELECT COUNT(*)::integer AS n
         FROM cosmetic_catalog
        WHERE cosmetic_key LIKE 'founder\\_%' AND is_active = TRUE
     ), founder_counts AS (
       SELECT s.discord_id, COUNT(cc.cosmetic_id)::integer AS owned
         FROM supporters s
         LEFT JOIN user_cosmetics uc ON uc.discord_id = s.discord_id
         LEFT JOIN cosmetic_catalog cc
           ON cc.cosmetic_id = uc.cosmetic_id
          AND cc.cosmetic_key LIKE 'founder\\_%'
          AND cc.is_active = TRUE
        WHERE s.status = 'active'
          AND s.tier IN ('eternal', 'eternal_believer')
        GROUP BY s.discord_id
     )
     SELECT COUNT(*)::integer AS active_founders,
            COUNT(*) FILTER (WHERE owned < expected.n)::integer AS founders_missing_cosmetics,
            expected.n AS expected_cosmetics_each
       FROM founder_counts CROSS JOIN expected
      GROUP BY expected.n`
  );
  console.log(`founder-coverage: ${JSON.stringify(coverage.rows[0] || {})}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

'use strict';

const REQUIRED_COLUMNS = Object.freeze({
  user_deities: Object.freeze(['sigils', 'ascended']),
});

async function verifyRequiredSchema(db) {
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const { rows } = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table]
    );
    const actual = new Set(rows.map((row) => row.column_name));
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(
        `required schema is missing ${missing.map((column) => `${table}.${column}`).join(', ')}; ` +
        'apply scripts/migrations/20260711_add_deity_ascension_progress.sql'
      );
    }
  }
}

module.exports = { REQUIRED_COLUMNS, verifyRequiredSchema };

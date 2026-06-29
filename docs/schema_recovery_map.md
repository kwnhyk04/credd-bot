# Schema Recovery Map

This project currently has a baseline schema file plus additive versioned SQL files:

- `credd_schema_v4.sql` is the oldest full create-table baseline in the repo.
- `version 5/*.sql` contains additive patches, feature migrations, indexes, and later runtime tables.

Do not treat any single file as a complete production restore script yet. For production recovery,
start from the baseline, then apply reviewed version files in chronological order to a clean test
database first, compare the resulting schema against production, and only then apply missing
additive steps to production.

## Current Order

Recommended reconstruction order from the files currently present:

1. `credd_schema_v4.sql`
2. `version 5/credd_schema_v5_migration.sql`
3. `version 5/credd_schema_v5b_runes_seasons.sql`
4. `version 5/credd_schema_v5c_bathala_cap.sql`
5. `version 5/credd_schema_v5d_rune_bags.sql`
6. `version 5/credd_schema_v5e_dynamic_rune_values.sql`
7. `version 5/credd_schema_v5_phase3.sql`
8. `version 5/credd_schema_v5_phase4.sql`
9. `version 5/credd_schema_v5_phase4_indexes.sql`
10. `version 5/credd_schema_v5_phase5.sql`
11. `version 5/credd_schema_v5_phase5b.sql`
12. `version 5/credd_schema_v5_phase6.sql`
13. `version 5/credd_schema_v6_mob_retune.sql`
14. `version 5/credd_schema_v7_auto_raid.sql`
15. `version 5/credd_schema_v8_active_ranked_fights.sql`
16. `version 5/credd_schema_v9_supporter_founder_sequence.sql`

## Production Recommendation

Before the next schema phase, add a canonical migration workflow:

- Keep immutable migration files in one ordered directory.
- Add a `schema_migrations` ledger table recording filename, checksum, applied time, and operator.
- Split data seeds from schema migrations.
- Mark migrations as additive, data-changing, or destructive in a header comment.
- Require destructive migrations to be manually approved and never run automatically.
- Generate a current full schema snapshot from a verified migrated database for disaster recovery.

This document is only a map. It does not replace live database inspection before production work.

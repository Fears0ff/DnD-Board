import type { Migration } from "./types";
import m0001 from "./0001-core";
import m0002 from "./0002-game";

/**
 * All migrations in apply order. Versions must be unique and monotonically
 * increasing; db/migrate.ts applies exactly the ones missing from
 * schema_migrations, each in its own transaction.
 */
export const migrations: Migration[] = [m0001, m0002];

for (let i = 1; i < migrations.length; i++) {
  if (migrations[i - 1].version >= migrations[i].version) {
    throw new Error(
      `Migrations are not strictly ordered: ${migrations[i - 1].version} !< ${migrations[i].version}`,
    );
  }
}

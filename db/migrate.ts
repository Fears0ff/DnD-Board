import type BetterSqlite3 from "better-sqlite3";
import { migrations as defaultMigrations } from "./migrations";
import type { Migration } from "./migrations/types";

export type SqliteDatabase = BetterSqlite3.Database;

export interface MigrateResult {
  /** Versions applied during this call, in apply order. */
  applied: string[];
  /** Versions already present before this call. */
  alreadyApplied: string[];
}

/**
 * Versioned migration runner.
 *
 * Applied versions are recorded in the `schema_migrations` table; each
 * pending migration runs inside its own transaction together with its
 * bookkeeping row, so a failing migration rolls back cleanly and the server
 * can refuse to boot (the caller decides: an exception here must block
 * startup, see api/boot.ts).
 *
 * Both paths are exercised by tests/integration/migrations.test.ts:
 *   - fresh: empty file gets every migration in order;
 *   - upgrade: a fixture DB with an older subset applied gains only the
 *     missing ones without losing data.
 */
export function migrate(
  db: SqliteDatabase,
  migrations: Migration[] = defaultMigrations,
): MigrateResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const rows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: string }>;
  const applied = new Set(rows.map((r) => r.version));
  const alreadyApplied = migrations
    .filter((m) => applied.has(m.version))
    .map((m) => m.version);

  const nowApplied: string[] = [];
  const insertRecord = db.prepare(
    "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      insertRecord.run(migration.version, migration.name);
    });
    // better-sqlite3 transactions are synchronous: when this returns, the
    // migration is committed; when it throws, nothing was applied.
    run();
    nowApplied.push(migration.version);
  }

  return { applied: nowApplied, alreadyApplied };
}

export function appliedVersions(db: SqliteDatabase): string[] {
  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    )
    .get() as { name: string } | undefined;
  if (!table) return [];
  const rows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: string }>;
  return rows.map((r) => r.version);
}

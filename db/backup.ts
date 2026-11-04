import fs from "node:fs";
import path from "node:path";
import type { Migration } from "./migrations/types";
import { appliedVersions, type SqliteDatabase } from "./migrate";

const BACKUP_PREFIX = "dnd-board-before-migration-";

function hasUserTables(db: SqliteDatabase): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .get() as { count: number };
  return row.count > 0;
}

/**
 * Keep a consistent pre-migration snapshot for desktop upgrades. VACUUM INTO
 * includes committed WAL content and produces one self-contained SQLite file.
 */
export function backupBeforeMigration(
  db: SqliteDatabase,
  backupDirectory: string | undefined,
  migrations: Migration[],
): string | null {
  if (!backupDirectory || !hasUserTables(db)) return null;
  const applied = new Set(appliedVersions(db));
  if (migrations.every((migration) => applied.has(migration.version))) {
    return null;
  }

  fs.mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const destination = path.join(
    path.resolve(backupDirectory),
    `${BACKUP_PREFIX}${timestamp}-${crypto.randomUUID().slice(0, 8)}.db`,
  );
  db.prepare("VACUUM INTO ?").run(destination);

  const backups = fs
    .readdirSync(backupDirectory)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(".db"))
    .sort()
    .reverse();
  for (const obsolete of backups.slice(5)) {
    fs.rmSync(path.join(backupDirectory, obsolete), { force: true });
  }
  return destination;
}

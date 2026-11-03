import fs from "node:fs";
import path from "node:path";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import * as schema from "./schema";
import { migrate, type SqliteDatabase } from "./migrate";

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: SqliteDatabase;
};

/**
 * Structural subset satisfied both by the connection and by a sync
 * better-sqlite3 transaction handle, so repositories and service helpers can
 * run inside or outside a transaction without casts.
 */
export type DbHandle = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete"
>;

/**
 * better-sqlite3 is a native module: it must NOT be bundled by esbuild (the
 * production build is `esbuild api/boot.ts --bundle`). A computed import
 * specifier keeps the bundler from resolving it, so it is loaded from
 * node_modules at runtime in every mode (dev SSR, vitest, bundled prod).
 */
const driverSpecifier = "better-sqlite3";
const { default: Database } = (await import(driverSpecifier)) as {
  default: typeof BetterSqlite3;
};

export function openSqlite(file: string): SqliteDatabase {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Open (or create) a database file, apply pending migrations and hand the
 * ready connection to Drizzle. Migrations failing here throw before any
 * query is served — a database that could not be migrated must not boot.
 */
export function createAppDatabase(file: string): AppDatabase {
  const sqlite = openSqlite(file);
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

export function defaultDatabaseFile(): string {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  if (process.env.NODE_ENV === "production") {
    return path.join(import.meta.dirname, "data", "dnd-board.db");
  }
  return path.join("data", "dnd-board.db");
}

let singleton: AppDatabase | null = null;

/** Shared application connection (lazy; migrates on first use). */
export function getDb(): AppDatabase {
  if (!singleton) {
    singleton = createAppDatabase(defaultDatabaseFile());
  }
  return singleton;
}

/** Raw better-sqlite3 handle behind the shared Drizzle instance. */
export function getSqlite(): SqliteDatabase {
  return getDb().$client;
}

/**
 * Test hook: integration tests swap in an isolated temporary database.
 * Passing null restores the default lazy behaviour.
 */
export function setDbForTests(db: AppDatabase | null): void {
  if (singleton && singleton !== db) {
    try {
      singleton.$client.close();
    } catch {
      // already closed; ignore
    }
  }
  singleton = db;
}

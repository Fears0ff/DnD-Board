import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appliedVersions, migrate } from "../../db/migrate";
import { openSqlite, type AppDatabase } from "../../db/connection";
import { migrations } from "../../db/migrations";
import { teardownTempDb, useTempDb, type TestDb } from "./helpers";

let testDb: TestDb;

beforeEach(() => {
  testDb = useTempDb();
});

afterEach(() => {
  teardownTempDb(testDb);
});

function tableNames(db: AppDatabase): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe("migration runner", () => {
  it("creates a fresh database with the full schema", () => {
    const tables = tableNames(testDb.db);
    for (const expected of [
      "schema_migrations",
      "users",
      "app_meta",
      "media_assets",
      "boards",
      "tokens",
      "characters",
      "notes",
      "compendium_items",
    ]) {
      expect(tables).toContain(expected);
    }
    expect(tables).not.toContain("tables"); // no such entity by design

    expect(appliedVersions(testDb.db.$client)).toEqual(["0001", "0002"]);

    const meta = testDb.db.$client
      .prepare("SELECT game_revision, compendium_revision FROM app_meta WHERE id = 1")
      .get() as { game_revision: number; compendium_revision: number };
    expect(meta.game_revision).toBe(0);
    expect(meta.compendium_revision).toBe(0);

    const fk = testDb.db.$client.pragma("foreign_keys", {
      simple: true,
    }) as number;
    expect(fk).toBe(1);
  });

  it("is idempotent: re-running migrations applies nothing", () => {
    const result = migrate(testDb.db.$client);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toEqual(["0001", "0002"]);
  });

  it("upgrades a fixture database without losing existing data", () => {
    // Fixture: a database where only the first (core) migration was applied.
    // Open the raw connection directly so no auto-migration runs.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-board-fixture-"));
    const sqlite = openSqlite(path.join(dir, "fixture.db"));
    try {
      migrate(sqlite, [migrations[0]]);
      expect(appliedVersions(sqlite)).toEqual(["0001"]);
      const tables = () =>
        (
          sqlite
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            )
            .all() as Array<{ name: string }>
        ).map((r) => r.name);
      expect(tables()).toContain("users");
      expect(tables()).not.toContain("boards");

      sqlite
        .prepare(
          `INSERT INTO users (union_id, login_normalized, display_name, password_hash, game_role, created_at, updated_at)
           VALUES ('local:legacy', 'legacy', 'Legacy User', 'hash', 'master', 1, 1)`,
        )
        .run();

      // Upgrade path: apply the remaining migrations.
      const result = migrate(sqlite);
      expect(result.applied).toEqual(["0002"]);
      expect(result.alreadyApplied).toEqual(["0001"]);
      expect(appliedVersions(sqlite)).toEqual(["0001", "0002"]);

      // Data survived the upgrade.
      const user = sqlite
        .prepare("SELECT login_normalized, game_role FROM users WHERE id = 1")
        .get() as { login_normalized: string; game_role: string };
      expect(user).toEqual({ login_normalized: "legacy", game_role: "master" });
      expect(tables()).toContain("boards");

      // The upgraded database accepts writes that rely on the new schema.
      sqlite
        .prepare(
          `INSERT INTO boards (name, cell_size, grid_width, grid_height, initiative, is_active, created_at, updated_at)
           VALUES ('b', 64, 30, 20, '[]', 1, 2, 2)`,
        )
        .run();
      const active = sqlite
        .prepare("SELECT COUNT(*) AS n FROM boards WHERE is_active = 1")
        .get() as { n: number };
      expect(active.n).toBe(1);
    } finally {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failing migration and records nothing", () => {
    const sqlite = openSqlite(":memory:");
    try {
      const bad = {
        version: "9999",
        name: "broken",
        sql: "CREATE TABLE ok_table (id INTEGER); THIS IS NOT SQL;",
      };
      expect(() => migrate(sqlite, [bad])).toThrow();
      expect(appliedVersions(sqlite)).toEqual([]);
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ok_table'",
        )
        .all();
      expect(tables).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("enforces the single-active-board invariant at the database level", () => {
    testDb.db.$client
      .prepare(
        `INSERT INTO boards (name, cell_size, grid_width, grid_height, initiative, is_active, created_at, updated_at)
         VALUES ('a', 64, 30, 20, '[]', 1, 1, 1)`,
      )
      .run();
    expect(() =>
      testDb.db.$client
        .prepare(
          `INSERT INTO boards (name, cell_size, grid_width, grid_height, initiative, is_active, created_at, updated_at)
           VALUES ('b', 64, 30, 20, '[]', 1, 1, 1)`,
        )
        .run(),
    ).toThrow();
  });

  it("cascades board deletion to tokens", () => {
    const now = Date.now();
    testDb.db.$client
      .prepare(
        `INSERT INTO boards (id, name, cell_size, grid_width, grid_height, initiative, is_active, created_at, updated_at)
         VALUES (1, 'a', 64, 30, 20, '[]', 1, ${now}, ${now})`,
      )
      .run();
    testDb.db.$client
      .prepare(
        `INSERT INTO tokens (board_id, kind, label, cell_x, cell_y, hp, max_hp, size, created_at, updated_at)
         VALUES (1, 'hero', 't', 0, 0, 5, 10, 1, ${now}, ${now})`,
      )
      .run();
    testDb.db.$client.prepare("DELETE FROM boards WHERE id = 1").run();
    const tokens = testDb.db.$client
      .prepare("SELECT COUNT(*) AS n FROM tokens")
      .get() as { n: number };
    expect(tokens.n).toBe(0);
  });
});

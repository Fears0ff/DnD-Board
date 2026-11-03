import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { appliedVersions, migrate } from "../../db/migrate";
import { migrations } from "../../db/migrations";

const tempDirs: string[] = [];

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-board-migrations-"));
  tempDirs.push(dir);
  return path.join(dir, "test.db");
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("migrations", () => {
  it("fresh database gets every migration in order", () => {
    const db = new Database(tempDbFile());
    const result = migrate(db);
    expect(result.alreadyApplied).toEqual([]);
    expect(result.applied).toEqual(migrations.map((m) => m.version));
    expect(appliedVersions(db)).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  it("upgrade path applies only the missing migrations and keeps data", () => {
    const file = tempDbFile();
    const db = new Database(file);

    // Simulate an older installation: only the first migration applied.
    migrate(db, migrations.slice(0, 1));
    db.prepare(
      "INSERT INTO users (union_id, login_normalized, display_name, password_hash, game_role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("local:alice", "alice", "Alice", "hash", "master", 1, 1);

    const result = migrate(db);
    expect(result.applied).toEqual(
      migrations.slice(1).map((m) => m.version),
    );
    expect(result.alreadyApplied).toEqual([migrations[0].version]);

    // Data survived the upgrade.
    const user = db
      .prepare("SELECT login_normalized FROM users WHERE id = 1")
      .get() as { login_normalized: string };
    expect(user.login_normalized).toBe("alice");

    // New tables exist now.
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
    expect(tables).toContain("boards");
    expect(tables).toContain("tokens");
    db.close();
  });

  it("running migrate twice is a no-op", () => {
    const db = new Database(tempDbFile());
    migrate(db);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(migrations.map((m) => m.version));
    db.close();
  });

  it("a failing migration rolls back and leaves the version unrecorded", () => {
    const db = new Database(tempDbFile());
    const broken = [
      {
        version: "0001",
        name: "creates-t",
        sql: "CREATE TABLE t (id INTEGER PRIMARY KEY);",
      },
      { version: "0002", name: "broken", sql: "THIS IS NOT SQL;" },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(appliedVersions(db)).toEqual(["0001"]);
    // The failed migration created nothing.
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='does_not_exist'",
      )
      .get();
    expect(row).toBeUndefined();
    db.close();
  });
});

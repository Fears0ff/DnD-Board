import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupBeforeMigration } from "../../db/backup";
import { openSqlite } from "../../db/connection";
import { appliedVersions, migrate } from "../../db/migrate";
import { migrations } from "../../db/migrations";

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-board-backup-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("desktop pre-migration backups", () => {
  it("captures restorable committed data before a pending migration", () => {
    const sqlite = openSqlite(path.join(directory, "game.db"));
    try {
      migrate(sqlite, [migrations[0]]);
      sqlite
        .prepare(
          `INSERT INTO users (union_id, login_normalized, display_name, password_hash, game_role, created_at, updated_at)
           VALUES ('local:legacy', 'legacy', 'Legacy', 'hash', 'master', 1, 1)`,
        )
        .run();

      const backupDirectory = path.join(directory, "backups");
      const backup = backupBeforeMigration(sqlite, backupDirectory, migrations);
      expect(backup && fs.existsSync(backup)).toBe(true);
      expect(appliedVersions(sqlite)).toEqual(["0001"]);

      const restored = openSqlite(backup!);
      try {
        expect(restored.prepare("SELECT display_name FROM users").get()).toEqual({
          display_name: "Legacy",
        });
        expect(
          restored
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'")
            .get(),
        ).toBeUndefined();
      } finally {
        restored.close();
      }

      migrate(sqlite);
      expect(backupBeforeMigration(sqlite, backupDirectory, migrations)).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  it("retains only the latest five snapshots", () => {
    const sqlite = openSqlite(path.join(directory, "game.db"));
    const backupDirectory = path.join(directory, "backups");
    try {
      migrate(sqlite, [migrations[0]]);
      for (let index = 0; index < 7; index += 1) {
        expect(backupBeforeMigration(sqlite, backupDirectory, migrations)).not.toBeNull();
      }
      expect(fs.readdirSync(backupDirectory).filter((name) => name.endsWith(".db"))).toHaveLength(5);
    } finally {
      sqlite.close();
    }
  });

  it("does not create a backup for a brand-new empty database", () => {
    const sqlite = openSqlite(path.join(directory, "new.db"));
    try {
      expect(
        backupBeforeMigration(sqlite, path.join(directory, "backups"), migrations),
      ).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});

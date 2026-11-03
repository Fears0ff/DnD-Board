import type { Migration } from "./types";

/**
 * 0001 core: users + app_meta singleton.
 * Applied transactionally by db/migrate.ts; keep in sync with db/schema.ts.
 */
const migration: Migration = {
  version: "0001",
  name: "core",
  sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  union_id TEXT NOT NULL UNIQUE,
  login_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  game_role TEXT NOT NULL DEFAULT 'player',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT users_game_role CHECK (game_role IN ('master','player'))
);

CREATE TABLE app_meta (
  id INTEGER PRIMARY KEY,
  game_revision INTEGER NOT NULL DEFAULT 0,
  compendium_revision INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT app_meta_singleton CHECK (id = 1)
);

INSERT INTO app_meta (id, game_revision, compendium_revision) VALUES (1, 0, 0);
`,
};

export default migration;

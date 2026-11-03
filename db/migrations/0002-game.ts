import type { Migration } from "./types";

/**
 * 0002 game: media assets, boards, characters, compendium items, tokens,
 * notes. All FK actions (cascade / set null) and invariants (single active
 * board, hp bounds, exclusive token refs) are declared here explicitly.
 */
const migration: Migration = {
  version: "0002",
  name: "game",
  sql: `
CREATE TABLE media_assets (
  key TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CONSTRAINT media_backend CHECK (backend IN ('local','platform'))
);
CREATE INDEX media_assets_uploaded_by_idx ON media_assets (uploaded_by);

CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  background_key TEXT REFERENCES media_assets(key) ON DELETE SET NULL,
  cell_size INTEGER NOT NULL DEFAULT 64,
  grid_width INTEGER NOT NULL DEFAULT 30,
  grid_height INTEGER NOT NULL DEFAULT 20,
  initiative TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT boards_grid_bounds CHECK (
    grid_width BETWEEN 1 AND 500
    AND grid_height BETWEEN 1 AND 500
    AND cell_size BETWEEN 4 AND 1024
  )
);
-- At most one active board.
CREATE UNIQUE INDEX boards_single_active ON boards (is_active) WHERE is_active = 1;

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX characters_owner_idx ON characters (owner_id);

CREATE TABLE compendium_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  is_magic INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  image_key TEXT REFERENCES media_assets(key) ON DELETE SET NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT compendium_type CHECK (
    type IN ('spell','item','monster','character','species','class','feat','background')
  ),
  CONSTRAINT compendium_visibility CHECK (visibility IN ('private','shared'))
);
CREATE INDEX compendium_type_idx ON compendium_items (type);
CREATE INDEX compendium_visibility_idx ON compendium_items (visibility);
CREATE INDEX compendium_created_by_idx ON compendium_items (created_by);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'prop',
  label TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  compendium_id INTEGER REFERENCES compendium_items(id) ON DELETE SET NULL,
  cell_x INTEGER NOT NULL DEFAULT 0,
  cell_y INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 0,
  max_hp INTEGER NOT NULL DEFAULT 0,
  size REAL NOT NULL DEFAULT 1,
  image_key TEXT REFERENCES media_assets(key) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT tokens_kind CHECK (kind IN ('hero','monster','prop')),
  CONSTRAINT tokens_hp_bounds CHECK (hp >= 0 AND max_hp >= 0 AND hp <= max_hp),
  CONSTRAINT tokens_refs_exclusive CHECK (
    NOT (character_id IS NOT NULL AND compendium_id IS NOT NULL)
  ),
  CONSTRAINT tokens_compendium_image CHECK (
    NOT (compendium_id IS NOT NULL AND image_key IS NOT NULL)
  )
);
CREATE INDEX tokens_board_idx ON tokens (board_id);
CREATE INDEX tokens_owner_idx ON tokens (owner_id);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_user_idx ON notes (user_id);
`,
};

export default migration;

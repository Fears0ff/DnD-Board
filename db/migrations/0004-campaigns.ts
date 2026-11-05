import type { Migration } from "./types";

/**
 * Existing boards move into a default active campaign without changing what
 * players see. SQLite keeps the default for compatibility with old raw writes;
 * application code always supplies campaignId explicitly.
 */
const migration: Migration = {
  version: "0004",
  name: "campaigns",
  sql: `
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX campaigns_single_active ON campaigns (is_active) WHERE is_active = 1;

INSERT INTO campaigns (id, name, is_active, created_at, updated_at)
VALUES (1, 'Основная кампания', 1, 0, 0);

ALTER TABLE boards ADD COLUMN campaign_id INTEGER NOT NULL DEFAULT 1
  REFERENCES campaigns(id) ON DELETE CASCADE;
CREATE INDEX boards_campaign_idx ON boards (campaign_id);
`,
};

export default migration;

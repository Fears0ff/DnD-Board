import type { Migration } from "./types";

/** Invisible master-only tokens and explicit read-only note recipients. */
const migration: Migration = {
  version: "0003",
  name: "sharing-and-visibility",
  sql: `
ALTER TABLE tokens ADD COLUMN invisible INTEGER NOT NULL DEFAULT 0;

CREATE TABLE note_shares (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX note_shares_user_idx ON note_shares (user_id);
`,
};

export default migration;

import type { Migration } from "./types";

/** Persistent character portraits backed by the shared media asset store. */
const migration: Migration = {
  version: "0005",
  name: "character-portraits",
  sql: `
ALTER TABLE characters ADD COLUMN portrait_key TEXT
  REFERENCES media_assets(key) ON DELETE SET NULL;
`,
};

export default migration;

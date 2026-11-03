import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle-kit is used to diff/generate SQL from db/schema.ts. The runtime
 * migration runner (db/migrate.ts) applies the embedded migrations from
 * db/migrations/*.ts into schema_migrations — generated SQL should be folded
 * into a new numbered migration there, never applied out of band.
 */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? "./data/dnd-board.db",
  },
});

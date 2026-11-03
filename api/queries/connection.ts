// The platform template entrypoint for DB access. The real implementation
// lives in db/connection.ts (better-sqlite3 + Drizzle + migrations); this
// module only re-exports it so existing imports keep working.
export {
  createAppDatabase,
  defaultDatabaseFile,
  getDb,
  getSqlite,
  openSqlite,
  setDbForTests,
  type AppDatabase,
} from "../../db/connection";

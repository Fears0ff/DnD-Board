import { getDb } from "../api/queries/connection";

// No seed data in v1: the first registered user becomes the master, boards
// and tokens are created through the UI. This script just verifies that the
// database opens and migrations apply cleanly.
async function seed() {
  getDb();
  console.log("Database is ready (migrations applied, no seed data needed).");
}

seed();

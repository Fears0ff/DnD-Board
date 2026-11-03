import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import { appMeta } from "../../db/schema";

type Db = DbHandle;

export function getGameRevision(db: Db): number {
  const row = db.select().from(appMeta).where(eq(appMeta.id, 1)).get();
  return row?.gameRevision ?? 0;
}

export function getCompendiumRevision(db: Db): number {
  const row = db.select().from(appMeta).where(eq(appMeta.id, 1)).get();
  return row?.compendiumRevision ?? 0;
}

/**
 * Increments and returns the game revision. Must be called inside the same
 * transaction as the mutation it versions, so a rollback also rolls back
 * the revision bump; the WS notification is published only after commit.
 */
export function bumpGameRevision(db: Db): number {
  db.update(appMeta)
    .set({ gameRevision: sql`${appMeta.gameRevision} + 1` })
    .where(eq(appMeta.id, 1))
    .run();
  return getGameRevision(db);
}

export function bumpCompendiumRevision(db: Db): number {
  db.update(appMeta)
    .set({ compendiumRevision: sql`${appMeta.compendiumRevision} + 1` })
    .where(eq(appMeta.id, 1))
    .run();
  return getCompendiumRevision(db);
}

import { and, eq, inArray } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import { characters, compendiumItems } from "../../db/schema";

/** Narrow reads used by token binding; no character/compendium DTO leakage. */
export function findHeroTokenBinding(db: DbHandle, id: number) {
  return db
    .select({
      id: characters.id,
      ownerId: characters.ownerId,
      data: characters.data,
    })
    .from(characters)
    .where(eq(characters.id, id))
    .get();
}

export function findMonsterTokenBinding(db: DbHandle, id: number) {
  return db
    .select({
      id: compendiumItems.id,
      imageKey: compendiumItems.imageKey,
      data: compendiumItems.data,
    })
    .from(compendiumItems)
    .where(and(eq(compendiumItems.id, id), eq(compendiumItems.type, "monster")))
    .get();
}

/** Batch image resolution for game.state, avoiding one query per token. */
export function listMonsterTokenImages(
  db: DbHandle,
  ids: readonly number[],
): Array<{ id: number; imageKey: string | null }> {
  if (ids.length === 0) return [];
  return db
    .select({ id: compendiumItems.id, imageKey: compendiumItems.imageKey })
    .from(compendiumItems)
    .where(
      and(inArray(compendiumItems.id, [...ids]), eq(compendiumItems.type, "monster")),
    )
    .all();
}

import { and, asc, eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import {
  characters,
  compendiumItems,
  type CharacterRow,
  type CompendiumItemRow,
} from "../../db/schema";
import type { GameRole } from "../../contracts/constants";
import {
  characterSheetDataSchema,
  createDefaultSheetData,
  type CharacterDto,
  type CharacterSheetData,
  type CharacterSummaryDto,
} from "../../contracts/characters";

type Db = DbHandle;

/**
 * Sheet JSON stored before this code shipped (or hand-edited DBs) may not
 * validate; degrade to a default sheet instead of crashing reads. All writes
 * go through mergeSheetData, so stored data is always valid going forward.
 */
export function parseSheetJson(json: string): CharacterSheetData {
  try {
    return characterSheetDataSchema.parse(JSON.parse(json));
  } catch {
    return createDefaultSheetData();
  }
}

export function toCharacterSummaryDto(row: CharacterRow): CharacterSummaryDto {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function toCharacterDto(row: CharacterRow): CharacterDto {
  return { ...toCharacterSummaryDto(row), data: parseSheetJson(row.data) };
}

/** Master sees every sheet; a player only their own. */
export function listCharactersFor(
  db: Db,
  userId: number,
  gameRole: GameRole,
): CharacterRow[] {
  if (gameRole === "master") {
    return db.select().from(characters).orderBy(asc(characters.id)).all();
  }
  return db
    .select()
    .from(characters)
    .where(eq(characters.ownerId, userId))
    .orderBy(asc(characters.id))
    .all();
}

export function findCharacterById(db: Db, id: number): CharacterRow | undefined {
  return db.select().from(characters).where(eq(characters.id, id)).get();
}

export function insertCharacter(
  db: Db,
  values: { ownerId: number; name: string; data: CharacterSheetData },
): CharacterRow {
  const now = Date.now();
  return db
    .insert(characters)
    .values({
      ownerId: values.ownerId,
      name: values.name,
      data: JSON.stringify(values.data),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/**
 * Version-guarded write: the row is only touched when its version still
 * equals `expectedVersion`. Returns undefined on version mismatch (or missing
 * row); the caller distinguishes the two and reports 409 vs 404.
 */
export function updateCharacterRow(
  db: Db,
  id: number,
  expectedVersion: number,
  patch: { name?: string; data?: string },
): CharacterRow | undefined {
  return db
    .update(characters)
    .set({
      ...patch,
      version: sql`${characters.version} + 1`,
      updatedAt: Date.now(),
    })
    .where(and(eq(characters.id, id), eq(characters.version, expectedVersion)))
    .returning()
    .get();
}

export function deleteCharacterRow(db: Db, id: number): void {
  db.delete(characters).where(eq(characters.id, id)).run();
}

/* --------------------- compendium copy source (narrow) ---------------------- */

/**
 * Minimal read access to compendium cards for the "create sheet from card"
 * flow. Deliberately defined here (not in a compendium module) so this slice
 * does not touch compendium files; the contract is `characterSheetPatchSchema`
 * applied to the card's `data` JSON.
 */
export function findCharacterCardById(
  db: Db,
  id: number,
): CompendiumItemRow | undefined {
  return db
    .select()
    .from(compendiumItems)
    .where(and(eq(compendiumItems.id, id), eq(compendiumItems.type, "character")))
    .get();
}

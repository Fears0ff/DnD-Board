import { and, asc, eq, ne, or, type SQL } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import {
  compendiumItems,
  mediaAssets,
  type CompendiumItemRow,
} from "../../db/schema";
import type {
  CompendiumCardData,
  CompendiumCardDto,
} from "../../contracts/compendium";
import type { CompendiumType, Visibility } from "../../contracts/constants";
import type { UserRow } from "../../db/schema";

type Db = DbHandle;

/** Parses the stored JSON payload. Data is validated on every write. */
function parseCardData(json: string): CompendiumCardData {
  try {
    return JSON.parse(json) as CompendiumCardData;
  } catch {
    return {} as CompendiumCardData;
  }
}

/** Maps a DB row to the safe DTO (ISO timestamps, parsed typed payload). */
export function toCompendiumCardDto(row: CompendiumItemRow): CompendiumCardDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    source: row.source,
    isMagic: row.isMagic,
    visibility: row.visibility,
    createdBy: row.createdBy,
    imageKey: row.imageKey,
    data: parseCardData(row.data),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export interface CompendiumListFilter {
  type?: CompendiumType;
  search?: string;
}

/**
 * Rows visible to the given user, filtered by type/search (case-insensitive
 * substring over the name). Visibility: the master sees everything; a player
 * sees shared cards plus their own private ones, but NEVER monsters — the
 * type=monster filter and search cannot smuggle them out either.
 */
export function listCompendiumItems(
  db: Db,
  user: UserRow,
  filter: CompendiumListFilter = {},
): CompendiumItemRow[] {
  const conditions: SQL[] = [];
  if (user.gameRole !== "master") {
    const visible = or(
      eq(compendiumItems.visibility, "shared"),
      eq(compendiumItems.createdBy, user.id),
    );
    if (visible) conditions.push(visible);
    conditions.push(ne(compendiumItems.type, "monster"));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(compendiumItems.type, filter.type));
  }
  const rows = db
    .select()
    .from(compendiumItems)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(compendiumItems.id))
    .all();
  if (filter.search === undefined || filter.search === "") return rows;
  // SQLite lower() без ICU не меняет кириллицу, тогда как JS toLowerCase()
  // меняет. Сравнение целиком в JS сохраняет одинаковые Unicode-правила для
  // поисковой строки и имени карточки и не зависит от сборки SQLite.
  const wanted = filter.search.toLowerCase();
  return rows.filter((row) => row.name.toLowerCase().includes(wanted));
}

export function findCompendiumItemById(
  db: Db,
  id: number,
): CompendiumItemRow | undefined {
  return db.select().from(compendiumItems).where(eq(compendiumItems.id, id)).get();
}

export function countCompendiumItems(db: Db): number {
  return db.select({ id: compendiumItems.id }).from(compendiumItems).all().length;
}

export interface CompendiumItemValues {
  type: CompendiumType;
  name: string;
  source: string;
  isMagic: boolean;
  visibility: Visibility;
  createdBy: number | null;
  imageKey: string | null;
  data: string;
}

export function insertCompendiumItem(
  db: Db,
  values: CompendiumItemValues,
): CompendiumItemRow {
  const now = Date.now();
  return db
    .insert(compendiumItems)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateCompendiumItemRow(
  db: Db,
  id: number,
  patch: Partial<
    Pick<
      CompendiumItemRow,
      "name" | "source" | "isMagic" | "visibility" | "imageKey" | "data"
    >
  >,
): CompendiumItemRow | undefined {
  return db
    .update(compendiumItems)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(compendiumItems.id, id))
    .returning()
    .get();
}

export function deleteCompendiumItemRow(db: Db, id: number): void {
  db.delete(compendiumItems).where(eq(compendiumItems.id, id)).run();
}

/** Referenced images must exist (the FK alone would surface as a 500). */
export function mediaAssetExists(db: Db, key: string): boolean {
  return (
    db.select({ key: mediaAssets.key }).from(mediaAssets).where(eq(mediaAssets.key, key)).get() !==
    undefined
  );
}

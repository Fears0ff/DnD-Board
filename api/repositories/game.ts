import { asc, eq } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import {
  boards,
  tokens,
  type BoardRow,
  type TokenRow,
} from "../../db/schema";
import type { BoardDto, InitiativeEntry, TokenDto } from "../../contracts/game";

type Db = DbHandle;

/* --------------------------------- mapping --------------------------------- */

export function toBoardDto(row: BoardRow): BoardDto {
  return {
    id: row.id,
    name: row.name,
    cellSize: row.cellSize,
    gridWidth: row.gridWidth,
    gridHeight: row.gridHeight,
    isActive: row.isActive,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function toTokenDto(row: TokenRow): TokenDto {
  return {
    id: row.id,
    boardId: row.boardId,
    kind: row.kind,
    label: row.label,
    ownerId: row.ownerId,
    characterId: row.characterId,
    compendiumId: row.compendiumId,
    cellX: row.cellX,
    cellY: row.cellY,
    hp: row.hp,
    maxHp: row.maxHp,
    size: row.size,
    imageKey: row.imageKey,
  };
}

/* ---------------------------------- boards --------------------------------- */

export function listBoards(db: Db): BoardRow[] {
  return db.select().from(boards).orderBy(asc(boards.id)).all();
}

export function findBoardById(db: Db, id: number): BoardRow | undefined {
  return db.select().from(boards).where(eq(boards.id, id)).get();
}

export function findActiveBoard(db: Db): BoardRow | undefined {
  return db.select().from(boards).where(eq(boards.isActive, true)).get();
}

export function countBoards(db: Db): number {
  return db.select({ id: boards.id }).from(boards).all().length;
}

export function insertBoard(
  db: Db,
  values: {
    name: string;
    cellSize: number;
    gridWidth: number;
    gridHeight: number;
    isActive: boolean;
  },
): BoardRow {
  const now = Date.now();
  return db
    .insert(boards)
    .values({
      name: values.name,
      cellSize: values.cellSize,
      gridWidth: values.gridWidth,
      gridHeight: values.gridHeight,
      isActive: values.isActive,
      initiative: "[]",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function renameBoardRow(
  db: Db,
  id: number,
  name: string,
): BoardRow | undefined {
  return db
    .update(boards)
    .set({ name, updatedAt: Date.now() })
    .where(eq(boards.id, id))
    .returning()
    .get();
}

export function setBoardActiveFlag(db: Db, id: number, active: boolean): void {
  db.update(boards)
    .set({ isActive: active, updatedAt: Date.now() })
    .where(eq(boards.id, id))
    .run();
}

export function deleteBoardRow(db: Db, id: number): void {
  db.delete(boards).where(eq(boards.id, id)).run();
}

/* ---------------------------------- tokens --------------------------------- */

export function listTokensByBoard(db: Db, boardId: number): TokenRow[] {
  return db
    .select()
    .from(tokens)
    .where(eq(tokens.boardId, boardId))
    .orderBy(asc(tokens.id))
    .all();
}

export function findTokenById(db: Db, id: number): TokenRow | undefined {
  return db.select().from(tokens).where(eq(tokens.id, id)).get();
}

export function insertToken(
  db: Db,
  values: {
    boardId: number;
    kind: TokenRow["kind"];
    label: string;
    ownerId: number | null;
    cellX: number;
    cellY: number;
    hp: number;
    maxHp: number;
    size: number;
    characterId: number | null;
    compendiumId: number | null;
    imageKey: string | null;
  },
): TokenRow {
  const now = Date.now();
  return db
    .insert(tokens)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateTokenRow(
  db: Db,
  id: number,
  patch: Partial<
    Pick<
      TokenRow,
      "label" | "kind" | "ownerId" | "hp" | "maxHp" | "size" | "cellX" | "cellY"
    >
  >,
): TokenRow | undefined {
  return db
    .update(tokens)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(tokens.id, id))
    .returning()
    .get();
}

export function deleteTokenRow(db: Db, id: number): void {
  db.delete(tokens).where(eq(tokens.id, id)).run();
}

export function deleteTokensByBoard(db: Db, boardId: number): void {
  db.delete(tokens).where(eq(tokens.boardId, boardId)).run();
}

/* -------------------------------- initiative ------------------------------- */

export function parseInitiative(raw: string): InitiativeEntry[] {
  try {
    const parsed = JSON.parse(raw) as InitiativeEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e) =>
        typeof e?.tokenId === "number" &&
        typeof e?.value === "number" &&
        Number.isInteger(e.tokenId) &&
        Number.isInteger(e.value),
    );
  } catch {
    return [];
  }
}

export function setBoardInitiative(
  db: Db,
  boardId: number,
  entries: InitiativeEntry[],
): void {
  db.update(boards)
    .set({ initiative: JSON.stringify(entries), updatedAt: Date.now() })
    .where(eq(boards.id, boardId))
    .run();
}

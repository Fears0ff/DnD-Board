import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { BoardRow, TokenRow, UserRow } from "../../db/schema";
import type {
  BoardCreateInput,
  TokenAddInput,
  TokenMoveInput,
  TokenUpdateInput,
} from "../../contracts/game";
import type { GameStateDto, InitiativeEntry } from "../../contracts/game";
import { toUserDto } from "../repositories/users";
import {
  countBoards,
  deleteBoardRow,
  deleteTokenRow,
  deleteTokensByBoard,
  findActiveBoard,
  findBoardById,
  findTokenById,
  insertBoard,
  insertToken,
  listBoards,
  listTokensByBoard,
  parseInitiative,
  renameBoardRow,
  setBoardActiveFlag,
  setBoardInitiative,
  toBoardDto,
  toTokenDto,
  updateTokenRow,
} from "../repositories/game";
import { bumpGameRevision, getGameRevision } from "../repositories/meta";
import { publishGameChanged } from "../realtime/hub";

/**
 * Game mutations. Every mutation:
 *   1. changes data and bumps game_revision in ONE transaction (drizzle's
 *      synchronous better-sqlite3 transaction commits when the callback
 *      returns);
 *   2. publishes `game.changed` with the new revision AFTER the commit.
 *
 * The WS message is a notification only — clients refetch the snapshot, so a
 * missed message costs at most one polling interval.
 */

type Db = DbHandle;

export interface MutationResult<T> {
  value: T;
  revision: number;
}

function commitAndNotify<T>(db: AppDatabase, fn: (tx: Db) => T): MutationResult<T> {
  let value!: T;
  let revision = 0;
  db.transaction((tx) => {
    value = fn(tx);
    revision = bumpGameRevision(tx);
  });
  publishGameChanged(revision);
  return { value, revision };
}

function requireBoard(db: Db, id: number): BoardRow {
  const board = findBoardById(db, id);
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
  }
  return board;
}

function requireActiveBoard(db: Db): BoardRow {
  const board = findActiveBoard(db);
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No active board" });
  }
  return board;
}

function requireToken(db: Db, id: number): TokenRow {
  const token = findTokenById(db, id);
  if (!token) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
  }
  return token;
}

function assertInsideBoard(
  board: BoardRow,
  cellX: number,
  cellY: number,
  size = 1,
): void {
  if (
    cellX < 0 ||
    cellY < 0 ||
    cellX + size > board.gridWidth ||
    cellY + size > board.gridHeight
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Token would leave the board",
    });
  }
}

function assertHp(hp: number, maxHp: number): void {
  if (hp < 0 || maxHp < 0 || hp > maxHp) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "hp must satisfy 0 <= hp <= maxHp",
    });
  }
}

/* ---------------------------------- state ---------------------------------- */

/** Full snapshot: boards list, active board, its tokens and initiative. */
export function getGameState(db: AppDatabase, me: UserRow): GameStateDto {
  const boards = listBoards(db).map(toBoardDto);
  const active = findActiveBoard(db);
  return {
    me: toUserDto(me),
    revision: getGameRevision(db),
    boards,
    activeBoard: active ? toBoardDto(active) : null,
    tokens: active ? listTokensByBoard(db, active.id).map(toTokenDto) : [],
    initiative: active ? parseInitiative(active.initiative) : [],
  };
}

/* ---------------------------------- boards --------------------------------- */

export function createBoard(
  db: AppDatabase,
  input: BoardCreateInput,
): MutationResult<ReturnType<typeof toBoardDto>> {
  return commitAndNotify(db, (tx) => {
    // The first board ever created becomes active automatically.
    const board = insertBoard(tx, {
      name: input.name,
      cellSize: input.cellSize ?? 64,
      gridWidth: input.gridWidth ?? 30,
      gridHeight: input.gridHeight ?? 20,
      isActive: countBoards(tx) === 0,
    });
    return toBoardDto(board);
  });
}

export function renameBoard(
  db: AppDatabase,
  id: number,
  name: string,
): MutationResult<ReturnType<typeof toBoardDto>> {
  return commitAndNotify(db, (tx) => {
    requireBoard(tx, id);
    const updated = renameBoardRow(tx, id, name);
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
    }
    return toBoardDto(updated);
  });
}

export function removeBoard(
  db: AppDatabase,
  id: number,
): MutationResult<{ removed: true }> {
  return commitAndNotify(db, (tx) => {
    requireBoard(tx, id);
    deleteBoardRow(tx, id);
    return { removed: true as const };
  });
}

export function setActiveBoard(
  db: AppDatabase,
  id: number,
): MutationResult<ReturnType<typeof toBoardDto>> {
  return commitAndNotify(db, (tx) => {
    const board = requireBoard(tx, id);
    const current = findActiveBoard(tx);
    if (current && current.id !== id) {
      setBoardActiveFlag(tx, current.id, false);
    }
    setBoardActiveFlag(tx, id, true);
    return toBoardDto({ ...board, isActive: true });
  });
}

/* ---------------------------------- tokens --------------------------------- */

export function addToken(
  db: AppDatabase,
  input: TokenAddInput,
): MutationResult<ReturnType<typeof toTokenDto>> {
  return commitAndNotify(db, (tx) => {
    const board = requireActiveBoard(tx);
    const size = input.size ?? 1;
    const cellX = input.cellX ?? 0;
    const cellY = input.cellY ?? 0;
    assertInsideBoard(board, cellX, cellY, size);
    assertHp(input.hp, input.maxHp);
    const token = insertToken(tx, {
      boardId: board.id,
      kind: input.kind,
      label: input.label,
      ownerId: input.ownerId ?? null,
      cellX,
      cellY,
      hp: input.hp,
      maxHp: input.maxHp,
      size,
      characterId: null,
      compendiumId: null,
      imageKey: null,
    });
    return toTokenDto(token);
  });
}

export function updateToken(
  db: AppDatabase,
  input: TokenUpdateInput,
): MutationResult<ReturnType<typeof toTokenDto>> {
  return commitAndNotify(db, (tx) => {
    const token = requireToken(tx, input.id);
    const board = requireBoard(tx, token.boardId);

    const next = {
      label: input.label ?? token.label,
      kind: input.kind ?? token.kind,
      ownerId: input.ownerId === undefined ? token.ownerId : input.ownerId,
      hp: input.hp ?? token.hp,
      maxHp: input.maxHp ?? token.maxHp,
      size: input.size ?? token.size,
      cellX: input.cellX ?? token.cellX,
      cellY: input.cellY ?? token.cellY,
    };
    assertHp(next.hp, next.maxHp);
    assertInsideBoard(board, next.cellX, next.cellY, next.size);

    const updated = updateTokenRow(tx, input.id, next);
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return toTokenDto(updated);
  });
}

/**
 * The only token mutation a player can perform: move a token they own.
 * Masters may move anything. Ownership is checked against the token row,
 * not against any client-supplied field.
 */
export function moveToken(
  db: AppDatabase,
  user: UserRow,
  input: TokenMoveInput,
): MutationResult<ReturnType<typeof toTokenDto>> {
  return commitAndNotify(db, (tx) => {
    const token = requireToken(tx, input.tokenId);
    if (user.gameRole !== "master" && token.ownerId !== user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You can only move your own tokens",
      });
    }
    const board = requireBoard(tx, token.boardId);
    assertInsideBoard(board, input.cellX, input.cellY, token.size);
    const updated = updateTokenRow(tx, input.tokenId, {
      cellX: input.cellX,
      cellY: input.cellY,
    });
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return toTokenDto(updated);
  });
}

export function removeToken(
  db: AppDatabase,
  id: number,
): MutationResult<{ removed: true }> {
  return commitAndNotify(db, (tx) => {
    requireToken(tx, id);
    deleteTokenRow(tx, id);
    return { removed: true as const };
  });
}

export function clearTokens(
  db: AppDatabase,
  boardId: number,
): MutationResult<{ removed: number }> {
  return commitAndNotify(db, (tx) => {
    requireBoard(tx, boardId);
    const count = listTokensByBoard(tx, boardId).length;
    deleteTokensByBoard(tx, boardId);
    setBoardInitiative(tx, boardId, []);
    return { removed: count };
  });
}

/* -------------------------------- initiative ------------------------------- */

export function setInitiative(
  db: AppDatabase,
  entries: InitiativeEntry[],
): MutationResult<InitiativeEntry[]> {
  return commitAndNotify(db, (tx) => {
    const board = requireActiveBoard(tx);
    // Entries must reference tokens that exist on the active board.
    const validIds = new Set(
      listTokensByBoard(tx, board.id).map((t) => t.id),
    );
    const cleaned = entries.filter((e) => validIds.has(e.tokenId));
    setBoardInitiative(tx, board.id, cleaned);
    return cleaned;
  });
}

import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { BoardRow, UserRow } from "../../db/schema";
import type {
  BoardCreateInput,
  BoardDto,
  GameStateDto,
  InitiativeEntry,
  TokenAddInput,
  TokenDto,
  TokenUpdateInput,
} from "../../contracts/game";
import { bumpGameRevision, getGameRevision } from "../repositories/meta";
import { findUserById, toUserDto } from "../repositories/users";
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
import { publishGameChanged } from "../realtime/hub";

/**
 * Transactional game operations. Every mutation:
 *   1. changes data,
 *   2. bumps app_meta.game_revision inside the SAME transaction,
 *   3. commits,
 *   4. only then publishes game.changed over WS (publish after commit).
 */

interface MutationResult<T> {
  value: T;
  revision: number;
}

function requireBoard(db: DbHandle, id: number): BoardRow {
  const board = findBoardById(db, id);
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
  }
  return board;
}

function requireActiveBoard(db: DbHandle): BoardRow {
  const board = findActiveBoard(db);
  if (!board) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No active board",
    });
  }
  return board;
}

export function getGameState(db: DbHandle, user: UserRow): GameStateDto {
  const allBoards = listBoards(db);
  const active = allBoards.find((b) => b.isActive) ?? null;
  const tokenRows = active ? listTokensByBoard(db, active.id) : [];
  return {
    me: toUserDto(user),
    revision: getGameRevision(db),
    boards: allBoards.map(toBoardDto),
    activeBoard: active ? toBoardDto(active) : null,
    tokens: tokenRows.map(toTokenDto),
    initiative: active ? parseInitiative(active.initiative) : [],
  };
}

/* ---------------------------------- boards --------------------------------- */

export function createBoard(
  db: AppDatabase,
  input: BoardCreateInput,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    // The first board ever created becomes active automatically.
    const isActive = countBoards(t) === 0;
    const row = insertBoard(t, {
      name: input.name,
      cellSize: input.cellSize ?? 64,
      gridWidth: input.gridWidth ?? 30,
      gridHeight: input.gridHeight ?? 20,
      isActive,
    });
    return { value: toBoardDto(row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function renameBoard(
  db: AppDatabase,
  id: number,
  name: string,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    requireBoard(t, id);
    const row = renameBoardRow(t, id, name);
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
    }
    return { value: toBoardDto(row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function removeBoard(
  db: AppDatabase,
  id: number,
): MutationResult<{ removedId: number }> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireBoard(t, id);
    // Tokens are removed by ON DELETE CASCADE.
    deleteBoardRow(t, id);
    if (board.isActive) {
      // Never leave the space without an active board if others remain.
      const next = listBoards(t)[0];
      if (next) setBoardActiveFlag(t, next.id, true);
    }
    return { value: { removedId: id }, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function setActiveBoard(
  db: AppDatabase,
  id: number,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireBoard(t, id);
    if (!board.isActive) {
      const current = findActiveBoard(t);
      if (current) setBoardActiveFlag(t, current.id, false);
      setBoardActiveFlag(t, id, true);
    }
    const updated = requireBoard(t, id);
    return { value: toBoardDto(updated), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/* ---------------------------------- tokens --------------------------------- */

function assertValidOwner(db: DbHandle, ownerId: number | null): void {
  if (ownerId !== null && !findUserById(db, ownerId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "ownerId does not reference an existing user",
    });
  }
}

export function addToken(
  db: AppDatabase,
  input: TokenAddInput,
): MutationResult<TokenDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireActiveBoard(t);
    const ownerId = input.ownerId ?? null;
    assertValidOwner(t, ownerId);
    const row = insertToken(t, {
      boardId: board.id,
      kind: input.kind,
      label: input.label,
      ownerId,
      // New tokens appear at the center of the active board by default.
      cellX: input.cellX ?? Math.floor(board.gridWidth / 2),
      cellY: input.cellY ?? Math.floor(board.gridHeight / 2),
      hp: input.hp,
      maxHp: input.maxHp,
      size: input.size ?? 1,
      characterId: null,
      compendiumId: null,
      imageKey: null,
    });
    return { value: toTokenDto(row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/** Master-only full update. Players must use moveToken instead. */
export function updateToken(
  db: AppDatabase,
  input: TokenUpdateInput,
): MutationResult<TokenDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, input.id);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    const nextHp = input.hp ?? token.hp;
    const nextMaxHp = input.maxHp ?? token.maxHp;
    if (nextHp < 0 || nextMaxHp < 0 || nextHp > nextMaxHp) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "hp must satisfy 0 <= hp <= maxHp",
      });
    }
    if (input.ownerId !== undefined) {
      assertValidOwner(t, input.ownerId);
    }
    const row = updateTokenRow(t, input.id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.hp !== undefined ? { hp: input.hp } : {}),
      ...(input.maxHp !== undefined ? { maxHp: input.maxHp } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.cellX !== undefined ? { cellX: input.cellX } : {}),
      ...(input.cellY !== undefined ? { cellY: input.cellY } : {}),
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return { value: toTokenDto(row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/**
 * Coordinate-only move. A player may move ONLY their own token
 * (tokens.ownerId = current user); the master may move anything.
 */
export function moveToken(
  db: AppDatabase,
  user: UserRow,
  input: { tokenId: number; cellX: number; cellY: number },
): MutationResult<TokenDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, input.tokenId);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    if (user.gameRole !== "master" && token.ownerId !== user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Players can move only their own tokens",
      });
    }
    const board = findBoardById(t, token.boardId);
    if (!board?.isActive) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Token is not on the active board",
      });
    }
    if (
      input.cellX < 0 ||
      input.cellY < 0 ||
      input.cellX + token.size > board.gridWidth ||
      input.cellY + token.size > board.gridHeight
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Token must remain inside the board",
      });
    }
    const row = updateTokenRow(t, token.id, {
      cellX: input.cellX,
      cellY: input.cellY,
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return { value: toTokenDto(row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function removeToken(
  db: AppDatabase,
  id: number,
): MutationResult<{ removedId: number }> {
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, id);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    deleteTokenRow(t, id);
    // The token's initiative entries die with it, in the same transaction.
    const board = findBoardById(t, token.boardId);
    if (board) {
      const kept = parseInitiative(board.initiative).filter(
        (e) => e.tokenId !== id,
      );
      setBoardInitiative(t, board.id, kept);
    }
    return { value: { removedId: id }, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function clearTokens(
  db: AppDatabase,
  boardId: number,
): MutationResult<{ clearedBoardId: number }> {
  const result = db.transaction((tx) => {
    const t = tx;
    requireBoard(t, boardId);
    deleteTokensByBoard(t, boardId);
    setBoardInitiative(t, boardId, []);
    return { value: { clearedBoardId: boardId }, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/* -------------------------------- initiative ------------------------------- */

/** Master-only manual initiative for the ACTIVE board. No dice, no auto math. */
export function setInitiative(
  db: AppDatabase,
  entries: InitiativeEntry[],
): MutationResult<InitiativeEntry[]> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireActiveBoard(t);
    const tokenIds = new Set(
      listTokensByBoard(t, board.id).map((token) => token.id),
    );
    const unknown = entries.filter((e) => !tokenIds.has(e.tokenId));
    if (unknown.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Initiative references tokens not on the active board: ${unknown
          .map((e) => e.tokenId)
          .join(", ")}`,
      });
    }
    // Duplicate tokenIds: last write wins.
    const byToken = new Map<number, number>();
    for (const e of entries) byToken.set(e.tokenId, e.value);
    const normalized: InitiativeEntry[] = [...byToken.entries()].map(
      ([tokenId, value]) => ({ tokenId, value }),
    );
    setBoardInitiative(t, board.id, normalized);
    return { value: normalized, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

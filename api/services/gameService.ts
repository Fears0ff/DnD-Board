import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { BoardRow, CampaignRow, TokenRow, UserRow } from "../../db/schema";
import { monsterCardDataSchema } from "../../contracts/compendium";
import { parseSheetJson } from "../repositories/characters";
import {
  findHeroTokenBinding,
  findMonsterTokenBinding,
  listMonsterTokenImages,
} from "../repositories/tokenBindings";
import type {
  BoardCreateInput,
  BoardDto,
  CampaignCreateInput,
  CampaignDto,
  GameStateDto,
  GameStateInput,
  InitiativeEntry,
  TokenAddInput,
  TokenAdjustHpInput,
  TokenDto,
  TokenUpdateInput,
} from "../../contracts/game";
import { bumpGameRevision, getGameRevision } from "../repositories/meta";
import { findUserById, toUserDto } from "../repositories/users";
import { findMediaAsset } from "../repositories/media";
import { deleteAssetIfUnreferenced } from "./mediaService";
import {
  countBoards,
  deleteBoardRow,
  deleteCampaignRow,
  deleteTokenRow,
  deleteTokensByBoard,
  findActiveBoard,
  findActiveCampaign,
  findBoardById,
  findCampaignById,
  findTokenById,
  insertBoard,
  insertCampaign,
  insertToken,
  listBoards,
  listBoardsByCampaign,
  listCampaigns,
  listTokensByBoard,
  parseInitiative,
  renameBoardRow,
  renameCampaignRow,
  setBoardActiveFlag,
  setCampaignActiveFlag,
  setBoardBackgroundKey,
  setBoardGridSize,
  setBoardInitiative,
  toBoardDto,
  toCampaignDto,
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

interface ResolvedTokenBinding {
  characterId: number | null;
  compendiumId: number | null;
  ownerId?: number;
  maxHp?: number;
}

/** Validate kind/reference pairing and read the one-time HP/owner defaults. */
function resolveTokenBinding(
  db: DbHandle,
  kind: TokenDto["kind"],
  characterId: number | null,
  compendiumId: number | null,
): ResolvedTokenBinding {
  if (characterId !== null && compendiumId !== null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A token cannot reference both a character and a compendium card",
    });
  }
  if (characterId !== null) {
    if (kind !== "hero") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only a hero token can reference a character sheet",
      });
    }
    const character = findHeroTokenBinding(db, characterId);
    if (!character) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
    }
    return {
      characterId,
      compendiumId: null,
      ownerId: character.ownerId,
      maxHp: parseSheetJson(character.data).vitals.maxHp,
    };
  }
  if (compendiumId !== null) {
    if (kind !== "monster") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only a monster token can reference a monster card",
      });
    }
    const monster = findMonsterTokenBinding(db, compendiumId);
    if (!monster) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Monster compendium card not found",
      });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(monster.data);
    } catch {
      raw = null;
    }
    const parsed = monsterCardDataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stored monster card data failed validation",
      });
    }
    return {
      characterId: null,
      compendiumId,
      maxHp: parsed.data.hitPoints,
    };
  }
  return { characterId: null, compendiumId: null };
}

/** Compendium-bound tokens use the card image; their own imageKey stays NULL. */
function toResolvedTokenDtos(db: DbHandle, rows: TokenRow[]): TokenDto[] {
  const ids = [
    ...new Set(
      rows
        .map((row) => row.compendiumId)
        .filter((id): id is number => id !== null),
    ),
  ];
  const images = new Map(
    listMonsterTokenImages(db, ids).map((row) => [row.id, row.imageKey]),
  );
  return rows.map((row) => {
    const dto = toTokenDto(row);
    if (row.compendiumId !== null) {
      dto.imageKey = images.get(row.compendiumId) ?? null;
    }
    return dto;
  });
}

function toResolvedTokenDto(db: DbHandle, row: TokenRow): TokenDto {
  return toResolvedTokenDtos(db, [row])[0];
}

function requireBoard(db: DbHandle, id: number): BoardRow {
  const board = findBoardById(db, id);
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
  }
  return board;
}

function requireCampaign(db: DbHandle, id: number): CampaignRow {
  const campaign = findCampaignById(db, id);
  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  return campaign;
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

export function getGameState(
  db: DbHandle,
  user: UserRow,
  input?: GameStateInput,
): GameStateDto {
  const isMaster = user.gameRole === "master";
  const allCampaigns = listCampaigns(db);
  const activeCampaign = allCampaigns.find((campaign) => campaign.isActive) ?? null;
  const allBoards = listBoards(db);
  // A board is player-visible only while both it and its campaign are active.
  const globallyActiveBoard = allBoards.find((board) => board.isActive) ?? null;
  const active = globallyActiveBoard?.campaignId === activeCampaign?.id
    ? globallyActiveBoard
    : null;

  let viewedCampaign = activeCampaign;
  let viewed = active;
  if (isMaster) {
    const requestedBoard = input?.boardId !== undefined
      ? requireBoard(db, input.boardId)
      : undefined;
    const requestedCampaignId = input?.campaignId ?? requestedBoard?.campaignId;
    viewedCampaign = requestedCampaignId !== undefined
      ? requireCampaign(db, requestedCampaignId)
      : activeCampaign ?? allCampaigns[0] ?? null;
    if (requestedBoard) {
      if (viewedCampaign?.id !== requestedBoard.campaignId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Board is outside the viewed campaign" });
      }
      viewed = requestedBoard;
    } else {
      const campaignBoards = viewedCampaign ? listBoardsByCampaign(db, viewedCampaign.id) : [];
      viewed = active?.campaignId === viewedCampaign?.id
        ? active
        : campaignBoards[0] ?? null;
    }
  }

  const visibleBoards = viewedCampaign ? listBoardsByCampaign(db, viewedCampaign.id) : [];
  if (!isMaster) viewed = active;
  const allTokenRows = viewed ? listTokensByBoard(db, viewed.id) : [];
  // Hidden token DTOs are omitted; manual initiative deliberately retains them.
  const tokenRows = isMaster ? allTokenRows : allTokenRows.filter((row) => !row.invisible);
  const tokenDtos = toResolvedTokenDtos(db, tokenRows).map((dto, index) => {
    if (!isMaster && tokenRows[index].ownerId !== user.id) {
      dto.hp = null;
      dto.maxHp = null;
    }
    return dto;
  });
  return {
    me: toUserDto(user),
    revision: getGameRevision(db),
    campaigns: allCampaigns.map(toCampaignDto),
    activeCampaign: activeCampaign ? toCampaignDto(activeCampaign) : null,
    viewedCampaign: viewedCampaign ? toCampaignDto(viewedCampaign) : null,
    boards: visibleBoards.map(toBoardDto),
    activeBoard: active ? toBoardDto(active) : null,
    viewedBoard: viewed ? toBoardDto(viewed) : null,
    tokens: tokenDtos,
    initiative: viewed ? parseInitiative(viewed.initiative) : [],
  };
}

/* -------------------------------- campaigns -------------------------------- */

export function createCampaign(
  db: AppDatabase,
  input: CampaignCreateInput,
): MutationResult<CampaignDto> {
  const result = db.transaction((tx) => {
    const isActive = !findActiveCampaign(tx);
    const row = insertCampaign(tx, input.name, isActive);
    return { value: toCampaignDto(row), revision: bumpGameRevision(tx) };
  });
  publishGameChanged(result.revision);
  return result;
}

export function renameCampaign(
  db: AppDatabase,
  id: number,
  name: string,
): MutationResult<CampaignDto> {
  const result = db.transaction((tx) => {
    requireCampaign(tx, id);
    const row = renameCampaignRow(tx, id, name);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
    return { value: toCampaignDto(row), revision: bumpGameRevision(tx) };
  });
  publishGameChanged(result.revision);
  return result;
}

/** Activating a campaign selects its first board; null hides the game from players. */
export function setActiveCampaign(
  db: AppDatabase,
  id: number | null,
): MutationResult<CampaignDto | null> {
  const result = db.transaction((tx) => {
    const target = id === null ? null : requireCampaign(tx, id);
    const currentCampaign = findActiveCampaign(tx);
    const currentBoard = findActiveBoard(tx);
    if (currentBoard) setBoardActiveFlag(tx, currentBoard.id, false);
    if (currentCampaign) setCampaignActiveFlag(tx, currentCampaign.id, false);
    if (target) {
      setCampaignActiveFlag(tx, target.id, true);
      const firstBoard = listBoardsByCampaign(tx, target.id)[0];
      if (firstBoard) setBoardActiveFlag(tx, firstBoard.id, true);
    }
    return {
      value: target ? toCampaignDto(requireCampaign(tx, target.id)) : null,
      revision: bumpGameRevision(tx),
    };
  });
  publishGameChanged(result.revision);
  return result;
}

export async function removeCampaign(
  db: AppDatabase,
  id: number,
): Promise<MutationResult<{ removedId: number }>> {
  let replacedKeys: (string | null)[] = [];
  const result = db.transaction((tx) => {
    const campaign = requireCampaign(tx, id);
    const campaignBoards = listBoardsByCampaign(tx, id);
    replacedKeys = campaignBoards.flatMap((board) => [
      board.backgroundKey,
      ...listTokensByBoard(tx, board.id).map((token) => token.imageKey),
    ]);
    deleteCampaignRow(tx, id);
    if (campaign.isActive) {
      const next = listCampaigns(tx)[0];
      if (next) {
        setCampaignActiveFlag(tx, next.id, true);
        const firstBoard = listBoardsByCampaign(tx, next.id)[0];
        if (firstBoard) setBoardActiveFlag(tx, firstBoard.id, true);
      }
    }
    return { value: { removedId: id }, revision: bumpGameRevision(tx) };
  });
  publishGameChanged(result.revision);
  await cleanupReplacedAssets(db, replacedKeys);
  return result;
}

/* ---------------------------------- boards --------------------------------- */

export function createBoard(
  db: AppDatabase,
  input: BoardCreateInput,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const activeCampaign = findActiveCampaign(t);
    const campaignId = input.campaignId ?? activeCampaign?.id;
    if (campaignId === undefined) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No campaign selected for the board" });
    }
    requireCampaign(t, campaignId);
    // The first board of the player-visible campaign becomes active automatically.
    const isActive = activeCampaign?.id === campaignId && countBoards(t, campaignId) === 0;
    const row = insertBoard(t, {
      campaignId,
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

export function updateBoardGrid(
  db: AppDatabase,
  id: number,
  gridWidth: number,
  gridHeight: number,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    requireBoard(tx, id);
    // Shrinking never deletes or strands tokens: move only those whose
    // footprint would cross the new edge to the nearest valid cell.
    for (const token of listTokensByBoard(tx, id)) {
      const cellX = Math.max(0, Math.min(token.cellX, Math.ceil(gridWidth - token.size)));
      const cellY = Math.max(0, Math.min(token.cellY, Math.ceil(gridHeight - token.size)));
      if (cellX !== token.cellX || cellY !== token.cellY) {
        updateTokenRow(tx, token.id, { cellX, cellY });
      }
    }
    const row = setBoardGridSize(tx, id, gridWidth, gridHeight);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
    return { value: toBoardDto(row), revision: bumpGameRevision(tx) };
  });
  publishGameChanged(result.revision);
  return result;
}

export async function removeBoard(
  db: AppDatabase,
  id: number,
): Promise<MutationResult<{ removedId: number }>> {
  let replacedKeys: (string | null)[] = [];
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireBoard(t, id);
    // Media keys whose references die with this board: its background and
    // the images of its tokens (tokens are removed by ON DELETE CASCADE).
    replacedKeys = [
      board.backgroundKey,
      ...listTokensByBoard(t, id).map((token) => token.imageKey),
    ];
    deleteBoardRow(t, id);
    if (board.isActive) {
      // Promote only inside the same campaign; never expose another campaign.
      const next = listBoardsByCampaign(t, board.campaignId)[0];
      if (next) setBoardActiveFlag(t, next.id, true);
    }
    return { value: { removedId: id }, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  await cleanupReplacedAssets(db, replacedKeys);
  return result;
}

/** Master-only: set/replace (or clear, with null) a board background image. */
export async function setBoardBackground(
  db: AppDatabase,
  id: number,
  imageKey: string | null,
): Promise<MutationResult<BoardDto>> {
  let replacedKey: string | null = null;
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireBoard(t, id);
    assertMediaAssetExists(t, imageKey);
    replacedKey =
      board.backgroundKey !== imageKey ? board.backgroundKey : null;
    const updated = setBoardBackgroundKey(t, id, imageKey);
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Board not found" });
    }
    return { value: toBoardDto(updated), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  await cleanupReplacedAssets(db, [replacedKey]);
  return result;
}

export function setActiveBoard(
  db: AppDatabase,
  id: number,
): MutationResult<BoardDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board = requireBoard(t, id);
    if (!board.isActive || !requireCampaign(t, board.campaignId).isActive) {
      const current = findActiveBoard(t);
      if (current) setBoardActiveFlag(t, current.id, false);
      const currentCampaign = findActiveCampaign(t);
      if (currentCampaign) setCampaignActiveFlag(t, currentCampaign.id, false);
      setCampaignActiveFlag(t, board.campaignId, true);
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

/** Image references must point at real media assets (FK is the backstop). */
function assertMediaAssetExists(db: DbHandle, imageKey: string | null): void {
  if (imageKey !== null && !findMediaAsset(db, imageKey)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "imageKey does not reference an existing media asset",
    });
  }
}

/**
 * Best-effort media cleanup AFTER the game mutation has committed and been
 * published (plan §8.3.3/5): a file-deletion failure is logged inside
 * deleteAssetIfUnreferenced and retried by the orphan cleanup; it never
 * rolls back the game change.
 */
async function cleanupReplacedAssets(
  db: AppDatabase,
  keys: (string | null)[],
): Promise<void> {
  for (const key of new Set(keys)) {
    if (key) await deleteAssetIfUnreferenced(db, key);
  }
}

export function addToken(
  db: AppDatabase,
  input: TokenAddInput,
): MutationResult<TokenDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    // The master may add tokens to any board; without boardId the active
    // board is used (backwards-compatible default).
    const board =
      input.boardId !== undefined
        ? requireBoard(t, input.boardId)
        : requireActiveBoard(t);
    const binding = resolveTokenBinding(
      t,
      input.kind,
      input.characterId ?? null,
      input.compendiumId ?? null,
    );
    const ownerId = binding.ownerId ?? input.ownerId ?? null;
    assertValidOwner(t, ownerId);
    if (binding.compendiumId !== null && input.imageKey != null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A compendium-bound token uses the card image",
      });
    }
    const imageKey = binding.compendiumId !== null ? null : input.imageKey ?? null;
    assertMediaAssetExists(t, imageKey);
    // Attaching an entity initializes full HP once. Later sheet/card edits do
    // not synchronize token HP, and ordinary token HP edits remain manual.
    const maxHp = binding.maxHp ?? input.maxHp;
    const hp = binding.maxHp ?? input.hp;
    const row = insertToken(t, {
      boardId: board.id,
      kind: input.kind,
      label: input.label,
      ownerId,
      // New tokens appear at the center of the target board by default.
      cellX: input.cellX ?? Math.floor(board.gridWidth / 2),
      cellY: input.cellY ?? Math.floor(board.gridHeight / 2),
      hp,
      maxHp,
      size: input.size ?? 1,
      invisible: input.invisible ?? false,
      characterId: binding.characterId,
      compendiumId: binding.compendiumId,
      imageKey,
    });
    return { value: toResolvedTokenDto(t, row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/** Master-only full update. Players must use moveToken instead. */
export async function updateToken(
  db: AppDatabase,
  input: TokenUpdateInput,
): Promise<MutationResult<TokenDto>> {
  let replacedKey: string | null = null;
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, input.id);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    const nextKind = input.kind ?? token.kind;
    const kindChanged = nextKind !== token.kind;
    let nextCharacterId =
      input.characterId !== undefined
        ? input.characterId ?? null
        : token.characterId;
    let nextCompendiumId =
      input.compendiumId !== undefined
        ? input.compendiumId ?? null
        : token.compendiumId;
    // Changing the token kind drops an incompatible old reference unless the
    // caller explicitly supplies a valid replacement in the same mutation.
    if (kindChanged) {
      if (input.characterId === undefined) nextCharacterId = null;
      if (input.compendiumId === undefined) nextCompendiumId = null;
    }
    const binding = resolveTokenBinding(
      t,
      nextKind,
      nextCharacterId,
      nextCompendiumId,
    );
    const referenceChanged =
      nextCharacterId !== token.characterId ||
      nextCompendiumId !== token.compendiumId;
    const attachMaxHp = referenceChanged ? binding.maxHp : undefined;
    const nextMaxHp = attachMaxHp ?? input.maxHp ?? token.maxHp;
    const nextHp = attachMaxHp ?? input.hp ?? token.hp;
    if (nextHp < 0 || nextMaxHp < 0 || nextHp > nextMaxHp) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "hp must satisfy 0 <= hp <= maxHp",
      });
    }
    const nextOwnerId =
      binding.ownerId ??
      (input.ownerId !== undefined ? input.ownerId ?? null : token.ownerId);
    assertValidOwner(t, nextOwnerId);

    let nextImageKey =
      input.imageKey !== undefined ? input.imageKey ?? null : token.imageKey;
    if (nextCompendiumId !== null && nextImageKey !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A compendium-bound token uses the card image",
      });
    }
    if (nextCompendiumId !== null) nextImageKey = null;
    assertMediaAssetExists(t, nextImageKey);
    if (nextImageKey !== token.imageKey) replacedKey = token.imageKey;

    const row = updateTokenRow(t, input.id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      kind: nextKind,
      ownerId: nextOwnerId,
      characterId: nextCharacterId,
      compendiumId: nextCompendiumId,
      hp: nextHp,
      maxHp: nextMaxHp,
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.invisible !== undefined ? { invisible: input.invisible } : {}),
      ...(input.cellX !== undefined ? { cellX: input.cellX } : {}),
      ...(input.cellY !== undefined ? { cellY: input.cellY } : {}),
      imageKey: nextImageKey,
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return { value: toResolvedTokenDto(t, row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  await cleanupReplacedAssets(db, [replacedKey]);
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
    if (user.gameRole !== "master" && token.invisible) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    if (user.gameRole !== "master" && token.ownerId !== user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Players can move only their own tokens",
      });
    }
    const board = findBoardById(t, token.boardId);
    if (!board?.isActive || !findCampaignById(t, board.campaignId)?.isActive) {
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
    return { value: toResolvedTokenDto(t, row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

/**
 * Master-only HP adjustment, clamped to [0, maxHp]. The master manages tokens
 * on ANY board: board activity only controls what players see, not what the
 * master may edit (unlike moveToken, which stays active-only for players).
 */
export function adjustTokenHp(
  db: AppDatabase,
  input: TokenAdjustHpInput,
): MutationResult<TokenDto> {
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, input.id);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    const hp = Math.min(Math.max(token.hp + input.delta, 0), token.maxHp);
    const row = updateTokenRow(t, token.id, { hp });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    return { value: toResolvedTokenDto(t, row), revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  return result;
}

export async function removeToken(
  db: AppDatabase,
  id: number,
): Promise<MutationResult<{ removedId: number }>> {
  let replacedKey: string | null = null;
  const result = db.transaction((tx) => {
    const t = tx;
    const token = findTokenById(t, id);
    if (!token) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
    }
    replacedKey = token.imageKey;
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
  await cleanupReplacedAssets(db, [replacedKey]);
  return result;
}

export async function clearTokens(
  db: AppDatabase,
  boardId: number,
): Promise<MutationResult<{ clearedBoardId: number }>> {
  let replacedKeys: (string | null)[] = [];
  const result = db.transaction((tx) => {
    const t = tx;
    requireBoard(t, boardId);
    replacedKeys = listTokensByBoard(t, boardId).map((token) => token.imageKey);
    deleteTokensByBoard(t, boardId);
    setBoardInitiative(t, boardId, []);
    return { value: { clearedBoardId: boardId }, revision: bumpGameRevision(t) };
  });
  publishGameChanged(result.revision);
  await cleanupReplacedAssets(db, replacedKeys);
  return result;
}

/* -------------------------------- initiative ------------------------------- */

/**
 * Master-only manual initiative. No dice, no auto math. Targets the board
 * given by `boardId`, or the active board when omitted; tokenIds are
 * validated against the target board.
 */
export function setInitiative(
  db: AppDatabase,
  entries: InitiativeEntry[],
  boardId?: number,
): MutationResult<InitiativeEntry[]> {
  const result = db.transaction((tx) => {
    const t = tx;
    const board =
      boardId !== undefined ? requireBoard(t, boardId) : requireActiveBoard(t);
    const tokenIds = new Set(
      listTokensByBoard(t, board.id).map((token) => token.id),
    );
    const unknown = entries.filter((e) => !tokenIds.has(e.tokenId));
    if (unknown.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Initiative references tokens not on the target board: ${unknown
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

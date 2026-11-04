import { z } from "zod";
import { tokenKinds } from "./constants";
import type { UserDto } from "./auth";

const cellCoordSchema = z.number().int().min(-1000).max(100_000);
const hpSchema = z.number().int().min(0).max(1_000_000);
const tokenSizeSchema = z.number().min(0.25).max(20);
const tokenKindSchema = z.enum(tokenKinds);
const idSchema = z.number().int().positive();

// Server-generated storage keys only: no user path segments are ever accepted.
export const mediaKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((v) => !v.includes(".."), "Invalid storage key");

/* ---------------------------------- boards --------------------------------- */

export const boardCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cellSize: z.number().int().min(4).max(1024).optional(),
  gridWidth: z.number().int().min(1).max(500).optional(),
  gridHeight: z.number().int().min(1).max(500).optional(),
});
export type BoardCreateInput = z.infer<typeof boardCreateInputSchema>;

export const boardRenameInputSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
});
export type BoardRenameInput = z.infer<typeof boardRenameInputSchema>;

export const boardIdInputSchema = z.object({ id: idSchema });
export type BoardIdInput = z.infer<typeof boardIdInputSchema>;

export interface BoardDto {
  id: number;
  name: string;
  backgroundKey: string | null;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------- tokens --------------------------------- */

export const tokenAddInputSchema = z
  .object({
    kind: tokenKindSchema,
    label: z.string().trim().max(120).default(""),
    ownerId: idSchema.nullish(),
    // Hero -> player-owned character sheet; monster -> compendium monster.
    // The service validates the kind/reference combination and initializes HP
    // once when a new reference is attached.
    characterId: idSchema.nullish(),
    compendiumId: idSchema.nullish(),
    hp: hpSchema,
    maxHp: hpSchema,
    size: tokenSizeSchema.optional(),
    cellX: cellCoordSchema.optional(),
    cellY: cellCoordSchema.optional(),
    // Master may target any board; without boardId the active board is used.
    boardId: idSchema.optional(),
    // Optional token image: an existing media_assets key (uploaded via
    // media.uploadImage). FK + existence enforced server-side.
    imageKey: mediaKeySchema.nullish(),
  })
  .refine(
    (v) =>
      v.characterId != null || v.compendiumId != null || v.hp <= v.maxHp,
    {
      message: "hp must be <= maxHp",
      path: ["hp"],
    },
  );
export type TokenAddInput = z.infer<typeof tokenAddInputSchema>;

export const tokenUpdateInputSchema = z.object({
  id: idSchema,
  label: z.string().trim().max(120).optional(),
  kind: tokenKindSchema.optional(),
  // null clears the owner/reference; undefined leaves it unchanged.
  ownerId: idSchema.nullish(),
  characterId: idSchema.nullish(),
  compendiumId: idSchema.nullish(),
  hp: hpSchema.optional(),
  maxHp: hpSchema.optional(),
  size: tokenSizeSchema.optional(),
  cellX: cellCoordSchema.optional(),
  cellY: cellCoordSchema.optional(),
  // null clears the image; undefined leaves it unchanged.
  imageKey: mediaKeySchema.nullish(),
});
export type TokenUpdateInput = z.infer<typeof tokenUpdateInputSchema>;

/** Set/replace/clear a board background image (null clears). Master-only. */
export const boardSetBackgroundInputSchema = z.object({
  id: idSchema,
  imageKey: mediaKeySchema.nullable(),
});
export type BoardSetBackgroundInput = z.infer<typeof boardSetBackgroundInputSchema>;

export const tokenMoveInputSchema = z.object({
  tokenId: idSchema,
  cellX: cellCoordSchema,
  cellY: cellCoordSchema,
});
export type TokenMoveInput = z.infer<typeof tokenMoveInputSchema>;

export const tokensClearInputSchema = z.object({ boardId: idSchema });
export type TokensClearInput = z.infer<typeof tokensClearInputSchema>;

export const tokenAdjustHpInputSchema = z.object({
  id: idSchema,
  delta: z.number().int().min(-1_000_000).max(1_000_000),
});
export type TokenAdjustHpInput = z.infer<typeof tokenAdjustHpInputSchema>;

export interface TokenDto {
  id: number;
  boardId: number;
  kind: (typeof tokenKinds)[number];
  label: string;
  ownerId: number | null;
  characterId: number | null;
  compendiumId: number | null;
  cellX: number;
  cellY: number;
  /** Hidden (null) for viewers who may not see this token's HP. */
  hp: number | null;
  maxHp: number | null;
  size: number;
  imageKey: string | null;
}

/* -------------------------------- initiative ------------------------------- */

export const initiativeEntrySchema = z.object({
  tokenId: idSchema,
  value: z.number().min(-1000).max(100_000),
});
export type InitiativeEntry = z.infer<typeof initiativeEntrySchema>;

// Applies to the given board, or to the active board when boardId is omitted.
export const initiativeSetInputSchema = z.object({
  entries: z.array(initiativeEntrySchema).max(500),
  boardId: idSchema.optional(),
});
export type InitiativeSetInput = z.infer<typeof initiativeSetInputSchema>;

/* ------------------------------- game.state -------------------------------- */

/**
 * Optional board selector for game.state. Only honored for the master:
 * players always view the globally active board.
 */
export const gameStateInputSchema = z
  .object({
    boardId: idSchema.optional(),
  })
  .nullish()
  // Legacy clients and thin HTTP helpers may encode "no input" as null.
  .transform((input) => input ?? undefined);
export type GameStateInput = z.infer<typeof gameStateInputSchema>;

export interface GameStateDto {
  me: UserDto;
  revision: number;
  boards: BoardDto[];
  /** The globally player-visible board. */
  activeBoard: BoardDto | null;
  /**
   * The board the requester actually views: for the master this may be any
   * board (via gameStateInputSchema.boardId); for players it is always the
   * active board. `tokens` and `initiative` belong to this board.
   */
  viewedBoard: BoardDto | null;
  /** Tokens of the viewed board (empty when there is none). */
  tokens: TokenDto[];
  /** Initiative of the viewed board (empty when there is none). */
  initiative: InitiativeEntry[];
}

/** Game-mutation result envelope: changed entity plus the new game revision. */
export interface WithRevision<T> {
  revision: number;
  value: T;
}

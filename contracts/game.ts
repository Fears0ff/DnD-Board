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
    hp: hpSchema,
    maxHp: hpSchema,
    size: tokenSizeSchema.optional(),
    cellX: cellCoordSchema.optional(),
    cellY: cellCoordSchema.optional(),
  })
  .refine((v) => v.hp <= v.maxHp, {
    message: "hp must be <= maxHp",
    path: ["hp"],
  });
export type TokenAddInput = z.infer<typeof tokenAddInputSchema>;

export const tokenUpdateInputSchema = z.object({
  id: idSchema,
  label: z.string().trim().max(120).optional(),
  kind: tokenKindSchema.optional(),
  // null clears the owner; undefined leaves it unchanged.
  ownerId: idSchema.nullish(),
  hp: hpSchema.optional(),
  maxHp: hpSchema.optional(),
  size: tokenSizeSchema.optional(),
  cellX: cellCoordSchema.optional(),
  cellY: cellCoordSchema.optional(),
});
export type TokenUpdateInput = z.infer<typeof tokenUpdateInputSchema>;

export const tokenMoveInputSchema = z.object({
  tokenId: idSchema,
  cellX: cellCoordSchema,
  cellY: cellCoordSchema,
});
export type TokenMoveInput = z.infer<typeof tokenMoveInputSchema>;

export const tokensClearInputSchema = z.object({ boardId: idSchema });
export type TokensClearInput = z.infer<typeof tokensClearInputSchema>;

export interface TokenDto {
  id: number;
  boardId: number;
  kind: (typeof tokenKinds)[number];
  label: string;
  ownerId: number | null;
  cellX: number;
  cellY: number;
  hp: number;
  maxHp: number;
  size: number;
  imageKey: string | null;
}

/* -------------------------------- initiative ------------------------------- */

export const initiativeEntrySchema = z.object({
  tokenId: idSchema,
  value: z.number().min(-1000).max(100_000),
});
export type InitiativeEntry = z.infer<typeof initiativeEntrySchema>;

// Applies to the currently active board; the board is resolved server-side.
export const initiativeSetInputSchema = z.object({
  entries: z.array(initiativeEntrySchema).max(500),
});
export type InitiativeSetInput = z.infer<typeof initiativeSetInputSchema>;

/* ------------------------------- game.state -------------------------------- */

export interface GameStateDto {
  me: UserDto;
  revision: number;
  boards: BoardDto[];
  activeBoard: BoardDto | null;
  /** Tokens of the active board (empty when there is none). */
  tokens: TokenDto[];
  /** Initiative of the active board (empty when there is none). */
  initiative: InitiativeEntry[];
}

/** Game-mutation result envelope: changed entity plus the new game revision. */
export interface WithRevision<T> {
  revision: number;
  value: T;
}

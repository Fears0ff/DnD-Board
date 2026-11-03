import { z } from "zod";
import { tokenKinds } from "./constants";
import type { UserDto } from "./auth";

export const tokenKindSchema = z.enum(tokenKinds);

/* ----------------------------------- DTO ----------------------------------- */

export interface BoardDto {
  id: number;
  name: string;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
  isActive: boolean;
  createdAt: string;
}

export interface TokenDto {
  id: number;
  boardId: number;
  kind: (typeof tokenKinds)[number];
  label: string;
  /** null = unowned; players may move only their own tokens. */
  ownerId: number | null;
  characterId: number | null;
  compendiumId: number | null;
  cellX: number;
  cellY: number;
  hp: number;
  maxHp: number;
  /** Token footprint in grid squares (>= 1). */
  size: number;
  imageKey: string | null;
}

export interface InitiativeEntry {
  tokenId: number;
  value: number;
}

/** The entire shared game space in one snapshot; revision is the sync token. */
export interface GameStateDto {
  me: UserDto;
  revision: number;
  boards: BoardDto[];
  activeBoard: BoardDto | null;
  tokens: TokenDto[];
  initiative: InitiativeEntry[];
}

/* ---------------------------------- inputs --------------------------------- */

const cellCoordinate = z.number().int().min(0).max(1000);
const hpValue = z.number().int().min(0).max(100_000);

export const boardCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cellSize: z.number().int().min(4).max(1024).optional(),
  gridWidth: z.number().int().min(1).max(500).optional(),
  gridHeight: z.number().int().min(1).max(500).optional(),
});
export type BoardCreateInput = z.infer<typeof boardCreateInputSchema>;

export const boardRenameInputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
});

export const boardIdInputSchema = z.object({
  id: z.number().int().positive(),
});

export const tokenAddInputSchema = z.object({
  kind: tokenKindSchema,
  label: z.string().trim().min(1).max(80),
  ownerId: z.number().int().positive().nullable().optional(),
  cellX: cellCoordinate.optional(),
  cellY: cellCoordinate.optional(),
  hp: hpValue,
  maxHp: hpValue,
  size: z.number().min(0.5).max(10).optional(),
});
export type TokenAddInput = z.infer<typeof tokenAddInputSchema>;

export const tokenUpdateInputSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().trim().min(1).max(80).optional(),
  kind: tokenKindSchema.optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  hp: hpValue.optional(),
  maxHp: hpValue.optional(),
  size: z.number().min(0.5).max(10).optional(),
  cellX: cellCoordinate.optional(),
  cellY: cellCoordinate.optional(),
});
export type TokenUpdateInput = z.infer<typeof tokenUpdateInputSchema>;

/** The only token operation available to players: move your own token. */
export const tokenMoveInputSchema = z.object({
  tokenId: z.number().int().positive(),
  cellX: cellCoordinate,
  cellY: cellCoordinate,
});
export type TokenMoveInput = z.infer<typeof tokenMoveInputSchema>;

export const tokensClearInputSchema = z.object({
  boardId: z.number().int().positive(),
});

export const initiativeSetInputSchema = z.object({
  entries: z
    .array(
      z.object({
        tokenId: z.number().int().positive(),
        value: z.number().int().min(-100).max(100_000),
      }),
    )
    .max(200),
});
export type InitiativeSetInput = z.infer<typeof initiativeSetInputSchema>;

import { z } from "zod";
import { mediaBackends } from "./constants";

/**
 * Media (image) contracts — plan §5.2 (media) and §8.
 *
 * Client-safe module: no Node imports. Image bytes travel through tRPC as
 * base64 (tRPC transports JSON; there is no multipart endpoint). The server
 * never trusts a client-supplied MIME or filename: the real type is sniffed
 * from the bytes, and the storage key is generated server-side.
 */

/** Hard limits enforced server-side (plan §8.2). */
export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 8192;

export const imageMimes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof imageMimes)[number];

/**
 * What the image will be used for; drives upload authorization (plan §4.3):
 * the master may upload for any purpose, players only for their own
 * `item`/`character` compendium cards (purpose "compendium" + compendiumId).
 */
export const mediaPurposes = ["board", "token", "compendium", "characterSheet"] as const;
export type MediaPurpose = (typeof mediaPurposes)[number];

// base64 inflates by 4/3; cap the encoded length so decoding never starts on
// a payload that could not possibly be within the byte limit.
const IMAGE_MAX_BASE64_CHARS = Math.ceil(IMAGE_MAX_BYTES / 3) * 4;

export const uploadImageInputSchema = z.object({
  /** Canonical base64 of the image bytes (no data: URL prefix). */
  dataBase64: z
    .string()
    .min(8)
    .max(IMAGE_MAX_BASE64_CHARS)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "dataBase64 must be canonical base64")
    .refine((v) => v.length % 4 === 0, "dataBase64 must be padded base64"),
  purpose: z.enum(mediaPurposes),
  /**
   * Target compendium card for purpose "compendium". Required for players
   * (ownership is verified); optional for the master.
   */
  compendiumId: z.number().int().positive().optional(),
});
export type UploadImageInput = z.infer<typeof uploadImageInputSchema>;

/** Safe DTO: keys only, never URLs (plan §5.2 — there is no imageUrl). */
export interface MediaAssetDto {
  key: string;
  backend: (typeof mediaBackends)[number];
  mime: ImageMime;
  size: number;
  width: number;
  height: number;
  createdAt: string;
}

/** Cache policy for GET /api/board-image responses (plan §8.2). */
export const BOARD_IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";

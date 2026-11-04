import { z } from "zod";

/**
 * Personal Markdown notes contracts.
 *
 * Notes are strictly private to their owner: even a master cannot read,
 * update or delete another user's note (inaccessible notes answer 404).
 * Notes are not part of any realtime broadcast.
 *
 * Shared with the frontend bundle: keep free of Node-only imports.
 */

const idSchema = z.number().int().positive();

export const noteTitleSchema = z.string().trim().min(1).max(120);
export const noteContentSchema = z.string().max(200_000);

export const noteIdInputSchema = z.object({ id: idSchema });
export type NoteIdInput = z.infer<typeof noteIdInputSchema>;

export const noteCreateInputSchema = z.object({
  title: noteTitleSchema.default("Untitled note"),
  content: noteContentSchema.default(""),
});
export type NoteCreateInput = z.infer<typeof noteCreateInputSchema>;

export const noteUpdateInputSchema = z
  .object({
    id: idSchema,
    /** Optimistic concurrency: must equal the current row version. */
    expectedVersion: z.number().int().min(1),
    title: noteTitleSchema.optional(),
    content: noteContentSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, {
    message: "Nothing to update",
  });
export type NoteUpdateInput = z.infer<typeof noteUpdateInputSchema>;

/** List payload: no note body. */
export interface NoteSummaryDto {
  id: number;
  title: string;
  version: number;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto extends NoteSummaryDto {
  content: string;
}

export type {
  VersionConflictCause,
} from "./characters";
export {
  readVersionConflict,
  versionConflictCause,
} from "./characters";

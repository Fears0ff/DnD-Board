import { z } from "zod";

/**
 * Personal Markdown notes contracts.
 *
 * Notes are private by default. The owner may grant read-only access to any
 * number of users. Only the owner can edit, delete or manage recipients;
 * inaccessible notes answer 404. Open note lists poll for changes.
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

export const noteSharesInputSchema = z.object({
  id: idSchema,
  userIds: z.array(idSchema).max(100).transform((ids) => [...new Set(ids)]),
});
export type NoteSharesInput = z.infer<typeof noteSharesInputSchema>;

/** List payload: no note body. */
export interface NoteSummaryDto {
  id: number;
  title: string;
  version: number;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  ownerId: number;
  ownerName: string;
  isOwner: boolean;
  sharedWith: Array<{ id: number; login: string; displayName: string }>;
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

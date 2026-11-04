import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { NoteRow, UserRow } from "../../db/schema";
import {
  versionConflictCause,
  type NoteCreateInput,
  type NoteDto,
  type NoteSummaryDto,
  type NoteUpdateInput,
} from "../../contracts/notes";
import {
  deleteNoteRow,
  findNoteById,
  insertNote,
  listNotesByUser,
  toNoteDto,
  toNoteSummaryDto,
  updateNoteRow,
} from "../repositories/notes";

/**
 * Personal Markdown notes. Strictly private: only the owner may list, read,
 * update or remove them — even a master gets 404 for another user's note.
 * Notes are not broadcast over realtime. Mutations return the full DTO whose
 * `version` is the new optimistic-concurrency version.
 */

function requireOwnNote(db: DbHandle, user: UserRow, id: number): NoteRow {
  const row = findNoteById(db, id);
  if (!row || row.userId !== user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
  }
  return row;
}

export function listNotes(db: DbHandle, user: UserRow): NoteSummaryDto[] {
  return listNotesByUser(db, user.id).map(toNoteSummaryDto);
}

export function getNote(db: DbHandle, user: UserRow, id: number): NoteDto {
  return toNoteDto(requireOwnNote(db, user, id));
}

export function createNote(
  db: AppDatabase,
  user: UserRow,
  input: NoteCreateInput,
): NoteDto {
  return db.transaction((tx) =>
    toNoteDto(
      insertNote(tx, {
        userId: user.id,
        title: input.title,
        content: input.content,
      }),
    ),
  );
}

/**
 * Owner-only update with optimistic concurrency. A stale `expectedVersion`
 * never overwrites: the guarded UPDATE touches 0 rows and the caller gets
 * 409 plus the CURRENT entity/version in the error cause.
 */
export function updateNote(
  db: AppDatabase,
  user: UserRow,
  input: NoteUpdateInput,
): NoteDto {
  return db.transaction((tx) => {
    const row = requireOwnNote(tx, user, input.id);
    const updated = updateNoteRow(tx, row.id, input.expectedVersion, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    });
    if (!updated) {
      const fresh = findNoteById(tx, row.id);
      const current = fresh ? toNoteDto(fresh) : toNoteDto(row);
      throw new TRPCError({
        code: "CONFLICT",
        message: `Note was modified concurrently; current version is ${current.version}`,
        cause: versionConflictCause(current),
      });
    }
    return toNoteDto(updated);
  });
}

export function removeNote(
  db: AppDatabase,
  user: UserRow,
  id: number,
): { removedId: number } {
  return db.transaction((tx) => {
    const row = requireOwnNote(tx, user, id);
    deleteNoteRow(tx, row.id);
    return { removedId: row.id };
  });
}

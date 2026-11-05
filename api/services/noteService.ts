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
  isNoteSharedWith,
  listNotesByUser,
  replaceNoteShares,
  toNoteDto,
  toNoteSummaryDto,
  updateNoteRow,
} from "../repositories/notes";
import { findUserById, listUsers, toUserDto } from "../repositories/users";

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
}

function requireOwnNote(db: DbHandle, user: UserRow, id: number): NoteRow {
  const row = findNoteById(db, id);
  if (!row || row.userId !== user.id) return notFound();
  return row;
}

function requireReadableNote(db: DbHandle, user: UserRow, id: number): NoteRow {
  const row = findNoteById(db, id);
  if (!row || (row.userId !== user.id && !isNoteSharedWith(db, id, user.id))) return notFound();
  return row;
}

export function listNotes(db: DbHandle, user: UserRow): NoteSummaryDto[] {
  return listNotesByUser(db, user.id).map((row) => toNoteSummaryDto(db, row, user.id));
}

export function listNoteShareCandidates(db: DbHandle, user: UserRow) {
  return listUsers(db).filter((candidate) => candidate.id !== user.id).map(toUserDto);
}

export function getNote(db: DbHandle, user: UserRow, id: number): NoteDto {
  return toNoteDto(db, requireReadableNote(db, user, id), user.id);
}

export function createNote(db: AppDatabase, user: UserRow, input: NoteCreateInput): NoteDto {
  return db.transaction((tx) =>
    toNoteDto(tx, insertNote(tx, { userId: user.id, title: input.title, content: input.content }), user.id),
  );
}

/** Owner-only update with optimistic concurrency. */
export function updateNote(db: AppDatabase, user: UserRow, input: NoteUpdateInput): NoteDto {
  return db.transaction((tx) => {
    const row = requireOwnNote(tx, user, input.id);
    const updated = updateNoteRow(tx, row.id, input.expectedVersion, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
    });
    if (!updated) {
      const fresh = findNoteById(tx, row.id);
      const current = toNoteDto(tx, fresh ?? row, user.id);
      throw new TRPCError({
        code: "CONFLICT",
        message: `Note was modified concurrently; current version is ${current.version}`,
        cause: versionConflictCause(current),
      });
    }
    return toNoteDto(tx, updated, user.id);
  });
}

export function setNoteShares(
  db: AppDatabase,
  user: UserRow,
  id: number,
  userIds: number[],
): NoteDto {
  return db.transaction((tx) => {
    const row = requireOwnNote(tx, user, id);
    for (const userId of userIds) {
      if (userId === user.id || !findUserById(tx, userId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid note recipient" });
      }
    }
    replaceNoteShares(tx, id, userIds);
    return toNoteDto(tx, row, user.id);
  });
}

export function removeNote(db: AppDatabase, user: UserRow, id: number): { removedId: number } {
  return db.transaction((tx) => {
    const row = requireOwnNote(tx, user, id);
    deleteNoteRow(tx, row.id);
    return { removedId: row.id };
  });
}

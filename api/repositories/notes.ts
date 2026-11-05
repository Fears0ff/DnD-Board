import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import { notes, noteShares, users, type NoteRow } from "../../db/schema";
import type { NoteDto, NoteSummaryDto } from "../../contracts/notes";

type Db = DbHandle;

export function listNoteShares(db: Db, noteId: number) {
  return db
    .select({ id: users.id, login: users.loginNormalized, displayName: users.displayName })
    .from(noteShares)
    .innerJoin(users, eq(users.id, noteShares.userId))
    .where(eq(noteShares.noteId, noteId))
    .orderBy(asc(users.id))
    .all();
}

export function toNoteSummaryDto(db: Db, row: NoteRow, currentUserId: number): NoteSummaryDto {
  const owner = db
    .select({ login: users.loginNormalized, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, row.userId))
    .get();
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    ownerId: row.userId,
    ownerName: owner?.displayName || owner?.login || `Пользователь #${row.userId}`,
    isOwner: row.userId === currentUserId,
    sharedWith: listNoteShares(db, row.id),
  };
}

export function toNoteDto(db: Db, row: NoteRow, currentUserId: number): NoteDto {
  return { ...toNoteSummaryDto(db, row, currentUserId), content: row.content };
}

/** Owned notes plus notes explicitly shared with this user. */
export function listNotesByUser(db: Db, userId: number): NoteRow[] {
  const sharedIds = db
    .select({ id: noteShares.noteId })
    .from(noteShares)
    .where(eq(noteShares.userId, userId))
    .all()
    .map((row) => row.id);
  return db
    .select()
    .from(notes)
    .where(sharedIds.length > 0 ? or(eq(notes.userId, userId), inArray(notes.id, sharedIds)) : eq(notes.userId, userId))
    .orderBy(asc(notes.id))
    .all();
}

export function findNoteById(db: Db, id: number): NoteRow | undefined {
  return db.select().from(notes).where(eq(notes.id, id)).get();
}

export function isNoteSharedWith(db: Db, noteId: number, userId: number): boolean {
  return Boolean(
    db
      .select({ noteId: noteShares.noteId })
      .from(noteShares)
      .where(and(eq(noteShares.noteId, noteId), eq(noteShares.userId, userId)))
      .get(),
  );
}

export function replaceNoteShares(db: Db, noteId: number, userIds: number[]): void {
  db.delete(noteShares).where(eq(noteShares.noteId, noteId)).run();
  if (userIds.length > 0) {
    db.insert(noteShares)
      .values(userIds.map((userId) => ({ noteId, userId, createdAt: Date.now() })))
      .run();
  }
}

export function insertNote(
  db: Db,
  values: { userId: number; title: string; content: string },
): NoteRow {
  const now = Date.now();
  return db
    .insert(notes)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

/** Version-guarded write; undefined means a version conflict or missing row. */
export function updateNoteRow(
  db: Db,
  id: number,
  expectedVersion: number,
  patch: { title?: string; content?: string },
): NoteRow | undefined {
  return db
    .update(notes)
    .set({ ...patch, version: sql`${notes.version} + 1`, updatedAt: Date.now() })
    .where(and(eq(notes.id, id), eq(notes.version, expectedVersion)))
    .returning()
    .get();
}

export function deleteNoteRow(db: Db, id: number): void {
  db.delete(notes).where(eq(notes.id, id)).run();
}

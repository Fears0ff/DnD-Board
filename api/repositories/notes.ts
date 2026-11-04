import { and, asc, eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import { notes, type NoteRow } from "../../db/schema";
import type { NoteDto, NoteSummaryDto } from "../../contracts/notes";

type Db = DbHandle;

export function toNoteSummaryDto(row: NoteRow): NoteSummaryDto {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function toNoteDto(row: NoteRow): NoteDto {
  return { ...toNoteSummaryDto(row), content: row.content };
}

/** Notes are strictly personal: listing is always scoped to the owner. */
export function listNotesByUser(db: Db, userId: number): NoteRow[] {
  return db
    .select()
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(asc(notes.id))
    .all();
}

export function findNoteById(db: Db, id: number): NoteRow | undefined {
  return db.select().from(notes).where(eq(notes.id, id)).get();
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

/**
 * Version-guarded write: the row is only touched when its version still
 * equals `expectedVersion`. Returns undefined on version mismatch (or missing
 * row); the caller distinguishes the two and reports 409 vs 404.
 */
export function updateNoteRow(
  db: Db,
  id: number,
  expectedVersion: number,
  patch: { title?: string; content?: string },
): NoteRow | undefined {
  return db
    .update(notes)
    .set({
      ...patch,
      version: sql`${notes.version} + 1`,
      updatedAt: Date.now(),
    })
    .where(and(eq(notes.id, id), eq(notes.version, expectedVersion)))
    .returning()
    .get();
}

export function deleteNoteRow(db: Db, id: number): void {
  db.delete(notes).where(eq(notes.id, id)).run();
}

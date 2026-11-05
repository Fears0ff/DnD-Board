import { authedProcedure, createRouter } from "../middleware";
import {
  noteCreateInputSchema,
  noteIdInputSchema,
  noteSharesInputSchema,
  noteUpdateInputSchema,
} from "../../contracts/notes";
import { getDb } from "../../db/connection";
import {
  createNote,
  getNote,
  listNotes,
  listNoteShareCandidates,
  removeNote,
  setNoteShares,
  updateNote,
} from "../services/noteService";

/**
 * Private-by-default Markdown notes with owner-managed read-only sharing.
 * Content writes use optimistic concurrency; open lists poll for changes.
 */
export const notesRouter = createRouter({
  list: authedProcedure.query(({ ctx }) => listNotes(getDb(), ctx.user)),

  shareCandidates: authedProcedure.query(({ ctx }) =>
    listNoteShareCandidates(getDb(), ctx.user),
  ),

  setShares: authedProcedure
    .input(noteSharesInputSchema)
    .mutation(({ ctx, input }) =>
      setNoteShares(getDb(), ctx.user, input.id, input.userIds),
    ),

  get: authedProcedure
    .input(noteIdInputSchema)
    .query(({ ctx, input }) => getNote(getDb(), ctx.user, input.id)),

  create: authedProcedure
    .input(noteCreateInputSchema)
    .mutation(({ ctx, input }) => createNote(getDb(), ctx.user, input)),

  // expectedVersion guards against lost updates; stale writes get 409 with
  // the current entity in the error cause.
  update: authedProcedure
    .input(noteUpdateInputSchema)
    .mutation(({ ctx, input }) => updateNote(getDb(), ctx.user, input)),

  remove: authedProcedure
    .input(noteIdInputSchema)
    .mutation(({ ctx, input }) => removeNote(getDb(), ctx.user, input.id)),
});

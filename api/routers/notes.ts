import { authedProcedure, createRouter } from "../middleware";
import {
  noteCreateInputSchema,
  noteIdInputSchema,
  noteUpdateInputSchema,
} from "../../contracts/notes";
import { getDb } from "../../db/connection";
import {
  createNote,
  getNote,
  listNotes,
  removeNote,
  updateNote,
} from "../services/noteService";

/**
 * Personal Markdown notes. Strictly private to the owner — even the master
 * gets 404 for another user's note. No realtime broadcast; mutations return
 * the new `version` for optimistic concurrency.
 */
export const notesRouter = createRouter({
  list: authedProcedure.query(({ ctx }) => listNotes(getDb(), ctx.user)),

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

import { authedProcedure, createRouter } from "../middleware";
import {
  characterCreateInputSchema,
  characterIdInputSchema,
  characterImportLssInputSchema,
  characterUpdateInputSchema,
} from "../../contracts/characters";
import { getDb } from "../../db/connection";
import {
  createCharacter,
  getCharacter,
  importLssCharacter,
  listCharacters,
  removeCharacter,
  updateCharacter,
} from "../services/characterService";

/**
 * Character sheets. Any signed-in user may manage their own sheets; the
 * master may additionally read/update/remove every sheet. Sheets have no
 * realtime subscription — clients re-read on open/focus, and mutations
 * return the new `version` for optimistic concurrency.
 */
export const charactersRouter = createRouter({
  // Master: all sheets (summaries). Player: own sheets only.
  list: authedProcedure.query(({ ctx }) => listCharacters(getDb(), ctx.user)),

  get: authedProcedure
    .input(characterIdInputSchema)
    .query(({ ctx, input }) => getCharacter(getDb(), ctx.user, input.id)),

  // Optionally copies a compendium `character` card (input.sourceCardId);
  // after creation sheet and card are independent.
  create: authedProcedure
    .input(characterCreateInputSchema)
    .mutation(({ ctx, input }) => createCharacter(getDb(), ctx.user, input)),

  // expectedVersion guards against lost updates; stale writes get 409 with
  // the current entity in the error cause.
  update: authedProcedure
    .input(characterUpdateInputSchema)
    .mutation(({ ctx, input }) => updateCharacter(getDb(), ctx.user, input)),

  // Импорт выгрузки Long Story Short: всегда создаёт НОВЫЙ лист вызывающего.
  // Ошибки формата приходят как BAD_REQUEST с сообщением на русском.
  importLss: authedProcedure
    .input(characterImportLssInputSchema)
    .mutation(({ ctx, input }) => importLssCharacter(getDb(), ctx.user, input.jsonText)),

  remove: authedProcedure
    .input(characterIdInputSchema)
    .mutation(({ ctx, input }) => removeCharacter(getDb(), ctx.user, input.id)),
});

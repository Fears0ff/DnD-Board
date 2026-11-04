import { authedProcedure, createRouter, masterProcedure } from "../middleware";
import {
  compendiumCopyInputSchema,
  compendiumCreateInputSchema,
  compendiumGetInputSchema,
  compendiumImportInputSchema,
  compendiumListInputSchema,
  compendiumRemoveInputSchema,
  compendiumUpdateInputSchema,
} from "../../contracts/compendium";
import { getDb } from "../../db/connection";
import {
  copyCard,
  createCard,
  getCard,
  importCards,
  listCards,
  removeCard,
  updateCard,
} from "../services/compendiumService";

/**
 * Compendium API. `list` is the single read for the browser and the pickers
 * (no separate listPickable). Mutations return the changed entity plus the
 * new compendiumRevision. create/update/remove/importJson are master-only;
 * copy is available to any signed-in user over cards they can read (players
 * always receive an independent private copy).
 */
export const compendiumRouter = createRouter({
  list: authedProcedure
    .input(compendiumListInputSchema.optional())
    .query(({ ctx, input }) => listCards(getDb(), ctx.user, input)),

  get: authedProcedure
    .input(compendiumGetInputSchema)
    .query(({ ctx, input }) => getCard(getDb(), ctx.user, input.id)),

  create: masterProcedure
    .input(compendiumCreateInputSchema)
    .mutation(({ ctx, input }) => createCard(getDb(), ctx.user, input)),

  update: masterProcedure
    .input(compendiumUpdateInputSchema)
    .mutation(({ ctx, input }) => updateCard(getDb(), ctx.user, input)),

  remove: masterProcedure
    .input(compendiumRemoveInputSchema)
    .mutation(({ ctx, input }) => removeCard(getDb(), ctx.user, input.id)),

  copy: authedProcedure
    .input(compendiumCopyInputSchema)
    .mutation(({ ctx, input }) => copyCard(getDb(), ctx.user, input)),

  importJson: masterProcedure
    .input(compendiumImportInputSchema)
    .mutation(({ input }) => importCards(getDb(), input.json)),
});

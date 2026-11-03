import { authedProcedure, createRouter, masterProcedure } from "../middleware";
import {
  boardCreateInputSchema,
  boardIdInputSchema,
  boardRenameInputSchema,
  initiativeSetInputSchema,
  tokenAddInputSchema,
  tokenMoveInputSchema,
  tokenUpdateInputSchema,
  tokensClearInputSchema,
} from "../../contracts/game";
import { getDb } from "../../db/connection";
import {
  addToken,
  clearTokens,
  createBoard,
  getGameState,
  moveToken,
  removeBoard,
  removeToken,
  renameBoard,
  setActiveBoard,
  setInitiative,
  updateToken,
} from "../services/gameService";

/** Snapshot read: any signed-in user may read the shared board state. */
export const gameRouter = createRouter({
  state: authedProcedure.query(({ ctx }) => getGameState(getDb(), ctx.user)),
});

/** Boards are managed by the master only. */
export const boardsRouter = createRouter({
  create: masterProcedure
    .input(boardCreateInputSchema)
    .mutation(({ input }) => {
      const { value, revision } = createBoard(getDb(), input);
      return { board: value, revision };
    }),

  rename: masterProcedure
    .input(boardRenameInputSchema)
    .mutation(({ input }) => {
      const { value, revision } = renameBoard(getDb(), input.id, input.name);
      return { board: value, revision };
    }),

  remove: masterProcedure.input(boardIdInputSchema).mutation(({ input }) => {
    const { value, revision } = removeBoard(getDb(), input.id);
    return { ...value, revision };
  }),

  setActive: masterProcedure
    .input(boardIdInputSchema)
    .mutation(({ input }) => {
      const { value, revision } = setActiveBoard(getDb(), input.id);
      return { board: value, revision };
    }),
});

export const tokensRouter = createRouter({
  add: masterProcedure.input(tokenAddInputSchema).mutation(({ input }) => {
    const { value, revision } = addToken(getDb(), input);
    return { token: value, revision };
  }),

  // Master-only by design, so a player can never edit restricted fields.
  update: masterProcedure.input(tokenUpdateInputSchema).mutation(({ input }) => {
    const { value, revision } = updateToken(getDb(), input);
    return { token: value, revision };
  }),

  // The single token operation a player may perform — and only on a token
  // they own (enforced in the service, not just hidden in the UI).
  move: authedProcedure.input(tokenMoveInputSchema).mutation(({ ctx, input }) => {
    const { value, revision } = moveToken(getDb(), ctx.user, input);
    return { token: value, revision };
  }),

  remove: masterProcedure.input(boardIdInputSchema).mutation(({ input }) => {
    const { value, revision } = removeToken(getDb(), input.id);
    return { ...value, revision };
  }),

  clear: masterProcedure
    .input(tokensClearInputSchema)
    .mutation(({ input }) => {
      const { value, revision } = clearTokens(getDb(), input.boardId);
      return { ...value, revision };
    }),
});

export const initiativeRouter = createRouter({
  // Manual numbers entered by the master for the active board.
  set: masterProcedure
    .input(initiativeSetInputSchema)
    .mutation(({ input }) => {
      const { value, revision } = setInitiative(getDb(), input.entries);
      return { initiative: value, revision };
    }),
});

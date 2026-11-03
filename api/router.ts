import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { usersRouter } from "./routers/users";
import {
  boardsRouter,
  gameRouter,
  initiativeRouter,
  tokensRouter,
} from "./routers/game";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  users: usersRouter,
  game: gameRouter,
  boards: boardsRouter,
  tokens: tokensRouter,
  initiative: initiativeRouter,
});

export type AppRouter = typeof appRouter;

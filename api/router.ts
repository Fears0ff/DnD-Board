import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { usersRouter } from "./routers/users";
import {
  boardsRouter,
  campaignsRouter,
  gameRouter,
  initiativeRouter,
  tokensRouter,
} from "./routers/game";
import { charactersRouter } from "./routers/characters";
import { notesRouter } from "./routers/notes";
import { mediaRouter } from "./routers/media";
import { compendiumRouter } from "./routers/compendium";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  users: usersRouter,
  game: gameRouter,
  boards: boardsRouter,
  campaigns: campaignsRouter,
  tokens: tokensRouter,
  initiative: initiativeRouter,
  characters: charactersRouter,
  notes: notesRouter,
  media: mediaRouter,
  compendium: compendiumRouter,
});

export type AppRouter = typeof appRouter;

import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { migrate } from "../db/migrate";
import { getDb, getSqlite } from "../db/connection";
import { log, logFilePath } from "./lib/logger";
import { REQUEST_ID_HEADER, runWithRequestId } from "./lib/requestcontext";
import { appRouter } from "./router";
import { createContext } from "./context";
import { handleClientLog } from "./lib/clientlog";
import { startHttpServer } from "./runtime/serve";
import { serveStaticFiles } from "./runtime/static";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

// Request id middleware: mint once per request, echo on the response, and scope
// the whole handler inside AsyncLocalStorage so every server log line written
// while this request is in flight (even after awaits) carries the same id. See
// api/lib/requestcontext.ts for why the id exists and how the browser uses it.
app.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.header(REQUEST_ID_HEADER, requestId);
  return runWithRequestId(requestId, () => next());
});

// Access log: one line per request with status and duration. Kept in the same
// app.log as everything else (not a separate access file) because the agent's
// whole story of a request lives there. Skipped for /api/log: client-log POSTs
// would otherwise log their own log ingestion and the file becomes a feedback
// loop of meta-noise.
app.use("*", async (c, next) => {
  if (c.req.path === "/api/log") return next();
  const start = Date.now();
  await next();
  log.info("http request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  });
});

// Errors returned by handlers are part of the HTTP contract (a 401 is a
// deliberate answer) and are NOT logged; errors THROWN by handlers are crashes
// and land here, which is why this exists: without a 500 log the agent cannot
// see that anything failed at all.
app.onError((err, c) => {
  log.error("unhandled error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
  });
  return c.json({ error: "Internal Server Error" }, 500);
});

if (!env.isProduction) {
  app.use(
    "/api/*",
    cors({
      origin: "http://localhost:5173",
      credentials: true,
    }),
  );
}

app.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Browser log sink. Must sit BEFORE serveStaticFiles: in production the static
// handler's catch-all notFound answers everything non-API that it does not
// recognize, and a POST here is exactly that — a logger that logs "logged" but
// drops the line on the floor. This route is also why /api/log is skipped by
// the access-log middleware above.
app.post("/api/log", handleClientLog);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

if (env.isProduction) {
  serveStaticFiles(app);
}

const port = Number(process.env.PORT) || 3000;

/**
 * Boot order is deliberate: open the DB, apply pending migrations, and only
 * then accept traffic. A migration that throws aborts startup (the process
 * crashes before listening) instead of serving against a half-migrated schema.
 */
export async function boot() {
  getDb();
  const result = migrate(getSqlite());
  if (result.applied.length > 0) {
    log.info("database migrated", { applied: result.applied });
  }
  startHttpServer(app, port);
}

if (process.env.NODE_ENV !== "test") {
  boot().catch((err) => {
    log.error("fatal: failed to boot", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      logFile: logFilePath,
    });
    process.exit(1);
  });
}

export default app;

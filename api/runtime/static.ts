import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";

type App = Hono<{ Bindings: HttpBindings }>;

/**
 * Serves the built client (dist/public) with an SPA fallback: unknown paths
 * that accept HTML get index.html so client-side routes work on refresh.
 * Only registered in production; in dev the Vite dev-server owns the frontend.
 */
export function serveStaticFiles(app: App): void {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}

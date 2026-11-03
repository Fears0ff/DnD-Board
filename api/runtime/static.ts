import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";

type App = Hono<{ Bindings: HttpBindings }>;

/**
 * Production static serving anchored to the bundle, not process.cwd().
 * The platform helper remains untouched; this adapter also works when a
 * launcher starts dist/boot.js from an arbitrary working directory.
 */
export function serveStaticFiles(app: App): void {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  app.use("*", serveStatic({ root: distPath }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    return c.html(fs.readFileSync(indexPath, "utf8"));
  });
}

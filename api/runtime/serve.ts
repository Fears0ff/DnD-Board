import type { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import { createGameHub, registerHub, type GameHub } from "../realtime/hub";
import { log } from "../lib/logger";

export interface RunningServer {
  /** Actual bound port (may differ from requested when port 0 was passed). */
  port: number;
  hub: GameHub;
  close: () => Promise<void>;
}

/**
 * Boots the combined HTTP + WebSocket server on one port:
 * tRPC/REST are served by the Hono app, /ws upgrades are handed to the hub.
 * Returns plain handles so both production boot and tests can manage the
 * lifecycle explicitly.
 */
export function startHttpServer(
  app: Hono<{ Bindings: HttpBindings }>,
  port: number,
): RunningServer {
  const server = serve({ fetch: app.fetch, port });

  const hub = createGameHub();
  registerHub(hub);
  server.on("upgrade", (req, socket, head) => {
    hub.handleUpgrade(req, socket, head);
  });

  server.on("error", (err) => {
    log.error("http server error", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const address = server.address();
  const boundPort =
    typeof address === "object" && address !== null ? address.port : port;
  log.info(`Server running on http://localhost:${boundPort}/`);

  return {
    port: boundPort,
    hub,
    close: () =>
      new Promise<void>((resolve) => {
        hub.close();
        server.close(() => resolve());
      }),
  };
}

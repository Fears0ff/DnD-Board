import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import {
  SESSION_COOKIE,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_PATH,
  type WsServerEvent,
} from "../../contracts/constants";
import { readCookie, verifySessionToken } from "../services/sessions";
import { findUserById } from "../repositories/users";
import { getDb } from "../../db/connection";
import { log } from "../lib/logger";

/**
 * WebSocket hub for /ws.
 *
 * The socket carries notifications only (`game.changed` / `compendium.changed`
 * with a revision number); it never accepts game mutations — those go through
 * tRPC. Upgrade requires the same valid session cookie as the HTTP API and,
 * when an Origin header is present, it must match the request host.
 *
 * `createGameHub` returns plain functions so the hub can be attached to any
 * Node HTTP server's "upgrade" event (production runtime, tests, Electron).
 */

export interface GameHub {
  /** Attach as: server.on("upgrade", hub.handleUpgrade) */
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  broadcastGameChanged: (revision: number) => void;
  broadcastCompendiumChanged: (revision: number) => void;
  clientCount: () => number;
  close: () => void;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } finally {
    socket.destroy();
  }
}

function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; cookie auth still applies
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export interface CreateGameHubOptions {
  heartbeatIntervalMs?: number;
}

export function createGameHub(
  options: CreateGameHubOptions = {},
): GameHub {
  const heartbeatMs =
    options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakSet<WebSocket>();

  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
    ws.on("error", () => {
      // a broken client socket must not take the hub down
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  async function authorize(req: IncomingMessage): Promise<number | null> {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return null;
    const session = await verifySessionToken(token);
    if (!session) return null;
    // Role and existence come from the DB at connect time, not the token.
    const user = findUserById(getDb(), session.userId);
    return user ? user.id : null;
  }

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (pathname !== WS_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!isOriginAllowed(req)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    authorize(req)
      .then((userId) => {
        if (userId === null) {
          rejectUpgrade(socket, 401, "Unauthorized");
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        log.error("ws upgrade authorization failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        rejectUpgrade(socket, 500, "Internal Server Error");
      });
  }

  function broadcast(event: WsServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  return {
    handleUpgrade,
    broadcastGameChanged: (revision) =>
      broadcast({ type: "game.changed", revision }),
    broadcastCompendiumChanged: (revision) =>
      broadcast({ type: "compendium.changed", revision }),
    clientCount: () => wss.clients.size,
    close: () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

/* ---------------------------------------------------------------------------
 * Publish-after-commit registry.
 *
 * Services bump a revision inside a transaction and call publish* AFTER the
 * transaction commits. When no hub is registered (unit tests, CLI scripts)
 * publishing is a no-op.
 * ------------------------------------------------------------------------- */

let activeHub: GameHub | null = null;

export function registerHub(hub: GameHub | null): void {
  activeHub = hub;
}

export function getHub(): GameHub | null {
  return activeHub;
}

export function publishGameChanged(revision: number): void {
  try {
    activeHub?.broadcastGameChanged(revision);
  } catch (err) {
    log.warn("failed to broadcast game.changed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function publishCompendiumChanged(revision: number): void {
  try {
    activeHub?.broadcastCompendiumChanged(revision);
  } catch (err) {
    log.warn("failed to broadcast compendium.changed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

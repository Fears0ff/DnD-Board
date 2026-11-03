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
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  publish: (event: WsServerEvent) => void;
  /** For tests: how many clients are currently attached. */
  clientCount: () => number;
  close: () => void;
}

const CLEAN_SHUTDOWN_CODE = 1012; // service restart → client should retry

export function createGameHub(): GameHub {
  const wss = new WebSocketServer({ noServer: true });
  let closed = false;

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      const socket = ws as WebSocket & { isAlive?: boolean };
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
  interval.unref();

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    // Origin allow-list: only same-host origins may open the socket.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      if (originHost !== req.headers.host) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    void (async () => {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = token ? await verifySessionToken(token) : null;
      const user = session ? findUserById(getDb(), session.userId) : undefined;
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, user.id);
      });
    })().catch(() => {
      socket.destroy();
    });
  }

  wss.on("connection", (ws: WebSocket & { isAlive?: boolean }, _req, userId) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("error", () => {
      ws.close();
    });
    log.debug("ws client connected", { userId });
  });

  function publish(event: WsServerEvent): void {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  return {
    handleUpgrade,
    publish,
    clientCount: () => wss.clients.size,
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      for (const client of wss.clients) {
        client.close(CLEAN_SHUTDOWN_CODE, "server shutdown");
      }
      wss.close();
    },
  };
}

/* ------------------------- module-level convenience ------------------------ */

let defaultHub: GameHub | null = null;

/** Called by the runtime once it owns the hub; tests pass null to isolate. */
export function registerHub(hub: GameHub | null): void {
  defaultHub = hub;
}

/** Publish-after-commit helper for services; safe when no hub is attached. */
export function publishGameChanged(revision: number): void {
  defaultHub?.publish({ type: "game.changed", revision });
}

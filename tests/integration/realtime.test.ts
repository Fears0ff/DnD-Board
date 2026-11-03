import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { createGameHub, registerHub, type GameHub } from "../../api/realtime/hub";
import { startHttpServer, type RunningServer } from "../../api/runtime/serve";
import {
  registerUser,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";
import { SESSION_COOKIE } from "../../contracts/constants";
import WebSocket from "ws";

let testDb: TestDb;
let server: RunningServer | null = null;

beforeEach(() => {
  testDb = useTempDb();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  teardownTempDb(testDb);
});

async function boot(): Promise<number> {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/health", (c) => c.json({ ok: true }));
  server = startHttpServer(app, 0);
  return server.port;
}

function connect(
  port: number,
  cookie?: string,
  headers?: Record<string, string>,
): Promise<{ ws: WebSocket; status: number | null }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(headers ?? {}),
      },
    });
    ws.once("open", () => resolve({ ws, status: null }));
    ws.once("unexpected-response", (_req, res) =>
      resolve({ ws, status: res.statusCode ?? 0 }),
    );
    ws.once("error", () => resolve({ ws, status: -1 }));
  });
}

describe("realtime hub", () => {
  it("rejects upgrade without a session cookie", async () => {
    const port = await boot();
    const { ws, status } = await connect(port);
    expect(status).toBe(401);
    ws.terminate();
  });

  it("rejects an invalid cookie and accepts a valid one", async () => {
    const port = await boot();
    const bad = await connect(port, `${SESSION_COOKIE}=junk`);
    expect(bad.status).toBe(401);
    bad.ws.terminate();

    const user = await registerUser("wsuser");
    const good = await connect(port, user.cookie);
    expect(good.status).toBeNull();
    good.ws.close();
  });

  it("rejects cross-origin upgrades", async () => {
    const port = await boot();
    const user = await registerUser("originuser");
    const evil = await connect(port, user.cookie, {
      origin: "http://evil.example",
    });
    expect(evil.status).toBe(403);
    evil.ws.terminate();
  });

  it("publishes game.changed to connected clients", async () => {
    const port = await boot();
    const user = await registerUser("sub");
    const { ws } = await connect(port, user.cookie);

    const hub: GameHub = server!.hub;
    const received = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(String(data)));
    });
    hub.publish({ type: "game.changed", revision: 42 });
    const payload = JSON.parse(await received);
    expect(payload).toEqual({ type: "game.changed", revision: 42 });
    ws.close();
  });

  it("close() detaches clients so close code 1012 is observable", async () => {
    const port = await boot();
    const user = await registerUser("closetest");
    const { ws } = await connect(port, user.cookie);
    const closed = new Promise<number>((resolve) => {
      ws.once("close", (code) => resolve(code));
    });
    server!.hub.close();
    expect(await closed).toBe(1012);
  });
});

describe("registerHub", () => {
  it("publishGameChanged is a no-op without a hub and publishes with one", async () => {
    const { publishGameChanged } = await import("../../api/realtime/hub");
    // No hub registered (helpers registered null) — must not throw.
    publishGameChanged(1);

    const events: unknown[] = [];
    const fakeHub: GameHub = {
      handleUpgrade: () => {},
      publish: (e) => events.push(e),
      clientCount: () => 0,
      close: () => {},
    };
    registerHub(fakeHub);
    publishGameChanged(7);
    expect(events).toEqual([{ type: "game.changed", revision: 7 }]);
    registerHub(null);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import bootApp from "../../api/boot";
import { startHttpServer, type RunningServer } from "../../api/runtime/serve";
import {
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

/**
 * End-to-end realtime checks against the REAL boot app: HTTP (tRPC, health)
 * and WS upgrades share one Node server on an ephemeral port, exactly like
 * the production runtime.
 */

let testDb: TestDb;
let server: RunningServer;
let baseUrl: string;
let wsUrl: string;

beforeEach(() => {
  testDb = useTempDb();
  server = startHttpServer(bootApp, 0);
  baseUrl = `http://localhost:${server.port}`;
  wsUrl = `ws://localhost:${server.port}/ws`;
});

afterEach(async () => {
  await server.close();
  teardownTempDb(testDb);
});

function connectWs(headers: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function expectUpgradeFailure(
  headers: Record<string, string>,
  status: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers });
    ws.once("open", () => {
      ws.close();
      reject(new Error(`expected upgrade to fail with ${status}`));
    });
    ws.once("unexpected-response", (_req, res) => {
      try {
        expect(res.statusCode).toBe(status);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("realtime server", () => {
  it("GET /api/health responds without authentication", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects WS upgrade without a session cookie (401)", async () => {
    await expectUpgradeFailure({ origin: baseUrl }, 401);
  });

  it("rejects WS upgrade with a foreign Origin (403)", async () => {
    const user = await registerUser("wsuser");
    await expectUpgradeFailure(
      { origin: "http://evil.example", cookie: user.cookie },
      403,
    );
  });

  it("rejects WS upgrade with a garbage cookie (401)", async () => {
    await expectUpgradeFailure(
      { origin: baseUrl, cookie: "dnd_session=junk" },
      401,
    );
  });

  it("accepts an authenticated same-origin upgrade and pushes game.changed after commit", async () => {
    const user = await registerUser("wsmaster");
    const ws = await connectWs({
      origin: baseUrl,
      cookie: user.cookie,
      host: `localhost:${server.port}`,
    });

    const messages: Array<{ type: string; revision: number }> = [];
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()));
    });
    expect(server.hub.clientCount()).toBe(1);

    // Mutation goes through tRPC; the notification must arrive only after
    // the transaction committed, carrying the new revision.
    const session = await newContext(user.cookie);
    const created = await session.caller.boards.create({ name: "Live" });

    await expect
      .poll(() => messages.length, { timeout: 2000, interval: 20 })
      .toBe(1);
    expect(messages[0]).toEqual({
      type: "game.changed",
      revision: created.revision,
    });

    ws.close();
    await expect
      .poll(() => server.hub.clientCount(), { timeout: 2000, interval: 20 })
      .toBe(0);
  });

  it("publishes nothing when a mutation rolls back", async () => {
    const user = await registerUser("wsrollback");
    const ws = await connectWs({
      origin: baseUrl,
      cookie: user.cookie,
      host: `localhost:${server.port}`,
    });
    const messages: unknown[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));

    const session = await newContext(user.cookie);
    await session.caller.boards.create({ name: "Live" });
    const { token } = await session.caller.tokens.add({
      kind: "hero",
      label: "x",
      hp: 5,
      maxHp: 10,
    });
    await expect
      .poll(() => messages.length, { timeout: 2000, interval: 20 })
      .toBe(2);

    // This update violates 0 <= hp <= maxHp and must roll back entirely:
    // no revision bump is committed, so no event may be published.
    messages.length = 0;
    await session.caller.tokens
      .update({ id: token.id, hp: 99 })
      .then(
        () => {
          throw new Error("update should have failed");
        },
        () => {
          // expected BAD_REQUEST
        },
      );
    await sleep(300);
    expect(messages).toHaveLength(0);

    const state = await session.caller.game.state();
    const persisted = state.tokens.find((t) => t.id === token.id);
    expect(persisted?.hp).toBe(5);
    ws.close();
  });
});

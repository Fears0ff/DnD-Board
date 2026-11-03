import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import {
  createAppDatabase,
  setDbForTests,
  type AppDatabase,
} from "../../db/connection";
import { appRouter, type AppRouter } from "../../api/router";
import { createContext, type TrpcContext } from "../../api/context";
import { resetRateLimits } from "../../api/services/rateLimit";
import { registerHub } from "../../api/realtime/hub";

export interface TestDb {
  db: AppDatabase;
  dir: string;
  cleanup: () => void;
}

/** Isolated temporary SQLite database per test run (never the dev/preview DB). */
export function createTempDb(): TestDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-board-test-"));
  const file = path.join(dir, "test.db");
  const db = createAppDatabase(file);
  return {
    db,
    dir,
    cleanup: () => {
      try {
        db.$client.close();
      } catch {
        // already closed
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Installs a fresh temp DB as the app singleton; returns its cleanup. */
export function useTempDb(): TestDb {
  const testDb = createTempDb();
  setDbForTests(testDb.db);
  resetRateLimits();
  registerHub(null);
  return testDb;
}

export function teardownTempDb(testDb: TestDb): void {
  setDbForTests(null);
  registerHub(null);
  resetRateLimits();
  testDb.cleanup();
}

export interface TestSession {
  ctx: TrpcContext;
  resHeaders: Headers;
  caller: ReturnType<AppRouter["createCaller"]>;
}

/** Builds a tRPC caller through the real createContext (cookie auth path). */
export async function newContext(
  cookie?: string,
  extraHeaders?: Record<string, string>,
): Promise<TestSession> {
  const headers = new Headers({ host: "test.local" });
  if (cookie) headers.set("cookie", cookie);
  for (const [k, v] of Object.entries(extraHeaders ?? {})) headers.set(k, v);
  const req = new Request("http://test.local/api/trpc", {
    method: "POST",
    headers,
  });
  const resHeaders = new Headers();
  const ctx = await createContext({ req, resHeaders } as FetchCreateContextFnOptions);
  return { ctx, resHeaders, caller: appRouter.createCaller(ctx) };
}

export function sessionCookieFrom(resHeaders: Headers): string {
  const setCookie = resHeaders.get("set-cookie") ?? "";
  const match = setCookie.match(/dnd_session=[^;]*/);
  if (!match) throw new Error(`no session cookie in Set-Cookie: ${setCookie}`);
  return match[0];
}

export interface RegisteredUser {
  id: number;
  login: string;
  cookie: string;
}

export async function registerUser(
  login: string,
  password = "password-123",
  displayName?: string,
): Promise<RegisteredUser> {
  const session = await newContext();
  const user = await session.caller.auth.register({
    login,
    password,
    displayName,
  });
  return { id: user.id, login: user.login, cookie: sessionCookieFrom(session.resHeaders) };
}

/** Expects a tRPC error with the given code. */
export async function expectTrpcError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual === code) return;
    throw new Error(
      `expected TRPCError ${code}, got ${actual ?? String(err)}`,
    );
  }
  throw new Error(`expected TRPCError ${code}, but the call succeeded`);
}

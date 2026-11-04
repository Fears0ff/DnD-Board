import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../../db/schema";
import {
  expectTrpcError,
  newContext,
  registerUser,
  sessionCookieFrom,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

let testDb: TestDb;

beforeEach(() => {
  testDb = useTempDb();
});

afterEach(() => {
  teardownTempDb(testDb);
});

describe("auth", () => {
  it("makes the first registered user the master, everyone else a player", async () => {
    const first = await registerUser("first");
    const second = await registerUser("second");
    const third = await registerUser("third");

    const session = await newContext(first.cookie);
    const usersList = await session.caller.users.list();
    expect(usersList.find((u) => u.login === "first")?.gameRole).toBe("master");
    expect(usersList.find((u) => u.login === "second")?.gameRole).toBe("player");
    expect(usersList.find((u) => u.login === "third")?.gameRole).toBe("player");
    expect(second.id).not.toBe(first.id);
    expect(third.id).not.toBe(first.id);
  });

  it("produces exactly one master even under concurrent first registrations", async () => {
    // better-sqlite3 serializes transactions on its single connection, so
    // interleaved registrations cannot both observe an empty user table.
    const results = await Promise.all(
      ["race-1", "race-2", "race-3", "race-4"].map(async (login) => {
        const session = await newContext();
        return session.caller.auth.register({
          login,
          password: "password-123",
        });
      }),
    );
    const masters = results.filter((u) => u.gameRole === "master");
    expect(masters).toHaveLength(1);
    expect(new Set(results.map((u) => u.id)).size).toBe(4);
  });

  it("rejects a duplicate login with 409 and is case-insensitive", async () => {
    await registerUser("Taken");
    await expectTrpcError(
      registerUser("taken"),
      "CONFLICT",
    );
  });

  it("accepts Cyrillic (Unicode) logins for register and login", async () => {
    // Logins are stored normalized (lowercase), same as for ASCII logins.
    const user = await registerUser("Дмитрий", "password-123");
    expect(user.login).toBe("дмитрий");

    const session = await newContext();
    const me = await session.caller.auth.login({
      login: "ДМИТРИЙ", // case-insensitive login still applies
      password: "password-123",
    });
    expect(me.login).toBe("дмитрий");
    expect(sessionCookieFrom(session.resHeaders)).toContain("dnd_session=");
  });

  it("rejects case-insensitive duplicates of Cyrillic logins", async () => {
    await registerUser("Иван");
    await expectTrpcError(registerUser("иван"), "CONFLICT");
    await expectTrpcError(registerUser("ИВАН"), "CONFLICT");
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await registerUser("hero", "correct-password");
    const ok = await newContext();
    const me = await ok.caller.auth.login({
      login: "hero",
      password: "correct-password",
    });
    expect(me.login).toBe("hero");
    expect(sessionCookieFrom(ok.resHeaders)).toContain("dnd_session=");

    const bad = await newContext();
    await expectTrpcError(
      bad.caller.auth.login({ login: "hero", password: "wrong-password" }),
      "UNAUTHORIZED",
    );
  });

  it("me returns the safe DTO and never leaks passwordHash", async () => {
    const user = await registerUser("safe", "password-123", "Safe User");
    const session = await newContext(user.cookie);
    const me = await session.caller.auth.me();
    expect(me).toMatchObject({
      id: user.id,
      login: "safe",
      displayName: "Safe User",
      gameRole: "master",
    });
    expect(typeof me.createdAt).toBe("string");
    expect(JSON.stringify(me)).not.toContain("passwordHash");
    expect(JSON.stringify(me)).not.toContain("scrypt$");

    const list = await session.caller.users.list();
    expect(JSON.stringify(list)).not.toContain("passwordHash");
  });

  it("me without a session is 401", async () => {
    const session = await newContext();
    await expectTrpcError(session.caller.auth.me(), "UNAUTHORIZED");
  });

  it("me with a forged/garbage cookie is 401", async () => {
    const session = await newContext("dnd_session=not-a-real-token");
    await expectTrpcError(session.caller.auth.me(), "UNAUTHORIZED");
  });

  it("logout clears the client cookie", async () => {
    const user = await registerUser("leaver");
    const session = await newContext(user.cookie);
    await session.caller.auth.logout();
    const cleared = session.resHeaders.get("set-cookie") ?? "";
    expect(cleared).toContain("dnd_session=");
    expect(cleared).toContain("Max-Age=0");
  });

  it("reads the role from the DB on every request, not from the token", async () => {
    const user = await registerUser("fresh");
    expect((await newContext(user.cookie)).ctx.user?.gameRole).toBe("master");

    // Role change happens directly in the DB after the token was issued.
    testDb.db
      .update(users)
      .set({ gameRole: "player" })
      .where(eq(users.id, user.id))
      .run();

    const me = await (await newContext(user.cookie)).caller.auth.me();
    expect(me.gameRole).toBe("player");
  });

  it("rejects mutating requests with a foreign Origin", async () => {
    await expectTrpcError(
      newContext(undefined, { origin: "http://evil.example" }).then(
        () => undefined,
      ),
      "FORBIDDEN",
    );
    // Same-host origin passes context creation.
    const ok = await newContext(undefined, { origin: "http://test.local" });
    expect(ok.ctx.user).toBeNull();
  });

  it("throttles repeated failed logins per login", async () => {
    // Registration itself consumes one attempt for this login.
    await registerUser("victim", "right-password");
    for (let i = 0; i < 9; i++) {
      const attempt = await newContext();
      await expectTrpcError(
        attempt.caller.auth.login({ login: "victim", password: "nope-nope" }),
        "UNAUTHORIZED",
      );
    }
    const blocked = await newContext();
    await expectTrpcError(
      blocked.caller.auth.login({ login: "victim", password: "right-password" }),
      "TOO_MANY_REQUESTS",
    );
  });
});

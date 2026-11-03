import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  expectTrpcError,
  newContext,
  registerUser,
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

describe("users", () => {
  it("users.list is master-only", async () => {
    const master = await registerUser("boss");
    const player = await registerUser("pawn");

    const asMaster = await newContext(master.cookie);
    const list = await asMaster.caller.users.list();
    expect(list).toHaveLength(2);

    const asPlayer = await newContext(player.cookie);
    await expectTrpcError(asPlayer.caller.users.list(), "FORBIDDEN");

    const anon = await newContext();
    await expectTrpcError(anon.caller.users.list(), "UNAUTHORIZED");
  });

  it("master can change roles; a player cannot", async () => {
    const master = await registerUser("boss");
    const player = await registerUser("pawn");

    const asPlayer = await newContext(player.cookie);
    await expectTrpcError(
      asPlayer.caller.users.setGameRole({ userId: master.id, gameRole: "player" }),
      "FORBIDDEN",
    );

    const asMaster = await newContext(master.cookie);
    const promoted = await asMaster.caller.users.setGameRole({
      userId: player.id,
      gameRole: "master",
    });
    expect(promoted.gameRole).toBe("master");
    // The change is effective immediately for the target's next request.
    const playerNow = await newContext(player.cookie);
    expect((await playerNow.caller.auth.me()).gameRole).toBe("master");
  });

  it("protects the last master transactionally", async () => {
    const master = await registerUser("only");
    const asMaster = await newContext(master.cookie);
    await expectTrpcError(
      asMaster.caller.users.setGameRole({
        userId: master.id,
        gameRole: "player",
      }),
      "CONFLICT",
    );
    // Still a master afterwards.
    expect((await asMaster.caller.auth.me()).gameRole).toBe("master");
  });

  it("allows demoting a master once another master exists", async () => {
    const first = await registerUser("first");
    const second = await registerUser("second");
    const asFirst = await newContext(first.cookie);

    await asFirst.caller.users.setGameRole({
      userId: second.id,
      gameRole: "master",
    });
    const demoted = await asFirst.caller.users.setGameRole({
      userId: first.id,
      gameRole: "player",
    });
    expect(demoted.gameRole).toBe("player");

    // Now second is the last master and is protected again.
    const asSecond = await newContext(second.cookie);
    await expectTrpcError(
      asSecond.caller.users.setGameRole({
        userId: second.id,
        gameRole: "player",
      }),
      "CONFLICT",
    );
  });

  it("setGameRole on a missing user is 404", async () => {
    const master = await registerUser("boss");
    const asMaster = await newContext(master.cookie);
    await expectTrpcError(
      asMaster.caller.users.setGameRole({ userId: 9999, gameRole: "master" }),
      "NOT_FOUND",
    );
  });
});

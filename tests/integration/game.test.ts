import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { appRouter } from "../../api/router";
import { createContext } from "../../api/context";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type RegisteredUser,
  type TestDb,
} from "./helpers";

let testDb: TestDb;
let master: RegisteredUser;
let player: RegisteredUser;

beforeEach(async () => {
  testDb = useTempDb();
  master = await registerUser("dm-master");
  player = await registerUser("pc-player");
});

afterEach(() => {
  teardownTempDb(testDb);
});

async function masterCaller() {
  return (await newContext(master.cookie)).caller;
}

async function playerCaller() {
  return (await newContext(player.cookie)).caller;
}

async function createBoard(name = "Dungeon") {
  const caller = await masterCaller();
  return caller.boards.create({ name, gridWidth: 20, gridHeight: 10 });
}

describe("game.state", () => {
  it("requires authentication", async () => {
    const anon = await newContext();
    await expectTrpcError(anon.caller.game.state(), "UNAUTHORIZED");
  });

  it("returns the snapshot shape for any signed-in user", async () => {
    await createBoard();
    const caller = await playerCaller();
    const state = await caller.game.state();
    expect(state.me.login).toBe("pc-player");
    expect(state.revision).toBe(1);
    expect(state.boards).toHaveLength(1);
    expect(state.activeBoard?.name).toBe("Dungeon");
    expect(state.tokens).toEqual([]);
    expect(state.initiative).toEqual([]);
  });
});

describe("boards", () => {
  it("is master-only", async () => {
    const caller = await playerCaller();
    await expectTrpcError(
      caller.boards.create({ name: "Nope" }),
      "FORBIDDEN",
    );
  });

  it("makes the first board active automatically and keeps a single active board", async () => {
    const first = await createBoard("One");
    const second = await createBoard("Two");
    expect(first.board.isActive).toBe(true);
    expect(second.board.isActive).toBe(false);

    const caller = await masterCaller();
    let state = await caller.game.state();
    expect(state.boards.filter((b) => b.isActive)).toHaveLength(1);

    await caller.boards.setActive({ id: second.board.id });
    state = await caller.game.state();
    const active = state.boards.filter((b) => b.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.board.id);
    expect(state.activeBoard?.id).toBe(second.board.id);
  });

  it("renames a board and bumps the revision", async () => {
    const created = await createBoard("Old");
    const caller = await masterCaller();
    const renamed = await caller.boards.rename({
      id: created.board.id,
      name: "New",
    });
    expect(renamed.board.name).toBe("New");
    expect(renamed.revision).toBeGreaterThan(created.revision);
  });

  it("activates another board in the same transaction when the active one is removed", async () => {
    const first = await createBoard("One");
    const second = await createBoard("Two");
    const caller = await masterCaller();
    await caller.boards.remove({ id: first.board.id });
    const state = await caller.game.state();
    expect(state.boards).toHaveLength(1);
    expect(state.activeBoard?.id).toBe(second.board.id);
    expect(state.activeBoard?.isActive).toBe(true);
  });

  it("allows removing the last board, leaving no active board", async () => {
    const only = await createBoard("Only");
    const caller = await masterCaller();
    await caller.boards.remove({ id: only.board.id });
    const state = await caller.game.state();
    expect(state.boards).toHaveLength(0);
    expect(state.activeBoard).toBeNull();
  });

  it("remove of a missing board is 404", async () => {
    const caller = await masterCaller();
    await expectTrpcError(caller.boards.remove({ id: 4242 }), "NOT_FOUND");
  });
});

describe("tokens", () => {
  it("requires an active board and master rights for add", async () => {
    const caller = await masterCaller();
    await expectTrpcError(
      caller.tokens.add({ kind: "hero", label: "A", hp: 5, maxHp: 10 }),
      "NOT_FOUND",
    );
    await createBoard();
    const asPlayer = await playerCaller();
    await expectTrpcError(
      asPlayer.tokens.add({ kind: "hero", label: "A", hp: 5, maxHp: 10 }),
      "FORBIDDEN",
    );
  });

  it("places a new token at the board center by default", async () => {
    await createBoard();
    const caller = await masterCaller();
    const { token } = await caller.tokens.add({
      kind: "monster",
      label: "Goblin",
      hp: 7,
      maxHp: 7,
    });
    expect(token.cellX).toBe(10); // gridWidth 20 / 2
    expect(token.cellY).toBe(5); // gridHeight 10 / 2
    expect(token.ownerId).toBeNull();
  });

  it("rejects hp > maxHp", async () => {
    await createBoard();
    const caller = await masterCaller();
    await expectTrpcError(
      caller.tokens.add({ kind: "hero", label: "x", hp: 11, maxHp: 10 }),
      "BAD_REQUEST",
    );
    const { token } = await caller.tokens.add({
      kind: "hero",
      label: "x",
      hp: 5,
      maxHp: 10,
    });
    await expectTrpcError(
      caller.tokens.update({ id: token.id, hp: 11 }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      caller.tokens.update({ id: token.id, maxHp: 4 }),
      "BAD_REQUEST",
    );
    const healed = await caller.tokens.update({ id: token.id, hp: 9 });
    expect(healed.token.hp).toBe(9);
  });

  it("tokens.update is master-only, even for a token the player owns", async () => {
    await createBoard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "Hero",
      ownerId: player.id,
      hp: 5,
      maxHp: 10,
    });
    const pc = await playerCaller();
    await expectTrpcError(
      pc.tokens.update({ id: token.id, label: "Renamed" }),
      "FORBIDDEN",
    );
  });

  it("lets a player move ONLY their own token", async () => {
    await createBoard();
    const dm = await masterCaller();
    const mine = (
      await dm.tokens.add({
        kind: "hero",
        label: "Mine",
        ownerId: player.id,
        hp: 5,
        maxHp: 10,
      })
    ).token;
    const theirs = (
      await dm.tokens.add({
        kind: "hero",
        label: "Theirs",
        ownerId: master.id,
        hp: 5,
        maxHp: 10,
      })
    ).token;
    const unowned = (
      await dm.tokens.add({ kind: "prop", label: "Rock", hp: 0, maxHp: 0 })
    ).token;

    const pc = await playerCaller();
    const moved = await pc.tokens.move({ tokenId: mine.id, cellX: 3, cellY: 4 });
    expect(moved.token.cellX).toBe(3);
    expect(moved.token.cellY).toBe(4);

    await expectTrpcError(
      pc.tokens.move({ tokenId: theirs.id, cellX: 1, cellY: 1 }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      pc.tokens.move({ tokenId: unowned.id, cellX: 1, cellY: 1 }),
      "FORBIDDEN",
    );

    // Master moves anything.
    const dmAgain = await masterCaller();
    const masterMoved = await dmAgain.tokens.move({
      tokenId: theirs.id,
      cellX: 8,
      cellY: 9,
    });
    expect(masterMoved.token.cellX).toBe(8);
  });

  it("rejects moves outside the active board", async () => {
    await createBoard();
    const dm = await masterCaller();
    const token = (
      await dm.tokens.add({
        kind: "hero",
        label: "Bounded",
        ownerId: player.id,
        hp: 5,
        maxHp: 10,
      })
    ).token;
    const pc = await playerCaller();
    await expectTrpcError(
      pc.tokens.move({ tokenId: token.id, cellX: -1, cellY: 0 }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      pc.tokens.move({ tokenId: token.id, cellX: 20, cellY: 0 }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      pc.tokens.move({ tokenId: token.id, cellX: 0, cellY: 10 }),
      "BAD_REQUEST",
    );
  });

  it("move of a missing token is 404", async () => {
    await createBoard();
    const pc = await playerCaller();
    await expectTrpcError(
      pc.tokens.move({ tokenId: 999, cellX: 0, cellY: 0 }),
      "NOT_FOUND",
    );
  });

  it("rejects assigning a token to a non-existent owner", async () => {
    await createBoard();
    const dm = await masterCaller();
    await expectTrpcError(
      dm.tokens.add({
        kind: "hero",
        label: "x",
        ownerId: 9999,
        hp: 1,
        maxHp: 1,
      }),
      "BAD_REQUEST",
    );
  });

  it("tokens.remove and tokens.clear are master-only", async () => {
    await createBoard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "prop",
      label: "x",
      hp: 0,
      maxHp: 0,
    });
    const pc = await playerCaller();
    await expectTrpcError(pc.tokens.remove({ id: token.id }), "FORBIDDEN");
    const state = await pc.game.state();
    await expectTrpcError(
      pc.tokens.clear({ boardId: state.activeBoard!.id }),
      "FORBIDDEN",
    );
  });
});

describe("initiative", () => {
  it("is master-only and bound to the active board", async () => {
    await createBoard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 1,
      maxHp: 1,
    });

    const pc = await playerCaller();
    await expectTrpcError(
      pc.initiative.set({ entries: [{ tokenId: token.id, value: 12 }] }),
      "FORBIDDEN",
    );

    const set = await dm.initiative.set({
      entries: [{ tokenId: token.id, value: 12 }],
    });
    expect(set.initiative).toEqual([{ tokenId: token.id, value: 12 }]);
    const state = await dm.game.state();
    expect(state.initiative).toEqual([{ tokenId: token.id, value: 12 }]);
  });

  it("rejects entries referencing tokens of another board", async () => {
    await createBoard("One");
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 1,
      maxHp: 1,
    });
    await dm.boards.create({ name: "Two" });
    // `token` lives on board One; make board Two active.
    const state = await dm.game.state();
    const boardTwo = state.boards.find((b) => b.name === "Two")!;
    await dm.boards.setActive({ id: boardTwo.id });
    await expectTrpcError(
      dm.initiative.set({ entries: [{ tokenId: token.id, value: 5 }] }),
      "BAD_REQUEST",
    );
  });

  it("removes initiative entries of deleted tokens in the same transaction", async () => {
    await createBoard();
    const dm = await masterCaller();
    const a = (
      await dm.tokens.add({ kind: "hero", label: "a", hp: 1, maxHp: 1 })
    ).token;
    const b = (
      await dm.tokens.add({ kind: "hero", label: "b", hp: 1, maxHp: 1 })
    ).token;
    await dm.initiative.set({
      entries: [
        { tokenId: a.id, value: 15 },
        { tokenId: b.id, value: 3 },
      ],
    });

    await dm.tokens.remove({ id: a.id });
    let state = await dm.game.state();
    expect(state.initiative).toEqual([{ tokenId: b.id, value: 3 }]);

    const boardId = state.activeBoard!.id;
    await dm.tokens.clear({ boardId });
    state = await dm.game.state();
    expect(state.tokens).toEqual([]);
    expect(state.initiative).toEqual([]);
  });
});

describe("revisions", () => {
  it("bump monotonically across game mutations", async () => {
    const created = await createBoard();
    const dm = await masterCaller();
    const added = await dm.tokens.add({
      kind: "hero",
      label: "a",
      hp: 1,
      maxHp: 1,
    });
    const moved = await dm.tokens.move({
      tokenId: added.token.id,
      cellX: 1,
      cellY: 1,
    });
    const removed = await dm.tokens.remove({ id: added.token.id });
    const revisions = [
      created.revision,
      added.revision,
      moved.revision,
      removed.revision,
    ];
    expect(revisions).toEqual([1, 2, 3, 4]);
    const state = await dm.game.state();
    expect(state.revision).toBe(4);
  });
});

describe("game.state viewed board", () => {
  async function twoBoardsWithContent() {
    const first = await createBoard("One"); // active automatically
    const dm = await masterCaller();
    const firstToken = (
      await dm.tokens.add({ kind: "hero", label: "A", hp: 3, maxHp: 5 })
    ).token;
    await dm.initiative.set({ entries: [{ tokenId: firstToken.id, value: 10 }] });

    const second = await dm.boards.create({ name: "Two" });
    await dm.boards.setActive({ id: second.board.id });
    const secondToken = (
      await dm.tokens.add({ kind: "monster", label: "B", hp: 8, maxHp: 12 })
    ).token;
    await dm.initiative.set({ entries: [{ tokenId: secondToken.id, value: 4 }] });

    // Board One is globally active again; board Two is not.
    await dm.boards.setActive({ id: first.board.id });
    return { dm, first, second, firstToken, secondToken };
  }

  it("lets the master view a non-active board while activeBoard stays global", async () => {
    const { dm, first, second, firstToken, secondToken } =
      await twoBoardsWithContent();

    const state = await dm.game.state({ boardId: second.board.id });
    expect(state.activeBoard?.id).toBe(first.board.id);
    expect(state.viewedBoard?.id).toBe(second.board.id);
    expect(state.tokens.map((t) => t.id)).toEqual([secondToken.id]);
    expect(state.initiative).toEqual([{ tokenId: secondToken.id, value: 4 }]);

    // Without input the master views the active board as before.
    const fallback = await dm.game.state();
    expect(fallback.activeBoard?.id).toBe(first.board.id);
    expect(fallback.viewedBoard?.id).toBe(first.board.id);
    expect(fallback.initiative).toEqual([{ tokenId: firstToken.id, value: 10 }]);
  });

  it("players always view the active board, even when requesting another", async () => {
    const { second, firstToken } = await twoBoardsWithContent();
    const pc = await playerCaller();

    const state = await pc.game.state({ boardId: second.board.id });
    expect(state.activeBoard?.id).not.toBe(second.board.id);
    expect(state.viewedBoard?.id).toBe(state.activeBoard?.id);
    expect(state.tokens.map((t) => t.id)).toEqual([firstToken.id]);
    expect(state.initiative).toEqual([{ tokenId: firstToken.id, value: 10 }]);
  });

  it("is 404 when the master requests a missing board", async () => {
    const dm = await masterCaller();
    await expectTrpcError(dm.game.state({ boardId: 9999 }), "NOT_FOUND");
  });
});

describe("game.state HP privacy", () => {
  it("shows HP to the master and the owner, hides it from everyone else", async () => {
    await createBoard();
    const dm = await masterCaller();
    const own = (
      await dm.tokens.add({
        kind: "hero",
        label: "Mine",
        ownerId: player.id,
        hp: 5,
        maxHp: 10,
      })
    ).token;
    const foreign = (
      await dm.tokens.add({
        kind: "monster",
        label: "Theirs",
        ownerId: master.id,
        hp: 7,
        maxHp: 12,
      })
    ).token;
    const unowned = (
      await dm.tokens.add({ kind: "prop", label: "Rock", hp: 1, maxHp: 2 })
    ).token;

    // The master sees every token's HP.
    const masterState = await dm.game.state();
    for (const t of masterState.tokens) {
      expect(t.hp).not.toBeNull();
      expect(t.maxHp).not.toBeNull();
    }

    // A player sees HP only for tokens they own.
    const pc = await playerCaller();
    const playerState = await pc.game.state();
    const byId = new Map(playerState.tokens.map((t) => [t.id, t]));
    expect(byId.get(own.id)).toMatchObject({ hp: 5, maxHp: 10 });
    expect(byId.get(foreign.id)).toMatchObject({ hp: null, maxHp: null });
    expect(byId.get(unowned.id)).toMatchObject({ hp: null, maxHp: null });
    // Other fields are still visible; only HP is hidden.
    expect(byId.get(foreign.id)?.label).toBe("Theirs");
  });
});

describe("tokens.adjustHp", () => {
  it("adjusts hp up and down, clamps to [0, maxHp], and bumps the revision", async () => {
    await createBoard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 5,
      maxHp: 10,
    });

    const hurt = await dm.tokens.adjustHp({ id: token.id, delta: -3 });
    expect(hurt.token.hp).toBe(2);

    const healed = await dm.tokens.adjustHp({ id: token.id, delta: 4 });
    expect(healed.token.hp).toBe(6);
    expect(healed.revision).toBeGreaterThan(hurt.revision);

    const overHealed = await dm.tokens.adjustHp({ id: token.id, delta: 999 });
    expect(overHealed.token.hp).toBe(10);

    const overKilled = await dm.tokens.adjustHp({ id: token.id, delta: -999 });
    expect(overKilled.token.hp).toBe(0);

    const state = await dm.game.state();
    expect(state.revision).toBe(overKilled.revision);
    expect(state.tokens.find((t) => t.id === token.id)?.hp).toBe(0);
  });

  it("adjusts HP on tokens of a non-active board (master management)", async () => {
    const first = await createBoard("One");
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 5,
      maxHp: 10,
    });
    expect(token.boardId).toBe(first.board.id);

    const second = await dm.boards.create({ name: "Two" });
    await dm.boards.setActive({ id: second.board.id });

    // Board activity only controls what players see; the master edits any board.
    const adjusted = await dm.tokens.adjustHp({ id: token.id, delta: -2 });
    expect(adjusted.token.hp).toBe(3);

    // Clamping still applies off the active board, revision bumps each time.
    const clamped = await dm.tokens.adjustHp({ id: token.id, delta: -999 });
    expect(clamped.token.hp).toBe(0);
    expect(clamped.revision).toBeGreaterThan(adjusted.revision);

    const viewed = await dm.game.state({ boardId: first.board.id });
    expect(viewed.activeBoard?.id).toBe(second.board.id);
    expect(viewed.tokens.find((t) => t.id === token.id)?.hp).toBe(0);
  });

  it("is master-only, even for a token the player owns", async () => {
    await createBoard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      ownerId: player.id,
      hp: 5,
      maxHp: 10,
    });
    const pc = await playerCaller();
    await expectTrpcError(
      pc.tokens.adjustHp({ id: token.id, delta: -1 }),
      "FORBIDDEN",
    );
  });

  it("is 404 for a missing token", async () => {
    const dm = await masterCaller();
    await expectTrpcError(dm.tokens.adjustHp({ id: 9999, delta: 1 }), "NOT_FOUND");
  });
});

describe("editing a chosen non-active board", () => {
  it("adds a token to a non-active board via boardId without changing activeBoard", async () => {
    const first = await createBoard("One"); // active
    const dm = await masterCaller();
    const second = await dm.boards.create({ name: "Two" });

    const added = await dm.tokens.add({
      kind: "monster",
      label: "Off-board",
      hp: 4,
      maxHp: 9,
      boardId: second.board.id,
    });
    expect(added.token.boardId).toBe(second.board.id);

    const viewed = await dm.game.state({ boardId: second.board.id });
    expect(viewed.activeBoard?.id).toBe(first.board.id);
    expect(viewed.tokens.map((t) => t.id)).toContain(added.token.id);

    // The active board (what players see) is untouched.
    const active = await dm.game.state();
    expect(active.activeBoard?.id).toBe(first.board.id);
    expect(active.tokens.map((t) => t.id)).not.toContain(added.token.id);
  });

  it("tokens.add without boardId still uses the active board", async () => {
    const first = await createBoard("One");
    const dm = await masterCaller();
    const added = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 1,
      maxHp: 1,
    });
    expect(added.token.boardId).toBe(first.board.id);
  });

  it("tokens.add with a missing boardId is 404", async () => {
    await createBoard();
    const dm = await masterCaller();
    await expectTrpcError(
      dm.tokens.add({
        kind: "hero",
        label: "x",
        hp: 1,
        maxHp: 1,
        boardId: 4242,
      }),
      "NOT_FOUND",
    );
  });

  it("sets initiative on a chosen non-active board", async () => {
    const first = await createBoard("One");
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 1,
      maxHp: 1,
    }); // lives on board One
    const second = await dm.boards.create({ name: "Two" });
    await dm.boards.setActive({ id: second.board.id });

    const set = await dm.initiative.set({
      entries: [{ tokenId: token.id, value: 7 }],
      boardId: first.board.id,
    });
    expect(set.initiative).toEqual([{ tokenId: token.id, value: 7 }]);

    const viewed = await dm.game.state({ boardId: first.board.id });
    expect(viewed.initiative).toEqual([{ tokenId: token.id, value: 7 }]);
    expect(viewed.activeBoard?.id).toBe(second.board.id);

    // The active board's initiative is untouched.
    const active = await dm.game.state();
    expect(active.initiative).toEqual([]);
  });

  it("rejects initiative entries referencing tokens of another board (explicit boardId)", async () => {
    await createBoard("One");
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "x",
      hp: 1,
      maxHp: 1,
    }); // lives on board One
    const second = await dm.boards.create({ name: "Two" });
    await expectTrpcError(
      dm.initiative.set({
        entries: [{ tokenId: token.id, value: 5 }],
        boardId: second.board.id,
      }),
      "BAD_REQUEST",
    );
  });

  it("initiative.set with a missing boardId is 404", async () => {
    const dm = await masterCaller();
    await expectTrpcError(
      dm.initiative.set({ entries: [], boardId: 4242 }),
      "NOT_FOUND",
    );
  });
});

describe("game.state HTTP compatibility", () => {
  it("accepts legacy null input as well as no input", async () => {
    await createBoard();
    const get = (suffix: string) =>
      fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(`http://test.local/api/trpc/game.state${suffix}`, {
          headers: { host: "test.local", cookie: master.cookie },
        }),
        router: appRouter,
        createContext: (opts) =>
          createContext({
            req: opts.req,
            resHeaders: new Headers(),
          } as FetchCreateContextFnOptions),
      });

    const nullInput = `?input=${encodeURIComponent(JSON.stringify({ json: null }))}`;
    for (const suffix of ["", nullInput]) {
      const res = await get(suffix);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as {
        result?: { data?: { json?: { activeBoard?: { name?: string } | null } } };
      };
      expect(payload.result?.data?.json?.activeBoard?.name).toBe("Dungeon");
    }
  });
});

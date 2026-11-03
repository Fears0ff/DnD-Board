import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

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

async function dmWithBoard() {
  const dm = await registerUser("dm");
  const ctx = await newContext(dm.cookie);
  const { board } = await ctx.caller.boards.create({ name: "Board 1" });
  return { dm, ctx, board };
}

describe("boards", () => {
  it("first board becomes active automatically", async () => {
    const { ctx } = await dmWithBoard();
    const state = await ctx.caller.game.state();
    expect(state.boards).toHaveLength(1);
    expect(state.activeBoard?.name).toBe("Board 1");
    expect(state.boards[0].isActive).toBe(true);
  });

  it("board management is master-only", async () => {
    await dmWithBoard();
    const player = await registerUser("player1");
    const asPlayer = await newContext(player.cookie);
    await expectTrpcError(
      asPlayer.caller.boards.create({ name: "Nope" }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      asPlayer.caller.boards.setActive({ id: 1 }),
      "FORBIDDEN",
    );
    const anon = await newContext();
    await expectTrpcError(
      anon.caller.boards.create({ name: "Nope" }),
      "UNAUTHORIZED",
    );
  });

  it("setActive switches the single active board", async () => {
    const { ctx, board } = await dmWithBoard();
    const second = await ctx.caller.boards.create({ name: "Board 2" });
    await ctx.caller.boards.setActive({ id: second.board.id });
    const state = await ctx.caller.game.state();
    expect(state.activeBoard?.id).toBe(second.board.id);
    expect(state.boards.find((b) => b.id === board.id)?.isActive).toBe(false);
  });

  it("rename and remove work; removing the active board leaves none active", async () => {
    const { ctx, board } = await dmWithBoard();
    const renamed = await ctx.caller.boards.rename({
      id: board.id,
      name: "Renamed",
    });
    expect(renamed.board.name).toBe("Renamed");
    await ctx.caller.boards.remove({ id: board.id });
    const state = await ctx.caller.game.state();
    expect(state.boards).toHaveLength(0);
    expect(state.activeBoard).toBeNull();
  });

  it("every mutation bumps the revision", async () => {
    const { ctx } = await dmWithBoard();
    const r1 = (await ctx.caller.game.state()).revision;
    await ctx.caller.boards.create({ name: "B2" });
    const r2 = (await ctx.caller.game.state()).revision;
    expect(r2).toBeGreaterThan(r1);
  });
});

describe("tokens", () => {
  it("master can add, update, move and remove tokens", async () => {
    const { ctx } = await dmWithBoard();
    const { token } = await ctx.caller.tokens.add({
      kind: "hero",
      label: "Aria",
      hp: 10,
      maxHp: 12,
    });
    expect(token.id).toBeGreaterThan(0);

    const updated = await ctx.caller.tokens.update({
      id: token.id,
      hp: 11,
      cellX: 3,
      cellY: 4,
    });
    expect(updated.token.hp).toBe(11);
    expect(updated.token.cellX).toBe(3);

    const moved = await ctx.caller.tokens.move({
      tokenId: token.id,
      cellX: 5,
      cellY: 6,
    });
    expect(moved.token.cellX).toBe(5);

    await ctx.caller.tokens.remove({ id: token.id });
    const state = await ctx.caller.game.state();
    expect(state.tokens).toHaveLength(0);
  });

  it("rejects hp > maxHp and out-of-board coordinates", async () => {
    const { ctx } = await dmWithBoard();
    await expectTrpcError(
      ctx.caller.tokens.add({ kind: "hero", label: "X", hp: 5, maxHp: 4 }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      ctx.caller.tokens.add({
        kind: "hero",
        label: "Y",
        hp: 1,
        maxHp: 1,
        cellX: 999,
        cellY: 0,
      }),
      "BAD_REQUEST",
    );
  });

  it("players can move only their own tokens", async () => {
    const { dm, ctx } = await dmWithBoard();
    const player = await registerUser("walker");
    const other = await registerUser("other");

    const ownToken = (
      await ctx.caller.tokens.add({
        kind: "hero",
        label: "Mine",
        ownerId: player.id,
        hp: 5,
        maxHp: 5,
      })
    ).token;
    const othersToken = (
      await ctx.caller.tokens.add({
        kind: "hero",
        label: "NotMine",
        ownerId: other.id,
        hp: 5,
        maxHp: 5,
      })
    ).token;
    const unowned = (
      await ctx.caller.tokens.add({
        kind: "prop",
        label: "Crate",
        hp: 0,
        maxHp: 1,
      })
    ).token;

    const asPlayer = await newContext(player.cookie);
    const moved = await asPlayer.caller.tokens.move({
      tokenId: ownToken.id,
      cellX: 1,
      cellY: 1,
    });
    expect(moved.token.cellX).toBe(1);

    await expectTrpcError(
      asPlayer.caller.tokens.move({
        tokenId: othersToken.id,
        cellX: 2,
        cellY: 2,
      }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      asPlayer.caller.tokens.move({
        tokenId: unowned.id,
        cellX: 2,
        cellY: 2,
      }),
      "FORBIDDEN",
    );

    // Players cannot add/update/remove at all.
    await expectTrpcError(
      asPlayer.caller.tokens.add({ kind: "prop", label: "Z", hp: 0, maxHp: 1 }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      asPlayer.caller.tokens.update({ id: ownToken.id, hp: 0 }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      asPlayer.caller.tokens.remove({ id: ownToken.id }),
      "FORBIDDEN",
    );

    // Master can move anything.
    const dmAgain = await newContext(dm.cookie);
    const moved2 = await dmAgain.caller.tokens.move({
      tokenId: unowned.id,
      cellX: 7,
      cellY: 7,
    });
    expect(moved2.token.cellX).toBe(7);
  });

  it("clear empties the board and its initiative", async () => {
    const { ctx, board } = await dmWithBoard();
    const t = (
      await ctx.caller.tokens.add({ kind: "hero", label: "A", hp: 1, maxHp: 1 })
    ).token;
    await ctx.caller.initiative.set({ entries: [{ tokenId: t.id, value: 15 }] });
    await ctx.caller.tokens.clear({ boardId: board.id });
    const state = await ctx.caller.game.state();
    expect(state.tokens).toHaveLength(0);
    expect(state.initiative).toHaveLength(0);
  });
});

describe("initiative", () => {
  it("master sets manual initiative; unknown token ids are dropped", async () => {
    const { ctx } = await dmWithBoard();
    const t = (
      await ctx.caller.tokens.add({ kind: "monster", label: "Gob", hp: 7, maxHp: 7 })
    ).token;
    const result = await ctx.caller.initiative.set({
      entries: [
        { tokenId: t.id, value: 12 },
        { tokenId: 9999, value: 3 },
      ],
    });
    expect(result.initiative).toEqual([{ tokenId: t.id, value: 12 }]);
    const state = await ctx.caller.game.state();
    expect(state.initiative).toEqual([{ tokenId: t.id, value: 12 }]);
  });

  it("initiative.set is master-only", async () => {
    await dmWithBoard();
    const player = await registerUser("p-init");
    const asPlayer = await newContext(player.cookie);
    await expectTrpcError(
      asPlayer.caller.initiative.set({ entries: [] }),
      "FORBIDDEN",
    );
  });
});

describe("game.state", () => {
  it("requires authentication and returns the safe user DTO", async () => {
    const anon = await newContext();
    await expectTrpcError(anon.caller.game.state(), "UNAUTHORIZED");

    const { ctx } = await dmWithBoard();
    const state = await ctx.caller.game.state();
    expect(state.me.login).toBe("dm");
    expect(state.me).not.toHaveProperty("passwordHash");
  });
});

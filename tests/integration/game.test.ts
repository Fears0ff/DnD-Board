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

describe("campaigns", () => {
  it("is master-only and keeps a single active campaign", async () => {
    const dm = await masterCaller();
    const first = (await dm.game.state()).activeCampaign!;
    const second = await dm.campaigns.create({ name: "Second" });
    expect(first.isActive).toBe(true);
    expect(second.campaign.isActive).toBe(false);

    await dm.campaigns.setActive({ id: second.campaign.id });
    const state = await dm.game.state();
    expect(state.activeCampaign?.id).toBe(second.campaign.id);
    expect(state.campaigns.filter((campaign) => campaign.isActive)).toHaveLength(1);
    await expectTrpcError(
      (await playerCaller()).campaigns.create({ name: "Nope" }),
      "FORBIDDEN",
    );
  });

  it("renames a campaign and lets the master clear player visibility", async () => {
    const dm = await masterCaller();
    const created = { campaign: (await dm.game.state()).activeCampaign! };
    await createBoard("Hidden board");
    const renamed = await dm.campaigns.rename({ id: created.campaign.id, name: "New" });
    expect(renamed.campaign.name).toBe("New");

    await dm.campaigns.setActive({ id: null });
    const playerState = await (await playerCaller()).game.state();
    expect(playerState.activeCampaign).toBeNull();
    expect(playerState.viewedCampaign).toBeNull();
    expect(playerState.activeBoard).toBeNull();
    expect(playerState.viewedBoard).toBeNull();
    expect(playerState.boards).toEqual([]);
    expect(playerState.tokens).toEqual([]);
    expect(playerState.initiative).toEqual([]);

    const masterState = await dm.game.state();
    expect(masterState.viewedCampaign?.id).toBe(created.campaign.id);
    expect(masterState.viewedBoard?.name).toBe("Hidden board");
  });

  it("returns only active-campaign boards to players and supports master viewing", async () => {
    const dm = await masterCaller();
    const first = { campaign: (await dm.game.state()).activeCampaign! };
    const firstBoard = await createBoard("First board");
    const second = await dm.campaigns.create({ name: "Second" });
    const secondBoard = await dm.boards.create({
      name: "Second board", campaignId: second.campaign.id,
    });

    const viewed = await dm.game.state({ campaignId: second.campaign.id });
    expect(viewed.boards.map((board) => board.id)).toEqual([secondBoard.board.id]);
    expect(viewed.activeBoard?.id).toBe(firstBoard.board.id);
    expect(viewed.viewedCampaign?.id).toBe(second.campaign.id);

    const playerState = await (await playerCaller()).game.state({
      campaignId: second.campaign.id,
      boardId: secondBoard.board.id,
    });
    expect(playerState.viewedCampaign?.id).toBe(first.campaign.id);
    expect(playerState.boards.map((board) => board.id)).toEqual([firstBoard.board.id]);
    expect(playerState.viewedBoard?.id).toBe(firstBoard.board.id);
  });

  it("activates a board's campaign and replaces a removed active board only inside it", async () => {
    const dm = await masterCaller();
    await dm.campaigns.create({ name: "First" });
    const oldBoard = await createBoard("Old active");
    const second = await dm.campaigns.create({ name: "Second" });
    const first = await dm.boards.create({ name: "One", campaignId: second.campaign.id });
    const next = await dm.boards.create({ name: "Two", campaignId: second.campaign.id });
    expect(first.board.isActive).toBe(false);

    await dm.boards.setActive({ id: first.board.id });
    let state = await dm.game.state();
    expect(state.activeCampaign?.id).toBe(second.campaign.id);
    expect(state.activeBoard?.id).toBe(first.board.id);
    expect(state.boards.find((board) => board.id === oldBoard.board.id)).toBeUndefined();

    await dm.boards.remove({ id: first.board.id });
    state = await dm.game.state({ campaignId: second.campaign.id });
    expect(state.activeCampaign?.id).toBe(second.campaign.id);
    expect(state.activeBoard?.id).toBe(next.board.id);
  });

  it("activates the first board of an empty active campaign even when others exist", async () => {
    const dm = await masterCaller();
    await dm.campaigns.create({ name: "First" });
    await createBoard("Existing elsewhere");
    const second = await dm.campaigns.create({ name: "Second" });
    await dm.campaigns.setActive({ id: second.campaign.id });
    expect((await dm.game.state()).activeBoard).toBeNull();
    const created = await dm.boards.create({ name: "First here", campaignId: second.campaign.id });
    expect(created.board.isActive).toBe(true);
  });

  it("cascades campaign removal and activates the next campaign", async () => {
    const dm = await masterCaller();
    const first = { campaign: (await dm.game.state()).activeCampaign! };
    const board = await createBoard("Doomed");
    const { token } = await dm.tokens.add({ kind: "prop", label: "Doomed token", hp: 0, maxHp: 0 });
    const second = await dm.campaigns.create({ name: "Second" });
    await dm.boards.create({ name: "Survivor", campaignId: second.campaign.id });

    await dm.campaigns.remove({ id: first.campaign.id });
    const state = await dm.game.state();
    expect(state.activeCampaign?.id).toBe(second.campaign.id);
    expect(state.activeBoard?.name).toBe("Survivor");
    expect(state.campaigns.map((campaign) => campaign.id)).not.toContain(first.campaign.id);
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS n FROM boards WHERE id = ?").get(board.board.id)).toEqual({ n: 0 });
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS n FROM tokens WHERE id = ?").get(token.id)).toEqual({ n: 0 });
  });

  it("rejects player movement after their board's campaign becomes inactive", async () => {
    const dm = await masterCaller();
    const first = { campaign: (await dm.game.state()).activeCampaign! };
    await createBoard();
    const { token } = await dm.tokens.add({
      kind: "hero", label: "Owned", ownerId: player.id, hp: 5, maxHp: 5,
    });
    const second = await dm.campaigns.create({ name: "Second" });
    await dm.campaigns.setActive({ id: second.campaign.id });

    await expectTrpcError(
      (await playerCaller()).tokens.move({ tokenId: token.id, cellX: 2, cellY: 2 }),
      "BAD_REQUEST",
    );
    expect((await dm.game.state({ campaignId: first.campaign.id })).tokens[0]).toMatchObject({
      id: token.id, cellX: 10, cellY: 5,
    });
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

  it("resizes the grid and clamps out-of-bounds tokens without deleting them", async () => {
    const created = await createBoard();
    const caller = await masterCaller();
    const { token } = await caller.tokens.add({
      kind: "prop", label: "Statue", hp: 0, maxHp: 0,
      boardId: created.board.id, cellX: 18, cellY: 8, size: 2,
    });
    const resized = await caller.boards.updateGrid({ id: created.board.id, gridWidth: 10, gridHeight: 6 });
    expect(resized.board.gridWidth).toBe(10);
    expect(resized.board.gridHeight).toBe(6);
    const state = await caller.game.state();
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0]).toMatchObject({ id: token.id, cellX: 8, cellY: 4 });
  });

  it("remove of a missing board is 404", async () => {
    const caller = await masterCaller();
    await expectTrpcError(caller.boards.remove({ id: 4242 }), "NOT_FOUND");
  });
});

describe("tokens", () => {
  it("hides invisible token DTOs from players but preserves their initiative", async () => {
    await createBoard();
    const masterApi = await masterCaller();
    const { token } = await masterApi.tokens.add({
      kind: "hero", label: "Hidden hero", hp: 5, maxHp: 5,
      ownerId: player.id, invisible: true, cellX: 1, cellY: 1,
    });
    await masterApi.initiative.set({ entries: [{ tokenId: token.id, value: 17 }] });
    const playerState = await (await playerCaller()).game.state();
    expect(playerState.tokens).toEqual([]);
    expect(playerState.initiative).toEqual([{ tokenId: token.id, value: 17 }]);
    await expectTrpcError(
      (await playerCaller()).tokens.move({ tokenId: token.id, cellX: 2, cellY: 2 }),
      "NOT_FOUND",
    );
    const masterState = await masterApi.game.state();
    expect(masterState.tokens[0].invisible).toBe(true);
  });

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

describe("token entity bindings", () => {
  const abilities = { str: 10, dex: 12, con: 14, int: 16, wis: 13, cha: 8 };

  async function playerSheet(name = "Player hero", maxHp = 37) {
    const pc = await playerCaller();
    return pc.characters.create({
      name,
      data: { vitals: { maxHp, currentHp: maxHp } },
    });
  }

  async function monsterCard(name = "Bound goblin", hitPoints = 45) {
    const dm = await masterCaller();
    return dm.compendium.create({
      type: "monster",
      name,
      visibility: "private",
      data: {
        size: "medium",
        creatureType: "humanoid",
        armorClass: 13,
        hitPoints,
        abilities,
      },
    });
  }

  it("attaches a hero sheet, inherits its owner and initializes full HP once", async () => {
    await createBoard();
    const sheet = await playerSheet();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "Hero",
      characterId: sheet.id,
      ownerId: master.id,
      hp: 1,
      maxHp: 1,
    });
    expect(token).toMatchObject({
      characterId: sheet.id,
      compendiumId: null,
      ownerId: player.id,
      hp: 37,
      maxHp: 37,
    });

    // Saving the same binding and changing HP manually must not refill it.
    const manual = await dm.tokens.update({
      id: token.id,
      characterId: sheet.id,
      hp: 12,
      maxHp: 37,
    });
    expect(manual.token).toMatchObject({ hp: 12, maxHp: 37, ownerId: player.id });

    // The sheet is not an ongoing HP synchronization source.
    const pc = await playerCaller();
    const fresh = await pc.characters.get({ id: sheet.id });
    await pc.characters.update({
      id: sheet.id,
      expectedVersion: fresh.version,
      data: { vitals: { maxHp: 99, currentHp: 99 } },
    });
    const state = await dm.game.state();
    expect(state.tokens[0]).toMatchObject({ hp: 12, maxHp: 37 });
  });

  it("attaches a monster card, resolves its image and resets HP only on reattach", async () => {
    await createBoard();
    const card = await monsterCard();
    const dm = await masterCaller();
    const { token } = await dm.tokens.add({
      kind: "monster",
      label: "Goblin",
      compendiumId: card.card.id,
      hp: 2,
      maxHp: 3,
    });
    expect(token).toMatchObject({
      compendiumId: card.card.id,
      characterId: null,
      hp: 45,
      maxHp: 45,
      imageKey: null,
    });

    const manual = await dm.tokens.update({ id: token.id, hp: 9 });
    expect(manual.token.hp).toBe(9);
    const detached = await dm.tokens.update({ id: token.id, compendiumId: null });
    expect(detached.token).toMatchObject({ compendiumId: null, hp: 9, maxHp: 45 });
    const reattached = await dm.tokens.update({
      id: token.id,
      compendiumId: card.card.id,
    });
    expect(reattached.token).toMatchObject({ hp: 45, maxHp: 45 });

    const asProp = await dm.tokens.update({ id: token.id, kind: "prop" });
    expect(asProp.token).toMatchObject({
      kind: "prop",
      characterId: null,
      compendiumId: null,
      hp: 45,
      maxHp: 45,
    });
  });

  it("inherits a replacement sheet owner and keeps owner/HP when detached", async () => {
    await createBoard();
    const first = await playerSheet("First", 20);
    const dm = await masterCaller();
    const second = await dm.characters.create({
      name: "Master NPC",
      data: { vitals: { maxHp: 60 } },
    });
    const { token } = await dm.tokens.add({
      kind: "hero",
      label: "Hero",
      characterId: first.id,
      hp: 0,
      maxHp: 0,
    });
    const replaced = await dm.tokens.update({
      id: token.id,
      characterId: second.id,
      ownerId: player.id,
    });
    expect(replaced.token).toMatchObject({
      characterId: second.id,
      ownerId: master.id,
      hp: 60,
      maxHp: 60,
    });
    const detached = await dm.tokens.update({ id: token.id, characterId: null });
    expect(detached.token).toMatchObject({
      characterId: null,
      ownerId: master.id,
      hp: 60,
      maxHp: 60,
    });
  });

  it("rejects mismatched, duplicate and missing references", async () => {
    await createBoard();
    const sheet = await playerSheet();
    const monster = await monsterCard();
    const dm = await masterCaller();
    const item = await dm.compendium.create({
      type: "item",
      name: "Not a monster",
      data: {},
    });
    const base = { label: "Invalid", hp: 1, maxHp: 1 };
    await expectTrpcError(
      dm.tokens.add({ ...base, kind: "monster", characterId: sheet.id }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      dm.tokens.add({ ...base, kind: "hero", compendiumId: monster.card.id }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      dm.tokens.add({
        ...base,
        kind: "hero",
        characterId: sheet.id,
        compendiumId: monster.card.id,
      }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      dm.tokens.add({ ...base, kind: "hero", characterId: 999999 }),
      "NOT_FOUND",
    );
    await expectTrpcError(
      dm.tokens.add({ ...base, kind: "monster", compendiumId: item.card.id }),
      "NOT_FOUND",
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

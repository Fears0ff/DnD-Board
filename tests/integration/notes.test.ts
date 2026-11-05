import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../../api/middleware";
import { notesRouter } from "../../api/routers/notes";
import {
  readVersionConflict,
  type NoteDto,
} from "../../contracts/notes";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

// Local test router: api/router.ts is integrated separately by the lead.
const testRouter = createRouter({ notes: notesRouter });

let testDb: TestDb;

beforeEach(() => {
  testDb = useTempDb();
});

afterEach(() => {
  teardownTempDb(testDb);
});

async function asUser(cookie?: string) {
  const session = await newContext(cookie);
  return testRouter.createCaller(session.ctx);
}

describe("notes router", () => {
  it("creates notes with defaults and safe DTO (ISO timestamps)", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);

    const created = await caller.notes.create({});
    expect(created.title).toBe("Untitled note");
    expect(created.content).toBe("");
    expect(created.version).toBe(1);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created).not.toHaveProperty("userId");
  });

  it("lists summaries without content, scoped to the owner", async () => {
    await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    await (await asUser(p1.cookie)).notes.create({ title: "P1 note" });
    await (await asUser(p2.cookie)).notes.create({ title: "P2 note" });
    await (await asUser(p2.cookie)).notes.create({ title: "P2 second" });

    const p1List = await (await asUser(p1.cookie)).notes.list();
    expect(p1List.map((n) => n.title)).toEqual(["P1 note"]);
    expect(p1List[0]).not.toHaveProperty("content");

    expect(await (await asUser(p2.cookie)).notes.list()).toHaveLength(2);
  });

  it("strictly private: even the master gets 404 for another user's note", async () => {
    const master = await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    const note = await (await asUser(p1.cookie)).notes.create({
      title: "secret",
      content: "# hidden",
    });

    for (const cookie of [p2.cookie, master.cookie]) {
      const caller = await asUser(cookie);
      await expectTrpcError(caller.notes.get({ id: note.id }), "NOT_FOUND");
      await expectTrpcError(
        caller.notes.update({
          id: note.id,
          expectedVersion: 1,
          content: "hack",
        }),
        "NOT_FOUND",
      );
      await expectTrpcError(caller.notes.remove({ id: note.id }), "NOT_FOUND");
    }

    // The owner still reads it.
    const own = await (await asUser(p1.cookie)).notes.get({ id: note.id });
    expect(own.content).toBe("# hidden");
  });

  it("shares one note read-only with multiple recipients", async () => {
    const owner = await registerUser("owner");
    const first = await registerUser("first");
    const second = await registerUser("second");
    const outsider = await registerUser("outsider");
    const ownerApi = await asUser(owner.cookie);
    const note = await ownerApi.notes.create({ title: "Shared", content: "original" });
    const shared = await ownerApi.notes.setShares({ id: note.id, userIds: [first.id, second.id, first.id] });
    expect(shared.sharedWith.map((user) => user.id)).toEqual([first.id, second.id]);

    for (const recipient of [first, second]) {
      const api = await asUser(recipient.cookie);
      expect((await api.notes.get({ id: note.id })).content).toBe("original");
      expect((await api.notes.list()).map((item) => item.id)).toContain(note.id);
      await expectTrpcError(api.notes.update({ id: note.id, expectedVersion: 1, content: "hack" }), "NOT_FOUND");
      await expectTrpcError(api.notes.setShares({ id: note.id, userIds: [] }), "NOT_FOUND");
      await expectTrpcError(api.notes.remove({ id: note.id }), "NOT_FOUND");
    }
    await expectTrpcError((await asUser(outsider.cookie)).notes.get({ id: note.id }), "NOT_FOUND");
    await ownerApi.notes.setShares({ id: note.id, userIds: [second.id] });
    await expectTrpcError((await asUser(first.cookie)).notes.get({ id: note.id }), "NOT_FOUND");
  });

  it("updates with expectedVersion; stale writes get 409 + current entity", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);
    const note = await caller.notes.create({ title: "Log", content: "v1" });

    const updated = await caller.notes.update({
      id: note.id,
      expectedVersion: 1,
      content: "v2",
    });
    expect(updated.version).toBe(2);
    expect(updated.content).toBe("v2");
    expect(updated.title).toBe("Log"); // partial patch keeps other fields

    let conflict: unknown;
    try {
      await caller.notes.update({
        id: note.id,
        expectedVersion: 1, // stale
        content: "stale overwrite",
      });
      throw new Error("expected a CONFLICT");
    } catch (err) {
      conflict = err;
    }
    expect((conflict as { code?: string }).code).toBe("CONFLICT");
    const payload = readVersionConflict<NoteDto>(conflict);
    expect(payload?.currentVersion).toBe(2);
    expect(payload?.current.content).toBe("v2");

    // No lost update: the stale write never landed.
    const fresh = await caller.notes.get({ id: note.id });
    expect(fresh.version).toBe(2);
    expect(fresh.content).toBe("v2");
  });

  it("removes only own notes; gone afterwards", async () => {
    await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    const note = await (await asUser(p1.cookie)).notes.create({});

    await expectTrpcError(
      (await asUser(p2.cookie)).notes.remove({ id: note.id }),
      "NOT_FOUND",
    );

    const caller = await asUser(p1.cookie);
    const removed = await caller.notes.remove({ id: note.id });
    expect(removed.removedId).toBe(note.id);
    await expectTrpcError(caller.notes.get({ id: note.id }), "NOT_FOUND");
    expect(await caller.notes.list()).toHaveLength(0);
  });

  it("validates input at the contract boundary", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);
    await expectTrpcError(
      caller.notes.create({ title: "" }),
      "BAD_REQUEST",
    );
    const note = await caller.notes.create({});
    await expectTrpcError(
      caller.notes.update({ id: note.id, expectedVersion: 0, title: "x" }),
      "BAD_REQUEST",
    );
  });

  it("requires authentication", async () => {
    const anon = await asUser();
    await expectTrpcError(anon.notes.list(), "UNAUTHORIZED");
    await expectTrpcError(anon.notes.create({}), "UNAUTHORIZED");
  });
});

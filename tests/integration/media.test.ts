import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { createRouter } from "../../api/middleware";
import { mediaRouter } from "../../api/routers/media";
import { handleBoardImage } from "../../api/routes/media";
import { LocalImageStorage } from "../../api/storage/local";
import {
  getMediaBackend,
  selectMediaBackend,
  setImageStorageForTests,
} from "../../api/storage";
import type { ImageStorage, ValidatedImage } from "../../api/storage/types";
import {
  MediaValidationError,
  sniffImage,
  validateImageBytes,
} from "../../api/storage/validate";
import { cleanupOrphanedAssets, uploadImage } from "../../api/services/mediaService";
import { boards, compendiumItems, mediaAssets, tokens } from "../../db/schema";
import { eq } from "drizzle-orm";
import { findUserById } from "../../api/repositories/users";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type RegisteredUser,
  type TestDb,
} from "./helpers";

/**
 * Media backend slice: validation, upload rights, authenticated delivery,
 * local roundtrip and orphan cleanup. The mediaRouter is mounted on a local
 * test router here because api/router.ts is wired by the integration lead.
 */
const testRouter = createRouter({ media: mediaRouter });

let testDb: TestDb;
let storageDir: string;
let master: RegisteredUser;
let player: RegisteredUser;

beforeEach(async () => {
  testDb = useTempDb();
  storageDir = path.join(testDb.dir, "uploads");
  setImageStorageForTests("local", new LocalImageStorage(storageDir));
  master = await registerUser("dm-master");
  player = await registerUser("pc-player");
});

afterEach(() => {
  setImageStorageForTests();
  teardownTempDb(testDb);
});

/* ------------------------------- fixtures --------------------------------- */

// 1x1 transparent PNG (real file: valid signature, IHDR CRC and IEND).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Minimal structurally valid JPEG: SOI, SOF0 with the given dims, EOI. */
function makeJpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2); // segment length
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

/** Minimal extended WebP container (VP8X) with the given canvas size. */
function makeWebp(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.concat([Buffer.from("VP8X"), uint32le(10), payload]);
  return Buffer.concat([
    Buffer.from("RIFF"),
    uint32le(4 + chunk.length),
    Buffer.from("WEBP"),
    chunk,
  ]);
}

function uint32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}

/** Minimal lossy WebP (VP8 bitstream header with the 9D 01 2A start code). */
function makeWebpLossy(width: number, height: number): Buffer {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width & 0x3fff, 6);
  frame.writeUInt16LE(height & 0x3fff, 8);
  const chunk = Buffer.concat([Buffer.from("VP8 "), uint32le(10), frame]);
  return Buffer.concat([
    Buffer.from("RIFF"),
    uint32le(4 + chunk.length),
    Buffer.from("WEBP"),
    chunk,
  ]);
}

const b64 = (b: Buffer) => b.toString("base64");

function callerFor(cookie: string) {
  return newContext(cookie).then((s) =>
    testRouter.createCaller(s.ctx).media,
  );
}

async function uploadAs(
  user: RegisteredUser,
  input: { dataBase64: string; purpose: "board" | "token" | "compendium"; compendiumId?: number },
) {
  const caller = await callerFor(user.cookie);
  return caller.uploadImage(input);
}

function insertCompendiumItem(values: {
  type: "spell" | "item" | "character";
  createdBy: number | null;
}): number {
  const now = Date.now();
  return testDb.db
    .insert(compendiumItems)
    .values({
      type: values.type,
      name: "Card",
      createdBy: values.createdBy,
      data: "{}",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get().id;
}

/* ------------------------------- validation ------------------------------- */

describe("image validation", () => {
  it("accepts real PNG/JPEG/WebP and reads their dimensions", () => {
    expect(sniffImage(PNG_1X1)).toEqual({ mime: "image/png", width: 1, height: 1 });
    expect(sniffImage(makeJpeg(32, 16))).toEqual({
      mime: "image/jpeg",
      width: 32,
      height: 16,
    });
    expect(sniffImage(makeWebp(640, 480))).toEqual({
      mime: "image/webp",
      width: 640,
      height: 480,
    });
    expect(sniffImage(makeWebpLossy(300, 200))).toEqual({
      mime: "image/webp",
      width: 300,
      height: 200,
    });
  });

  it("rejects a spoofed PNG signature with garbage after the header", () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0x41),
    ]);
    expect(sniffImage(fake)).toBeNull();
    expect(() => validateImageBytes(fake)).toThrow(MediaValidationError);
  });

  it("rejects a PNG with a corrupted IHDR CRC", () => {
    const corrupted = Buffer.from(PNG_1X1);
    corrupted[29] ^= 0xff; // first CRC byte
    expect(sniffImage(corrupted)).toBeNull();
  });

  it("rejects a truncated PNG without IEND", () => {
    expect(sniffImage(PNG_1X1.subarray(0, PNG_1X1.length - 12))).toBeNull();
  });

  it("rejects SVG and executables", () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]))).toBeNull();
    expect(sniffImage(Buffer.from("#!/bin/sh\nrm -rf /"))).toBeNull();
  });

  it("enforces the 15 MiB byte cap", () => {
    const huge = Buffer.alloc(15 * 1024 * 1024 + 1);
    expect(() => validateImageBytes(huge)).toThrowError(/15\*1024|byte limit|exceeds/);
  });

  it("rejects dimensions above 8192 even with a valid structure", () => {
    expect(sniffImage(makeJpeg(8193, 10))).not.toBeNull(); // parses fine…
    expect(() => validateImageBytes(makeJpeg(8193, 10))).toThrowError(/8192/);
    expect(() => validateImageBytes(makeJpeg(10, 9000))).toThrowError(/8192/);
    expect(validateImageBytes(makeJpeg(8192, 8192)).width).toBe(8192);
  });
});

/* --------------------------------- upload --------------------------------- */

describe("media.uploadImage", () => {
  it("requires authentication", async () => {
    const anon = testRouter.createCaller((await newContext()).ctx).media;
    await expectTrpcError(
      anon.uploadImage({ dataBase64: b64(PNG_1X1), purpose: "board" }),
      "UNAUTHORIZED",
    );
  });

  it("lets the master upload general images (board/token purposes)", async () => {
    const uploaded = await uploadAs(master, {
      dataBase64: b64(PNG_1X1),
      purpose: "board",
    });
    expect(uploaded.key).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
    expect(uploaded.backend).toBe("local");
    expect(uploaded.mime).toBe("image/png");
    expect(uploaded.size).toBe(PNG_1X1.length);
    expect(uploaded.width).toBe(1);
    expect(uploaded.height).toBe(1);
  });

  it("forbids players from board/token uploads", async () => {
    await expectTrpcError(
      uploadAs(player, { dataBase64: b64(PNG_1X1), purpose: "board" }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      uploadAs(player, { dataBase64: b64(PNG_1X1), purpose: "token" }),
      "FORBIDDEN",
    );
  });

  it("lets a player upload for their own item/character card only", async () => {
    const ownItem = insertCompendiumItem({ type: "item", createdBy: player.id });
    const ownCharacter = insertCompendiumItem({ type: "character", createdBy: player.id });
    const ownSpell = insertCompendiumItem({ type: "spell", createdBy: player.id });
    const foreignItem = insertCompendiumItem({ type: "item", createdBy: master.id });

    const ok = await uploadAs(player, {
      dataBase64: b64(PNG_1X1),
      purpose: "compendium",
      compendiumId: ownItem,
    });
    expect(ok.key).toBeTruthy();
    await uploadAs(player, {
      dataBase64: b64(PNG_1X1),
      purpose: "compendium",
      compendiumId: ownCharacter,
    });

    await expectTrpcError(
      uploadAs(player, { dataBase64: b64(PNG_1X1), purpose: "compendium" }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      uploadAs(player, {
        dataBase64: b64(PNG_1X1),
        purpose: "compendium",
        compendiumId: ownSpell,
      }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      uploadAs(player, {
        dataBase64: b64(PNG_1X1),
        purpose: "compendium",
        compendiumId: foreignItem,
      }),
      "FORBIDDEN",
    );
  });

  it("rejects non-image bytes and oversized payloads at the service layer", async () => {
    const masterUser = findUserById(testDb.db, master.id)!;
    await expect(
      uploadImage(testDb.db, masterUser, {
        dataBase64: b64(Buffer.from("<svg/>")),
        purpose: "board",
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    await expect(
      uploadImage(testDb.db, masterUser, {
        dataBase64: b64(Buffer.alloc(15 * 1024 * 1024 + 1, 1)),
        purpose: "board",
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

/* --------------------------- local roundtrip ------------------------------ */

describe("local storage roundtrip + GET /api/board-image", () => {
  function app() {
    const a = new Hono();
    a.get("/api/board-image", handleBoardImage);
    return a;
  }

  it("serves uploaded bytes with the recorded MIME and safe headers", async () => {
    const uploaded = await uploadAs(master, {
      dataBase64: b64(makeJpeg(32, 16)),
      purpose: "board",
    });
    // Bytes are really on disk under the storage root.
    const onDisk = fs.readFileSync(path.join(storageDir, uploaded.key));
    expect(onDisk.equals(makeJpeg(32, 16))).toBe(true);

    const res = await app().request(
      `http://test.local/api/board-image?key=${encodeURIComponent(uploaded.key)}`,
      { headers: { cookie: player.cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(Buffer.from(await res.arrayBuffer()).equals(makeJpeg(32, 16))).toBe(true);
  });

  it("requires a session and rejects bad keys", async () => {
    const uploaded = await uploadAs(master, {
      dataBase64: b64(PNG_1X1),
      purpose: "board",
    });
    const a = app();
    const anon = await a.request(
      `http://test.local/api/board-image?key=${uploaded.key}`,
    );
    expect(anon.status).toBe(401);

    const traversal = await a.request(
      "http://test.local/api/board-image?key=" + encodeURIComponent("../secret"),
      { headers: { cookie: master.cookie } },
    );
    expect(traversal.status).toBe(400);

    const missing = await a.request(
      "http://test.local/api/board-image?key=" +
        encodeURIComponent("images/00000000-0000-0000-0000-000000000000.png"),
      { headers: { cookie: master.cookie } },
    );
    expect(missing.status).toBe(404);
  });
});

/* ------------------------------ orphan cleanup ----------------------------- */

function insertAsset(key: string, createdAt: number): void {
  testDb.db
    .insert(mediaAssets)
    .values({ key, backend: "local", uploadedBy: master.id, mime: "image/png", size: 10, createdAt })
    .run();
}

describe("orphan cleanup", () => {
  it("removes only unreferenced assets older than 24h", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // Put real files for all assets.
    const storage = new LocalImageStorage(storageDir);
    const img: ValidatedImage = {
      key: "images/orphan-old.png",
      bytes: PNG_1X1,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    await storage.put({ ...img, key: "images/orphan-old.png" });
    await storage.put({ ...img, key: "images/orphan-young.png" });
    await storage.put({ ...img, key: "images/ref-board.png" });
    await storage.put({ ...img, key: "images/ref-token.png" });
    await storage.put({ ...img, key: "images/ref-card.png" });

    insertAsset("images/orphan-old.png", now - day - 1000);
    insertAsset("images/orphan-young.png", now - 1000);
    insertAsset("images/ref-board.png", now - day - 1000);
    insertAsset("images/ref-token.png", now - day - 1000);
    insertAsset("images/ref-card.png", now - day - 1000);

    const boardId = testDb.db
      .insert(boards)
      .values({
        name: "B",
        backgroundKey: "images/ref-board.png",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get().id;
    testDb.db
      .insert(tokens)
      .values({
        boardId,
        imageKey: "images/ref-token.png",
        hp: 0,
        maxHp: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    testDb.db
      .update(compendiumItems)
      .set({ imageKey: "images/ref-card.png" })
      .where(eq(compendiumItems.id, insertCompendiumItem({ type: "item", createdBy: master.id })))
      .run();

    const result = await cleanupOrphanedAssets(testDb.db, { now });
    expect(result).toEqual({ scanned: 1, removed: 1, failed: 0 });

    const remaining = testDb.db
      .select({ key: mediaAssets.key })
      .from(mediaAssets)
      .all()
      .map((r) => r.key)
      .sort();
    expect(remaining).toEqual([
      "images/orphan-young.png",
      "images/ref-board.png",
      "images/ref-card.png",
      "images/ref-token.png",
    ]);
    expect(fs.existsSync(path.join(storageDir, "images/orphan-old.png"))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, "images/ref-board.png"))).toBe(true);
  });

  it("keeps the row and counts a failure when file deletion fails", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    insertAsset("images/broken.png", now - day - 1000);

    const failing: ImageStorage = {
      put: async () => ({ key: "unused" }),
      get: async () => {
        throw new Error("unreachable");
      },
      delete: async () => {
        throw new Error("disk on fire");
      },
    };
    setImageStorageForTests("local", failing);

    const result = await cleanupOrphanedAssets(testDb.db, { now });
    expect(result).toEqual({ scanned: 1, removed: 0, failed: 1 });
    // Row kept so the next cleanup retries the file delete (plan §8.3.5).
    expect(
      testDb.db.select().from(mediaAssets).where(eq(mediaAssets.key, "images/broken.png")).all(),
    ).toHaveLength(1);
  });
});

/* -------------------- game integration: image references ------------------- */

describe("game integration with media assets", () => {
  async function masterCaller() {
    return (await newContext(master.cookie)).caller;
  }
  async function playerCaller() {
    return (await newContext(player.cookie)).caller;
  }
  async function uploadKey(purpose: "board" | "token" = "board"): Promise<string> {
    const masterUser = findUserById(testDb.db, master.id)!;
    const dto = await uploadImage(testDb.db, masterUser, {
      dataBase64: b64(PNG_1X1),
      purpose,
    });
    return dto.key;
  }
  const assetRow = (key: string) =>
    testDb.db.select().from(mediaAssets).where(eq(mediaAssets.key, key)).all();
  const fileExists = (key: string) =>
    fs.existsSync(path.join(storageDir, key));

  it("setBackground sets, replaces (deleting the old asset) and clears", async () => {
    const caller = await masterCaller();
    const { board } = await caller.boards.create({ name: "Map" });
    const keyA = await uploadKey();
    const keyB = await uploadKey();

    const set = await caller.boards.setBackground({ id: board.id, imageKey: keyA });
    expect(set.board.backgroundKey).toBe(keyA);

    // Replace: the previous background is unreferenced and fully removed.
    const replaced = await caller.boards.setBackground({ id: board.id, imageKey: keyB });
    expect(replaced.board.backgroundKey).toBe(keyB);
    expect(assetRow(keyA)).toHaveLength(0);
    expect(fileExists(keyA)).toBe(false);
    expect(assetRow(keyB)).toHaveLength(1);

    // Re-setting the SAME key must not delete it.
    await caller.boards.setBackground({ id: board.id, imageKey: keyB });
    expect(assetRow(keyB)).toHaveLength(1);

    // Clear.
    const cleared = await caller.boards.setBackground({ id: board.id, imageKey: null });
    expect(cleared.board.backgroundKey).toBeNull();
    expect(assetRow(keyB)).toHaveLength(0);
  });

  it("setBackground is master-only and validates the asset key", async () => {
    const caller = await masterCaller();
    const { board } = await caller.boards.create({ name: "Map" });
    await expectTrpcError(
      (await playerCaller()).boards.setBackground({ id: board.id, imageKey: null }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      caller.boards.setBackground({ id: board.id, imageKey: "images/deadbeef.png" }),
      "BAD_REQUEST",
    );
  });

  it("token images: set on add/update, replaced and removed with cleanup", async () => {
    const caller = await masterCaller();
    await caller.boards.create({ name: "Map" });
    const keyA = await uploadKey("token");
    const keyB = await uploadKey("token");

    const { token } = await caller.tokens.add({
      kind: "hero",
      label: "Aria",
      hp: 5,
      maxHp: 10,
      imageKey: keyA,
    });
    expect(token.imageKey).toBe(keyA);

    const updated = await caller.tokens.update({ id: token.id, imageKey: keyB });
    expect(updated.token.imageKey).toBe(keyB);
    expect(assetRow(keyA)).toHaveLength(0);
    expect(assetRow(keyB)).toHaveLength(1);

    // Clearing the image removes the asset too.
    await caller.tokens.update({ id: token.id, imageKey: null });
    expect(assetRow(keyB)).toHaveLength(0);

    // Removing a token cleans up its image.
    const keyC = await uploadKey("token");
    await caller.tokens.update({ id: token.id, imageKey: keyC });
    await caller.tokens.remove({ id: token.id });
    expect(assetRow(keyC)).toHaveLength(0);
    expect(fileExists(keyC)).toBe(false);
  });

  it("tokens.clear and boards.remove clean up referenced images", async () => {
    const caller = await masterCaller();
    const { board } = await caller.boards.create({ name: "Map" });
    const bg = await uploadKey();
    await caller.boards.setBackground({ id: board.id, imageKey: bg });
    const t1 = await uploadKey("token");
    const t2 = await uploadKey("token");
    await caller.tokens.add({ kind: "hero", label: "A", hp: 1, maxHp: 1, imageKey: t1 });
    await caller.tokens.add({ kind: "monster", label: "B", hp: 1, maxHp: 1, imageKey: t2 });

    // clear removes token images but keeps the background.
    await caller.tokens.clear({ boardId: board.id });
    expect(assetRow(t1)).toHaveLength(0);
    expect(assetRow(t2)).toHaveLength(0);
    expect(assetRow(bg)).toHaveLength(1);

    // boards.remove cleans the background as well.
    const t3 = await uploadKey("token");
    await caller.tokens.add({ kind: "prop", label: "C", hp: 0, maxHp: 0, imageKey: t3 });
    await caller.boards.remove({ id: board.id });
    expect(assetRow(bg)).toHaveLength(0);
    expect(assetRow(t3)).toHaveLength(0);
    expect(fileExists(bg)).toBe(false);
  });

  it("shared images survive: deleting one reference keeps a shared asset", async () => {
    const caller = await masterCaller();
    const { board } = await caller.boards.create({ name: "Map" });
    const shared = await uploadKey();
    await caller.boards.setBackground({ id: board.id, imageKey: shared });
    await caller.tokens.add({ kind: "prop", label: "P", hp: 0, maxHp: 0, imageKey: shared });
    // Removing the token leaves the asset alive for the board background.
    const state = await caller.game.state();
    const token = state.tokens[0];
    await caller.tokens.remove({ id: token.id });
    expect(assetRow(shared)).toHaveLength(1);
  });

  it("player cannot set a token image (master-only field)", async () => {
    const caller = await masterCaller();
    await caller.boards.create({ name: "Map" });
    const { token } = await caller.tokens.add({ kind: "hero", label: "A", hp: 1, maxHp: 1 });
    await expectTrpcError(
      (await playerCaller()).tokens.update({ id: token.id, imageKey: "images/x.png" }),
      "FORBIDDEN",
    );
  });
});

/* ------------------------------ backend select ----------------------------- */
describe("backend selection", () => {
  it("is explicit-override first, platform when provisioned, else local", () => {
    const triple = {
      KIMI_AGENTGW_BASE_URL: "https://agent-gw.kimi.com/coding/v1",
      KIMI_AGENTGW_API_KEY: "k",
      KIMI_STORAGE_RESOURCE_ID: "r",
    };
    expect(selectMediaBackend({})).toBe("local");
    expect(selectMediaBackend({ ...triple })).toBe("platform");
    expect(selectMediaBackend({ ...triple, MEDIA_STORAGE_BACKEND: "local" })).toBe("local");
    expect(selectMediaBackend({ MEDIA_STORAGE_BACKEND: "platform", ...triple })).toBe("platform");
    expect(() => selectMediaBackend({ MEDIA_STORAGE_BACKEND: "platform" })).toThrow();
    expect(() =>
      selectMediaBackend({ MEDIA_STORAGE_BACKEND: "bogus" }),
    ).toThrow();
    // Test hook installed "local".
    expect(getMediaBackend()).toBe("local");
  });
});

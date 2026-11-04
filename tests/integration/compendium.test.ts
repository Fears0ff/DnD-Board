import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import fs from "node:fs";
import path from "node:path";
import { createRouter } from "../../api/middleware";
import { authRouter } from "../../api/routers/auth";
import { compendiumRouter } from "../../api/routers/compendium";
import { createContext } from "../../api/context";
import { registerHub, type GameHub } from "../../api/realtime/hub";
import {
  COMPENDIUM_IMPORT_MAX_BYTES,
  buildCompendiumJsonSchemas,
  type CompendiumCreateInput,
} from "../../contracts/compendium";
import { compendiumTypes } from "../../contracts/constants";
import {
  expectTrpcError,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

/**
 * Compendium slice tests. api/router.ts is owned by another workstream, so
 * this suite wires a LOCAL router (real auth + compendium routers) and drives
 * it through the real createContext (cookie auth path).
 */
const testRouter = createRouter({ auth: authRouter, compendium: compendiumRouter });

type Caller = ReturnType<(typeof testRouter)["createCaller"]>;

async function callerFor(cookie?: string): Promise<{ caller: Caller; resHeaders: Headers }> {
  const headers = new Headers({ host: "test.local" });
  if (cookie) headers.set("cookie", cookie);
  const req = new Request("http://test.local/api/trpc", { method: "POST", headers });
  const resHeaders = new Headers();
  const ctx = await createContext({ req, resHeaders } as FetchCreateContextFnOptions);
  return { caller: testRouter.createCaller(ctx), resHeaders };
}

interface User {
  id: number;
  cookie: string;
}

async function register(login: string): Promise<User> {
  const { caller, resHeaders } = await callerFor();
  const user = await caller.auth.register({ login, password: "password-123" });
  const cookie = (resHeaders.get("set-cookie") ?? "").match(/dnd_session=[^;]*/)?.[0];
  if (!cookie) throw new Error("no session cookie issued");
  return { id: user.id, cookie };
}

async function masterCaller(): Promise<Caller> {
  const master = await register("master");
  return (await callerFor(master.cookie)).caller;
}

const abilities = { str: 10, dex: 12, con: 14, int: 16, wis: 13, cha: 8 };

/** Minimal valid payload per card type (defaults fill the rest). */
const validData: Record<(typeof compendiumTypes)[number], Record<string, unknown>> = {
  spell: {
    level: 3,
    school: "evocation",
    castingTime: "1 action",
    range: "150 ft",
    duration: "Instantaneous",
  },
  item: {},
  monster: {
    size: "medium",
    creatureType: "undead",
    armorClass: 13,
    hitPoints: 45,
    abilities,
  },
  character: { level: 3, abilities, maxHp: 24, armorClass: 15 },
  species: {},
  class: { hitDie: 8 },
  feat: {},
  background: {},
};

function createInput(
  type: keyof typeof validData,
  name: string,
  dataExtra: Record<string, unknown> = {},
): CompendiumCreateInput {
  return { type, name, data: { ...validData[type], ...dataExtra } } as CompendiumCreateInput;
}

/** Intentionally invalid payloads still satisfy the static input type. */
function asCreate(input: unknown): CompendiumCreateInput {
  return input as CompendiumCreateInput;
}

describe("compendium", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = useTempDb();
  });

  afterEach(() => {
    teardownTempDb(testDb);
  });

  it("master creates and reads one card of every type", async () => {
    const master = await masterCaller();
    let revision = 0;
    for (const type of compendiumTypes) {
      const result = await master.compendium.create(createInput(type, `Card ${type}`));
      expect(result.card.type).toBe(type);
      expect(result.card.createdBy).toBeTypeOf("number");
      expect(result.compendiumRevision).toBe(++revision);
    }
    const list = await master.compendium.list();
    expect(list.items).toHaveLength(compendiumTypes.length);
    expect(list.compendiumRevision).toBe(revision);
    for (const item of list.items) {
      const got = await master.compendium.get({ id: item.id });
      expect(got.card.name).toBe(item.name);
      expect(got.card.data).toEqual(item.data);
    }
  });

  it("requires auth and master role for mutations", async () => {
    const anon = (await callerFor()).caller;
    await expectTrpcError(anon.compendium.list(), "UNAUTHORIZED");

    const master = await masterCaller();
    const player = await register("player");
    const playerCaller = (await callerFor(player.cookie)).caller;

    await expectTrpcError(
      playerCaller.compendium.create(createInput("item", "Dagger")),
      "FORBIDDEN",
    );
    const created = await master.compendium.create(createInput("item", "Dagger"));
    await expectTrpcError(
      playerCaller.compendium.update({ id: created.card.id, name: "Stolen" }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      playerCaller.compendium.remove({ id: created.card.id }),
      "FORBIDDEN",
    );
    await expectTrpcError(
      playerCaller.compendium.importJson({
        json: JSON.stringify({ schemaVersion: 1, cards: [] }),
      }),
      "FORBIDDEN",
    );
  });

  it("rejects invalid card data at the API boundary", async () => {
    const master = await masterCaller();
    await expectTrpcError(
      master.compendium.create(
        asCreate({ type: "spell", name: "Bad spell", data: { ...validData.spell, level: 99 } }),
      ),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      master.compendium.create(
        asCreate({
          type: "monster",
          name: "Bad monster",
          data: { ...validData.monster, abilities: { ...abilities, str: 0 } },
        }),
      ),
      "BAD_REQUEST",
    );
  });

  it("applies visibility: player sees shared and own private, master sees all", async () => {
    const master = await masterCaller();
    const shared = await master.compendium.create({
      ...createInput("spell", "Shared Spell"),
      visibility: "shared",
    });
    const privateCard = await master.compendium.create(createInput("spell", "Secret Spell"));

    const player = await register("player");
    const playerCaller = (await callerFor(player.cookie)).caller;

    const playerList = await playerCaller.compendium.list();
    expect(playerList.items.map((i) => i.name)).toEqual(["Shared Spell"]);
    await expectTrpcError(
      playerCaller.compendium.get({ id: privateCard.card.id }),
      "NOT_FOUND",
    );
    expect((await playerCaller.compendium.get({ id: shared.card.id })).card.name).toBe(
      "Shared Spell",
    );

    const masterList = await master.compendium.list();
    expect(masterList.items.map((i) => i.name)).toEqual(["Shared Spell", "Secret Spell"]);

    // A player's own private card (via copy) stays readable to its owner.
    const copy = await playerCaller.compendium.copy({ id: shared.card.id });
    expect(copy.card.visibility).toBe("private");
    expect(copy.card.createdBy).toBe(player.id);
    const names = (await playerCaller.compendium.list()).items.map((i) => i.name);
    expect(names).toEqual(["Shared Spell", "Shared Spell"]);
    expect(
      (await playerCaller.compendium.get({ id: copy.card.id })).card.id,
    ).toBe(copy.card.id);
  });

  it("filters by type and case-insensitive search substring", async () => {
    const master = await masterCaller();
    await master.compendium.create({ ...createInput("spell", "Fireball"), visibility: "shared" });
    await master.compendium.create({ ...createInput("spell", "Frost Nova"), visibility: "shared" });
    await master.compendium.create({ ...createInput("item", "Fire Opal"), visibility: "shared" });
    await master.compendium.create({ ...createInput("item", "Фонарь Приёмки"), visibility: "shared" });

    expect((await master.compendium.list({ type: "spell" })).items).toHaveLength(2);
    expect(
      (await master.compendium.list({ search: "fire" })).items.map((i) => i.name),
    ).toEqual(["Fireball", "Fire Opal"]);
    expect(
      (await master.compendium.list({ type: "spell", search: "FROST" })).items.map(
        (i) => i.name,
      ),
    ).toEqual(["Frost Nova"]);
    expect(
      (await master.compendium.list({ search: "фонарь" })).items.map((i) => i.name),
    ).toEqual(["Фонарь Приёмки"]);
    expect(
      (await master.compendium.list({ search: "ПРИЁМКИ" })).items.map((i) => i.name),
    ).toEqual(["Фонарь Приёмки"]);
  });

  it("matches class/subclass filters exactly and case-insensitively", async () => {
    const master = await masterCaller();
    await master.compendium.create({
      ...createInput("spell", "Wizard Only", { classes: ["Wizard"], subclasses: ["Evocation"] }),
      visibility: "shared",
    });
    await master.compendium.create({
      ...createInput("spell", "For Everyone"),
      visibility: "shared",
    });
    await master.compendium.create({
      ...createInput("feat", "Fighter Feat", { classes: ["Fighter"] }),
      visibility: "shared",
    });
    await master.compendium.create({
      ...createInput("character", "Hero", { className: "wizard", subclass: "Evocation" }),
      visibility: "shared",
    });

    const names = async (input: { class?: string; subclass?: string }) =>
      (await master.compendium.list(input)).items.map((i) => i.name);

    // Exact case-insensitive match; unrestricted cards match any class.
    expect(await names({ class: "wizard" })).toEqual(["Wizard Only", "For Everyone", "Hero"]);
    expect(await names({ class: "WIZARD" })).toEqual(["Wizard Only", "For Everyone", "Hero"]);
    // Substrings never match.
    expect(await names({ class: "wiz" })).toEqual(["For Everyone"]);
    expect(await names({ class: "fighter" })).toEqual(["For Everyone", "Fighter Feat"]);
    // Subclass dimension is independent and equally strict.
    expect(await names({ subclass: "evocation" })).toEqual([
      "Wizard Only",
      "For Everyone",
      "Fighter Feat",
      "Hero",
    ]);
    expect(await names({ subclass: "necromancy" })).toEqual([
      "For Everyone",
      "Fighter Feat",
    ]);
    expect(await names({ class: "wizard", subclass: "evocation" })).toEqual([
      "Wizard Only",
      "For Everyone",
      "Hero",
    ]);
  });

  it("updates cards, validates data against the stored type, keeps createdBy", async () => {
    const master = await masterCaller();
    const created = await master.compendium.create(createInput("item", "Rope"));

    const renamed = await master.compendium.update({
      id: created.card.id,
      name: "Hempen Rope",
      visibility: "shared",
    });
    expect(renamed.card.name).toBe("Hempen Rope");
    expect(renamed.card.visibility).toBe("shared");
    expect(renamed.card.createdBy).toBe(created.card.createdBy);
    expect(renamed.compendiumRevision).toBe(created.compendiumRevision + 1);

    const withData = await master.compendium.update({
      id: created.card.id,
      data: { category: "gear", cost: "1 gp" },
    });
    expect(withData.card.data).toMatchObject({ category: "gear", cost: "1 gp" });

    // Values violating the stored card type must not validate.
    await expectTrpcError(
      master.compendium.update({ id: created.card.id, data: { category: "plate-mail" } }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      master.compendium.update({ id: created.card.id, data: { weight: -5 } }),
      "BAD_REQUEST",
    );

    await expectTrpcError(master.compendium.update({ id: 9999, name: "Ghost" }), "NOT_FOUND");
    const removed = await master.compendium.remove({ id: created.card.id });
    expect(removed.removedId).toBe(created.card.id);
    expect((await master.compendium.list()).items).toHaveLength(0);
  });

  it("copies cards into independent private copies", async () => {
    const master = await masterCaller();
    const source = await master.compendium.create({
      ...createInput("spell", "Fly", { classes: ["Wizard"] }),
      visibility: "shared",
    });

    const player = await register("player");
    const playerCaller = (await callerFor(player.cookie)).caller;
    const copy = await playerCaller.compendium.copy({ id: source.card.id, name: "My Fly" });
    expect(copy.card.id).not.toBe(source.card.id);
    expect(copy.card.name).toBe("My Fly");
    expect(copy.card.visibility).toBe("private");
    expect(copy.card.createdBy).toBe(player.id);
    expect(copy.card.data).toEqual(source.card.data);

    // Editing the source must not leak into the copy (independent data).
    await master.compendium.update({
      id: source.card.id,
      data: { ...validData.spell, classes: ["Sorcerer"] },
    });
    const reread = await playerCaller.compendium.get({ id: copy.card.id });
    expect(reread.card.data).toMatchObject({ classes: ["Wizard"] });

    // Master may copy with chosen visibility.
    const masterCopy = await master.compendium.copy({
      id: source.card.id,
      visibility: "shared",
    });
    expect(masterCopy.card.visibility).toBe("shared");

    // Another player's private card cannot be copied (invisible -> 404).
    const other = await register("other");
    const otherCaller = (await callerFor(other.cookie)).caller;
    await expectTrpcError(otherCaller.compendium.copy({ id: copy.card.id }), "NOT_FOUND");
  });

  it("imports cards atomically as shared with createdBy null", async () => {
    const master = await masterCaller();
    const file = JSON.stringify({
      schemaVersion: 1,
      cards: [
        { type: "spell", name: "Imported Spell", data: validData.spell },
        { type: "item", name: "Imported Item", data: validData.item },
      ],
    });
    const result = await master.compendium.importJson({ json: file });
    expect(result.imported).toBe(2);
    expect(result.compendiumRevision).toBe(1);

    const list = await master.compendium.list();
    expect(list.items).toHaveLength(2);
    for (const item of list.items) {
      expect(item.visibility).toBe("shared");
      expect(item.createdBy).toBeNull();
    }

    // Players can read imported (shared) cards.
    const player = await register("player");
    const playerCaller = (await callerFor(player.cookie)).caller;
    expect((await playerCaller.compendium.list()).items).toHaveLength(2);
  });

  it("import reports card index and field path, and leaves no partial data", async () => {
    const master = await masterCaller();
    const file = JSON.stringify({
      schemaVersion: 1,
      cards: [
        { type: "item", name: "Fine", data: validData.item },
        { type: "spell", name: "Broken", data: { ...validData.spell, level: 99 } },
        { type: "feat", name: "Also Broken", data: { repeatable: "yes" } },
      ],
    });
    try {
      await master.compendium.importJson({ json: file });
      expect.unreachable("import must fail");
    } catch (err) {
      const e = err as { code?: string; message?: string; issues?: unknown[] };
      expect(e.code).toBe("UNPROCESSABLE_CONTENT");
      expect(e.message).toContain("cards[1].data.level");
      expect(e.message).toContain("cards[2].data.repeatable");
      expect(e.issues).toEqual([
        expect.objectContaining({ index: 1, path: "data.level" }),
        expect.objectContaining({ index: 2, path: "data.repeatable" }),
      ]);
    }

    // Atomic: nothing inserted, revision untouched.
    const list = await master.compendium.list();
    expect(list.items).toHaveLength(0);
    expect(list.compendiumRevision).toBe(0);
  });

  it("import rejects wrong schemaVersion, bad JSON and oversized files", async () => {
    const master = await masterCaller();
    await expectTrpcError(
      master.compendium.importJson({
        json: JSON.stringify({ schemaVersion: 2, cards: [] }),
      }),
      "UNPROCESSABLE_CONTENT",
    );
    await expectTrpcError(
      master.compendium.importJson({ json: "{not json" }),
      "UNPROCESSABLE_CONTENT",
    );

    const tooMany = {
      schemaVersion: 1,
      cards: Array.from({ length: 501 }, (_, i) => ({
        type: "item",
        name: `Item ${i}`,
        data: {},
      })),
    };
    await expectTrpcError(
      master.compendium.importJson({ json: JSON.stringify(tooMany) }),
      "UNPROCESSABLE_CONTENT",
    );

    const huge = ` "${"x".repeat(COMPENDIUM_IMPORT_MAX_BYTES)}"`;
    await expectTrpcError(
      master.compendium.importJson({ json: huge }),
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("publishes compendium.changed only after the commit", async () => {
    const broadcasts: number[] = [];
    const hub: GameHub = {
      handleUpgrade: () => {},
      broadcastGameChanged: () => {},
      broadcastCompendiumChanged: vi.fn((revision: number) => broadcasts.push(revision)),
      clientCount: () => 0,
      close: () => {},
    };
    registerHub(hub);

    const master = await masterCaller();
    const created = await master.compendium.create(createInput("feat", "Lucky"));
    expect(broadcasts).toEqual([created.compendiumRevision]);
    // The notification fires after the data is readable.
    const list = await master.compendium.list();
    expect(list.compendiumRevision).toBe(created.compendiumRevision);
    expect(list.items.map((i) => i.name)).toEqual(["Lucky"]);

    // Failed mutations do not publish.
    await expectTrpcError(
      master.compendium.importJson({ json: "{broken" }),
      "UNPROCESSABLE_CONTENT",
    );
    expect(broadcasts).toEqual([created.compendiumRevision]);
  });

  it("committed JSON schemas match the Zod contracts byte-for-byte", () => {
    const expected = buildCompendiumJsonSchemas();
    const dir = path.resolve(__dirname, "../../docs/import-schemas/v1");
    const onDisk = fs.readdirSync(dir).sort();
    expect(onDisk).toEqual(Object.keys(expected).sort());
    for (const [name, content] of Object.entries(expected)) {
      expect(fs.readFileSync(path.join(dir, name), "utf8")).toBe(content);
    }
    // Every published schema declares draft 2020-12.
    for (const name of onDisk) {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      expect(parsed.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }
  });
});

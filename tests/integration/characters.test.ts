import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../../api/middleware";
import { charactersRouter } from "../../api/routers/characters";
import { compendiumItems } from "../../db/schema";
import {
  abilityModifier,
  createDefaultSheetData,
  proficiencyBonus,
  proficiencyMultiplier,
  readVersionConflict,
  skillAbilities,
  skillBonus,
  type CharacterDto,
} from "../../contracts/characters";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

// Local test router: api/router.ts is integrated separately by the lead.
const testRouter = createRouter({ characters: charactersRouter });

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

function insertCharacterCard(
  data: unknown,
  opts: { name?: string; visibility?: "private" | "shared"; createdBy?: number | null } = {},
): number {
  const now = Date.now();
  return testDb.db
    .insert(compendiumItems)
    .values({
      type: "character",
      name: opts.name ?? "Card Hero",
      visibility: opts.visibility ?? "shared",
      createdBy: opts.createdBy ?? null,
      data: JSON.stringify(data),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get().id;
}

describe("character sheet contracts (derived rules)", () => {
  it("computes ability modifiers per D&D 2024", () => {
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(30)).toBe(10);
  });

  it("computes proficiency bonus per D&D 2024", () => {
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(8)).toBe(3);
    expect(proficiencyBonus(9)).toBe(4);
    expect(proficiencyBonus(20)).toBe(6);
    expect(proficiencyMultiplier("none")).toBe(0);
    expect(proficiencyMultiplier("proficient")).toBe(1);
    expect(proficiencyMultiplier("expertise")).toBe(2);
    // str 16 (+3), proficient at level 5 (+3) => +6
    expect(skillBonus(16, "proficient", 5)).toBe(6);
  });

  it("default sheet covers all seven tabs", () => {
    const sheet = createDefaultSheetData();
    expect(sheet.sheetVersion).toBe(1);
    expect(sheet.abilities.str).toBe(10);
    expect(sheet.identity.level).toBe(1);
    expect(skillAbilities.athletics).toBe("str");
    expect(sheet.skills.perception).toBe("none");
    expect(sheet.saves.dex).toBe("none");
    expect(sheet.spellcasting.slots).toHaveLength(9);
    expect(sheet.inventory.currency.gp).toBe(0);
    expect(sheet.attacks.list).toEqual([]);
    expect(sheet.traits.featuresAndTraits).toBe("");
    expect(sheet.vitals.heroicInspiration).toBe(false);
    expect(sheet.vitals.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});

describe("characters router", () => {
  it("creates a default sheet owned by the caller with safe DTO", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);

    const created = await caller.characters.create({});
    expect(created.id).toBeGreaterThan(0);
    expect(created.ownerId).toBe(player.id);
    expect(created.name).toBe("Unnamed character");
    expect(created.version).toBe(1);
    expect(created.data.sheetVersion).toBe(1);
    expect(created.data.abilities.str).toBe(10);
    // Safe DTO: ISO timestamps, no raw DB row leakage.
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created).not.toHaveProperty("passwordHash");
  });

  it("scopes list: master sees all sheets, players only their own", async () => {
    const master = await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    await (await asUser(p1.cookie)).characters.create({ name: "P1 hero" });
    await (await asUser(p2.cookie)).characters.create({ name: "P2 hero" });
    await (await asUser(p2.cookie)).characters.create({ name: "P2 second" });

    const asP1 = await asUser(p1.cookie);
    const p1List = await asP1.characters.list();
    expect(p1List.map((c) => c.name)).toEqual(["P1 hero"]);

    const asP2 = await asUser(p2.cookie);
    expect(await asP2.characters.list()).toHaveLength(2);

    const asMaster = await asUser(master.cookie);
    const all = await asMaster.characters.list();
    expect(all).toHaveLength(3);
    // Summaries carry no sheet JSON.
    expect(all[0]).not.toHaveProperty("data");
  });

  it("player gets 404 for another user's sheet; master can read any", async () => {
    const master = await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    const sheet = await (await asUser(p1.cookie)).characters.create({});

    await expectTrpcError(
      (await asUser(p2.cookie)).characters.get({ id: sheet.id }),
      "NOT_FOUND",
    );
    const fetched = await (await asUser(master.cookie)).characters.get({
      id: sheet.id,
    });
    expect(fetched.id).toBe(sheet.id);
  });

  it("updates with expectedVersion and bumps the version", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);
    const created = await caller.characters.create({ name: "Hero" });

    const updated = await caller.characters.update({
      id: created.id,
      expectedVersion: 1,
      name: "Renamed",
      data: { abilities: { str: 16 }, identity: { level: 5 } },
    });
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Renamed");
    expect(updated.data.abilities.str).toBe(16);
    // Untouched sections keep their values (shallow merge, not replace).
    expect(updated.data.abilities.dex).toBe(10);
    expect(updated.data.identity.level).toBe(5);
  });

  it("rejects a stale expectedVersion with 409 + current entity (no lost update)", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);
    const created = await caller.characters.create({ name: "Hero" });

    const first = await caller.characters.update({
      id: created.id,
      expectedVersion: 1,
      data: { traits: { backstory: "first write" } },
    });
    expect(first.version).toBe(2);

    let conflict: unknown;
    try {
      await caller.characters.update({
        id: created.id,
        expectedVersion: 1, // stale
        data: { traits: { backstory: "stale overwrite" } },
      });
      throw new Error("expected a CONFLICT");
    } catch (err) {
      conflict = err;
    }
    expect((conflict as { code?: string }).code).toBe("CONFLICT");
    const payload = readVersionConflict<CharacterDto>(conflict);
    expect(payload?.currentVersion).toBe(2);
    expect(payload?.current.data.traits.backstory).toBe("first write");

    // The stale write never landed.
    const fresh = await caller.characters.get({ id: created.id });
    expect(fresh.version).toBe(2);
    expect(fresh.data.traits.backstory).toBe("first write");
  });

  it("only owner or master may update/remove; others get 404", async () => {
    const master = await registerUser("boss");
    const p1 = await registerUser("pawn1");
    const p2 = await registerUser("pawn2");
    const asP1 = await asUser(p1.cookie);
    const sheet = await asP1.characters.create({});

    const asP2 = await asUser(p2.cookie);
    await expectTrpcError(
      asP2.characters.update({
        id: sheet.id,
        expectedVersion: 1,
        name: "hack",
      }),
      "NOT_FOUND",
    );
    await expectTrpcError(
      asP2.characters.remove({ id: sheet.id }),
      "NOT_FOUND",
    );

    // Master may edit anyone's sheet.
    const asMaster = await asUser(master.cookie);
    const updated = await asMaster.characters.update({
      id: sheet.id,
      expectedVersion: 1,
      name: "master edit",
    });
    expect(updated.name).toBe("master edit");

    // Owner removes their own sheet.
    const removed = await asP1.characters.remove({ id: sheet.id });
    expect(removed.removedId).toBe(sheet.id);
    await expectTrpcError(
      asMaster.characters.get({ id: sheet.id }),
      "NOT_FOUND",
    );
  });

  it("copies a compendium character card once, then stays independent", async () => {
    await registerUser("boss");
    const player = await registerUser("hero");
    const cardId = insertCharacterCard(
      {
        abilities: { str: 16 },
        identity: { className: "Fighter", level: 3 },
        traits: { backstory: "from the card" },
      },
      { name: "Card Hero" },
    );

    const caller = await asUser(player.cookie);
    const created = await caller.characters.create({ sourceCardId: cardId });
    expect(created.name).toBe("Card Hero");
    expect(created.data.abilities.str).toBe(16);
    expect(created.data.abilities.dex).toBe(10); // defaults fill the rest
    expect(created.data.identity.className).toBe("Fighter");
    expect(created.data.traits.backstory).toBe("from the card");

    // Independence: deleting the card does not affect the sheet.
    testDb.db.delete(compendiumItems).run();
    const sheet = await caller.characters.get({ id: created.id });
    expect(sheet.data.abilities.str).toBe(16);
    expect(sheet.data.traits.backstory).toBe("from the card");

    // An explicit name/data overrides the card snapshot.
    const cardId2 = insertCharacterCard({ identity: { className: "Wizard" } });
    const overridden = await caller.characters.create({
      sourceCardId: cardId2,
      name: "Custom",
      data: { identity: { className: "Rogue" } },
    });
    expect(overridden.name).toBe("Custom");
    expect(overridden.data.identity.className).toBe("Rogue");
  });

  it("cannot copy a private card owned by someone else (404)", async () => {
    const master = await registerUser("boss");
    const player = await registerUser("hero");
    const privateCard = insertCharacterCard(
      { identity: { className: "Secret" } },
      { visibility: "private", createdBy: master.id },
    );

    await expectTrpcError(
      (await asUser(player.cookie)).characters.create({
        sourceCardId: privateCard,
      }),
      "NOT_FOUND",
    );

    // The master sees all cards and may copy them.
    const copied = await (await asUser(master.cookie)).characters.create({
      sourceCardId: privateCard,
    });
    expect(copied.data.identity.className).toBe("Secret");

    // Missing card ids are 404 as well.
    await expectTrpcError(
      (await asUser(master.cookie)).characters.create({ sourceCardId: 9999 }),
      "NOT_FOUND",
    );
  });

  it("rejects invalid sheet data at the contract boundary", async () => {
    const player = await registerUser("hero");
    const caller = await asUser(player.cookie);
    await expectTrpcError(
      caller.characters.create({ data: { abilities: { str: 99 } } }),
      "BAD_REQUEST",
    );
    const created = await caller.characters.create({});
    await expectTrpcError(
      caller.characters.update({
        id: created.id,
        expectedVersion: 1,
        data: { identity: { level: 25 } },
      }),
      "BAD_REQUEST",
    );
  });

  it("requires authentication", async () => {
    const anon = await asUser();
    await expectTrpcError(anon.characters.list(), "UNAUTHORIZED");
    await expectTrpcError(anon.characters.create({}), "UNAUTHORIZED");
  });
});

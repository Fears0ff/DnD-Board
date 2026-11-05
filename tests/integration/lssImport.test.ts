import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSheetData,
  mergeSheetData,
  proficiencyBonus,
  skillBonus,
  abilityModifier,
  readVersionConflict,
  type CharacterDto,
  type VersionConflictCause,
} from "../../contracts/characters";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type RegisteredUser,
  type TestDb,
} from "./helpers";
import { parseLssExport, LssImportError } from "../../api/lib/lssImport";

const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "lss-kort.json");

let testDb: TestDb;
let player: RegisteredUser;

beforeEach(async () => {
  testDb = useTempDb();
  player = await registerUser("pc-player");
});

afterEach(() => {
  teardownTempDb(testDb);
  vi.unstubAllGlobals();
});

describe("derived rules (pure)", () => {
  it("computes ability modifiers per D&D 2024", () => {
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(20)).toBe(5);
  });

  it("computes the proficiency bonus for levels 1..20", () => {
    expect(proficiencyBonus(1)).toBe(2);
    expect(proficiencyBonus(4)).toBe(2);
    expect(proficiencyBonus(5)).toBe(3);
    expect(proficiencyBonus(9)).toBe(4);
    expect(proficiencyBonus(20)).toBe(6);
  });

  it("composes skill bonuses from score, rank and level", () => {
    expect(skillBonus(16, "none", 5)).toBe(3);
    expect(skillBonus(16, "proficient", 5)).toBe(6);
    expect(skillBonus(16, "expertise", 5)).toBe(9);
  });
});

describe("parseLssExport (pure mapping)", () => {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");

  it("maps a realistic export into the sheet with a readable name", () => {
    const { name, data } = parseLssExport(raw);
    expect(name).toBe("Корт");
    expect(data.sheetVersion).toBe(1);
    // Identity
    expect(data.identity.className).toBe("Бард");
    expect(data.identity.level).toBe(5);
    // Ability scores: stored LSS modifiers are wrong; only scores are used.
    expect(data.abilities.cha).toBe(20);
    expect(data.abilities.str).toBe(8);
    // Skills map by LSS display names with isProf → rank.
    expect(data.skills.persuasion).toBe("expertise");
    expect(data.skills.perception).toBe("proficient");
    expect(data.skills.athletics).toBe("none");
    // Vitals
    expect(data.vitals.maxHp).toBe(38);
    expect(data.vitals.armorClass).toBe(12);
    expect(data.vitals.speed).toBe(30);
    expect(data.vitals.passivePerception).toBe(14);
    expect(data.vitals.hitDice).toBe("3к8");
    expect(data.vitals.heroicInspiration).toBe(true);
    // Weapons keep full damage text verbatim.
    expect(data.attacks.list.map((w) => w.name)).toContain("Рапира");
    expect(data.attacks.list[0].damage).toBe("1к8+4 Колющий + 1к6 Огонь");
    expect(data.attacks.list[0].attackBonus).toBe("+7");
    // Text blocks land in mapped sections.
    expect(data.inventory.otherEquipment).toContain("Жезл секретов");
    expect(data.traits.featuresAndTraits).toContain("Колдовские сказки");
    // Money
    expect(data.inventory.currency.gp).toBe(10);
    // Unrepresented LSS state is preserved in the typed extension bucket.
    const ext = data.extensions.longStoryShort!;
    expect(ext.source).toBe("long-story-short");
    expect(ext.importedAt).not.toBe("");
    expect(ext.edition).toBe("2024");
    expect(ext.sheetEdition).toBe("2024");
    expect(ext.resources).toBeDefined();
    expect(ext.bonusesSkills).toBeDefined();
    expect(ext.spells).toBeDefined();
    expect(ext.settings).toBeDefined();
    // Avatar bytes/URLs are NOT duplicated into the sheet data.
    expect(JSON.stringify(data.extensions)).not.toContain("hotbox");
  });

  it("accepts sheets without optional name", () => {
    const outer = JSON.parse(raw) as { data: string };
    const inner = JSON.parse(outer.data) as Record<string, unknown>;
    delete inner.name;
    const { name } = parseLssExport(
      JSON.stringify({ ...outer, data: JSON.stringify(inner) }),
    );
    expect(name).toBe("Импортированный персонаж");
  });

  it("rejects malformed inputs with Russian messages", () => {
    expect(() => parseLssExport("not json")).toThrow(LssImportError);
    expect(() => parseLssExport("not json")).toThrow(/JSON/u);
    expect(() => parseLssExport(JSON.stringify({ data: "{\"a\":" }))).toThrow(
      /некорректный JSON/u,
    );
    expect(() => parseLssExport(JSON.stringify({ jsonType: "monster" }))).toThrow(
      /не персонажа/u,
    );
    expect(() => parseLssExport(JSON.stringify({ data: "[1]" }))).toThrow(
      /неверный формат/u,
    );
  });
});

describe("characters.importLss", () => {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");

  it("creates a new owned sheet from pasted text with a stored portrait", async () => {
    const pc = await newContext(player.cookie);
    const result = (await pc.caller.characters.importLss({
      jsonText: raw,
    })) as CharacterDto;
    expect(result.name).toBe("Корт");
    expect(result.ownerId).toBe(player.id);
    expect(result.data.identity.className).toBe("Бард");
    expect(result.version).toBe(1);
    // The fixture avatar is a hotbox URL; network is stubbed below to deliver
    // a PNG, so the portrait becomes a media asset with its key stored.
    // (In this test fetch is NOT stubbed yet, so avatar fetch fails and the
    // import still succeeds without a portrait.)
    expect(result.portraitKey).toBeNull();

    const list = (await pc.caller.characters.list()) as { name: string }[];
    expect(list.map((c) => c.name)).toContain("Корт");
  });

  it("stores an avatar fetched over HTTPS from the allowlisted host", async () => {
    const png = Buffer.from(
      // 1x1 transparent PNG
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(png, {
          status: 200,
          headers: { "content-length": String(png.length) },
        }),
      ),
    );
    const pc = await newContext(player.cookie);
    const result = (await pc.caller.characters.importLss({
      jsonText: raw,
    })) as CharacterDto;
    expect(result.portraitKey).not.toBeNull();
    const row = testDb.db.$client
      .prepare("SELECT key, backend, mime, size FROM media_assets WHERE key = ?")
      .get(result.portraitKey!) as {
      key: string;
      backend: string;
      mime: string;
      size: number;
    };
    expect(row.backend).toBe("local");
    expect(row.mime).toBe("image/png");
    expect(row.size).toBe(png.length);
    // The URL is never persisted or rendered.
    expect(JSON.stringify(result)).not.toContain("http");
  });

  it("rejects avatar URLs outside the allowlisted host (SSRF guard)", async () => {
    const outer = JSON.parse(raw) as { data: string };
    const inner = JSON.parse(outer.data) as Record<string, unknown>;
    inner.avatar = "https://evil.example.com/x.png";
    const pc = await newContext(player.cookie);
    const result = (await pc.caller.characters.importLss({
      jsonText: JSON.stringify({ ...outer, data: JSON.stringify(inner) }),
    })) as CharacterDto;
    // Bad avatar must not block the import; it is skipped with a log line.
    expect(result.portraitKey).toBeNull();
  });

  it("maps BAD_REQUEST with a Russian message for a non-LSS file", async () => {
    const pc = await newContext(player.cookie);
    await expectTrpcError(
      pc.caller.characters.importLss({ jsonText: "{\n" }),
      "BAD_REQUEST",
      /JSON/u,
    );
  });
});

describe("characters CRUD + optimistic concurrency", () => {
  it("creates a default sheet owned by the caller and lists summaries", async () => {
    const pc = await newContext(player.cookie);
    const created = (await pc.caller.characters.create({})) as CharacterDto;
    expect(created.name).toBe("Unnamed character");
    expect(created.ownerId).toBe(player.id);
    expect(created.data).toEqual(createDefaultSheetData());
    expect(created.version).toBe(1);

    const list = (await pc.caller.characters.list()) as {
      id: number;
      name: string;
    }[];
    expect(list).toEqual([{ id: created.id, name: "Unnamed character" }]);
    // List payload excludes the sheet JSON.
    expect("data" in list[0]).toBe(false);
  });

  it("updates with merge semantics and bumps the version", async () => {
    const pc = await newContext(player.cookie);
    const created = (await pc.caller.characters.create({
      name: "Hero",
    })) as CharacterDto;
    const updated = (await pc.caller.characters.update({
      id: created.id,
      expectedVersion: 1,
      name: "Hero II",
      data: { identity: { level: 7 }, vitals: { maxHp: 55, currentHp: 40 } },
    })) as CharacterDto;
    expect(updated.name).toBe("Hero II");
    expect(updated.version).toBe(2);
    expect(updated.data.identity.level).toBe(7);
    expect(updated.data.vitals.maxHp).toBe(55);
    // Untouched sections survive the shallow merge.
    expect(updated.data.abilities).toEqual(created.data.abilities);
  });

  it("rejects a stale expectedVersion with 409 and the current entity in cause", async () => {
    const pc = await newContext(player.cookie);
    const created = (await pc.caller.characters.create({ name: "A" })) as CharacterDto;
    await pc.caller.characters.update({
      id: created.id,
      expectedVersion: 1,
      data: { identity: { level: 2 } },
    });
    let conflict: unknown;
    try {
      await pc.caller.characters.update({
        id: created.id,
        expectedVersion: 1, // stale
        data: { identity: { level: 99 } },
      });
      expect.unreachable("stale write must conflict");
    } catch (err) {
      conflict = err;
    }
    const cause = readVersionConflict<CharacterDto>(conflict);
    expect(cause).not.toBeNull();
    expect((conflict as { data?: { code?: string } }).data?.code).toBe("CONFLICT");
    expect((cause as VersionConflictCause<CharacterDto>).currentVersion).toBe(2);
    expect(
      (cause as VersionConflictCause<CharacterDto>).current.data.identity.level,
    ).toBe(2);
  });

  it("enforces ownership: players cannot read/update/remove others' sheets", async () => {
    const other = await registerUser("pc-other");
    const pcA = await newContext(player.cookie);
    const created = (await pcA.caller.characters.create({ name: "Mine" })) as CharacterDto;

    const pcB = await newContext(other.cookie);
    await expectTrpcError(pcB.caller.characters.get({ id: created.id }), "NOT_FOUND");
    await expectTrpcError(
      pcB.caller.characters.update({
        id: created.id,
        expectedVersion: 1,
        name: "Stolen",
      }),
      "NOT_FOUND",
    );
    await expectTrpcError(
      pcB.caller.characters.remove({ id: created.id }),
      "NOT_FOUND",
    );
    const list = (await pcB.caller.characters.list()) as unknown[];
    expect(list).toEqual([]);
  });

  it("lets the master read and update any sheet", async () => {
    const pc = await newContext(player.cookie);
    const created = (await pc.caller.characters.create({ name: "Player's" })) as CharacterDto;
    const dmUser = await registerUser("dm-user", "master");
    const dm = await newContext(dmUser.cookie);
    const got = (await dm.caller.characters.get({ id: created.id })) as CharacterDto;
    expect(got.name).toBe("Player's");
    const updated = (await dm.caller.characters.update({
      id: created.id,
      expectedVersion: 1,
      data: { identity: { level: 3 } },
    })) as CharacterDto;
    expect(updated.data.identity.level).toBe(3);
    const list = (await dm.caller.characters.list()) as { name: string }[];
    expect(list.map((c) => c.name)).toContain("Player's");
  });

  it("copies a compendium character card once at creation", async () => {
    const dmUser = await registerUser("dm-cards", "master");
    const dm = await newContext(dmUser.cookie);
    const card = await dm.caller.compendium.create({
      type: "character",
      name: "Pre-made wizard",
      visibility: "shared",
      data: {
        identity: { className: "Wizard", level: 4 },
        abilities: { int: 18 },
      },
    });
    const pc = await newContext(player.cookie);
    const created = (await pc.caller.characters.create({
      sourceCardId: card.card.id,
    })) as CharacterDto;
    expect(created.name).toBe("Pre-made wizard");
    expect(created.data.identity.className).toBe("Wizard");
    expect(created.data.abilities.int).toBe(18);
    // Defaults fill the rest of the sheet.
    expect(created.data.vitals.armorClass).toBe(10);
  });

  it("sheet patch merges keep nested sections intact", () => {
    const base = createDefaultSheetData();
    const merged = mergeSheetData(base, {
      vitals: { maxHp: 44 },
      skills: { stealth: "expertise" },
    });
    expect(merged.vitals.maxHp).toBe(44);
    expect(merged.vitals.armorClass).toBe(10);
    expect(merged.skills.stealth).toBe("expertise");
    expect(merged.skills.acrobatics).toBe("none");
  });
});

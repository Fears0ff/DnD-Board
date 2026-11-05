import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../../api/middleware";
import { charactersRouter } from "../../api/routers/characters";
import { mediaRouter } from "../../api/routers/media";
import { parseLssExport, LssImportError } from "../../api/lib/lssImport";
import {
  countMediaReferences,
  findMediaAsset,
} from "../../api/repositories/media";
import { deleteAssetIfUnreferenced } from "../../api/services/mediaService";
import { setImageStorageForTests } from "../../api/storage";
import { LocalImageStorage } from "../../api/storage/local";
import {
  expectTrpcError,
  newContext,
  registerUser,
  teardownTempDb,
  useTempDb,
  type TestDb,
} from "./helpers";

// Local test router: api/router.ts is integrated separately by the lead.
const testRouter = createRouter({ characters: charactersRouter, media: mediaRouter });

let testDb: TestDb;

beforeEach(() => {
  testDb = useTempDb();
  setImageStorageForTests("local", new LocalImageStorage(path.join(testDb.dir, "uploads")));
});

afterEach(() => {
  setImageStorageForTests();
  teardownTempDb(testDb);
});

async function asUser(cookie?: string) {
  const session = await newContext(cookie);
  return testRouter.createCaller(session.ctx);
}

/* --------------------------- compact LSS fixtures -------------------------- */

function pm(text: string) {
  return {
    value: {
      data: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text }] },
        ],
      },
    },
  };
}

function makeKortFixture(): string {
  const inner = {
    jsonType: "character",
    name: { value: "Корт" },
    info: {
      charClass: { value: "Волшебник" },
      level: { value: 5 },
      background: { value: "Криминал" },
      playerName: { value: "Фирс" },
      race: { value: "Людоящер" },
      alignment: { value: "Ну такое" },
      experience: { value: "" },
    },
    subInfo: { age: { value: 18 }, height: { value: "2 метра" } },
    stats: {
      str: { score: 10, modifier: 99 }, // stored modifiers are wrong on purpose
      dex: { score: 16, modifier: -5 },
      con: { score: 14, modifier: -5 },
      int: { score: 18, modifier: -5 },
      wis: { score: 10, modifier: 0 },
      cha: { score: 8, modifier: 0 },
    },
    saves: {
      str: { isProf: false },
      dex: { isProf: false },
      con: { isProf: false },
      int: { isProf: true },
      wis: { isProf: true },
      cha: { isProf: false },
    },
    skills: {
      investigation: { baseStat: "int", isProf: 1 },
      "sleight of hand": { baseStat: "dex" },
      stealth: { baseStat: "dex", isProf: 1 },
      arcana: { baseStat: "int", isProf: 2 },
    },
    vitality: {
      "hp-max": { value: 32 },
      "hp-current": { value: 32 },
      "hp-temp": { value: 0 },
      ac: { value: 16 },
      speed: { value: "30" },
      deathFails: 0,
      deathSuccesses: 2,
    },
    weaponsList: [
      {
        name: { value: "Кусь" },
        mod: { value: "+0" },
        dmg: { value: "1к6 - колющий" },
        isProf: true,
      },
    ],
    text: {
      features: pm("Арканическое восстановление"),
      equipment: pm("Сумка с компонентами"),
      allies: pm("Гильдия"),
      strangeFutureBlock: { customLabel: "X", value: { data: pm("?").value.data } },
    },
    coins: { gp: { value: 20 }, sp: { value: 3 }, cp: { value: 0 }, ep: { value: 0 }, pp: { value: 0 } },
    resources: { rage: { value: 2 } },
    bonusesSkills: { stealth: { value: 1 } },
    bonusesStats: {},
    conditions: [],
    proficiency: 3,
    futureInnerField: { hello: "world" },
  };
  return JSON.stringify({
    jsonType: "character",
    edition: "2014",
    sheetEdition: "2024",
    spells: { mode: "cards", prepared: [], book: [] },
    disabledBlocks: { "info-left": [] },
    futureOuterField: [1, 2, 3],
    data: JSON.stringify(inner),
  });
}

function makeHalldorFixture(): string {
  const inner = {
    jsonType: "character",
    name: { value: "Хальдор сын Ульфа" },
    info: {
      charClass: { value: "Варвар" },
      charSubclass: { value: "Берсерк" },
      level: { value: 4 },
      race: { value: "Человек" },
    },
    stats: {
      str: { score: 18 },
      dex: { score: 14 },
      con: { score: 14 },
      int: { score: 10 },
      wis: { score: 10 },
      cha: { score: 10 },
    },
    saves: { str: { isProf: true }, con: { isProf: true } },
    skills: { athletics: { isProf: 1 }, perception: { isProf: 1 } },
    vitality: {
      "hp-max": { value: 49 },
      "hp-current": { value: 49 },
      "hit-die": { value: "d12" },
      "hp-dice-current": { value: 4 },
      ac: { value: 16 },
      speed: { value: 30 },
      initiative: { value: null },
      deathFails: 1,
      deathSuccesses: 0,
    },
    weaponsList: [
      {
        name: { value: "Секира" },
        mod: { value: "+0" },
        dmg: { value: "1к12 + 6" },
        notes: { value: "Тяжёлое, двуручное" },
      },
    ],
    text: { attacks: { customLabel: "Атаки", ...pm("Текст атак") } },
    coins: { gp: { value: 20 } },
    resources: {},
    inspiration: true,
    prof: { "armor-light": { value: true }, "weapon-martial": { value: true } },
    attunementsList: [{ name: "Меч" }],
    avatar: {
      jpeg: "https://hotbox.longstoryshort.app/avatar/abc.jpeg?mod=1",
      webp: "https://hotbox.longstoryshort.app/avatar/abc.webp?mod=1",
    },
  };
  return JSON.stringify({
    jsonType: "character",
    edition: "2014",
    sheetEdition: "2024",
    spells: { mode: "cards", prepared: [], book: [] },
    data: JSON.stringify(inner),
  });
}

/* --------------------------------- tests ---------------------------------- */

describe("parseLssExport mapping", () => {
  it("maps Kort identity, scores, proficiencies, vitals, attacks, currencies", () => {
    const { name, data, avatar } = parseLssExport(makeKortFixture());
    expect(name).toBe("Корт");
    expect(avatar).toBeNull();

    expect(data.identity.className).toBe("Волшебник");
    expect(data.identity.level).toBe(5);
    expect(data.identity.background).toBe("Криминал");
    expect(data.identity.species).toBe("Людоящер");
    expect(data.identity.playerName).toBe("Фирс");

    // Scores taken from `score`; bogus stored modifiers ignored.
    expect(data.abilities.dex).toBe(16);
    expect(data.abilities.int).toBe(18);
    expect(data.abilities.cha).toBe(8);

    expect(data.saves.int).toBe("proficient");
    expect(data.saves.wis).toBe("proficient");
    expect(data.saves.str).toBe("none");

    expect(data.skills.investigation).toBe("proficient");
    expect(data.skills.stealth).toBe("proficient");
    expect(data.skills.arcana).toBe("expertise"); // isProf: 2
    expect(data.skills.sleightOfHand).toBe("none"); // "sleight of hand" key
    expect(data.skills.perception).toBe("none");

    expect(data.vitals.maxHp).toBe(32);
    expect(data.vitals.currentHp).toBe(32);
    expect(data.vitals.armorClass).toBe(16);
    expect(data.vitals.speed).toBe(30);
    expect(data.vitals.deathSaves).toEqual({ successes: 2, failures: 0 });

    expect(data.attacks.list).toHaveLength(1);
    expect(data.attacks.list[0]).toMatchObject({
      name: "Кусь",
      attackBonus: "+0",
      damage: "1к6 - колющий", // full damage text preserved
    });

    expect(data.inventory.currency).toMatchObject({ gp: 20, sp: 3, cp: 0 });

    expect(data.traits.featuresAndTraits).toContain("Арканическое восстановление");
    expect(data.inventory.otherEquipment).toContain("Сумка с компонентами");
    expect(data.traits.alliesAndOrganizations).toContain("Гильдия");
    expect(data.traits.appearance).toContain("Возраст: 18");
    expect(data.traits.appearance).toContain("Рост: 2 метра");
  });

  it("preserves unsupported data in extensions.longStoryShort as JSON", () => {
    const { data } = parseLssExport(makeKortFixture());
    const ext = data.extensions.longStoryShort;
    expect(ext).toBeDefined();
    expect(ext?.source).toBe("long-story-short");
    expect(ext?.edition).toBe("2014");
    expect(ext?.resources).toEqual({ rage: { value: 2 } });
    expect(ext?.bonusesSkills).toEqual({ stealth: { value: 1 } });
    expect(ext?.spells).toMatchObject({ outer: { mode: "cards" } });
    expect(ext?.settings).toMatchObject({ disabledBlocks: { "info-left": [] } });
    expect(ext?.unknownFields).toEqual({ futureInnerField: { hello: "world" } });
    expect(ext?.unknownOuterFields).toEqual({ futureOuterField: [1, 2, 3] });
    // Text block without a sheet counterpart is kept, not dropped.
    expect(ext?.unmappedText.strangeFutureBlock).toBeDefined();
    // Whole sheet still validates against the shared contract.
    expect(data.sheetVersion).toBe(1);
  });

  it("maps Halldor fixture: subclass, hit dice, inspiration, avatar URL", () => {
    const { name, data, avatar } = parseLssExport(makeHalldorFixture());
    expect(name).toBe("Хальдор сын Ульфа");
    expect(data.identity.subclass).toBe("Берсерк");
    expect(data.abilities.str).toBe(18);
    expect(data.vitals.hitDice).toBe("4d12");
    expect(data.vitals.initiative).toBe(0); // null → default
    expect(data.vitals.deathSaves.failures).toBe(1);
    expect(data.vitals.heroicInspiration).toBe(true);
    expect(data.attacks.list[0]).toMatchObject({
      name: "Секира",
      damage: "1к12 + 6",
      notes: "Тяжёлое, двуручное",
    });
    expect(data.attacks.notes).toContain("Текст атак");
    expect(data.traits.otherProficienciesAndLanguages).toContain("Лёгкие доспехи");
    expect(data.traits.otherProficienciesAndLanguages).toContain("Воинское оружие");
    expect(data.extensions.longStoryShort?.attunements).toEqual([{ name: "Меч" }]);

    // Avatar URL extracted for server-side fetch (never persisted as-is).
    expect(avatar).toEqual({
      kind: "url",
      url: "https://hotbox.longstoryshort.app/avatar/abc.jpeg?mod=1",
    });
    const extJson = JSON.stringify(data.extensions);
    expect(extJson).not.toContain("hotbox.longstoryshort.app");
  });

  it("accepts data-base64 avatars", () => {
    const fixture = JSON.parse(makeKortFixture());
    const inner = JSON.parse(fixture.data);
    inner.avatar = { jpeg: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" };
    fixture.data = JSON.stringify(inner);
    const { avatar } = parseLssExport(JSON.stringify(fixture));
    expect(avatar).toEqual({
      kind: "base64",
      mime: "image/jpeg",
      dataBase64: "/9j/4AAQSkZJRg==",
    });
  });

  it("rejects invalid inputs with Russian messages", () => {
    expect(() => parseLssExport("not json")).toThrow(LssImportError);
    expect(() => parseLssExport('"just a string"')).toThrow(/JSON-объект/u);
    expect(() => parseLssExport("{}")).toThrow(/data/u);
    expect(() => parseLssExport('{"data": "oops"}')).toThrow(/data/u);
    expect(() =>
      parseLssExport(JSON.stringify({ jsonType: "map", data: "{}" })),
    ).toThrow(/не персонажа/u);
    expect(() => parseLssExport(JSON.stringify({ data: "[1,2]" }))).toThrow(
      LssImportError,
    );
  });
});

describe("characters.importLss endpoint", () => {
  it("always creates a NEW sheet owned by the caller", async () => {
    const user = await registerUser("lss-player");
    const caller = await asUser(user.cookie);

    // Strip the remote avatar URL: the endpoint path must stay hermetic
    // (avatar fetching is covered separately at the parser level).
    const halldor = JSON.parse(makeHalldorFixture());
    const halldorInner = JSON.parse(halldor.data);
    delete halldorInner.avatar;
    halldor.data = JSON.stringify(halldorInner);

    const first = await caller.characters.importLss({ jsonText: makeKortFixture() });
    const second = await caller.characters.importLss({
      jsonText: JSON.stringify(halldor),
    });
    expect(first.id).not.toBe(second.id);
    expect(first.ownerId).toBe(user.id);
    expect(second.ownerId).toBe(user.id);

    const list = await caller.characters.list();
    expect(list.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());

    const fetched = await caller.characters.get({ id: first.id });
    expect(fetched.data.identity.className).toBe("Волшебник");
    expect(fetched.data.extensions.longStoryShort?.source).toBe("long-story-short");
    expect(fetched.portraitKey).toBeNull(); // no avatar in fixture
  });

  it("returns BAD_REQUEST with a Russian message for invalid input", async () => {
    const user = await registerUser("lss-bad");
    const caller = await asUser(user.cookie);
    await expectTrpcError(
      caller.characters.importLss({ jsonText: "not json" }),
      "BAD_REQUEST",
    );
    await expectTrpcError(
      caller.characters.importLss({ jsonText: '{"data": 42}' }),
      "BAD_REQUEST",
    );
    try {
      await caller.characters.importLss({ jsonText: "not json" });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).toMatch(/JSON/u);
    }
  });

  it("requires authentication", async () => {
    const caller = await asUser();
    await expectTrpcError(
      caller.characters.importLss({ jsonText: makeKortFixture() }),
      "UNAUTHORIZED",
    );
  });
});

describe("portrait media references", () => {
  // 1x1 PNG (valid signature/IHDR/IEND).
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  it("counts characters.portrait_key as a media reference", async () => {
    const user = await registerUser("lss-portrait");
    const caller = await asUser(user.cookie);

    const asset = await caller.media.uploadImage({
      dataBase64: PNG_BASE64,
      purpose: "characterSheet",
    });
    expect(asset.key).toBeTruthy();

    // Unreferenced right after upload.
    expect(countMediaReferences(testDb.db, asset.key)).toBe(0);

    const noAvatar = JSON.parse(makeHalldorFixture());
    const noAvatarInner = JSON.parse(noAvatar.data);
    delete noAvatarInner.avatar;
    noAvatar.data = JSON.stringify(noAvatarInner);
    const created = await caller.characters.importLss({
      jsonText: JSON.stringify(noAvatar),
    });
    // Manually attach the portrait (import-time avatar fetch is skipped in
    // tests; the attach path is what matters here).
    testDb.db.$client
      .prepare("UPDATE characters SET portrait_key = ? WHERE id = ?")
      .run(asset.key, created.id);
    expect(countMediaReferences(testDb.db, asset.key)).toBe(1);

    // Best-effort delete must refuse while the portrait is referenced.
    expect(await deleteAssetIfUnreferenced(testDb.db, asset.key)).toBe(false);
    expect(findMediaAsset(testDb.db, asset.key)).toBeDefined();

    // Character deletion triggers best-effort portrait cleanup after commit.
    await caller.characters.remove({ id: created.id });
    // Cleanup is async fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(countMediaReferences(testDb.db, asset.key)).toBe(0);
    expect(findMediaAsset(testDb.db, asset.key)).toBeUndefined();
  });

  it("allows any authenticated user to upload purpose characterSheet", async () => {
    const user = await registerUser("lss-anyone");
    const caller = await asUser(user.cookie);
    const asset = await caller.media.uploadImage({
      dataBase64: PNG_BASE64,
      purpose: "characterSheet",
    });
    expect(asset.mime).toBe("image/png");
  });
});

/* ------------- real sample files (present in this workspace) -------------- */

const SAMPLE_DIR = "/mnt/agents/temp";
const KORT_SAMPLE = `${SAMPLE_DIR}/Корт — Long Story Short.json`;
const HALLDOR_SAMPLE = `${SAMPLE_DIR}/Хальдор сын Ульфа — Long Story Short.json`;

describe("real LSS sample files (skipped when unavailable)", () => {
  it("imports the Kort sample", () => {
    if (!fs.existsSync(KORT_SAMPLE)) return;
    const { name, data } = parseLssExport(fs.readFileSync(KORT_SAMPLE, "utf8"));
    expect(name).toBe("Корт");
    expect(data.identity.className).toBe("Волшебник");
    expect(data.identity.level).toBe(5);
    expect(data.abilities.dex).toBe(16);
    expect(data.saves.int).toBe("proficient");
    expect(data.skills.arcana).toBe("proficient");
    expect(data.vitals.maxHp).toBe(32);
    expect(data.vitals.armorClass).toBe(16);
    expect(data.attacks.list[0].damage).toBe("1к6 - колющий");
    // Real Kort sample has empty coins; Halldor carries the gp=20 check.
    expect(data.inventory.currency.gp).toBe(0);
    expect(data.traits.featuresAndTraits.length).toBeGreaterThan(0);
    expect(data.extensions.longStoryShort).toBeDefined();
  });

  it("imports the Halldor sample with avatar URL", () => {
    if (!fs.existsSync(HALLDOR_SAMPLE)) return;
    const { name, data, avatar } = parseLssExport(
      fs.readFileSync(HALLDOR_SAMPLE, "utf8"),
    );
    expect(name).toBe("Хальдор сын Ульфа");
    expect(data.identity.subclass).toBe("Берсерк");
    expect(data.abilities.str).toBe(18);
    expect(data.vitals.maxHp).toBe(49);
    expect(data.inventory.currency.gp).toBe(20);
    expect(data.attacks.list.length).toBeGreaterThanOrEqual(2);
    expect(avatar?.kind).toBe("url");
    if (avatar?.kind === "url") {
      expect(avatar.url.startsWith("https://hotbox.longstoryshort.app/")).toBe(true);
    }
  });
});

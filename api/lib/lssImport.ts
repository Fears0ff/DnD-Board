import {
  abilityKeys,
  createDefaultSheetData,
  jsonValueSchema,
  longStoryShortExtensionSchema,
  type CharacterSheetData,
  type LongStoryShortExtension,
  type ProficiencyRank,
  type SkillKey,
} from "../../contracts/characters";

/**
 * Парсер экспорта «Long Story Short» (https://longstoryshort.app).
 *
 * Формат: внешний JSON-объект, где `data` — ВЛОЖЕННАЯ JSON-строка с листом.
 * Маппинг — чистый (без БД/сети): известные поля переносятся в
 * CharacterSheetData, всё неподдержанное сохраняется в
 * `extensions.longStoryShort` как JSON. Модификаторы характеристик из файла
 * НЕ используются (в выгрузках они некорректны) — берутся только score.
 */

/** Ошибка импорта с сообщением на русском для показа в UI. */
export class LssImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LssImportError";
  }
}

/** Аватар из выгрузки: base64-data или разрешённый HTTPS-URL. */
export type LssAvatar =
  | { kind: "base64"; dataBase64: string; mime: string }
  | { kind: "url"; url: string };

export interface LssImportResult {
  name: string;
  data: CharacterSheetData;
  avatar: LssAvatar | null;
}

/* ------------------------------ small helpers ------------------------------ */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** LSS field wrapper `{ value: ... }` → raw value (or undefined). */
function fieldValue(v: unknown): unknown {
  return isObj(v) && "value" in v ? v.value : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function intClamped(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Recursively drop `undefined` entries so the result is plain JSON data. */
function stripUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) out[k] = stripUndefined(val);
    }
    return out;
  }
  return v;
}

/** JSON-ness guard: returns undefined when the value is not plain JSON. */
function asJson(v: unknown): unknown {
  if (v === undefined) return undefined;
  const parsed = jsonValueSchema.safeParse(stripUndefined(v));
  return parsed.success ? parsed.data : undefined;
}

/* --------------------------- ProseMirror → text ---------------------------- */

/** Рекурсивный обход ProseMirror-документа: абзацы через перевод строки. */
function proseMirrorToText(node: unknown): string {
  if (!isObj(node)) return "";
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  const content = Array.isArray(node.content) ? node.content : [];
  const parts = content.map(proseMirrorToText);
  const joined = parts.join("");
  // Блочные узлы отделяем переводом строки.
  if (
    node.type === "doc" ||
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "blockquote" ||
    node.type === "listItem" ||
    node.type === "bulletList" ||
    node.type === "orderedList"
  ) {
    return joined.replace(/\n+$/u, "") + "\n";
  }
  return joined;
}

/** Текстовый блок LSS: `{ value: { data: <ProseMirror doc> } }` → plain text. */
function lssTextToPlain(block: unknown): string {
  const value = fieldValue(block);
  const doc = isObj(value) && "data" in value ? value.data : value;
  return proseMirrorToText(doc).replace(/\n{3,}/gu, "\n\n").trim();
}

/* ------------------------------- key mapping ------------------------------- */

/** LSS skill names use spaces ("sleight of hand"); map to sheet keys. */
const SKILL_BY_LSS_NAME: Record<string, SkillKey> = {
  acrobatics: "acrobatics",
  "animal handling": "animalHandling",
  arcana: "arcana",
  athletics: "athletics",
  deception: "deception",
  history: "history",
  insight: "insight",
  intimidation: "intimidation",
  investigation: "investigation",
  medicine: "medicine",
  nature: "nature",
  perception: "perception",
  performance: "performance",
  persuasion: "persuasion",
  religion: "religion",
  "sleight of hand": "sleightOfHand",
  stealth: "stealth",
  survival: "survival",
};

const PROF_FLAG_LABELS: Record<string, string> = {
  "armor-light": "Лёгкие доспехи",
  "armor-medium": "Средние доспехи",
  "armor-heavy": "Тяжёлые доспехи",
  "armor-shields": "Щиты",
  "armor-label": "Доспехи",
  "weapon-simple": "Простое оружие",
  "weapon-martial": "Воинское оружие",
};

const SUB_INFO_LABELS: Record<string, string> = {
  age: "Возраст",
  height: "Рост",
  weight: "Вес",
  eyes: "Глаза",
  skin: "Кожа",
  hair: "Волосы",
};

const COIN_KEYS = ["cp", "sp", "ep", "gp", "pp"] as const;

/** Inner `data` keys consumed by the mapper; everything else is preserved. */
const KNOWN_INNER_KEYS = new Set([
  "isDefault",
  "jsonType",
  "template",
  "name",
  "info",
  "subInfo",
  "spellsInfo",
  "spells",
  "spellsPact",
  "proficiency",
  "stats",
  "saves",
  "skills",
  "vitality",
  "weaponsList",
  "weapons",
  "text",
  "coins",
  "conditions",
  "inspiration",
  "createdAt",
  // Preserved in dedicated extension buckets below.
  "resources",
  "bonuses",
  "bonusesSkills",
  "bonusesStats",
  "prof",
  "attunementsList",
  // Portrait bytes/URLs are handled separately and never duplicated.
  "avatar",
]);

/** Outer keys consumed or intentionally dropped (collab state, session ids). */
const KNOWN_OUTER_KEYS = new Set([
  "data",
  "jsonType",
  "version",
  "edition",
  "sheetEdition",
  // Dedicated extension buckets.
  "spells",
  "disabledBlocks",
  "linkAccess",
  // LSS app collaboration state — too large/irrelevant to preserve.
  "tags",
  "rooms",
  "lastWriterSessionId",
]);

/* --------------------------------- avatar ---------------------------------- */

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u;

/** Strict allowlist for remote avatars (SSRF guard, enforced again at fetch). */
export const LSS_AVATAR_HOST = "hotbox.longstoryshort.app";

export function extractLssAvatar(inner: Record<string, unknown>): LssAvatar | null {
  const avatar = inner.avatar;
  if (typeof avatar === "string") {
    const m = DATA_URL_RE.exec(avatar.trim());
    if (m) return { kind: "base64", mime: m[1], dataBase64: m[2] };
    if (/^https:\/\//u.test(avatar)) return { kind: "url", url: avatar };
    return null;
  }
  if (isObj(avatar)) {
    // Prefer lossless-ish original; jpeg first (sample files expose both).
    for (const key of ["png", "jpeg", "webp"]) {
      const v = avatar[key];
      if (typeof v === "string" && v) {
        const m = DATA_URL_RE.exec(v.trim());
        if (m) return { kind: "base64", mime: m[1], dataBase64: m[2] };
        if (/^https:\/\//u.test(v)) return { kind: "url", url: v };
      }
    }
    // Future shapes: any string entry that matches.
    for (const v of Object.values(avatar)) {
      if (typeof v === "string" && v) {
        const m = DATA_URL_RE.exec(v.trim());
        if (m) return { kind: "base64", mime: m[1], dataBase64: m[2] };
        if (/^https:\/\//u.test(v)) return { kind: "url", url: v };
      }
    }
  }
  return null;
}

/* ----------------------------- avatar fetching ----------------------------- */

const AVATAR_FETCH_TIMEOUT_MS = 10_000;
/** Remote portraits are capped well below the generic image limit. */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Server-side fetch of a remote LSS avatar with a strict SSRF guard:
 * https: protocol and EXACTLY the allowlisted host — no redirects followed
 * to other origins, no credentials, timeout and a byte cap. The bytes are
 * validated/stored by the caller; the URL is never persisted or rendered.
 */
export async function fetchLssAvatarBytes(url: string): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LssImportError("Некорректный URL аватара в файле выгрузки.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== LSS_AVATAR_HOST) {
    throw new LssImportError(
      "Загрузка аватара разрешена только с hotbox.longstoryshort.app по HTTPS.",
    );
  }
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new LssImportError("Не удалось загрузить аватар (таймаут или сеть).");
  }
  if (!res.ok) {
    throw new LssImportError(`Сервер аватаров ответил ошибкой ${res.status}.`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > AVATAR_MAX_BYTES) {
    throw new LssImportError("Аватар слишком большой (более 5 МиБ).");
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > AVATAR_MAX_BYTES) {
    throw new LssImportError("Аватар слишком большой (более 5 МиБ).");
  }
  return buf;
}

/* --------------------------------- mapping --------------------------------- */

function mapTextSections(
  inner: Record<string, unknown>,
  sheet: CharacterSheetData,
  ext: LongStoryShortExtension,
): void {
  const text = isObj(inner.text) ? inner.text : {};
  const plain: Record<string, string> = {};
  for (const [key, block] of Object.entries(text)) {
    plain[key] = lssTextToPlain(block);
  }
  const join = (...parts: (string | undefined)[]): string =>
    parts.filter((p): p is string => !!p && p.trim() !== "").join("\n\n");

  // Инвентарь: снаряжение и «Хабар» (items) — свободным текстом.
  sheet.inventory.otherEquipment = join(plain.equipment, plain.items).slice(0, 5000);
  // Владения: текстовый блок + флаги prof (доспехи/оружие).
  const profFlags = isObj(inner.prof)
    ? Object.entries(inner.prof)
        .filter(([, v]) => fieldValue(v) === true)
        .map(([k]) => PROF_FLAG_LABELS[k] ?? k)
        .join(", ")
    : "";
  sheet.traits.otherProficienciesAndLanguages = join(
    plain.prof,
    profFlags ? `Владение: ${profFlags}` : undefined,
  ).slice(0, 10000);
  sheet.traits.featuresAndTraits = join(plain.features, plain.feats).slice(0, 20000);
  sheet.traits.alliesAndOrganizations = (plain.allies ?? "").slice(0, 10000);
  sheet.traits.appearance = join(
    plain.appearance,
    mapSubInfo(inner),
  ).slice(0, 10000);
  sheet.traits.backstory = join(plain.personality, plain.traits).slice(0, 20000);
  sheet.traits.additionalNotes = join(plain.ideals, plain.bonds, plain.flaws).slice(
    0,
    20000,
  );
  // Свободный текст атак LSS — примечание к атакам (список оружия маппится отдельно).
  sheet.attacks.notes = (plain.attacks ?? "").slice(0, 5000);
  sheet.spellcasting.notes = (plain.spellsNotes ?? "").slice(0, 5000);

  const MAPPED_TEXT_KEYS = new Set([
    "equipment",
    "items",
    "prof",
    "features",
    "feats",
    "allies",
    "appearance",
    "personality",
    "traits",
    "ideals",
    "bonds",
    "flaws",
    "attacks",
    "spellsNotes",
  ]);
  for (const [key, block] of Object.entries(text)) {
    if (!MAPPED_TEXT_KEYS.has(key)) {
      ext.unmappedText[key] = asJson(block) ?? String(block);
    }
  }
}

function mapSubInfo(inner: Record<string, unknown>): string {
  const sub = isObj(inner.subInfo) ? inner.subInfo : {};
  const lines: string[] = [];
  for (const [key, label] of Object.entries(SUB_INFO_LABELS)) {
    const v = fieldValue(sub[key]);
    const s = typeof v === "number" ? String(v) : str(v).trim();
    if (s) lines.push(`${label}: ${s}`);
  }
  return lines.join("\n");
}

function mapSpells(
  inner: Record<string, unknown>,
  sheet: CharacterSheetData,
): void {
  // Known future-proof shape: inner.spells = { "1": [{name, ...}], ... }.
  // In practice LSS keeps the book in the OUTER spells object; inner buckets
  // are empty in the samples, so only map the obvious entries and preserve
  // everything else in the extension.
  const buckets = [inner.spells, inner.spellsPact];
  for (const bucket of buckets) {
    if (!isObj(bucket)) continue;
    for (const [levelKey, entries] of Object.entries(bucket)) {
      if (!Array.isArray(entries)) continue;
      const level = /^\d+$/u.test(levelKey) ? Number(levelKey) : 0;
      for (const entry of entries) {
        if (!isObj(entry)) continue;
        const name = str(fieldValue(entry.name) ?? entry.name).trim();
        if (!name) continue;
        sheet.spellcasting.spells.push({
          name: name.slice(0, 200),
          level: Math.min(9, Math.max(0, level)),
          prepared: entry.prepared === true,
          compendiumItemId: null,
          notes: "",
        });
        if (sheet.spellcasting.spells.length >= 300) return;
      }
    }
  }
}

/** Главная точка входа: текст файла → данные нового листа. */
export function parseLssExport(jsonText: string): LssImportResult {
  let outer: unknown;
  try {
    outer = JSON.parse(jsonText);
  } catch {
    throw new LssImportError("Файл не является корректным JSON.");
  }
  if (!isObj(outer)) {
    throw new LssImportError("Ожидался JSON-объект выгрузки Long Story Short.");
  }
  if (outer.jsonType !== undefined && outer.jsonType !== "character") {
    throw new LssImportError(
      "Это выгрузка не персонажа (jsonType ≠ character). Выберите файл персонажа.",
    );
  }
  if (typeof outer.data !== "string") {
    throw new LssImportError(
      "В файле нет вложенного поля data — это не выгрузка Long Story Short.",
    );
  }
  let inner: unknown;
  try {
    inner = JSON.parse(outer.data);
  } catch {
    throw new LssImportError("Вложенное поле data содержит некорректный JSON.");
  }
  if (!isObj(inner)) {
    throw new LssImportError("Вложенные данные листа имеют неверный формат.");
  }

  // Clone: zod `.default(...)` values are shared references, and the mapper
  // mutates nested sections — without a clone edits would leak across imports.
  const sheet = structuredClone(createDefaultSheetData());

  /* identity */
  const info = isObj(inner.info) ? inner.info : {};
  const name = str(fieldValue(inner.name)).trim();
  sheet.identity.className = str(fieldValue(info.charClass)).slice(0, 80);
  sheet.identity.subclass = str(fieldValue(info.charSubclass)).slice(0, 80);
  sheet.identity.species = str(fieldValue(info.race)).slice(0, 80);
  sheet.identity.background = str(fieldValue(info.background)).slice(0, 80);
  sheet.identity.alignment = str(fieldValue(info.alignment)).slice(0, 80);
  sheet.identity.playerName = str(fieldValue(info.playerName)).slice(0, 120);
  const level = intClamped(fieldValue(info.level), 1, 20);
  if (level !== undefined) sheet.identity.level = level;
  const xp = intClamped(fieldValue(info.experience), 0, 10_000_000);
  if (xp !== undefined) sheet.identity.experiencePoints = xp;

  /* ability SCORES (stored modifiers in LSS exports are wrong — ignore) */
  const stats = isObj(inner.stats) ? inner.stats : {};
  for (const key of abilityKeys) {
    const score = intClamped(fieldValue(stats[key]) ?? stats[key], 1, 30);
    const raw = isObj(stats[key]) ? stats[key].score : undefined;
    const finalScore = intClamped(raw, 1, 30) ?? score;
    if (finalScore !== undefined) sheet.abilities[key] = finalScore;
  }

  /* saving throw proficiencies */
  const saves = isObj(inner.saves) ? inner.saves : {};
  for (const key of abilityKeys) {
    const entry = saves[key];
    if (isObj(entry) && entry.isProf === true) sheet.saves[key] = "proficient";
  }

  /* skills: isProf 1 = владение, 2 = экспертиза */
  const skills = isObj(inner.skills) ? inner.skills : {};
  for (const [lssName, entry] of Object.entries(skills)) {
    const key =
      SKILL_BY_LSS_NAME[lssName.toLowerCase()] ??
      SKILL_BY_LSS_NAME[str(isObj(entry) ? entry.name : "").toLowerCase()];
    if (!key || !isObj(entry)) continue;
    const rank: ProficiencyRank =
      entry.isProf === 2 ? "expertise" : entry.isProf === 1 ? "proficient" : "none";
    sheet.skills[key] = rank;
  }

  /* vitals */
  const vit = isObj(inner.vitality) ? inner.vitality : {};
  const setVit = (
    key: string,
    apply: (n: number) => void,
    min: number,
    max: number,
  ) => {
    const n = intClamped(fieldValue(vit[key]), min, max);
    if (n !== undefined) apply(n);
  };
  setVit("hp-max", (n) => (sheet.vitals.maxHp = n), 0, 2000);
  setVit("hp-current", (n) => (sheet.vitals.currentHp = n), 0, 2000);
  setVit("hp-temp", (n) => (sheet.vitals.tempHp = n), 0, 2000);
  setVit("ac", (n) => (sheet.vitals.armorClass = n), 0, 50);
  setVit("speed", (n) => (sheet.vitals.speed = n), 0, 300);
  setVit("initiative", (n) => (sheet.vitals.initiative = n), -20, 30);
  setVit("passive-perception", (n) => (sheet.vitals.passivePerception = n), 0, 50);
  const deathS = intClamped(vit.deathSuccesses, 0, 3);
  const deathF = intClamped(vit.deathFails, 0, 3);
  if (deathS !== undefined) sheet.vitals.deathSaves.successes = deathS;
  if (deathF !== undefined) sheet.vitals.deathSaves.failures = deathF;
  const hitDie = str(fieldValue(vit["hit-die"]));
  const diceCurrent = intClamped(fieldValue(vit["hp-dice-current"]), 0, 40);
  if (hitDie) {
    sheet.vitals.hitDice = `${diceCurrent !== undefined ? `${diceCurrent}` : ""}${hitDie}`.slice(0, 40);
  }
  if (inner.inspiration === true) sheet.vitals.heroicInspiration = true;

  /* conditions */
  if (Array.isArray(inner.conditions)) {
    sheet.vitals.conditions = inner.conditions
      .map((c) => (typeof c === "string" ? c : str(fieldValue(c))))
      .filter((c) => c.trim() !== "")
      .slice(0, 30)
      .map((c) => c.slice(0, 60));
  }

  /* weapons → attacks (full damage text preserved verbatim) */
  if (Array.isArray(inner.weaponsList)) {
    for (const w of inner.weaponsList) {
      if (!isObj(w)) continue;
      const wname = str(fieldValue(w.name)).trim();
      if (!wname) continue;
      sheet.attacks.list.push({
        name: wname.slice(0, 120),
        attackBonus: str(fieldValue(w.mod)).slice(0, 40),
        damage: str(fieldValue(w.dmg)).slice(0, 120),
        damageType: "",
        notes: str(fieldValue(w.notes)).slice(0, 2000),
      });
      if (sheet.attacks.list.length >= 100) break;
    }
  }

  /* currencies */
  const coins = isObj(inner.coins) ? inner.coins : {};
  for (const key of COIN_KEYS) {
    const n = intClamped(fieldValue(coins[key]), 0, 1_000_000_000);
    if (n !== undefined) sheet.inventory.currency[key] = n;
  }

  /* spellcasting ability hint (base stat name like "int") */
  const spellsInfo = isObj(inner.spellsInfo) ? inner.spellsInfo : {};
  const base = str(fieldValue(spellsInfo.base)).toLowerCase();
  if ((abilityKeys as readonly string[]).includes(base)) {
    sheet.spellcasting.ability = base as (typeof abilityKeys)[number];
  }
  mapSpells(inner, sheet);

  /* extension buckets */
  const ext = longStoryShortExtensionSchema.parse({
    importedAt: new Date().toISOString(),
    edition: str(outer.edition),
    sheetEdition: str(outer.sheetEdition ?? inner.sheetEdition),
    resources: asJson(inner.resources),
    bonusesSkills: asJson(inner.bonusesSkills),
    bonusesStats: asJson(inner.bonusesStats),
    bonuses: asJson(inner.bonuses),
    proficiencies: asJson(inner.prof),
    attunements: asJson(inner.attunementsList),
    spells: asJson({
      inner: inner.spells,
      pact: inner.spellsPact,
      outer: outer.spells,
    }),
    settings: asJson({
      disabledBlocks: outer.disabledBlocks,
      linkAccess: outer.linkAccess,
      template: inner.template,
      isDefault: inner.isDefault,
      createdAt: inner.createdAt,
      version: outer.version,
    }),
  });

  mapTextSections(inner, sheet, ext);

  for (const [key, value] of Object.entries(inner)) {
    if (KNOWN_INNER_KEYS.has(key)) continue;
    const json = asJson(value);
    if (json !== undefined) ext.unknownFields[key] = json;
  }
  for (const [key, value] of Object.entries(outer)) {
    if (KNOWN_OUTER_KEYS.has(key)) continue;
    const json = asJson(value);
    if (json !== undefined) ext.unknownOuterFields[key] = json;
  }
  sheet.extensions = { longStoryShort: ext };

  return {
    name: name || "Импортированный персонаж",
    data: sheet,
    avatar: extractLssAvatar(inner),
  };
}

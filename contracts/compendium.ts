import { z } from "zod";
import {
  compendiumTypes,
  visibilityValues,
  type CompendiumType,
  type Visibility,
} from "./constants";
import { mediaKeySchema } from "./game";

/**
 * Compendium contracts — the SINGLE SOURCE for:
 *   - TypeScript types of the eight card payloads;
 *   - server-side validation (tRPC inputs + import);
 *   - client-side validation and editor field composition
 *     (`compendiumEditorMeta` is DERIVED from the Zod schemas below — types,
 *     requiredness and constraints are never duplicated by hand);
 *   - JSON Schema draft 2020-12 for the public import format
 *     (`buildCompendiumJsonSchemas`, written to docs/import-schemas/v1 by
 *     scripts/generate-compendium-schemas.ts and checked by
 *     tests/integration/compendium.test.ts).
 *
 * Card data schemas deliberately avoid output transforms so that
 * `z.toJSONSchema` can represent them exactly.
 */

const idSchema = z.number().int().positive();

const shortText = (max: number) => z.string().max(max);
const nameSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().max(20_000).default("");
const classNameListSchema = z.array(shortText(64)).max(20).default([]);

export const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof abilityKeys)[number];

const abilityScoreSchema = z.number().int().min(1).max(30);
const abilityBlockSchema = z.object({
  str: abilityScoreSchema,
  dex: abilityScoreSchema,
  con: abilityScoreSchema,
  int: abilityScoreSchema,
  wis: abilityScoreSchema,
  cha: abilityScoreSchema,
});

const namedTextListSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(200),
      text: z.string().max(5_000).default(""),
    }),
  )
  .max(50)
  .default([]);

/* ------------------------------ card payloads ------------------------------ */

export const spellCardDataSchema = z.object({
  level: z.number().int().min(0).max(9),
  school: z.enum([
    "abjuration",
    "conjuration",
    "divination",
    "enchantment",
    "evocation",
    "illusion",
    "necromancy",
    "transmutation",
  ]),
  castingTime: shortText(200).min(1),
  range: shortText(200).min(1),
  components: z
    .array(z.enum(["verbal", "somatic", "material"]))
    .max(3)
    .default([]),
  materialText: shortText(500).default(""),
  duration: shortText(200).min(1),
  concentration: z.boolean().default(false),
  ritual: z.boolean().default(false),
  /** Normalized class names allowed to use the card; empty = no restriction. */
  classes: classNameListSchema,
  subclasses: classNameListSchema,
  description: descriptionSchema,
  higherLevels: z.string().max(5_000).default(""),
});
export type SpellCardData = z.infer<typeof spellCardDataSchema>;

export const itemCardDataSchema = z.object({
  category: z
    .enum(["weapon", "armor", "gear", "tool", "consumable", "treasure", "other"])
    .default("other"),
  rarity: z
    .enum(["none", "common", "uncommon", "rare", "veryRare", "legendary", "artifact"])
    .default("none"),
  cost: shortText(100).default(""),
  weight: z.number().min(0).max(100_000).optional(),
  properties: z.array(shortText(100)).max(30).default([]),
  attunement: z.boolean().default(false),
  description: descriptionSchema,
});
export type ItemCardData = z.infer<typeof itemCardDataSchema>;

export const monsterCardDataSchema = z.object({
  size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]),
  creatureType: shortText(100).min(1),
  alignment: shortText(100).default(""),
  armorClass: z.number().int().min(0).max(50),
  hitPoints: z.number().int().min(0).max(100_000),
  speed: shortText(200).default(""),
  abilities: abilityBlockSchema,
  challengeRating: shortText(10).default(""),
  traits: namedTextListSchema,
  actions: namedTextListSchema,
  description: descriptionSchema,
});
export type MonsterCardData = z.infer<typeof monsterCardDataSchema>;

export const characterCardDataSchema = z.object({
  level: z.number().int().min(1).max(20),
  className: shortText(64).default(""),
  subclass: shortText(64).default(""),
  species: shortText(64).default(""),
  background: shortText(64).default(""),
  abilities: abilityBlockSchema,
  maxHp: z.number().int().min(0).max(100_000),
  armorClass: z.number().int().min(0).max(50),
  speed: z.number().int().min(0).max(1_000).default(30),
  description: descriptionSchema,
  notes: descriptionSchema,
});
export type CharacterCardData = z.infer<typeof characterCardDataSchema>;

export const speciesCardDataSchema = z.object({
  size: z.enum(["small", "medium"]).default("medium"),
  speed: z.number().int().min(0).max(1_000).default(30),
  traits: namedTextListSchema,
  description: descriptionSchema,
});
export type SpeciesCardData = z.infer<typeof speciesCardDataSchema>;

export const classCardDataSchema = z.object({
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbility: shortText(100).default(""),
  savingThrows: z.array(z.enum(abilityKeys)).max(2).default([]),
  subclasses: classNameListSchema,
  description: descriptionSchema,
});
export type ClassCardData = z.infer<typeof classCardDataSchema>;

export const featCardDataSchema = z.object({
  category: z
    .enum(["origin", "general", "fightingStyle", "epicBoon", "other"])
    .default("other"),
  prerequisite: shortText(500).default(""),
  repeatable: z.boolean().default(false),
  /** Normalized class names allowed to take the feat; empty = no restriction. */
  classes: classNameListSchema,
  description: descriptionSchema,
});
export type FeatCardData = z.infer<typeof featCardDataSchema>;

export const backgroundCardDataSchema = z.object({
  abilityScores: z.array(z.enum(abilityKeys)).max(3).default([]),
  feat: shortText(200).default(""),
  skillProficiencies: z.array(shortText(100)).max(20).default([]),
  toolProficiency: shortText(200).default(""),
  equipment: z.string().max(2_000).default(""),
  description: descriptionSchema,
});
export type BackgroundCardData = z.infer<typeof backgroundCardDataSchema>;

/** Type -> payload schema map. Adding a type starts here (plus DB enum). */
export const compendiumCardSchemas = {
  spell: spellCardDataSchema,
  item: itemCardDataSchema,
  monster: monsterCardDataSchema,
  character: characterCardDataSchema,
  species: speciesCardDataSchema,
  class: classCardDataSchema,
  feat: featCardDataSchema,
  background: backgroundCardDataSchema,
} satisfies Record<CompendiumType, z.ZodType>;

export interface CompendiumCardDataByType {
  spell: SpellCardData;
  item: ItemCardData;
  monster: MonsterCardData;
  character: CharacterCardData;
  species: SpeciesCardData;
  class: ClassCardData;
  feat: FeatCardData;
  background: BackgroundCardData;
}
export type CompendiumCardData = CompendiumCardDataByType[CompendiumType];

/* ------------------------------ editor metadata ---------------------------- */

export type CompendiumFieldWidget =
  | "text"
  | "textarea"
  | "markdown"
  | "number"
  | "checkbox"
  | "select"
  | "tags"
  | "group"
  | "list";

export interface CompendiumFieldMeta {
  key: string;
  label: string;
  hint?: string;
  widget: CompendiumFieldWidget;
  required: boolean;
  /** Option values for "select"/"tags" widgets (stringified for unions). */
  options?: string[];
}

interface FieldOverride {
  label: string;
  hint?: string;
  widget?: CompendiumFieldWidget;
}

function unwrapSchema(schema: z.ZodType): z.ZodType {
  let cur = schema;
  for (;;) {
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault
    ) {
      cur = cur.unwrap() as z.ZodType;
      continue;
    }
    return cur;
  }
}

function describeField(
  key: string,
  field: z.ZodType,
  override: FieldOverride,
): CompendiumFieldMeta {
  const meta: CompendiumFieldMeta = {
    key,
    label: override.label,
    widget: override.widget ?? "text",
    required: !field.safeParse(undefined).success,
  };
  if (override.hint !== undefined) meta.hint = override.hint;
  const core = unwrapSchema(field);
  if (core instanceof z.ZodString) {
    const max = core.maxLength ?? 0;
    meta.widget = override.widget ?? (max >= 5_000 ? "markdown" : max >= 500 ? "textarea" : "text");
  } else if (core instanceof z.ZodNumber) {
    meta.widget = override.widget ?? "number";
  } else if (core instanceof z.ZodBoolean) {
    meta.widget = override.widget ?? "checkbox";
  } else if (core instanceof z.ZodEnum) {
    meta.widget = override.widget ?? "select";
    meta.options = [...core.options].map(String);
  } else if (core instanceof z.ZodArray) {
    const el = unwrapSchema(core.element as z.ZodType);
    if (el instanceof z.ZodEnum) {
      meta.widget = override.widget ?? "tags";
      meta.options = [...el.options].map(String);
    } else if (el instanceof z.ZodString) {
      meta.widget = override.widget ?? "tags";
    } else {
      meta.widget = override.widget ?? "list";
    }
  } else if (core instanceof z.ZodObject) {
    meta.widget = override.widget ?? "group";
  } else if (core instanceof z.ZodUnion) {
    const literals = core.options as z.ZodType[];
    if (
      literals.length > 0 &&
      literals.every((o) => o instanceof z.ZodLiteral)
    ) {
      meta.widget = override.widget ?? "select";
      meta.options = literals.map((o) => String((o as z.ZodLiteral).value));
    }
  }
  return meta;
}

function buildEditorMeta<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  overrides: Record<keyof z.output<S>, FieldOverride>,
): CompendiumFieldMeta[] {
  return Object.entries(schema.shape).map(([key, field]) => {
    const override = (overrides as Record<string, FieldOverride>)[key];
    if (!override) {
      throw new Error(`compendium editor metadata missing for field "${key}"`);
    }
    return describeField(key, field as z.ZodType, override);
  });
}

const abilityBlockOverride: FieldOverride = { label: "Характеристики", hint: "Значения 1–30: СИЛ, ЛОВ, ТЕЛ, ИНТ, МДР, ХАР" };
const classesOverride: FieldOverride = {
  label: "Классы",
  hint: "Ограничение по классам; пусто — доступна любому классу",
};
const descriptionOverride: FieldOverride = { label: "Описание", hint: "Markdown" };

/** Field composition/labels for the card editors, derived from the schemas. */
export const compendiumEditorMeta: Record<CompendiumType, CompendiumFieldMeta[]> = {
  spell: buildEditorMeta(spellCardDataSchema, {
    level: { label: "Круг", hint: "0 — заговор, 1–9 — круг заклинания" },
    school: { label: "Школа" },
    castingTime: { label: "Время накладывания" },
    range: { label: "Дистанция" },
    components: { label: "Компоненты" },
    materialText: { label: "Материальный компонент" },
    duration: { label: "Длительность" },
    concentration: { label: "Концентрация" },
    ritual: { label: "Ритуал" },
    classes: classesOverride,
    subclasses: { label: "Подклассы", hint: "Пусто — доступно любому подклассу" },
    description: descriptionOverride,
    higherLevels: { label: "На больших кругах" },
  }),
  item: buildEditorMeta(itemCardDataSchema, {
    category: { label: "Категория" },
    rarity: { label: "Редкость" },
    cost: { label: "Стоимость", hint: "Например: 10 зм" },
    weight: { label: "Вес, кг" },
    properties: { label: "Свойства" },
    attunement: { label: "Требует настройки" },
    description: descriptionOverride,
  }),
  monster: buildEditorMeta(monsterCardDataSchema, {
    size: { label: "Размер" },
    creatureType: { label: "Тип существа" },
    alignment: { label: "Мировоззрение" },
    armorClass: { label: "Класс брони" },
    hitPoints: { label: "Хиты" },
    speed: { label: "Скорость" },
    abilities: abilityBlockOverride,
    challengeRating: { label: "Уровень опасности", hint: "Например: 1/4, 5" },
    traits: { label: "Черты" },
    actions: { label: "Действия" },
    description: descriptionOverride,
  }),
  character: buildEditorMeta(characterCardDataSchema, {
    level: { label: "Уровень" },
    className: { label: "Класс" },
    subclass: { label: "Подкласс" },
    species: { label: "Вид" },
    background: { label: "Предыстория" },
    abilities: abilityBlockOverride,
    maxHp: { label: "Максимум хитов" },
    armorClass: { label: "Класс брони" },
    speed: { label: "Скорость, фт." },
    description: descriptionOverride,
    notes: { label: "Заметки", hint: "Markdown" },
  }),
  species: buildEditorMeta(speciesCardDataSchema, {
    size: { label: "Размер" },
    speed: { label: "Скорость, фт." },
    traits: { label: "Черты вида" },
    description: descriptionOverride,
  }),
  class: buildEditorMeta(classCardDataSchema, {
    hitDie: { label: "Кость хитов" },
    primaryAbility: { label: "Основная характеристика" },
    savingThrows: { label: "Спасброски" },
    subclasses: { label: "Подклассы" },
    description: descriptionOverride,
  }),
  feat: buildEditorMeta(featCardDataSchema, {
    category: { label: "Категория" },
    prerequisite: { label: "Требование" },
    repeatable: { label: "Можно брать повторно" },
    classes: classesOverride,
    description: { label: "Эффект", hint: "Markdown" },
  }),
  background: buildEditorMeta(backgroundCardDataSchema, {
    abilityScores: { label: "Характеристики предыстории" },
    feat: { label: "Черта" },
    skillProficiencies: { label: "Владение навыками" },
    toolProficiency: { label: "Владение инструментом" },
    equipment: { label: "Снаряжение" },
    description: descriptionOverride,
  }),
};

/* ------------------------------ list / filters ----------------------------- */

export const compendiumListInputSchema = z.object({
  type: z.enum(compendiumTypes).optional(),
  /** Case-insensitive substring over the card name. */
  search: z.string().trim().max(200).optional(),
  /** Exact case-insensitive match on normalized class name (see helpers). */
  class: z.string().trim().min(1).max(64).optional(),
  subclass: z.string().trim().min(1).max(64).optional(),
});
export type CompendiumListInput = z.infer<typeof compendiumListInputSchema>;

export const compendiumGetInputSchema = z.object({ id: idSchema });
export type CompendiumGetInput = z.infer<typeof compendiumGetInputSchema>;

/** Normalized comparison form for class/subclass names (pickers and list). */
export function normalizeCompendiumClassName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Normalized class restrictions of a card; empty = unrestricted. */
export function compendiumCardClassNames(data: CompendiumCardData): string[] {
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.classes)) {
    return record.classes
      .filter((v): v is string => typeof v === "string")
      .map(normalizeCompendiumClassName)
      .filter(Boolean);
  }
  if (typeof record.className === "string" && record.className.trim() !== "") {
    return [normalizeCompendiumClassName(record.className)];
  }
  return [];
}

/** Normalized subclass restrictions of a card; empty = unrestricted. */
export function compendiumCardSubclassNames(data: CompendiumCardData): string[] {
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.subclasses)) {
    return record.subclasses
      .filter((v): v is string => typeof v === "string")
      .map(normalizeCompendiumClassName)
      .filter(Boolean);
  }
  if (typeof record.subclass === "string" && record.subclass.trim() !== "") {
    return [normalizeCompendiumClassName(record.subclass)];
  }
  return [];
}

/**
 * Exact case-insensitive matching for pickers/browser: a filter matches when
 * the card is UNRESTRICTED for that dimension or its normalized name list
 * contains the normalized filter. Substrings never match.
 */
export function compendiumCardMatchesClassFilters(
  data: CompendiumCardData,
  classFilter?: string,
  subclassFilter?: string,
): boolean {
  if (classFilter !== undefined) {
    const names = compendiumCardClassNames(data);
    const wanted = normalizeCompendiumClassName(classFilter);
    if (names.length > 0 && !names.includes(wanted)) return false;
  }
  if (subclassFilter !== undefined) {
    const names = compendiumCardSubclassNames(data);
    const wanted = normalizeCompendiumClassName(subclassFilter);
    if (names.length > 0 && !names.includes(wanted)) return false;
  }
  return true;
}

/* ---------------------------------- DTOs ----------------------------------- */

/** Safe card DTO — never a raw ORM row; timestamps are ISO strings. */
export interface CompendiumCardDto {
  id: number;
  type: CompendiumType;
  name: string;
  source: string;
  isMagic: boolean;
  visibility: Visibility;
  /** NULL only for imported cards. */
  createdBy: number | null;
  imageKey: string | null;
  data: CompendiumCardData;
  createdAt: string;
  updatedAt: string;
}

export interface CompendiumListResultDto {
  items: CompendiumCardDto[];
  compendiumRevision: number;
}
export interface CompendiumGetResultDto {
  card: CompendiumCardDto;
  compendiumRevision: number;
}
export interface CompendiumMutationResultDto {
  card: CompendiumCardDto;
  compendiumRevision: number;
}
export interface CompendiumRemoveResultDto {
  removedId: number;
  compendiumRevision: number;
}
export interface CompendiumImportResultDto {
  imported: number;
  compendiumRevision: number;
}

/* ------------------------------ CRUD inputs -------------------------------- */

const createBaseShape = {
  name: nameSchema,
  source: z.string().trim().max(200).default(""),
  isMagic: z.boolean().default(false),
  visibility: z.enum(visibilityValues).default("private"),
  imageKey: mediaKeySchema.nullish(),
};

/**
 * Full per-type validation at the tRPC boundary: the external API cannot
 * bypass the server schema for `data`.
 */
export const compendiumCreateInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("spell"), ...createBaseShape, data: spellCardDataSchema }),
  z.object({ type: z.literal("item"), ...createBaseShape, data: itemCardDataSchema }),
  z.object({ type: z.literal("monster"), ...createBaseShape, data: monsterCardDataSchema }),
  z.object({ type: z.literal("character"), ...createBaseShape, data: characterCardDataSchema }),
  z.object({ type: z.literal("species"), ...createBaseShape, data: speciesCardDataSchema }),
  z.object({ type: z.literal("class"), ...createBaseShape, data: classCardDataSchema }),
  z.object({ type: z.literal("feat"), ...createBaseShape, data: featCardDataSchema }),
  z.object({ type: z.literal("background"), ...createBaseShape, data: backgroundCardDataSchema }),
]);
export type CompendiumCreateInput = z.infer<typeof compendiumCreateInputSchema>;

/**
 * Patch semantics: omitted fields keep their values. `type` is immutable;
 * `data` (when present) is validated against the STORED card type in the
 * service. `imageKey: null` clears the image.
 */
export const compendiumUpdateInputSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  source: z.string().trim().max(200).optional(),
  isMagic: z.boolean().optional(),
  visibility: z.enum(visibilityValues).optional(),
  imageKey: mediaKeySchema.nullish(),
  data: z.unknown().optional(),
});
export type CompendiumUpdateInput = z.infer<typeof compendiumUpdateInputSchema>;

export const compendiumRemoveInputSchema = z.object({ id: idSchema });
export type CompendiumRemoveInput = z.infer<typeof compendiumRemoveInputSchema>;

/**
 * Duplicates a visible card into a new INDEPENDENT card (no link to the
 * original: data is deep-copied, future edits never propagate). Players get a
 * private copy owned by themselves; the master may choose the visibility.
 */
export const compendiumCopyInputSchema = z.object({
  id: idSchema,
  name: nameSchema.optional(),
  visibility: z.enum(visibilityValues).optional(),
});
export type CompendiumCopyInput = z.infer<typeof compendiumCopyInputSchema>;

/* ------------------------------- import format ----------------------------- */

export const COMPENDIUM_IMPORT_SCHEMA_VERSION = 1;
export const COMPENDIUM_IMPORT_MAX_CARDS = 500;
/** Encoded UTF-8 size limit for one import file (20 MiB). */
export const COMPENDIUM_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

const importCardNameSchema = nameSchema;

const importEnvelopeCardSchemas = [
  z.object({ type: z.literal("spell"), name: importCardNameSchema, data: spellCardDataSchema }),
  z.object({ type: z.literal("item"), name: importCardNameSchema, data: itemCardDataSchema }),
  z.object({ type: z.literal("monster"), name: importCardNameSchema, data: monsterCardDataSchema }),
  z.object({ type: z.literal("character"), name: importCardNameSchema, data: characterCardDataSchema }),
  z.object({ type: z.literal("species"), name: importCardNameSchema, data: speciesCardDataSchema }),
  z.object({ type: z.literal("class"), name: importCardNameSchema, data: classCardDataSchema }),
  z.object({ type: z.literal("feat"), name: importCardNameSchema, data: featCardDataSchema }),
  z.object({ type: z.literal("background"), name: importCardNameSchema, data: backgroundCardDataSchema }),
] as const;

/**
 * Canonical import envelope (v1). Deeply validates every card's `data`
 * against the per-type schema, so issue paths always point at the exact
 * field (cards[i].data.<field>).
 */
export const compendiumImportEnvelopeSchema = z.object({
  schemaVersion: z.literal(COMPENDIUM_IMPORT_SCHEMA_VERSION),
  cards: z
    .array(z.discriminatedUnion("type", [...importEnvelopeCardSchemas]))
    .max(COMPENDIUM_IMPORT_MAX_CARDS),
});
export type CompendiumImportEnvelope = z.infer<typeof compendiumImportEnvelopeSchema>;
export type CompendiumImportCard = CompendiumImportEnvelope["cards"][number];

/** Raw file content (JSON text); the encoded-size limit is checked server-side. */
export const compendiumImportInputSchema = z.object({
  json: z.string().min(2),
});
export type CompendiumImportInput = z.infer<typeof compendiumImportInputSchema>;

/** Compiles zod issues into a compact "path: message; …" summary. */
export function toZodIssueSummary(
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join(".") || "$";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export interface CompendiumImportIssue {
  /** 0-based card index, or -1 for envelope/file-level problems. */
  index: number;
  /** Field path relative to the card (e.g. "data.level"), or "$" at file level. */
  path: string;
  message: string;
}

function issueFromZodPath(
  path: readonly (string | number | symbol)[],
  message: string,
): CompendiumImportIssue {
  if (path[0] === "cards" && typeof path[1] === "number") {
    const index = path[1];
    const rest = path.slice(2);
    return {
      index,
      path: rest.length > 0 ? rest.map(String).join(".") : "$",
      message,
    };
  }
  return { index: -1, path: path.length > 0 ? path.map(String).join(".") : "$", message };
}

export type CompendiumImportValidation =
  | { ok: true; cards: CompendiumImportCard[] }
  | { ok: false; issues: CompendiumImportIssue[] };

/**
 * Parses and fully validates an import file body (without the byte-size
 * check, which is a transport concern enforced by the server). Shared by the
 * server and by the client's local pre-flight check.
 */
export function validateCompendiumImport(json: string): CompendiumImportValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          index: -1,
          path: "$",
          message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  const result = compendiumImportEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) =>
        issueFromZodPath(issue.path, issue.message),
      ),
    };
  }
  return { ok: true, cards: result.data.cards };
}

/* ------------------------- JSON Schema (draft 2020-12) --------------------- */

const JSON_SCHEMA_TARGET = "draft-2020-12" as const;

const cardSchemaDescriptions: Record<CompendiumType, string> = {
  spell: "DnD Board compendium v1: spell card data",
  item: "DnD Board compendium v1: item card data",
  monster: "DnD Board compendium v1: monster card data",
  character: "DnD Board compendium v1: character card data",
  species: "DnD Board compendium v1: species card data",
  class: "DnD Board compendium v1: class card data",
  feat: "DnD Board compendium v1: feat card data",
  background: "DnD Board compendium v1: background card data",
};

/**
 * Deterministically builds the public import schemas (draft 2020-12) from the
 * Zod definitions above. Returns file name -> serialized JSON (with trailing
 * newline). scripts/generate-compendium-schemas.ts writes these to
 * docs/import-schemas/v1/; the integration test asserts the committed files
 * match byte-for-byte.
 */
export function buildCompendiumJsonSchemas(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const type of compendiumTypes) {
    const generated = z.toJSONSchema(
      compendiumCardSchemas[type].describe(cardSchemaDescriptions[type]),
      { target: JSON_SCHEMA_TARGET, io: "input" },
    ) as Record<string, unknown>;
    files[`${type}.json`] =
      JSON.stringify(
        {
          ...generated,
          $id: `https://dnd-board.local/import-schemas/v1/${type}.json`,
          title: `DnD Board compendium ${type} card (v1)`,
        },
        null,
        2,
      ) + "\n";
  }
  const envelope = z.toJSONSchema(
    compendiumImportEnvelopeSchema.describe(
      `DnD Board compendium import envelope v1. The encoded UTF-8 body is additionally limited to ${COMPENDIUM_IMPORT_MAX_BYTES} bytes (20 MiB).`,
    ),
    { target: JSON_SCHEMA_TARGET, io: "input" },
  ) as Record<string, unknown>;
  files["envelope.json"] =
    JSON.stringify(
      {
        ...envelope,
        $id: "https://dnd-board.local/import-schemas/v1/envelope.json",
        title: "DnD Board compendium import envelope (v1)",
      },
      null,
      2,
    ) + "\n";
  return files;
}

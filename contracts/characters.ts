import { z } from "zod";

/**
 * Character sheet contracts (D&D 5e, 2024 revision).
 *
 * The sheet models the seven editor tabs:
 *   1. abilities            -> `identity` + `abilities`
 *   2. skills & saves       -> `skills` + `saves`
 *   3. spells               -> `spellcasting`
 *   4. inventory            -> `inventory`
 *   5. attacks              -> `attacks`
 *   6. other traits         -> `traits`
 *   7. additional 2024 data -> `vitals`
 *
 * Scope guards: no dice, no automatic attack/HP/initiative math. The ONLY
 * derived values are ability modifiers and the proficiency bonus (and their
 * direct compositions), exposed as pure helpers below. Everything else is a
 * manually entered field stored as-is.
 *
 * This file is shared with the frontend bundle: keep it free of Node-only
 * imports.
 */

export const CHARACTER_SHEET_VERSION = 1;

const idSchema = z.number().int().positive();
const text = (max: number) => z.string().max(max);

/* ------------------------------ derived rules ------------------------------ */

/** D&D 2024 ability modifier: floor((score - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** D&D 2024 proficiency bonus for a character level (1..20). */
export function proficiencyBonus(level: number): number {
  const clamped = Math.min(20, Math.max(1, Math.floor(level)));
  return 2 + Math.floor((clamped - 1) / 4);
}

export const proficiencyRanks = ["none", "proficient", "expertise"] as const;
export type ProficiencyRank = (typeof proficiencyRanks)[number];

export function proficiencyMultiplier(rank: ProficiencyRank): number {
  switch (rank) {
    case "none":
      return 0;
    case "proficient":
      return 1;
    case "expertise":
      return 2;
  }
}

/** Derived composition: modifier + rank multiplier * proficiency bonus. */
export function skillBonus(
  abilityScore: number,
  rank: ProficiencyRank,
  level: number,
): number {
  return (
    abilityModifier(abilityScore) +
    proficiencyMultiplier(rank) * proficiencyBonus(level)
  );
}

/* ------------------------------- abilities --------------------------------- */

export const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = (typeof abilityKeys)[number];

const abilityScoreSchema = z.number().int().min(1).max(30).default(10);

// Base object schemas stay `.partial()`-able (a ZodDefault wrapper is not),
// the exported schemas add the full-section defaults.
const abilityScoresObjectSchema = z.object({
  str: abilityScoreSchema,
  dex: abilityScoreSchema,
  con: abilityScoreSchema,
  int: abilityScoreSchema,
  wis: abilityScoreSchema,
  cha: abilityScoreSchema,
});
export const abilityScoresSchema = abilityScoresObjectSchema.default({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
});
export type AbilityScores = z.infer<typeof abilityScoresSchema>;

/* ------------------------------- identity ---------------------------------- */

const identityObjectSchema = z.object({
  className: text(80).default(""),
  subclass: text(80).default(""),
  species: text(80).default(""),
  background: text(80).default(""),
  alignment: text(80).default(""),
  playerName: text(120).default(""),
  level: z.number().int().min(1).max(20).default(1),
  experiencePoints: z.number().int().min(0).max(10_000_000).default(0),
});
export const identitySchema = identityObjectSchema.default({
  className: "",
  subclass: "",
  species: "",
  background: "",
  alignment: "",
  playerName: "",
  level: 1,
  experiencePoints: 0,
});
export type SheetIdentity = z.infer<typeof identitySchema>;

/* ----------------------------- skills & saves ------------------------------ */

export const skillKeys = [
  "acrobatics",
  "animalHandling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleightOfHand",
  "stealth",
  "survival",
] as const;
export type SkillKey = (typeof skillKeys)[number];

/** Governing ability per skill (D&D 2024). */
export const skillAbilities: Record<SkillKey, AbilityKey> = {
  acrobatics: "dex",
  animalHandling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleightOfHand: "dex",
  stealth: "dex",
  survival: "wis",
};

const proficiencyRankSchema = z.enum(proficiencyRanks).default("none");
/** Saving throws only know "not proficient" / "proficient". */
const saveProficiencySchema = z.enum(["none", "proficient"]).default("none");

const skillsObjectSchema = z.object({
  acrobatics: proficiencyRankSchema,
  animalHandling: proficiencyRankSchema,
  arcana: proficiencyRankSchema,
  athletics: proficiencyRankSchema,
  deception: proficiencyRankSchema,
  history: proficiencyRankSchema,
  insight: proficiencyRankSchema,
  intimidation: proficiencyRankSchema,
  investigation: proficiencyRankSchema,
  medicine: proficiencyRankSchema,
  nature: proficiencyRankSchema,
  perception: proficiencyRankSchema,
  performance: proficiencyRankSchema,
  persuasion: proficiencyRankSchema,
  religion: proficiencyRankSchema,
  sleightOfHand: proficiencyRankSchema,
  stealth: proficiencyRankSchema,
  survival: proficiencyRankSchema,
});
export const skillsSchema = skillsObjectSchema.default({
  acrobatics: "none",
  animalHandling: "none",
  arcana: "none",
  athletics: "none",
  deception: "none",
  history: "none",
  insight: "none",
  intimidation: "none",
  investigation: "none",
  medicine: "none",
  nature: "none",
  perception: "none",
  performance: "none",
  persuasion: "none",
  religion: "none",
  sleightOfHand: "none",
  stealth: "none",
  survival: "none",
});
export type SheetSkills = z.infer<typeof skillsSchema>;

const savingThrowsObjectSchema = z.object({
  str: saveProficiencySchema,
  dex: saveProficiencySchema,
  con: saveProficiencySchema,
  int: saveProficiencySchema,
  wis: saveProficiencySchema,
  cha: saveProficiencySchema,
});
export const savingThrowsSchema = savingThrowsObjectSchema.default({
  str: "none",
  dex: "none",
  con: "none",
  int: "none",
  wis: "none",
  cha: "none",
});
export type SheetSavingThrows = z.infer<typeof savingThrowsSchema>;

/* --------------------------------- spells ---------------------------------- */

const spellSlotSchema = z.object({
  /** Spell level 1..9. */
  level: z.number().int().min(1).max(9),
  total: z.number().int().min(0).max(20).default(0),
  used: z.number().int().min(0).max(20).default(0),
});

const defaultSpellSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({
  level,
  total: 0,
  used: 0,
}));

const spellEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** 0 = cantrip. */
  level: z.number().int().min(0).max(9).default(0),
  prepared: z.boolean().default(false),
  /** Optional link to a compendium spell card; informational only. */
  compendiumItemId: idSchema.nullable().default(null),
  notes: text(2000).default(""),
});

const spellcastingObjectSchema = z.object({
  /** Chosen spellcasting ability; empty string = none selected. */
  ability: z.enum(abilityKeys).or(z.literal("")).default(""),
  slots: z.array(spellSlotSchema).max(9).default(defaultSpellSlots),
  spells: z.array(spellEntrySchema).max(300).default([]),
  notes: text(5000).default(""),
});
export const spellcastingSchema = spellcastingObjectSchema.default({
  ability: "",
  slots: defaultSpellSlots,
  spells: [],
  notes: "",
});
export type SheetSpellcasting = z.infer<typeof spellcastingSchema>;

/* -------------------------------- inventory -------------------------------- */

const inventoryItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(0).max(100_000).default(1),
  /** Weight per unit, free-form number (no auto totals). */
  weight: z.number().min(0).max(100_000).default(0),
  attuned: z.boolean().default(false),
  /** Optional link to a compendium item card; informational only. */
  compendiumItemId: idSchema.nullable().default(null),
  notes: text(2000).default(""),
});

const currencySchema = z
  .object({
    cp: z.number().int().min(0).max(1_000_000_000).default(0),
    sp: z.number().int().min(0).max(1_000_000_000).default(0),
    ep: z.number().int().min(0).max(1_000_000_000).default(0),
    gp: z.number().int().min(0).max(1_000_000_000).default(0),
    pp: z.number().int().min(0).max(1_000_000_000).default(0),
  })
  .default({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });

const inventoryObjectSchema = z.object({
  items: z.array(inventoryItemSchema).max(500).default([]),
  currency: currencySchema,
  /** Free-text equipment that is not itemized. */
  otherEquipment: text(5000).default(""),
});
export const inventorySchema = inventoryObjectSchema.default({
  items: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  otherEquipment: "",
});
export type SheetInventory = z.infer<typeof inventorySchema>;

/* --------------------------------- attacks --------------------------------- */

/**
 * Attack entries are free-form MANUAL text (e.g. "+5", "1d8+3 slashing").
 * The server stores them verbatim; nothing is rolled or auto-computed.
 */
const attackEntrySchema = z.object({
  name: z.string().trim().min(1).max(120),
  attackBonus: text(40).default(""),
  damage: text(120).default(""),
  damageType: text(60).default(""),
  notes: text(2000).default(""),
});

const attacksObjectSchema = z.object({
  list: z.array(attackEntrySchema).max(100).default([]),
  notes: text(5000).default(""),
});
export const attacksSchema = attacksObjectSchema.default({
  list: [],
  notes: "",
});
export type SheetAttacks = z.infer<typeof attacksSchema>;

/* ------------------------------ other traits ------------------------------- */

const traitsObjectSchema = z.object({
  featuresAndTraits: text(20000).default(""),
  otherProficienciesAndLanguages: text(10000).default(""),
  appearance: text(10000).default(""),
  backstory: text(20000).default(""),
  alliesAndOrganizations: text(10000).default(""),
  additionalNotes: text(20000).default(""),
});
export const traitsSchema = traitsObjectSchema.default({
  featuresAndTraits: "",
  otherProficienciesAndLanguages: "",
  appearance: "",
  backstory: "",
  alliesAndOrganizations: "",
  additionalNotes: "",
});
export type SheetTraits = z.infer<typeof traitsSchema>;

/* --------------------------- additional 2024 fields ------------------------ */

/**
 * Vitals tab: HP, AC, speed, initiative etc. are MANUAL entries. The server
 * never computes or adjusts them (no automatic HP mechanics).
 */
const vitalsObjectSchema = z.object({
  armorClass: z.number().int().min(0).max(50).default(10),
  initiative: z.number().int().min(-20).max(30).default(0),
  speed: z.number().int().min(0).max(300).default(30),
  maxHp: z.number().int().min(0).max(2000).default(0),
  currentHp: z.number().int().min(0).max(2000).default(0),
  tempHp: z.number().int().min(0).max(2000).default(0),
  hitDice: text(40).default(""),
  /** 2024 exhaustion levels (each imposes a manual penalty). */
  exhaustion: z.number().int().min(0).max(10).default(0),
  heroicInspiration: z.boolean().default(false),
  conditions: z.array(text(60)).max(30).default([]),
  deathSaves: z
    .object({
      successes: z.number().int().min(0).max(3).default(0),
      failures: z.number().int().min(0).max(3).default(0),
    })
    .default({ successes: 0, failures: 0 }),
  /** Manual field; NOT auto-derived from Perception. */
  passivePerception: z.number().int().min(0).max(50).default(10),
});
export const vitalsSchema = vitalsObjectSchema.default({
  armorClass: 10,
  initiative: 0,
  speed: 30,
  maxHp: 0,
  currentHp: 0,
  tempHp: 0,
  hitDice: "",
  exhaustion: 0,
  heroicInspiration: false,
  conditions: [],
  deathSaves: { successes: 0, failures: 0 },
  passivePerception: 10,
});
export type SheetVitals = z.infer<typeof vitalsSchema>;

/* --------------------------- import extensions ----------------------------- */

/**
 * Recursive JSON value validator for preserved third-party data. Stored data
 * must remain JSON-serializable so the sheet column never gets non-JSON
 * content; `unknown` importer output is re-validated through this schema.
 */
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

/**
 * Typed extension bucket for data imported from "Long Story Short" that the
 * native sheet cannot represent (resources, bonus overrides, LSS app
 * settings, outer spells state, unrecognized fields). Kept as JSON data —
 * NOT flattened into notes — so a future version can map more of it. Avatar
 * payloads (bytes/URLs) are deliberately NOT preserved here.
 */
export const longStoryShortExtensionSchema = z.object({
  source: z.literal("long-story-short").default("long-story-short"),
  /** ISO-8601 import timestamp. */
  importedAt: text(40).default(""),
  edition: text(20).default(""),
  sheetEdition: text(20).default(""),
  /** LSS dice/resource trackers (inner `resources`), verbatim JSON. */
  resources: jsonValueSchema.optional(),
  /** Manual bonus overrides (inner `bonusesSkills`/`bonusesStats`/`bonuses`). */
  bonusesSkills: jsonValueSchema.optional(),
  bonusesStats: jsonValueSchema.optional(),
  bonuses: jsonValueSchema.optional(),
  /** LSS proficiency flags (inner `prof`), verbatim JSON. */
  proficiencies: jsonValueSchema.optional(),
  /** Attunement list when present (inner `attunementsList`). */
  attunements: jsonValueSchema.optional(),
  /** LSS spellbook state that the sheet does not model (inner+outer spells). */
  spells: jsonValueSchema.optional(),
  /** LSS UI/layout settings (outer `disabledBlocks`, link access, etc.). */
  settings: jsonValueSchema.optional(),
  /** ProseMirror text blocks with no sheet counterpart, keyed by LSS key. */
  unmappedText: jsonObjectSchema.default({}),
  /** Unrecognized inner `data` keys, preserved verbatim for future support. */
  unknownFields: jsonObjectSchema.default({}),
  /** Unrecognized outer export keys (minus `data`/collab state), verbatim. */
  unknownOuterFields: jsonObjectSchema.default({}),
});
export type LongStoryShortExtension = z.infer<typeof longStoryShortExtensionSchema>;

/**
 * Extensible per-source extension sections. New importers add a typed key
 * here instead of overloading free-text fields.
 */
const extensionsObjectSchema = z.object({
  longStoryShort: longStoryShortExtensionSchema.optional(),
});
export const sheetExtensionsSchema = extensionsObjectSchema.default({});
export type SheetExtensions = z.infer<typeof sheetExtensionsSchema>;

/* ------------------------------ whole sheet -------------------------------- */

export const characterSheetDataSchema = z.object({
  sheetVersion: z.literal(CHARACTER_SHEET_VERSION).default(CHARACTER_SHEET_VERSION),
  identity: identitySchema,
  abilities: abilityScoresSchema,
  saves: savingThrowsSchema,
  skills: skillsSchema,
  spellcasting: spellcastingSchema,
  inventory: inventorySchema,
  attacks: attacksSchema,
  traits: traitsSchema,
  vitals: vitalsSchema,
  extensions: sheetExtensionsSchema,
});
export type CharacterSheetData = z.infer<typeof characterSheetDataSchema>;

/** Full default sheet: `characterSheetDataSchema.parse({})` made explicit. */
export function createDefaultSheetData(): CharacterSheetData {
  return characterSheetDataSchema.parse({});
}

/**
 * Partial snapshot used for (a) copy-from-compendium-card data and
 * (b) `characters.update` payloads. Sections are merged shallowly over the
 * base sheet; array fields (spells, items, attacks, conditions) are replaced
 * wholesale. The merged result is always re-validated as a full sheet.
 */
export const characterSheetPatchSchema = z.object({
  identity: identityObjectSchema.partial().optional(),
  abilities: abilityScoresObjectSchema.partial().optional(),
  saves: savingThrowsObjectSchema.partial().optional(),
  skills: skillsObjectSchema.partial().optional(),
  spellcasting: spellcastingObjectSchema.partial().optional(),
  inventory: inventoryObjectSchema.partial().optional(),
  attacks: attacksObjectSchema.partial().optional(),
  traits: traitsObjectSchema.partial().optional(),
  vitals: vitalsObjectSchema.partial().optional(),
  extensions: extensionsObjectSchema.partial().optional(),
});
export type CharacterSheetPatch = z.infer<typeof characterSheetPatchSchema>;

export function mergeSheetData(
  base: CharacterSheetData,
  patch: CharacterSheetPatch,
): CharacterSheetData {
  return characterSheetDataSchema.parse({
    sheetVersion: CHARACTER_SHEET_VERSION,
    identity: { ...base.identity, ...patch.identity },
    abilities: { ...base.abilities, ...patch.abilities },
    saves: { ...base.saves, ...patch.saves },
    skills: { ...base.skills, ...patch.skills },
    spellcasting: { ...base.spellcasting, ...patch.spellcasting },
    inventory: { ...base.inventory, ...patch.inventory },
    attacks: { ...base.attacks, ...patch.attacks },
    traits: { ...base.traits, ...patch.traits },
    vitals: { ...base.vitals, ...patch.vitals },
    extensions: { ...base.extensions, ...patch.extensions },
  });
}

/* ------------------------------ API contract ------------------------------- */

export const characterIdInputSchema = z.object({ id: idSchema });
export type CharacterIdInput = z.infer<typeof characterIdInputSchema>;

export const characterCreateInputSchema = z.object({
  /** Falls back to the copied card name, then to a generic default. */
  name: z.string().trim().min(1).max(120).optional(),
  /**
   * Optional compendium card of type `character` to copy the sheet from.
   * The copy happens once at creation; the sheet never syncs with the card.
   */
  sourceCardId: idSchema.optional(),
  /** Extra snapshot merged over the defaults / copied card data. */
  data: characterSheetPatchSchema.optional(),
});
export type CharacterCreateInput = z.infer<typeof characterCreateInputSchema>;

export const characterUpdateInputSchema = z
  .object({
    id: idSchema,
    /** Optimistic concurrency: must equal the current row version. */
    expectedVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    data: characterSheetPatchSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.data !== undefined, {
    message: "Nothing to update",
  });
export type CharacterUpdateInput = z.infer<typeof characterUpdateInputSchema>;

/** List payload: no sheet JSON. */
export interface CharacterSummaryDto {
  id: number;
  ownerId: number;
  name: string;
  version: number;
  /**
   * Portrait media key (FK media_assets), null when none. Render via
   * GET /api/board-image?key=...; never an external URL.
   */
  portraitKey: string | null;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDto extends CharacterSummaryDto {
  data: CharacterSheetData;
}

/* ------------------------- Long Story Short import ------------------------- */

/** Hard cap on the pasted/loaded export text (samples are ~100–200 KB). */
export const LSS_IMPORT_MAX_CHARS = 8 * 1024 * 1024;

/**
 * `characters.importLss`: raw text of a Long Story Short export file
 * (`.json`, outer object with `data` as a nested JSON string). Always
 * creates a NEW sheet owned by the caller; the name comes from the export.
 */
export const characterImportLssInputSchema = z.object({
  jsonText: z.string().min(2).max(LSS_IMPORT_MAX_CHARS),
});
export type CharacterImportLssInput = z.infer<typeof characterImportLssInputSchema>;

/* --------------------------- optimistic concurrency ------------------------ */

/**
 * Payload attached as `cause` to the CONFLICT (409) tRPC error thrown when
 * `expectedVersion` is stale. `current` is the up-to-date entity, so a client
 * can resolve the conflict without an extra round trip.
 */
export interface VersionConflictCause<T> {
  tag: "version_conflict";
  currentVersion: number;
  current: T;
}

export function versionConflictCause<T extends { version: number }>(
  current: T,
): VersionConflictCause<T> {
  return {
    tag: "version_conflict",
    currentVersion: current.version,
    current,
  };
}

/** Reads the conflict payload back from a caught tRPC error (or null). */
export function readVersionConflict<T>(
  err: unknown,
): VersionConflictCause<T> | null {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause;
  if (
    cause &&
    typeof cause === "object" &&
    (cause as { tag?: unknown }).tag === "version_conflict" &&
    typeof (cause as { currentVersion?: unknown }).currentVersion === "number"
  ) {
    return cause as VersionConflictCause<T>;
  }
  return null;
}

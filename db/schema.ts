import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * DnD Board schema (SQLite / better-sqlite3).
 *
 * There is intentionally no `tables` entity: one installation holds exactly
 * one game space. Timestamps are stored as integer unix milliseconds and are
 * exposed through the API as ISO strings (mapping happens in repositories).
 * JSON columns are used only for variable-structure payloads (character sheet,
 * compendium card data, per-board initiative list); everything that takes
 * part in rights, relations or invariants is a real column.
 *
 * The DDL source of truth that is actually applied at runtime lives in
 * db/migrations/*.ts (embedded SQL, so it survives the esbuild server bundle).
 * Keep this file and those migrations in sync; drizzle-kit can diff/generate
 * against this schema via drizzle.config.ts.
 */

const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Technical identity for the platform adapter: local:<loginNormalized>.
    unionId: text("union_id").notNull().unique(),
    loginNormalized: text("login_normalized").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    gameRole: text("game_role", { enum: ["master", "player"] })
      .notNull()
      .default("player"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("users_game_role", sql`${t.gameRole} IN ('master','player')`)],
);

/** Singleton row (id = 1) holding monotonically increasing state revisions. */
export const appMeta = sqliteTable(
  "app_meta",
  {
    id: integer("id").primaryKey(),
    gameRevision: integer("game_revision").notNull().default(0),
    compendiumRevision: integer("compendium_revision").notNull().default(0),
  },
  (t) => [check("app_meta_singleton", sql`${t.id} = 1`)],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    // Storage key, doubles as the object-store key. The only string PK.
    key: text("key").primaryKey(),
    backend: text("backend", { enum: ["local", "platform"] }).notNull(),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => users.id),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("media_backend", sql`${t.backend} IN ('local','platform')`),
    index("media_assets_uploaded_by_idx").on(t.uploadedBy),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("campaigns_single_active")
      .on(t.isActive)
      .where(sql`${t.isActive} = 1`),
  ],
);

export const boards = sqliteTable(
  "boards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignId: integer("campaign_id")
      .notNull()
      .default(1)
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    backgroundKey: text("background_key").references(
      () => mediaAssets.key,
      { onDelete: "set null" },
    ),
    cellSize: integer("cell_size").notNull().default(64),
    gridWidth: integer("grid_width").notNull().default(30),
    gridHeight: integer("grid_height").notNull().default(20),
    // JSON array of { tokenId, value } for this board.
    initiative: text("initiative").notNull().default("[]"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("boards_campaign_idx").on(t.campaignId),
    // Invariant: at most one globally active board; its campaign must be active.
    uniqueIndex("boards_single_active")
      .on(t.isActive)
      .where(sql`${t.isActive} = 1`),
    check(
      "boards_grid_bounds",
      sql`${t.gridWidth} BETWEEN 1 AND 500 AND ${t.gridHeight} BETWEEN 1 AND 500 AND ${t.cellSize} BETWEEN 4 AND 1024`,
    ),
  ],
);

export const characters = sqliteTable(
  "characters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // JSON character sheet including its sheetVersion.
    data: text("data").notNull(),
    portraitKey: text("portrait_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    // Optimistic concurrency version.
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("characters_owner_idx").on(t.ownerId)],
);

export const compendiumItems = sqliteTable(
  "compendium_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", {
      enum: [
        "spell",
        "item",
        "monster",
        "character",
        "species",
        "class",
        "feat",
        "background",
      ],
    }).notNull(),
    name: text("name").notNull(),
    source: text("source").notNull().default(""),
    isMagic: integer("is_magic", { mode: "boolean" })
      .notNull()
      .default(false),
    visibility: text("visibility", { enum: ["private", "shared"] })
      .notNull()
      .default("private"),
    // NULL only for imported shared cards.
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    imageKey: text("image_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    // JSON payload of the concrete card type.
    data: text("data").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("compendium_type_idx").on(t.type),
    index("compendium_visibility_idx").on(t.visibility),
    index("compendium_created_by_idx").on(t.createdBy),
  ],
);

export const tokens = sqliteTable(
  "tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    boardId: integer("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["hero", "monster", "prop"] })
      .notNull()
      .default("prop"),
    label: text("label").notNull().default(""),
    ownerId: integer("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    characterId: integer("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    compendiumId: integer("compendium_id").references(
      () => compendiumItems.id,
      { onDelete: "set null" },
    ),
    cellX: integer("cell_x").notNull().default(0),
    cellY: integer("cell_y").notNull().default(0),
    hp: integer("hp").notNull().default(0),
    maxHp: integer("max_hp").notNull().default(0),
    // Token footprint in grid squares.
    size: real("size").notNull().default(1),
    invisible: integer("invisible", { mode: "boolean" }).notNull().default(false),
    imageKey: text("image_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tokens_board_idx").on(t.boardId),
    index("tokens_owner_idx").on(t.ownerId),
    check(
      "tokens_hp_bounds",
      sql`${t.hp} >= 0 AND ${t.maxHp} >= 0 AND ${t.hp} <= ${t.maxHp}`,
    ),
    check(
      "tokens_refs_exclusive",
      sql`NOT (${t.characterId} IS NOT NULL AND ${t.compendiumId} IS NOT NULL)`,
    ),
    // A compendium-bound token takes its image from the card.
    check(
      "tokens_compendium_image",
      sql`NOT (${t.compendiumId} IS NOT NULL AND ${t.imageKey} IS NOT NULL)`,
    ),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_user_idx").on(t.userId)],
);

export const noteShares = sqliteTable(
  "note_shares",
  {
    noteId: integer("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.noteId, t.userId] }),
    index("note_shares_user_idx").on(t.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type AppMetaRow = typeof appMeta.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type CompendiumItemRow = typeof compendiumItems.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;

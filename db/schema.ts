import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Declarative Drizzle mirror of the embedded migrations (db/migrations/*.ts).
 * The migrations are the source of truth for what runs at boot; this file
 * gives the ORM typed access and lets drizzle-kit diff future changes.
 * Keep the two in sync when adding tables/columns.
 */

/* ---------------------------------- users ---------------------------------- */

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    unionId: text("union_id").notNull().unique(),
    loginNormalized: text("login_normalized").notNull().unique(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    gameRole: text("game_role", { enum: ["master", "player"] })
      .notNull()
      .default("player"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    sql`CHECK (${t.gameRole} IN ('master','player'))`,
  ],
);

export const appMeta = sqliteTable(
  "app_meta",
  {
    id: integer("id").primaryKey(),
    gameRevision: integer("game_revision").notNull().default(0),
    compendiumRevision: integer("compendium_revision").notNull().default(0),
  },
  (t) => [sql`CHECK (${t.id} = 1)`],
);

/* ------------------------------- media assets ------------------------------ */

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    key: text("key").primaryKey(),
    backend: text("backend", { enum: ["local", "platform"] }).notNull(),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => users.id),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("media_assets_uploaded_by_idx").on(t.uploadedBy)],
);

/* ---------------------------------- boards --------------------------------- */

export const boards = sqliteTable(
  "boards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    backgroundKey: text("background_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    cellSize: integer("cell_size").notNull().default(64),
    gridWidth: integer("grid_width").notNull().default(30),
    gridHeight: integer("grid_height").notNull().default(20),
    /** JSON-serialized initiative list; v1 stores manual entries. */
    initiative: text("initiative").notNull().default("[]"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // At most one active board (partial unique index).
    uniqueIndex("boards_single_active").on(t.isActive).where(sql`${t.isActive} = 1`),
    sql`CHECK (${t.gridWidth} BETWEEN 1 AND 500 AND ${t.gridHeight} BETWEEN 1 AND 500 AND ${t.cellSize} BETWEEN 4 AND 1024)`,
  ],
);

/* -------------------------------- characters ------------------------------- */

export const characters = sqliteTable(
  "characters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** JSON blob with character-sheet fields. */
    data: text("data").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("characters_owner_idx").on(t.ownerId)],
);

/* -------------------------------- compendium ------------------------------- */

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
    isMagic: integer("is_magic", { mode: "boolean" }).notNull().default(false),
    visibility: text("visibility", { enum: ["private", "shared"] })
      .notNull()
      .default("private"),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    imageKey: text("image_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    data: text("data").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("compendium_type_idx").on(t.type),
    index("compendium_visibility_idx").on(t.visibility),
    index("compendium_created_by_idx").on(t.createdBy),
  ],
);

/* ---------------------------------- tokens --------------------------------- */

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
    compendiumId: integer("compendium_id").references(() => compendiumItems.id, {
      onDelete: "set null",
    }),
    cellX: integer("cell_x").notNull().default(0),
    cellY: integer("cell_y").notNull().default(0),
    hp: integer("hp").notNull().default(0),
    maxHp: integer("max_hp").notNull().default(0),
    /** Token footprint in grid squares. */
    size: real("size").notNull().default(1),
    imageKey: text("image_key").references(() => mediaAssets.key, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("tokens_board_idx").on(t.boardId),
    index("tokens_owner_idx").on(t.ownerId),
    sql`CHECK (${t.hp} >= 0 AND ${t.maxHp} >= 0 AND ${t.hp} <= ${t.maxHp})`,
    // A token links to either a character or a compendium entry, never both.
    sql`CHECK (NOT (${t.characterId} IS NOT NULL AND ${t.compendiumId} IS NOT NULL))`,
    // Compendium-linked tokens inherit the entry's image, no override allowed.
    sql`CHECK (NOT (${t.compendiumId} IS NOT NULL AND ${t.imageKey} IS NOT NULL))`,
  ],
);

/* ----------------------------------- notes --------------------------------- */

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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("notes_user_idx").on(t.userId)],
);

/* ---------------------------------- helpers -------------------------------- */

export type UserRow = typeof users.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type CompendiumItemRow = typeof compendiumItems.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;

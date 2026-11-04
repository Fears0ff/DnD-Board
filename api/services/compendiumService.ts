import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { CompendiumItemRow, UserRow } from "../../db/schema";
import {
  COMPENDIUM_IMPORT_MAX_BYTES,
  compendiumCardMatchesClassFilters,
  compendiumCardSchemas,
  toZodIssueSummary,
  validateCompendiumImport,
  type CompendiumCopyInput,
  type CompendiumCreateInput,
  type CompendiumGetResultDto,
  type CompendiumImportIssue,
  type CompendiumImportResultDto,
  type CompendiumListInput,
  type CompendiumListResultDto,
  type CompendiumMutationResultDto,
  type CompendiumRemoveResultDto,
  type CompendiumUpdateInput,
} from "../../contracts/compendium";
import {
  deleteCompendiumItemRow,
  findCompendiumItemById,
  insertCompendiumItem,
  listCompendiumItems,
  mediaAssetExists,
  toCompendiumCardDto,
  updateCompendiumItemRow,
} from "../repositories/compendium";
import { bumpCompendiumRevision, getCompendiumRevision } from "../repositories/meta";
import { publishCompendiumChanged } from "../realtime/hub";
import { deleteAssetIfUnreferenced } from "./mediaService";

/**
 * Transactional compendium operations. Every mutation:
 *   1. changes data,
 *   2. bumps app_meta.compendium_revision inside the SAME transaction,
 *   3. commits,
 *   4. only then publishes compendium.changed over WS (publish after commit).
 *
 * Rights (plan §4.3, compendium slice): reads and copies are role-aware
 * (master sees everything; a player sees shared cards plus their own
 * private ones, but never monsters — they answer NOT_FOUND without
 * revealing existence); create/update/remove/import are master-only
 * (enforced by masterProcedure in api/routers/compendium.ts).
 */

export class CompendiumImportError extends TRPCError {
  readonly issues: CompendiumImportIssue[];
  constructor(issues: CompendiumImportIssue[]) {
    const shown = issues.slice(0, 20).map(formatIssue);
    const rest = issues.length - shown.length;
    super({
      code: "UNPROCESSABLE_CONTENT",
      message:
        `Compendium import failed with ${issues.length} error(s): ` +
        shown.join("; ") +
        (rest > 0 ? `; …and ${rest} more` : ""),
    });
    this.issues = issues;
  }
}

function formatIssue(issue: CompendiumImportIssue): string {
  const where =
    issue.index >= 0
      ? `cards[${issue.index}]${issue.path === "$" ? "" : `.${issue.path}`}`
      : issue.path;
  return `${where}: ${issue.message}`;
}

function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Compendium card not found" });
}

/** A card is readable when it is shared or owned by the requester. */
function canRead(row: CompendiumItemRow, user: UserRow): boolean {
  if (user.gameRole === "master") return true;
  // Monsters are master-only: players get NOT_FOUND on shared/private/own
  // monsters alike, so the card's existence never leaks.
  if (row.type === "monster") return false;
  return row.visibility === "shared" || row.createdBy === user.id;
}

function requireVisibleCard(db: DbHandle, id: number, user: UserRow): CompendiumItemRow {
  const row = findCompendiumItemById(db, id);
  // Hidden cards answer 404 — existence must not leak to other players.
  if (!row || !canRead(row, user)) throw notFound();
  return row;
}

function assertImageKey(db: DbHandle, imageKey: string | null | undefined): void {
  if (imageKey == null) return;
  if (!mediaAssetExists(db, imageKey)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "imageKey does not reference an existing media asset",
    });
  }
}

/* ---------------------------------- reads ---------------------------------- */

export function listCards(
  db: DbHandle,
  user: UserRow,
  input: CompendiumListInput = {},
): CompendiumListResultDto {
  const rows = listCompendiumItems(db, user, {
    type: input.type,
    search: input.search,
  });
  let items = rows.map(toCompendiumCardDto);
  if (input.class !== undefined || input.subclass !== undefined) {
    items = items.filter((item) =>
      compendiumCardMatchesClassFilters(item.data, input.class, input.subclass),
    );
  }
  return { items, compendiumRevision: getCompendiumRevision(db) };
}

export function getCard(
  db: DbHandle,
  user: UserRow,
  id: number,
): CompendiumGetResultDto {
  const row = requireVisibleCard(db, id, user);
  return {
    card: toCompendiumCardDto(row),
    compendiumRevision: getCompendiumRevision(db),
  };
}

/* -------------------------------- mutations -------------------------------- */

/** Master-only (router enforces); the creator is always the caller. */
export function createCard(
  db: AppDatabase,
  user: UserRow,
  input: CompendiumCreateInput,
): CompendiumMutationResultDto {
  const result = db.transaction((tx) => {
    const imageKey = input.imageKey ?? null;
    assertImageKey(tx, imageKey);
    const row = insertCompendiumItem(tx, {
      type: input.type,
      name: input.name,
      source: input.source,
      isMagic: input.isMagic,
      visibility: input.visibility,
      createdBy: user.id,
      imageKey,
      data: JSON.stringify(input.data),
    });
    return { card: toCompendiumCardDto(row), compendiumRevision: bumpCompendiumRevision(tx) };
  });
  publishCompendiumChanged(result.compendiumRevision);
  return result;
}

/** Master-only (router enforces). `type` is immutable; `data` is validated. */
export async function updateCard(
  db: AppDatabase,
  user: UserRow,
  input: CompendiumUpdateInput,
): Promise<CompendiumMutationResultDto> {
  let replacedImageKey: string | null = null;
  const result = db.transaction((tx) => {
    const row = requireVisibleCard(tx, input.id, user);
    let data: string | undefined;
    if (input.data !== undefined) {
      const schema = compendiumCardSchemas[row.type];
      const parsed = schema.safeParse(input.data);
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid card data: ${toZodIssueSummary(parsed.error.issues)}`,
        });
      }
      data = JSON.stringify(parsed.data);
    }
    if (input.imageKey !== undefined && input.imageKey !== null) {
      assertImageKey(tx, input.imageKey);
    }
    if (input.imageKey !== undefined && input.imageKey !== row.imageKey) {
      replacedImageKey = row.imageKey;
    }
    const updated = updateCompendiumItemRow(tx, input.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.isMagic !== undefined ? { isMagic: input.isMagic } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
      ...(data !== undefined ? { data } : {}),
    });
    if (!updated) throw notFound();
    return {
      card: toCompendiumCardDto(updated),
      compendiumRevision: bumpCompendiumRevision(tx),
    };
  });
  publishCompendiumChanged(result.compendiumRevision);
  if (replacedImageKey) await deleteAssetIfUnreferenced(db, replacedImageKey);
  return result;
}

/** Master-only (router enforces). */
export async function removeCard(
  db: AppDatabase,
  user: UserRow,
  id: number,
): Promise<CompendiumRemoveResultDto> {
  let removedImageKey: string | null = null;
  const result = db.transaction((tx) => {
    const row = requireVisibleCard(tx, id, user);
    removedImageKey = row.imageKey;
    deleteCompendiumItemRow(tx, id);
    return { removedId: id, compendiumRevision: bumpCompendiumRevision(tx) };
  });
  publishCompendiumChanged(result.compendiumRevision);
  if (removedImageKey) await deleteAssetIfUnreferenced(db, removedImageKey);
  return result;
}

/**
 * Duplicates a visible card into a new INDEPENDENT card: the payload is
 * deep-copied and re-validated, so later edits of either card never affect
 * the other. A player's copy is always private and owned by the player; the
 * master may pick the visibility.
 */
export function copyCard(
  db: AppDatabase,
  user: UserRow,
  input: CompendiumCopyInput,
): CompendiumMutationResultDto {
  const result = db.transaction((tx) => {
    const source = requireVisibleCard(tx, input.id, user);
    const schema = compendiumCardSchemas[source.type];
    const parsed = schema.safeParse(JSON.parse(source.data));
    if (!parsed.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Stored card data failed validation",
      });
    }
    const isMaster = user.gameRole === "master";
    const row = insertCompendiumItem(tx, {
      type: source.type,
      name: input.name ?? source.name,
      source: source.source,
      isMagic: source.isMagic,
      visibility: isMaster ? (input.visibility ?? "private") : "private",
      createdBy: user.id,
      imageKey: source.imageKey,
      data: JSON.stringify(parsed.data),
    });
    return { card: toCompendiumCardDto(row), compendiumRevision: bumpCompendiumRevision(tx) };
  });
  publishCompendiumChanged(result.compendiumRevision);
  return result;
}

/**
 * Master-only atomic import (router enforces the role). Validates the byte
 * size, the envelope and every card; on ANY error nothing is inserted and
 * the revision is untouched. Success inserts shared cards with
 * createdBy = NULL in a single transaction.
 */
export function importCards(
  db: AppDatabase,
  json: string,
): CompendiumImportResultDto {
  if (Buffer.byteLength(json, "utf8") > COMPENDIUM_IMPORT_MAX_BYTES) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `Import file exceeds ${COMPENDIUM_IMPORT_MAX_BYTES} bytes (20 MiB)`,
    });
  }
  const validated = validateCompendiumImport(json);
  if (!validated.ok) {
    throw new CompendiumImportError(validated.issues);
  }
  const result = db.transaction((tx) => {
    for (const card of validated.cards) {
      insertCompendiumItem(tx, {
        type: card.type,
        name: card.name,
        source: "",
        isMagic: false,
        visibility: "shared",
        createdBy: null,
        imageKey: null,
        data: JSON.stringify(card.data),
      });
    }
    return {
      imported: validated.cards.length,
      compendiumRevision: bumpCompendiumRevision(tx),
    };
  });
  publishCompendiumChanged(result.compendiumRevision);
  return result;
}

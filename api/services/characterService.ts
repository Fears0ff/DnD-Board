import { TRPCError } from "@trpc/server";
import type { AppDatabase, DbHandle } from "../../db/connection";
import type { CharacterRow, UserRow } from "../../db/schema";
import {
  characterSheetPatchSchema,
  createDefaultSheetData,
  mergeSheetData,
  versionConflictCause,
  type CharacterCreateInput,
  type CharacterDto,
  type CharacterSheetPatch,
  type CharacterSummaryDto,
  type CharacterUpdateInput,
} from "../../contracts/characters";
import {
  deleteCharacterRow,
  findCharacterById,
  findCharacterCardById,
  insertCharacter,
  listCharactersFor,
  toCharacterDto,
  toCharacterSummaryDto,
  updateCharacterRow,
} from "../repositories/characters";
import { log } from "../lib/logger";
import {
  LssImportError,
  fetchLssAvatarBytes,
  parseLssExport,
  type LssAvatar,
} from "../lib/lssImport";
import { validateImageBytes, MediaValidationError } from "../storage/validate";
import { deleteAssetIfUnreferenced, uploadImage } from "./mediaService";

/**
 * Character sheet operations. Sheets have NO realtime revision: clients
 * re-read on editor open / window focus. Mutations return the full DTO whose
 * `version` is the new optimistic-concurrency version.
 *
 * Rights: the master may read/update/remove ANY sheet; a player only their
 * own. Inaccessible sheets answer 404 (existence is not leaked).
 */

function canAccess(user: UserRow, row: CharacterRow): boolean {
  return user.gameRole === "master" || row.ownerId === user.id;
}

function requireAccessibleSheet(
  db: DbHandle,
  user: UserRow,
  id: number,
): CharacterRow {
  const row = findCharacterById(db, id);
  if (!row || !canAccess(user, row)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });
  }
  return row;
}

export function listCharacters(
  db: DbHandle,
  user: UserRow,
): CharacterSummaryDto[] {
  return listCharactersFor(db, user.id, user.gameRole).map(toCharacterSummaryDto);
}

export function getCharacter(
  db: DbHandle,
  user: UserRow,
  id: number,
): CharacterDto {
  return toCharacterDto(requireAccessibleSheet(db, user, id));
}

/**
 * Creates a sheet owned by the caller. With `sourceCardId` the sheet starts
 * as a copy of that compendium `character` card's data (validated through
 * `characterSheetPatchSchema`); the copy is a snapshot — the sheet never
 * syncs with the card afterwards.
 */
export function createCharacter(
  db: AppDatabase,
  user: UserRow,
  input: CharacterCreateInput,
): CharacterDto {
  return db.transaction((tx) => {
    let cardPatch: CharacterSheetPatch = {};
    let cardName: string | undefined;

    if (input.sourceCardId !== undefined) {
      const card = findCharacterCardById(tx, input.sourceCardId);
      // Same visibility rule as the compendium browser: shared cards, own
      // private cards, or anything for the master.
      const visible =
        card &&
        (card.visibility === "shared" ||
          card.createdBy === user.id ||
          user.gameRole === "master");
      if (!visible) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compendium card not found",
        });
      }
      let raw: unknown;
      try {
        raw = JSON.parse(card.data);
      } catch {
        raw = null;
      }
      const parsed = characterSheetPatchSchema.safeParse(raw);
      if (!parsed.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Compendium card data is not a valid character sheet snapshot",
        });
      }
      cardPatch = parsed.data;
      cardName = card.name;
    }

    const data = mergeSheetData(
      mergeSheetData(createDefaultSheetData(), cardPatch),
      input.data ?? {},
    );
    const row = insertCharacter(tx, {
      ownerId: user.id,
      name: input.name ?? cardName ?? "Unnamed character",
      data,
    });
    return toCharacterDto(row);
  });
}

/**
 * Owner-or-master update with optimistic concurrency. A stale
 * `expectedVersion` never overwrites: the guarded UPDATE touches 0 rows and
 * the caller gets 409 plus the CURRENT entity/version in the error cause.
 */
export function updateCharacter(
  db: AppDatabase,
  user: UserRow,
  input: CharacterUpdateInput,
): CharacterDto {
  return db.transaction((tx) => {
    const row = requireAccessibleSheet(tx, user, input.id);
    const data =
      input.data !== undefined
        ? mergeSheetData(toCharacterDto(row).data, input.data)
        : undefined;
    const updated = updateCharacterRow(tx, row.id, input.expectedVersion, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(data !== undefined ? { data: JSON.stringify(data) } : {}),
    });
    if (!updated) {
      // Same transaction: the row was visible above, so this read is current.
      const fresh = findCharacterById(tx, row.id);
      const current = fresh ? toCharacterDto(fresh) : toCharacterDto(row);
      throw new TRPCError({
        code: "CONFLICT",
        message: `Character was modified concurrently; current version is ${current.version}`,
        cause: versionConflictCause(current),
      });
    }
    return toCharacterDto(updated);
  });
}

/**
 * Удаление листа: портрет (media_assets) удаляется ПОСЛЕ коммита и только
 * best-effort — сбой очистки никогда не отменяет удаление листа, а сироту
 * позже соберёт фоновая чистка.
 */
export function removeCharacter(
  db: AppDatabase,
  user: UserRow,
  id: number,
): { removedId: number } {
  const result = db.transaction((tx) => {
    const row = requireAccessibleSheet(tx, user, id);
    const portraitKey = row.portraitKey ?? null;
    deleteCharacterRow(tx, row.id);
    // tokens.characterId references are cleared by ON DELETE SET NULL.
    return { removedId: row.id, portraitKey };
  });
  if (result.portraitKey) {
    void deleteAssetIfUnreferenced(db, result.portraitKey).catch((err) =>
      log.warn("character portrait cleanup failed", {
        key: result.portraitKey,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return { removedId: result.removedId };
}

/* --------------------------- Long Story Short import ----------------------- */

/** Avatar problems never block the import: log and continue without one. */
async function importPortrait(
  db: AppDatabase,
  user: UserRow,
  avatar: LssAvatar,
): Promise<string | null> {
  try {
    let bytes: Uint8Array;
    if (avatar.kind === "base64") {
      bytes = Buffer.from(avatar.dataBase64, "base64");
    } else {
      bytes = await fetchLssAvatarBytes(avatar.url);
    }
    validateImageBytes(bytes); // throws MediaValidationError on bad bytes
    const asset = await uploadImage(db, user, {
      dataBase64: Buffer.from(bytes).toString("base64"),
      purpose: "characterSheet",
    });
    return asset.key;
  } catch (err) {
    if (
      err instanceof LssImportError ||
      err instanceof MediaValidationError ||
      err instanceof TRPCError
    ) {
      log.warn("LSS avatar skipped", {
        userId: user.id,
        error: err.message,
      });
      return null;
    }
    throw err;
  }
}

/**
 * `characters.importLss`: parses a Long Story Short export and ALWAYS creates
 * a new sheet owned by the caller. Avatar (base64 or allowlisted HTTPS URL)
 * is fetched/validated/stored server-side as a media asset; its key goes to
 * characters.portrait_key. If the sheet insert fails after the upload, the
 * asset is deleted best-effort.
 */
export async function importLssCharacter(
  db: AppDatabase,
  user: UserRow,
  jsonText: string,
): Promise<CharacterDto> {
  let parsed;
  try {
    parsed = parseLssExport(jsonText);
  } catch (err) {
    if (err instanceof LssImportError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }

  const portraitKey = parsed.avatar
    ? await importPortrait(db, user, parsed.avatar)
    : null;

  try {
    return db.transaction((tx) =>
      toCharacterDto(
        insertCharacter(tx, {
          ownerId: user.id,
          name: parsed.name,
          data: parsed.data,
          portraitKey,
        }),
      ),
    );
  } catch (err) {
    // Compensation: a portrait uploaded for a sheet that failed to insert
    // must not linger (it would be orphaned only after 24h otherwise).
    if (portraitKey) {
      await deleteAssetIfUnreferenced(db, portraitKey).catch((cleanupErr) =>
        log.error("LSS import portrait compensation failed", {
          key: portraitKey,
          error:
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        }),
      );
    }
    throw err;
  }
}

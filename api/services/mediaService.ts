import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { AppDatabase, DbHandle } from "../../db/connection";
import { compendiumItems, type UserRow } from "../../db/schema";
import type { MediaAssetDto, UploadImageInput } from "../../contracts/media";
import type { MediaBackend } from "../../contracts/constants";
import { log } from "../lib/logger";
import {
  getImageStorage,
  getMediaBackend,
  getStorageForBackend,
} from "../storage";
import { StorageObjectNotFoundError, type ImageStorage } from "../storage/types";
import {
  MediaValidationError,
  generateImageKey,
  validateImageBytes,
} from "../storage/validate";
import { mediaKeySchema } from "../../contracts/game";
import {
  countMediaReferences,
  deleteMediaAssetRowIfUnreferenced,
  findMediaAsset,
  insertMediaAsset,
  listUnreferencedAssetsOlderThan,
  toMediaAssetDto,
} from "../repositories/media";

/**
 * Media upload / serve / lifecycle (plan §5.2 media, §8).
 *
 * Transaction semantics: the storage object is written first, then the
 * media_assets row is inserted in a transaction; if the insert fails the
 * object is deleted best-effort (compensation is logged, never silent).
 * Deletion is best-effort per plan §8.3: a storage delete failure never
 * rolls back a finished game mutation — it is logged, the row is kept, and
 * the next orphan cleanup retries the file delete.
 */

/** Orphaned uploads are collected after 24h (plan §8.3.4). */
export const ORPHAN_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

function toUploadError(err: MediaValidationError): TRPCError {
  return new TRPCError({
    code: err.reason === "too_large" ? "PAYLOAD_TOO_LARGE" : "UNPROCESSABLE_CONTENT",
    message: err.message,
  });
}

/**
 * Upload rights (plan §4.3): the master may upload for any purpose; a player
 * only for their own `item`/`character` compendium cards. The same check is
 * re-applied at the integration points that attach the key to an entity.
 */
function assertUploadRights(db: DbHandle, user: UserRow, input: UploadImageInput): void {
  if (user.gameRole === "master") {
    if (input.compendiumId !== undefined) {
      const item = db
        .select({ id: compendiumItems.id })
        .from(compendiumItems)
        .where(eq(compendiumItems.id, input.compendiumId))
        .get();
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Compendium item not found" });
      }
    }
    return;
  }
  if (input.purpose !== "compendium" || input.compendiumId === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Players may upload images only for their own item/character cards",
    });
  }
  const item = db
    .select()
    .from(compendiumItems)
    .where(eq(compendiumItems.id, input.compendiumId))
    .get();
  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Compendium item not found" });
  }
  const playerTypes = new Set(["item", "character"]);
  if (item.createdBy !== user.id || !playerTypes.has(item.type)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Players may upload images only for their own item/character cards",
    });
  }
}

export async function uploadImage(
  db: AppDatabase,
  user: UserRow,
  input: UploadImageInput,
): Promise<MediaAssetDto> {
  assertUploadRights(db, user, input);

  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(input.dataBase64, "base64");
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid base64 payload" });
  }
  let info;
  try {
    info = validateImageBytes(bytes);
  } catch (err) {
    if (err instanceof MediaValidationError) throw toUploadError(err);
    throw err;
  }

  const backend: MediaBackend = getMediaBackend();
  const storage: ImageStorage = getImageStorage();
  const requestedKey = generateImageKey(info.mime);

  // Storage first, DB row second; on DB failure the object is compensated.
  const stored = await storage.put({
    key: requestedKey,
    bytes,
    mime: info.mime,
    width: info.width,
    height: info.height,
  });
  try {
    const row = db.transaction((tx) =>
      insertMediaAsset(tx, {
        key: stored.key,
        backend,
        uploadedBy: user.id,
        mime: info.mime,
        size: bytes.length,
      }),
    );
    return toMediaAssetDto(row, info.width, info.height);
  } catch (err) {
    try {
      await storage.delete(stored.key);
    } catch (cleanupErr) {
      log.error("media upload compensation failed", {
        key: stored.key,
        backend,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    throw err;
  }
}

export interface BoardImageBytes {
  bytes: Uint8Array;
  mime: string;
  size: number;
}

/**
 * Byte delivery for GET /api/board-image. The row's RECORDED backend is used
 * for the read, so old assets keep working after the write backend changes.
 */
export async function readBoardImage(
  db: DbHandle,
  key: string,
): Promise<BoardImageBytes> {
  const parsed = mediaKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image key" });
  }
  const row = findMediaAsset(db, key);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
  }
  try {
    const { bytes } = await getStorageForBackend(row.backend).get(key);
    return { bytes, mime: row.mime, size: row.size };
  } catch (err) {
    if (err instanceof StorageObjectNotFoundError) {
      log.warn("media asset row exists but object is missing", {
        key,
        backend: row.backend,
      });
      throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });
    }
    throw err;
  }
}

/**
 * Best-effort deletion after a reference was replaced/removed (plan §8.3.3,
 * §8.3.5). Never throws: storage failures are logged and the row is kept so
 * the orphan cleanup retries the file delete. Returns true when the asset is
 * fully gone (row + object).
 */
export async function deleteAssetIfUnreferenced(
  db: AppDatabase,
  key: string,
): Promise<boolean> {
  const referenced = db.transaction((tx) => countMediaReferences(tx, key) > 0);
  if (referenced) return false;
  const row = findMediaAsset(db, key);
  if (!row) return true;
  try {
    await getStorageForBackend(row.backend).delete(key);
  } catch (err) {
    log.error("media file deletion failed; row kept for cleanup retry", {
      key,
      backend: row.backend,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  // The row delete re-checks references atomically, so a reference created
  // concurrently can never be orphaned.
  return db.transaction((tx) => deleteMediaAssetRowIfUnreferenced(tx, key));
}

export interface OrphanCleanupResult {
  scanned: number;
  removed: number;
  failed: number;
}

/**
 * Background orphan cleanup (plan §8.3.4/5): unreferenced assets older than
 * 24h are deleted file-first; rows survive file-delete failures so the next
 * run retries. Never throws.
 */
export async function cleanupOrphanedAssets(
  db: AppDatabase,
  opts: { olderThanMs?: number; now?: number } = {},
): Promise<OrphanCleanupResult> {
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.olderThanMs ?? ORPHAN_CLEANUP_AGE_MS);
  const orphans = db.transaction((tx) => listUnreferencedAssetsOlderThan(tx, cutoff));
  const result: OrphanCleanupResult = {
    scanned: orphans.length,
    removed: 0,
    failed: 0,
  };
  for (const orphan of orphans) {
    try {
      await getStorageForBackend(orphan.backend).delete(orphan.key);
    } catch (err) {
      result.failed += 1;
      log.error("orphan media cleanup: file deletion failed; will retry", {
        key: orphan.key,
        backend: orphan.backend,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const removed = db.transaction((tx) =>
      deleteMediaAssetRowIfUnreferenced(tx, orphan.key),
    );
    if (removed) result.removed += 1;
  }
  if (result.removed > 0 || result.failed > 0) {
    log.info("orphan media cleanup finished", { ...result, cutoff });
  }
  return result;
}

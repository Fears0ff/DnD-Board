import { StorageError, storage } from "../lib/storage";
import type {
  ImageStorage,
  StoredImage,
  StoredImageBytes,
  ValidatedImage,
} from "./types";
import { StorageObjectNotFoundError } from "./types";
import { assertValidStorageKey } from "./validate";

/**
 * Platform object storage (Kimi TOS via the agent gateway) behind the same
 * ImageStorage interface as the local backend. Delegates to the platform SDK
 * in api/lib/storage.ts — the gateway credential never leaves the server and
 * is never part of a response payload.
 *
 * Key note: the SDK appends its own 8-char random suffix to the fileName on
 * upload, so the FINAL key differs from the requested one; put() returns the
 * final key and the caller must record that (both stay within the strict
 * mediaKeySchema: hex suffix, same extension).
 */
export class PlatformImageStorage implements ImageStorage {
  async put(input: ValidatedImage): Promise<StoredImage> {
    const saved = await storage.uploadFile({
      fileContent: input.bytes,
      fileName: input.key,
      contentType: input.mime,
    });
    return { key: saved.key };
  }

  async get(key: string): Promise<StoredImageBytes> {
    assertValidStorageKey(key);
    try {
      const bytes = await storage.readFile({ fileKey: key });
      return { bytes };
    } catch (err) {
      if (err instanceof StorageError && err.code === "STORAGE_OBJECT_NOT_FOUND") {
        throw new StorageObjectNotFoundError(key);
      }
      throw err;
    }
  }

  /** Idempotent: the platform delete reports success for missing keys. */
  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await storage.deleteFile({ fileKey: key });
  }
}

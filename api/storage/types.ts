import type { ImageMime } from "../../contracts/media";

/**
 * Unified image storage interface (plan §8.1). Implementations: `local`
 * (filesystem under LOCAL_STORAGE_DIR) and `platform` (provisioned object
 * storage via the agent gateway). Upload/serve paths never branch or fall
 * back between backends: the backend is chosen once at startup for writes,
 * and reads use the backend recorded on the media_assets row.
 */

/** Image bytes that passed signature + structure + dimension validation. */
export interface ValidatedImage {
  /** Server-generated storage key (also the media_assets PK). */
  key: string;
  bytes: Uint8Array;
  mime: ImageMime;
  width: number;
  height: number;
}

export interface StoredImage {
  key: string;
}

export interface StoredImageBytes {
  bytes: Uint8Array;
}

export interface ImageStorage {
  put(input: ValidatedImage): Promise<StoredImage>;
  /** Throws StorageObjectNotFoundError when the key does not exist. */
  get(key: string): Promise<StoredImageBytes>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}

/** Distinguished "missing object" failure so callers can map it to 404. */
export class StorageObjectNotFoundError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
    this.key = key;
  }
}

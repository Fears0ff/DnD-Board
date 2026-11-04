import fs from "node:fs/promises";
import path from "node:path";
import type {
  ImageStorage,
  StoredImage,
  StoredImageBytes,
  ValidatedImage,
} from "./types";
import { StorageObjectNotFoundError } from "./types";
import { assertValidStorageKey } from "./validate";

/**
 * Filesystem image storage rooted at LOCAL_STORAGE_DIR (plan §8.1: desktop
 * always uses this backend, at <userData>/uploads). Keys are validated
 * against the strict contract and re-resolved against the root, so a key
 * can never escape the storage directory.
 */
export class LocalImageStorage implements ImageStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Absolute path for a key, guaranteed to stay under the root. */
  private resolve(key: string): string {
    assertValidStorageKey(key);
    const target = path.resolve(this.root, key);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return target;
  }

  async put(input: ValidatedImage): Promise<StoredImage> {
    const target = this.resolve(input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Write to a sibling temp file and rename, so a concurrent reader never
    // observes a partially written image.
    const tmp = `${target}.tmp-${crypto.randomUUID()}`;
    try {
      await fs.writeFile(tmp, input.bytes);
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    return { key: input.key };
  }

  async get(key: string): Promise<StoredImageBytes> {
    try {
      const bytes = await fs.readFile(this.resolve(key));
      return { bytes };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectNotFoundError(key);
      }
      throw err;
    }
  }

  /** Idempotent: a missing object counts as deleted. */
  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

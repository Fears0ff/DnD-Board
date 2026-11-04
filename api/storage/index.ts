import path from "node:path";
import { mediaBackends, type MediaBackend } from "../../contracts/constants";
import { LocalImageStorage } from "./local";
import { PlatformImageStorage } from "./platform";
import type { ImageStorage } from "./types";

/**
 * Backend selection and instances (plan §8.1).
 *
 * The write backend is chosen ONCE at startup:
 *   - explicit MEDIA_STORAGE_BACKEND=local|platform always wins
 *     (Electron/desktop sets "local");
 *   - otherwise "platform" when the full provisioning triple
 *     (KIMI_AGENTGW_BASE_URL / KIMI_AGENTGW_API_KEY / KIMI_STORAGE_RESOURCE_ID)
 *     is present;
 *   - otherwise "local" under LOCAL_STORAGE_DIR.
 *
 * Every media_assets row records the backend that wrote it, and reads go
 * through the backend recorded on the row — switching the write backend for
 * new uploads never changes how old files are read. There are deliberately
 * no fallback branches in the upload/serve paths.
 */

export function defaultLocalStorageDir(): string {
  return process.env.LOCAL_STORAGE_DIR || path.join("data", "uploads");
}

export function isPlatformProvisioningPresent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.KIMI_AGENTGW_BASE_URL &&
      env.KIMI_AGENTGW_API_KEY &&
      env.KIMI_STORAGE_RESOURCE_ID,
  );
}

export function selectMediaBackend(
  env: NodeJS.ProcessEnv = process.env,
): MediaBackend {
  const explicit = env.MEDIA_STORAGE_BACKEND;
  if (explicit) {
    if (!(mediaBackends as readonly string[]).includes(explicit)) {
      throw new Error(
        `MEDIA_STORAGE_BACKEND must be one of ${mediaBackends.join(", ")}; got "${explicit}"`,
      );
    }
    if (explicit === "platform" && !isPlatformProvisioningPresent(env)) {
      throw new Error(
        "MEDIA_STORAGE_BACKEND=platform requires KIMI_AGENTGW_BASE_URL, KIMI_AGENTGW_API_KEY and KIMI_STORAGE_RESOURCE_ID",
      );
    }
    return explicit as MediaBackend;
  }
  return isPlatformProvisioningPresent(env) ? "platform" : "local";
}

const instances = new Map<MediaBackend, ImageStorage>();

function createBackend(backend: MediaBackend): ImageStorage {
  return backend === "platform"
    ? new PlatformImageStorage()
    : new LocalImageStorage(defaultLocalStorageDir());
}

/** Storage instance for a specific backend (used for reads of old assets). */
export function getStorageForBackend(backend: MediaBackend): ImageStorage {
  let instance = instances.get(backend);
  if (!instance) {
    instance = createBackend(backend);
    instances.set(backend, instance);
  }
  return instance;
}

let writeBackend: MediaBackend | null = null;

/** The write backend chosen once at startup. */
export function getMediaBackend(): MediaBackend {
  if (!writeBackend) {
    writeBackend = selectMediaBackend();
  }
  return writeBackend;
}

/** Storage for NEW uploads (the backend selected once at startup). */
export function getImageStorage(): ImageStorage {
  return getStorageForBackend(getMediaBackend());
}

/**
 * Test hook: override instances / selection; passing no arguments restores
 * default lazy behaviour. Mirrors setDbForTests in db/connection.ts.
 */
export function setImageStorageForTests(
  backend?: MediaBackend,
  storage?: ImageStorage,
): void {
  if (backend === undefined) {
    instances.clear();
    writeBackend = null;
    return;
  }
  if (storage) instances.set(backend, storage);
  writeBackend = backend;
}

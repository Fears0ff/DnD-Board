import { TRPCError } from "@trpc/server";

/**
 * Small in-memory sliding-window throttler for login/register attempts.
 * One installation is a trusted LAN app, so a per-process limiter is
 * sufficient; it protects against scripted password guessing, not against
 * a distributed attack.
 */

interface Window {
  timestamps: number[];
}

const windows = new Map<string, Window>();

const MAX_TRACKED_KEYS = 10_000;

export function hitRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): void {
  const now = Date.now();
  let entry = windows.get(key);
  if (!entry) {
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    entry = { timestamps: [] };
    windows.set(key, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= limit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts, try again later",
    });
  }
  entry.timestamps.push(now);
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}

export const LOGIN_ATTEMPT_LIMIT = 10;
export const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

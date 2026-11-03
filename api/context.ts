import { TRPCError } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { UserRow } from "../db/schema";
import { getDb } from "../db/connection";
import { findUserById } from "./repositories/users";
import {
  SESSION_COOKIE,
  createSessionToken,
  isSecureRequest,
  readCookie,
  sessionCookieHeader,
  shouldRenew,
  verifySessionToken,
} from "./services/sessions";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** Authenticated user freshly loaded from the DB, or null. */
  user: UserRow | null;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Mutating requests carrying an Origin header must come from our own host.
 * Combined with SameSite=Lax cookies this blocks cross-site POSTs without
 * opening CORS to anyone.
 */
function enforceOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; cookie auth still applies
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "Bad Origin" });
  }
  const host = req.headers.get("host") ?? new URL(req.url).host;
  if (originHost !== host) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Origin mismatch" });
  }
}

async function loadSessionUser(
  req: Request,
  resHeaders: Headers,
): Promise<UserRow | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  // The role is read from the database on EVERY request; it is never trusted
  // from the token, so role changes apply immediately.
  const user = findUserById(getDb(), session.userId);
  if (!user) return null;
  // Sliding renewal: active sessions are re-issued before they get old.
  if (shouldRenew(session)) {
    const fresh = await createSessionToken(user.id);
    resHeaders.append(
      "Set-Cookie",
      sessionCookieHeader(fresh, isSecureRequest(req)),
    );
  }
  return user;
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const { req, resHeaders } = opts;
  enforceOrigin(req);
  const user = await loadSessionUser(req, resHeaders);
  return { req, resHeaders, user };
}

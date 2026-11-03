import { SignJWT, jwtVerify } from "jose";
import {
  SESSION_COOKIE,
  SESSION_RENEW_BELOW_SECONDS,
  SESSION_TTL_SECONDS,
} from "../../contracts/constants";

/**
 * Signed session tokens (jose / HS256). The token carries ONLY the user id
 * and its expiry — the game role is deliberately not embedded; every request
 * reloads the user and the current gameRole from the database.
 */

function secretKey(): Uint8Array {
  const secret = process.env.APP_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is required in production");
  }
  // Development/test fallback only; never usable in production.
  return new TextEncoder().encode("dnd-board-dev-secret");
}

export async function createSessionToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export interface SessionInfo {
  userId: number;
  /** Seconds until expiry — used for sliding renewal. */
  expiresInSeconds: number;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionInfo | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    return {
      userId,
      expiresInSeconds: Math.max(0, Math.floor(exp - Date.now() / 1000)),
    };
  } catch {
    return null;
  }
}

export function shouldRenew(session: SessionInfo): boolean {
  return session.expiresInSeconds < SESSION_RENEW_BELOW_SECONDS;
}

/* --------------------------------- cookies --------------------------------- */

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function cookieAttributes(secure: boolean): string {
  return `HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(secure)}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(secure)}; Max-Age=0`;
}

/** True when the current request arrived over HTTPS (direct or via proxy). */
export function isSecureRequest(req: Request): boolean {
  if (req.url.startsWith("https://")) return true;
  return req.headers.get("x-forwarded-proto") === "https";
}

export { SESSION_COOKIE };

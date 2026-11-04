import type { Context } from "hono";
import { TRPCError } from "@trpc/server";
import { BOARD_IMAGE_CACHE_CONTROL } from "../../contracts/media";
import { getDb } from "../../db/connection";
import { findUserById } from "../repositories/users";
import {
  SESSION_COOKIE,
  readCookie,
  verifySessionToken,
} from "../services/sessions";
import { readBoardImage } from "../services/mediaService";

/**
 * Authenticated byte delivery: GET /api/board-image?key=<storageKey>.
 *
 * Registration (done in api/boot.ts, BEFORE the /api/* 404 catch-all):
 *   app.get("/api/board-image", handleBoardImage);
 *
 * Auth mirrors the tRPC context (session cookie, role reloaded from the DB).
 * Responses carry the recorded MIME, nosniff and a private immutable cache
 * policy (plan §8.2); keys are random and content-addressed by upload, so
 * immutable caching is safe.
 */
export async function handleBoardImage(c: Context): Promise<Response> {
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  const session = token ? await verifySessionToken(token) : null;
  const user = session ? findUserById(getDb(), session.userId) : undefined;
  if (!user) {
    return c.json({ error: "Not signed in" }, 401);
  }

  const key = c.req.query("key") ?? "";
  try {
    const image = await readBoardImage(getDb(), key);
    // Uint8Array is a valid Response body at runtime (undici); the cast mirrors
    // api/lib/storage.ts, where DOM-vs-undici BufferSource types disagree.
    return new Response(image.bytes as unknown as NonNullable<RequestInit["body"]>, {
      status: 200,
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(image.bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": BOARD_IMAGE_CACHE_CONTROL,
      },
    });
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === "BAD_REQUEST") {
        return c.json({ error: err.message }, 400);
      }
      if (err.code === "NOT_FOUND") {
        return c.json({ error: err.message }, 404);
      }
    }
    throw err; // app.onError logs and answers a generic 500
  }
}

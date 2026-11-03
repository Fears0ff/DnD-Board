import { TRPCError } from "@trpc/server";
import { authedProcedure, createRouter, publicQuery } from "../middleware";
import {
  loginInputSchema,
  registerInputSchema,
} from "../../contracts/auth";
import { getDb } from "../../db/connection";
import { authenticateUser, registerUser } from "../services/authService";
import { normalizeLogin, toUserDto } from "../repositories/users";
import {
  clearSessionCookieHeader,
  createSessionToken,
  isSecureRequest,
  sessionCookieHeader,
} from "../services/sessions";
import {
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_ATTEMPT_WINDOW_MS,
  hitRateLimit,
} from "../services/rateLimit";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

function throttleCredentials(req: Request, login: string): void {
  hitRateLimit(
    `auth:ip:${clientIp(req)}`,
    LOGIN_ATTEMPT_LIMIT * 6,
    LOGIN_ATTEMPT_WINDOW_MS,
  );
  hitRateLimit(
    `auth:login:${normalizeLogin(login)}`,
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_ATTEMPT_WINDOW_MS,
  );
}

export const authRouter = createRouter({
  register: publicQuery
    .input(registerInputSchema)
    .mutation(async ({ ctx, input }) => {
      throttleCredentials(ctx.req, input.login);
      const user = registerUser(getDb(), input);
      const token = await createSessionToken(user.id);
      ctx.resHeaders.append(
        "Set-Cookie",
        sessionCookieHeader(token, isSecureRequest(ctx.req)),
      );
      return toUserDto(user);
    }),

  login: publicQuery.input(loginInputSchema).mutation(async ({ ctx, input }) => {
    throttleCredentials(ctx.req, input.login);
    const user = authenticateUser(getDb(), input);
    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid login or password",
      });
    }
    const token = await createSessionToken(user.id);
    ctx.resHeaders.append(
      "Set-Cookie",
      sessionCookieHeader(token, isSecureRequest(ctx.req)),
    );
    return toUserDto(user);
  }),

  // Idempotent: dropping the current client cookie always succeeds.
  logout: publicQuery.mutation(({ ctx }) => {
    ctx.resHeaders.append(
      "Set-Cookie",
      clearSessionCookieHeader(isSecureRequest(ctx.req)),
    );
    return { ok: true };
  }),

  // Safe DTO only; passwordHash never leaves the server.
  me: authedProcedure.query(({ ctx }) => toUserDto(ctx.user)),
});

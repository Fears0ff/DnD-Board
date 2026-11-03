import { TRPCError } from "@trpc/server";
import type { AppDatabase } from "../../db/connection";
import type { UserRow } from "../../db/schema";
import type { GameRole } from "../../contracts/constants";
import {
  countUsers,
  findUserByLogin,
  insertUser,
} from "../repositories/users";
import { hashPassword, verifyPassword } from "./passwords";

/**
 * Registration and credential checks. Routers stay thin: anything that must
 * be atomic (first-user-becomes-master, login uniqueness) lives here inside
 * a transaction.
 */

export function registerUser(
  db: AppDatabase,
  input: { login: string; password: string; displayName?: string },
): UserRow {
  // better-sqlite3 executes on a single connection, so this transaction is
  // fully serialized against any concurrent registration: exactly one first
  // user can ever observe countUsers() === 0 and become the master.
  return db.transaction((tx) => {
    if (findUserByLogin(tx, input.login)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Login is already taken",
      });
    }
    const gameRole: GameRole = countUsers(tx) === 0 ? "master" : "player";
    return insertUser(tx, {
      login: input.login,
      displayName: input.displayName?.trim() || input.login.trim(),
      passwordHash: hashPassword(input.password),
      gameRole,
    });
  });
}

export function authenticateUser(
  db: AppDatabase,
  input: { login: string; password: string },
): UserRow | null {
  const user = findUserByLogin(db, input.login);
  if (!user) return null;
  if (!verifyPassword(input.password, user.passwordHash)) return null;
  return user;
}

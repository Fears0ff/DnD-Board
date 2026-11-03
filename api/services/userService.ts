import { TRPCError } from "@trpc/server";
import type { AppDatabase } from "../../db/connection";
import type { UserRow } from "../../db/schema";
import type { GameRole } from "../../contracts/constants";
import {
  countMasters,
  findUserById,
  updateUserRole,
} from "../repositories/users";

/**
 * Role changes. The last-master invariant is checked inside the same
 * transaction as the update; concurrent demotions serialize on the single
 * better-sqlite3 connection, so one of them always loses.
 */
export function setGameRole(
  db: AppDatabase,
  targetUserId: number,
  gameRole: GameRole,
): UserRow {
  return db.transaction((tx) => {
    const target = findUserById(tx, targetUserId);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    if (target.gameRole === gameRole) return target;
    if (
      target.gameRole === "master" &&
      gameRole === "player" &&
      countMasters(tx) <= 1
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Cannot demote the last master",
      });
    }
    const updated = updateUserRole(tx, targetUserId, gameRole);
    if (!updated) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }
    return updated;
  });
}

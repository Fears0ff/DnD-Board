import { asc, eq } from "drizzle-orm";
import type { DbHandle } from "../../db/connection";
import { users, type UserRow } from "../../db/schema";
import type { GameRole } from "../../contracts/constants";
import type { UserDto } from "../../contracts/auth";

type Db = DbHandle;

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Maps a DB row to the safe DTO. passwordHash never leaves the server. */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    login: row.loginNormalized,
    displayName: row.displayName,
    gameRole: row.gameRole,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function findUserById(db: Db, id: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function findUserByLogin(
  db: Db,
  login: string,
): UserRow | undefined {
  return db
    .select()
    .from(users)
    .where(eq(users.loginNormalized, normalizeLogin(login)))
    .get();
}

export function listUsers(db: Db): UserRow[] {
  return db.select().from(users).orderBy(asc(users.id)).all();
}

export function countUsers(db: Db): number {
  return db.select({ id: users.id }).from(users).all().length;
}

export function countMasters(db: Db): number {
  return db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.gameRole, "master"))
    .all().length;
}

export function insertUser(
  db: Db,
  values: {
    login: string;
    displayName: string;
    passwordHash: string;
    gameRole: GameRole;
  },
): UserRow {
  const now = Date.now();
  const loginNormalized = normalizeLogin(values.login);
  return db
    .insert(users)
    .values({
      unionId: `local:${loginNormalized}`,
      loginNormalized,
      displayName: values.displayName,
      passwordHash: values.passwordHash,
      gameRole: values.gameRole,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateUserRole(
  db: Db,
  userId: number,
  gameRole: GameRole,
): UserRow | undefined {
  return db
    .update(users)
    .set({ gameRole, updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .returning()
    .get();
}

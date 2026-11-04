import { z } from "zod";
import { gameRoles } from "./constants";

export const loginSchema = z
  .string()
  .trim()
  .min(3, "Login must be at least 3 characters")
  .max(32)
  .regex(/^[\p{L}\p{N}_.-]+$/u, "Login may contain letters, digits, _ . -");

export const passwordSchema = z.string().min(8).max(128);

export const displayNameSchema = z.string().trim().min(1).max(64);

export const registerInputSchema = z.object({
  login: loginSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  login: loginSchema,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const gameRoleSchema = z.enum(gameRoles);

export const setGameRoleInputSchema = z.object({
  userId: z.number().int().positive(),
  gameRole: gameRoleSchema,
});
export type SetGameRoleInput = z.infer<typeof setGameRoleInputSchema>;

/**
 * Safe user DTO. passwordHash and other internal columns are never exposed.
 * `createdAt` is an ISO-8601 string.
 */
export interface UserDto {
  id: number;
  login: string;
  displayName: string;
  gameRole: (typeof gameRoles)[number];
  createdAt?: string;
}

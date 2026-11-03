import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import { toast } from "sonner";
import { trpc, queryClient } from "@/providers/trpc";
import { log } from "@/lib/logger";

export { trpc as api, queryClient };

/** Shared query key pieces so invalidation sites use one constant. */
export const gameStateKey = [["game", "state"]] as const;
export const usersListKey = [["users", "list"]] as const;

export type QueryResult<T> = UseTRPCQueryResult<T, unknown>;

/** True for a tRPC UNAUTHORIZED error (session expired/absent). */
export function isUnauthorizedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { data?: { code?: string } }).data?.code === "UNAUTHORIZED"
  );
}

export function trpcErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
}

/** After login/logout/registration the whole session-scoped cache is stale. */
export function invalidateAuth(): void {
  void queryClient.invalidateQueries();
}

/** Optimistic-update helper: report failures both to the user and the log. */
export function reportMutationError(context: string) {
  return (error: unknown) => {
    const message = trpcErrorMessage(error, "Операция не удалась");
    log.error(`${context} failed`, { error: message });
    toast.error(message);
  };
}

import { trpc } from "@/providers/trpc";
import { queryClient } from "@/providers/trpc";
import type {
  GameRole,
  GameStateDto,
  InitiativeEntry,
  TokenAddInput,
  TokenUpdateInput,
  UserDto,
} from "./game-contract";
import type {
  CharacterCreateInput,
  CharacterDto,
  CharacterSummaryDto,
  CharacterUpdateInput,
} from "@contracts/characters";
import type {
  NoteCreateInput,
  NoteDto,
  NoteSummaryDto,
  NoteUpdateInput,
} from "@contracts/notes";
import type { MediaAssetDto, UploadImageInput } from "@contracts/media";
import type {
  CompendiumCopyInput,
  CompendiumCreateInput,
  CompendiumGetResultDto,
  CompendiumImportResultDto,
  CompendiumListInput,
  CompendiumListResultDto,
  CompendiumMutationResultDto,
  CompendiumRemoveResultDto,
  CompendiumUpdateInput,
} from "@contracts/compendium";

/**
 * Типизированный фасад поверх tRPC-proxy.
 *
 * Backend-роутер реализуется параллельно; пока api/router.ts не содержит
 * игровых процедур, прямое обращение trpc.game.state не типизируется.
 * Прокси tRPC строит пути по именам свойств в рантайме, поэтому фасад
 * остаётся корректным: как только backend реализует тот же контракт
 * (см. game-contract.ts), всё работает без изменений в src/.
 */

export interface QueryOptions {
  enabled?: boolean;
  retry?: number | boolean;
  staleTime?: number;
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

export interface MutationOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

export interface MutationResult<I, T> {
  mutate: (input: I, options?: MutationOptions<T>) => void;
  mutateAsync: (input: I) => Promise<T>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

export interface QueryHook<I, O> {
  useQuery: (input: I, options?: QueryOptions) => QueryResult<O>;
}

export interface MutationHook<I, O> {
  useMutation: (options?: MutationOptions<O>) => MutationResult<I, O>;
}

export interface ApiFacade {
  auth: {
    me: QueryHook<undefined, UserDto>;
    login: MutationHook<{ login: string; password: string }, UserDto>;
    register: MutationHook<
      { login: string; password: string; displayName?: string },
      UserDto
    >;
    logout: MutationHook<undefined, unknown>;
  };
  users: {
    list: QueryHook<undefined, UserDto[]>;
    setGameRole: MutationHook<{ userId: number; gameRole: GameRole }, unknown>;
  };
  game: {
    state: QueryHook<{ boardId?: number } | undefined, GameStateDto>;
  };
  // Игровые мутации возвращают конверт { …, revision }; фронтенд опирается
  // на перечитывание game.state, поэтому тип результата намеренно unknown.
  boards: {
    create: MutationHook<
      { name: string; cellSize?: number; gridWidth?: number; gridHeight?: number },
      unknown
    >;
    rename: MutationHook<{ id: number; name: string }, unknown>;
    remove: MutationHook<{ id: number }, unknown>;
    setActive: MutationHook<{ id: number }, unknown>;
    setBackground: MutationHook<{ id: number; imageKey: string | null }, unknown>;
  };
  tokens: {
    add: MutationHook<TokenAddInput, unknown>;
    update: MutationHook<TokenUpdateInput, unknown>;
    adjustHp: MutationHook<{ id: number; delta: number }, unknown>;
    move: MutationHook<{ tokenId: number; cellX: number; cellY: number }, unknown>;
    remove: MutationHook<{ id: number }, unknown>;
    clear: MutationHook<{ boardId: number }, unknown>;
  };
  initiative: {
    set: MutationHook<{ entries: InitiativeEntry[]; boardId?: number }, unknown>;
  };
  characters: {
    list: QueryHook<undefined, CharacterSummaryDto[]>;
    get: QueryHook<{ id: number }, CharacterDto>;
    create: MutationHook<CharacterCreateInput, CharacterDto>;
    update: MutationHook<CharacterUpdateInput, CharacterDto>;
    remove: MutationHook<{ id: number }, { removedId: number }>;
  };
  notes: {
    list: QueryHook<undefined, NoteSummaryDto[]>;
    get: QueryHook<{ id: number }, NoteDto>;
    create: MutationHook<NoteCreateInput, NoteDto>;
    update: MutationHook<NoteUpdateInput, NoteDto>;
    remove: MutationHook<{ id: number }, { removedId: number }>;
  };
  media: {
    uploadImage: MutationHook<UploadImageInput, MediaAssetDto>;
  };
  compendium: {
    list: QueryHook<CompendiumListInput | undefined, CompendiumListResultDto>;
    get: QueryHook<{ id: number }, CompendiumGetResultDto>;
    create: MutationHook<CompendiumCreateInput, CompendiumMutationResultDto>;
    update: MutationHook<CompendiumUpdateInput, CompendiumMutationResultDto>;
    remove: MutationHook<{ id: number }, CompendiumRemoveResultDto>;
    copy: MutationHook<CompendiumCopyInput, CompendiumMutationResultDto>;
    importJson: MutationHook<{ json: string }, CompendiumImportResultDto>;
  };
}

export const api = trpc as unknown as ApiFacade;

// Compile-time проверка: как только api/router реализует контракт,
// реальный клиент обязан оставаться совместимым с фасадом.
const _facadeMatchesRouter: ApiFacade = trpc;
void _facadeMatchesRouter;

/** Ключи TanStack Query, которые строит tRPC-клиент (префиксное совпадение). */
export const authMeKey = [["auth", "me"]] as const;
export const gameStateKey = [["game", "state"]] as const;
export const usersListKey = [["users", "list"]] as const;
export const compendiumListKey = [["compendium", "list"]] as const;

export function invalidateGameState(): void {
  void queryClient.invalidateQueries({ queryKey: [...gameStateKey] });
}

export function invalidateAuth(): void {
  void queryClient.invalidateQueries({ queryKey: [...authMeKey] });
}

export function invalidateUsers(): void {
  void queryClient.invalidateQueries({ queryKey: [...usersListKey] });
}

interface TrpcErrorShape {
  message?: string;
  data?: { code?: string; httpStatus?: number };
}

export function trpcErrorCode(error: unknown): string | null {
  const e = error as TrpcErrorShape | null;
  return e?.data?.code ?? null;
}

export function isUnauthorizedError(error: unknown): boolean {
  const e = error as TrpcErrorShape | null;
  return e?.data?.code === "UNAUTHORIZED" || e?.data?.httpStatus === 401;
}

export function trpcErrorMessage(error: unknown, fallback = "Ошибка запроса"): string {
  const e = error as TrpcErrorShape | null;
  if (e && typeof e.message === "string" && e.message.length > 0) return e.message;
  return fallback;
}

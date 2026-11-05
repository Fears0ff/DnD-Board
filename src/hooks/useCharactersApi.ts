import { api, type MutationHook, type QueryHook } from "@/lib/api";
import type { UserDto } from "@contracts/auth";
import { queryClient } from "@/providers/trpc";
import type {
  CharacterCreateInput,
  CharacterDto,
  CharacterIdInput,
  CharacterSummaryDto,
  CharacterUpdateInput,
} from "@contracts/characters";
import type {
  NoteDto,
  NoteIdInput,
  NoteSummaryDto,
  NoteUpdateInput,
  NoteSharesInput,
} from "@contracts/notes";

/**
 * Расширение фасада для листов персонажей и заметок.
 *
 * Backend-роутеры реализованы (см. api/routers/characters.ts, notes.ts);
 * сведение их в api/router.ts и в тип ApiFacade выполняет интегратор.
 * До тех пор используем локальное структурное расширение поверх того же
 * tRPC-прокси — пути процедур и контракты совпадают с серверными.
 */

export interface CharactersNotesApiExtension {
  characters: {
    list: QueryHook<undefined, CharacterSummaryDto[]>;
    get: QueryHook<CharacterIdInput, CharacterDto>;
    create: MutationHook<CharacterCreateInput, CharacterDto>;
    update: MutationHook<CharacterUpdateInput, CharacterDto>;
    remove: MutationHook<CharacterIdInput, { removedId: number }>;
  };
  notes: {
    list: QueryHook<undefined, NoteSummaryDto[]>;
    get: QueryHook<NoteIdInput, NoteDto>;
    // title/content имеют серверные дефолты, поэтому на входе опциональны.
    create: MutationHook<{ title?: string; content?: string }, NoteDto>;
    update: MutationHook<NoteUpdateInput, NoteDto>;
    shareCandidates: QueryHook<undefined, UserDto[]>;
    setShares: MutationHook<NoteSharesInput, NoteDto>;
    remove: MutationHook<NoteIdInput, { removedId: number }>;
  };
}

const extendedApi = api as unknown as CharactersNotesApiExtension;

export const charactersApi = extendedApi.characters;
export const notesApi = extendedApi.notes;

/** Ключи TanStack Query, которые строит tRPC-клиент (префиксное совпадение). */
export const charactersKey = [["characters"]] as const;
export const notesKey = [["notes"]] as const;

export function invalidateCharacters(): void {
  void queryClient.invalidateQueries({ queryKey: [...charactersKey] });
}

export function invalidateNotes(): void {
  void queryClient.invalidateQueries({ queryKey: [...notesKey] });
}

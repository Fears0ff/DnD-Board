import { useCallback, useState } from "react";
import { api, trpcErrorMessage } from "@/lib/api";
import { queryClient } from "@/providers/trpc";
import {
  fileToBase64,
  mediaApi,
  validatePickedImage,
} from "@/lib/media";
import type {
  CompendiumGetResultDto,
  CompendiumListInput,
  CompendiumListResultDto,
} from "@contracts/compendium";

/**
 * Хуки данных компедиума поверх фасада api.compendium (см. src/lib/api.ts).
 * Realtime-инвалидация compendium.changed уже подключена в useGameSync
 * (ключ compendiumListKey); мутации инвалидируют префикс ["compendium"],
 * покрывая и list, и get.
 */

export const compendiumQueryKey = [["compendium"]] as const;

export function invalidateCompendium(): void {
  void queryClient.invalidateQueries({ queryKey: [...compendiumQueryKey] });
}

export function useCompendiumCards(
  input: CompendiumListInput | undefined,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return api.compendium.list.useQuery(input, {
    retry: 1,
    refetchOnWindowFocus: true,
    ...options,
  }) as {
    data: CompendiumListResultDto | undefined;
    error: unknown;
    isError: boolean;
    isLoading: boolean;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
}

export function useCompendiumCard(
  id: number | null,
  options?: { enabled?: boolean },
) {
  return api.compendium.get.useQuery(
    { id: id ?? 0 },
    { enabled: (options?.enabled ?? true) && id !== null && id > 0, retry: 1 },
  ) as {
    data: CompendiumGetResultDto | undefined;
    error: unknown;
    isError: boolean;
    isLoading: boolean;
    refetch: () => Promise<unknown>;
  };
}

/** Мутации компедиума с инвалидацией кэша после успеха. */
export function useCompendiumMutations() {
  const create = api.compendium.create.useMutation({
    onSuccess: () => invalidateCompendium(),
  });
  const update = api.compendium.update.useMutation({
    onSuccess: () => invalidateCompendium(),
  });
  const remove = api.compendium.remove.useMutation({
    onSuccess: () => invalidateCompendium(),
  });
  const copy = api.compendium.copy.useMutation({
    onSuccess: () => invalidateCompendium(),
  });
  const importJson = api.compendium.importJson.useMutation({
    onSuccess: () => invalidateCompendium(),
  });
  return { create, update, remove, copy, importJson };
}

export interface CompendiumImageUpload {
  /** Загружает файл и возвращает ключ хранилища; ошибка — строкой. */
  upload: (file: File, compendiumId?: number) => Promise<string | null>;
  isPending: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Загрузка изображения карточки через media.uploadImage (purpose "compendium").
 * Для редактирования передаётся compendiumId — так игрокам доступна загрузка
 * только для собственных карточек, а мастеру — для любых.
 */
export function useCompendiumImageUpload(): CompendiumImageUpload {
  const uploadMutation = mediaApi.uploadImage.useMutation();
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File, compendiumId?: number): Promise<string | null> => {
      const problem = validatePickedImage(file);
      if (problem) {
        setError(problem);
        return null;
      }
      setError(null);
      try {
        const dataBase64 = await fileToBase64(file);
        const asset = await uploadMutation.mutateAsync({
          dataBase64,
          purpose: "compendium",
          ...(compendiumId !== undefined ? { compendiumId } : {}),
        });
        return asset.key;
      } catch (e) {
        setError(trpcErrorMessage(e, "Не удалось загрузить изображение"));
        return null;
      }
    },
    [uploadMutation],
  );

  return {
    upload,
    isPending: uploadMutation.isPending,
    error,
    clearError: () => setError(null),
  };
}

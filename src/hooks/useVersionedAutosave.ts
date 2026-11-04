import { useCallback, useEffect, useRef, useState } from "react";
import { readVersionConflict } from "@contracts/characters";
import { trpcErrorCode, trpcErrorMessage } from "@/lib/api";

export const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface VersionedAutosaveConflict {
  /**
   * Актуальная серверная версия на момент конфликта; null, если узнать её не
   * удалось (по HTTP поле cause не передаётся — тогда версия запрашивается
   * отдельно через fetchVersion).
   */
  currentVersion: number | null;
}

export interface UseVersionedAutosaveOptions<S> {
  /** false, пока редактор не готов (нет загруженной сущности). */
  enabled: boolean;
  /** Версия сущности при монтировании редактора. */
  initialVersion: number;
  /** Собрать payload из текущего состояния редактора (вызывается в момент сохранения). */
  buildPayload: () => S;
  /** Выполнить сохранение; резолвится новой версией сущности. */
  save: (expectedVersion: number, payload: S) => Promise<{ version: number }>;
  /**
   * Перечитать сущность с сервера (выбор «загрузить актуальную версию»).
   * Возвращает свежую версию либо null, если перечитать не удалось.
   */
  reload: () => Promise<number | null>;
  /**
   * Узнать актуальную серверную версию БЕЗ применения данных в редактор
   * (для отображения номера версии в баннере конфликта и для перезаписи).
   */
  fetchVersion: () => Promise<number | null>;
  debounceMs?: number;
}

export interface VersionedAutosave {
  /** Вызывается при любом локальном изменении редактора. */
  notifyEdited: () => void;
  /** Немедленно сохранить накопленное (flush при закрытии редактора). */
  flush: () => Promise<void>;
  /**
   * Запрос на закрытие: сначала flush; возвращает false, если осталась
   * ошибка сохранения или конфликт — диалог не должен закрываться и
   * маскировать проблему.
   */
  requestClose: () => Promise<boolean>;
  /** Сброс состояния при (пере)загрузке сущности в редактор. */
  reset: (version: number) => void;
  saving: boolean;
  dirty: boolean;
  /** Последняя успешно сохранённая / загруженная версия. */
  version: number | null;
  /** Текст не-конфликтной ошибки сохранения (виден пользователю). */
  error: string | null;
  /** Конфликт 409: сохранение остановлено до выбора пользователя. */
  conflict: VersionedAutosaveConflict | null;
  /** Выбор «загрузить актуальную версию»: чужие изменения побеждают. */
  resolveConflictReload: () => Promise<void>;
  /** Выбор «сохранить мою копию»: мои правки перезаписывают серверную версию. */
  resolveConflictOverwrite: () => Promise<void>;
  /** Повтор не-конфликтной ошибки. */
  retry: () => void;
}

/**
 * Переиспользуемый оптимистичный автосейв (план §7.5/§7.6):
 * - debounce 1,5 c;
 * - одновременно не больше одного запроса; новые правки ставятся в очередь;
 * - каждый запрос несёт expectedVersion;
 * - 409 останавливает сохранение и предлагает reload / сохранить свою копию;
 * - ошибка сохранения видна и не маскируется закрытием (requestClose).
 */
export function useVersionedAutosave<S>(
  options: UseVersionedAutosaveOptions<S>,
): VersionedAutosave {
  const { enabled, initialVersion, buildPayload, save, reload, fetchVersion } = options;
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState<number | null>(initialVersion);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionedAutosaveConflict | null>(null);

  // Логические зеркала состояния для синхронного чтения внутри async-кода.
  const versionRef = useRef<number | null>(initialVersion);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<VersionedAutosaveConflict | null>(null);
  const errorRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  // Колбэки всегда свежие, без перевешивания таймеров.
  const buildPayloadRef = useRef(buildPayload);
  const saveRef = useRef(save);
  const reloadRef = useRef(reload);
  const fetchVersionRef = useRef(fetchVersion);
  useEffect(() => {
    buildPayloadRef.current = buildPayload;
    saveRef.current = save;
    reloadRef.current = reload;
    fetchVersionRef.current = fetchVersion;
  });

  const setDirtyBoth = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirty(v);
  }, []);
  const setConflictBoth = useCallback((v: VersionedAutosaveConflict | null) => {
    conflictRef.current = v;
    setConflict(v);
  }, []);
  const setErrorBoth = useCallback((v: string | null) => {
    errorRef.current = v;
    setError(v);
  }, []);
  const setVersionBoth = useCallback((v: number | null) => {
    versionRef.current = v;
    setVersion(v);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runSave = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current || conflictRef.current) return;
    const task = (async () => {
      setSaving(true);
      const expectedVersion = versionRef.current ?? 1;
      const payload = buildPayloadRef.current();
      dirtyRef.current = false;
      setDirty(false);
      try {
        const result = await saveRef.current(expectedVersion, payload);
        setVersionBoth(result.version);
        setErrorBoth(null);
      } catch (err) {
        // Несохранённые правки остаются: они НЕ теряются ни при 409,
        // ни при сетевой ошибке.
        dirtyRef.current = true;
        setDirty(true);
        const conflictPayload = readVersionConflict(err);
        if (conflictPayload) {
          // In-process вызов: актуальная версия уже в cause.
          setConflictBoth({ currentVersion: conflictPayload.currentVersion });
        } else if (trpcErrorCode(err) === "CONFLICT") {
          // По HTTP cause не сериализуется: конфликт определяем по коду,
          // номер актуальной версии запрашиваем отдельно.
          const currentVersion = await fetchVersionRef.current();
          setConflictBoth({ currentVersion });
        } else {
          setErrorBoth(trpcErrorMessage(err, "Не удалось сохранить"));
        }
      } finally {
        setSaving(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = task;
    await task;
    // Изменения, накопленные во время запроса, — следующим сохранением.
    if (dirtyRef.current && !conflictRef.current) {
      await runSave();
    }
  }, [setConflictBoth, setErrorBoth, setVersionBoth, setDirty]);

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, debounceMs);
  }, [clearTimer, debounceMs, runSave]);

  const notifyEdited = useCallback(() => {
    if (!enabled) return;
    setDirtyBoth(true);
    // При активном конфликте сохранение остановлено до выбора пользователя.
    if (conflictRef.current) return;
    schedule();
  }, [enabled, schedule, setDirtyBoth]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    if (inFlightRef.current) await inFlightRef.current;
    while (dirtyRef.current && !conflictRef.current) {
      await runSave();
      if (errorRef.current) break; // не-конфликтная ошибка: не зацикливаемся
    }
  }, [clearTimer, runSave]);

  const requestClose = useCallback(async (): Promise<boolean> => {
    await flush();
    return !conflictRef.current && !errorRef.current;
  }, [flush]);

  const reset = useCallback(
    (nextVersion: number) => {
      clearTimer();
      setVersionBoth(nextVersion);
      setDirtyBoth(false);
      setConflictBoth(null);
      setErrorBoth(null);
    },
    [clearTimer, setConflictBoth, setDirtyBoth, setErrorBoth, setVersionBoth],
  );

  const resolveConflictReload = useCallback(async (): Promise<void> => {
    const freshVersion = await reloadRef.current();
    if (freshVersion === null) return; // не перечиталось — конфликт остаётся
    clearTimer();
    setConflictBoth(null);
    setVersionBoth(freshVersion);
    setDirtyBoth(false);
  }, [clearTimer, setConflictBoth, setDirtyBoth, setVersionBoth]);

  const resolveConflictOverwrite = useCallback(async (): Promise<void> => {
    const current = conflictRef.current;
    if (!current) return;
    // «Сохранить мою копию»: перезаписываем, стартуя от актуальной версии.
    let nextVersion = current.currentVersion;
    if (nextVersion === null) {
      nextVersion = await fetchVersionRef.current();
      if (nextVersion === null) return; // версия неизвестна — не перезаписываем
    }
    setVersionBoth(nextVersion);
    setConflictBoth(null);
    setDirtyBoth(true);
    await runSave();
  }, [runSave, setConflictBoth, setDirtyBoth, setVersionBoth]);

  const retry = useCallback(() => {
    setErrorBoth(null);
    void runSave();
  }, [runSave, setErrorBoth]);

  // Снятие с экрана: таймер отменяем, чтобы не сохранять в «мёртвый» редактор.
  useEffect(() => clearTimer, [clearTimer]);

  return {
    notifyEdited,
    flush,
    requestClose,
    reset,
    saving,
    dirty,
    version,
    error,
    conflict,
    resolveConflictReload,
    resolveConflictOverwrite,
    retry,
  };
}

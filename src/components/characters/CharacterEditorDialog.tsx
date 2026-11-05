import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CloudCheck, CloudUpload, Loader2 } from "lucide-react";
import {
  mergeSheetData,
  type CharacterDto,
  type CharacterSheetData,
  type CharacterSheetPatch,
} from "@contracts/characters";
import { charactersApi, invalidateCharacters } from "@/hooks/useCharactersApi";
import {
  useVersionedAutosave,
  type VersionedAutosave,
} from "@/hooks/useVersionedAutosave";
import { trpcErrorCode, trpcErrorMessage } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { boardImageUrl } from "@/lib/media";
import { TextField } from "./fields";
import { AbilitiesTab, SkillsTab, SpellsTab } from "./tabsCore";
import { AttacksTab, InventoryTab, LssExtensionTab, TraitsTab, VitalsTab } from "./tabsExtra";

/** Гарант закрытия: регистрируется телом редактора, вызывается оболочкой. */
export type CloseGuard = () => Promise<boolean>;

/**
 * Редактор листа персонажа: семь вкладок, оптимистичный автосейв
 * (debounce 1,5 c, expectedVersion), видимые ошибки и разбор конфликтов 409.
 * Закрытие диалога происходит только после успешного flush — ошибка
 * сохранения не маскируется закрытием.
 *
 * Тело редактора смонтировано с key=character.id: состояние инициализируется
 * из загруженной сущности без эффектов, а фоновые refetch не затирают
 * черновик (расхождение версий всплывёт как 409 при сохранении).
 */
export function CharacterEditorDialog({
  characterId,
  open,
  onOpenChange,
}: {
  characterId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = charactersApi.get.useQuery(
    { id: characterId ?? 0 },
    {
      enabled: open && characterId !== null,
      retry: 1,
      // План §6.3: лист перечитывается при открытии и возврате фокуса.
      refetchOnWindowFocus: true,
    },
  );

  const closeGuardRef = useRef<CloseGuard>(async () => true);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    void closeGuardRef.current().then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  const notFound = query.isError && trpcErrorCode(query.error) === "NOT_FOUND";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Лист персонажа</DialogTitle>
          <DialogDescription className="text-xs">
            Редакция 2024. Изменения сохраняются автоматически.
          </DialogDescription>
        </DialogHeader>

        {query.data ? (
          <CharacterEditorBody
            key={query.data.id}
            dto={query.data}
            refetch={query.refetch}
            registerCloseGuard={(guard) => {
              closeGuardRef.current = guard;
            }}
          />
        ) : query.isError ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-xs text-destructive-foreground">
              {notFound
                ? "Лист недоступен"
                : trpcErrorMessage(query.error, "Не удалось загрузить лист")}
            </p>
            <button
              type="button"
              className="ui-hover text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => void query.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Загрузка листа…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CharacterEditorBody({
  dto,
  refetch,
  registerCloseGuard,
}: {
  dto: CharacterDto;
  refetch: () => Promise<unknown>;
  registerCloseGuard: (guard: CloseGuard) => void;
}) {
  const [name, setName] = useState(dto.name);
  const [sheet, setSheet] = useState<CharacterSheetData>(dto.data);
  const updateMutation = charactersApi.update.useMutation();
  const hasLss = Boolean(dto.data.extensions?.longStoryShort);
  const portraitUrl = dto.portraitKey ? boardImageUrl(dto.portraitKey) : null;

  const autosaveRef = useRef<VersionedAutosave | null>(null);
  const applyEntity = useCallback((fresh: CharacterDto) => {
    setName(fresh.name);
    setSheet(fresh.data);
    autosaveRef.current?.reset(fresh.version);
  }, []);

  const autosave = useVersionedAutosave<{ name: string; data: CharacterSheetData }>({
    enabled: true,
    initialVersion: dto.version,
    buildPayload: () => ({ name, data: sheet }),
    save: async (expectedVersion, payload) => {
      const saved = await updateMutation.mutateAsync({
        id: dto.id,
        expectedVersion,
        name: payload.name,
        data: payload.data,
      });
      invalidateCharacters();
      return saved;
    },
    reload: async () => {
      const result = (await refetch()) as { data?: CharacterDto };
      const fresh = result.data;
      if (!fresh) return null;
      applyEntity(fresh);
      return fresh.version;
    },
    fetchVersion: async () => {
      const result = (await refetch()) as { data?: CharacterDto };
      return result.data?.version ?? null;
    },
  });

  useEffect(() => {
    autosaveRef.current = autosave;
  });

  useEffect(() => {
    registerCloseGuard(autosave.requestClose);
  }, [registerCloseGuard, autosave.requestClose]);

  const patch = useCallback((p: CharacterSheetPatch) => {
    setSheet((prev) => mergeSheetData(prev, p));
    autosaveRef.current?.notifyEdited();
  }, []);

  const onNameChange = (value: string) => {
    setName(value);
    autosaveRef.current?.notifyEdited();
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {portraitUrl ? (
          <img
            src={portraitUrl}
            alt="Портрет персонажа"
            className="size-9 shrink-0 rounded-full border border-border object-cover"
          />
        ) : null}
        <div className="min-w-48 flex-1">
          <TextField
            value={name}
            maxLength={120}
            placeholder="Имя персонажа"
            onChange={onNameChange}
          />
        </div>
        <SaveStatus
          saving={autosave.saving}
          dirty={autosave.dirty}
          version={autosave.version}
        />
      </div>

      {autosave.conflict ? (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs">Конфликт версий</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            Лист изменён в другом окне
            {autosave.conflict.currentVersion !== null
              ? ` (актуальная версия — ${autosave.conflict.currentVersion})`
              : ""}
            . Ваши правки не сохранены.
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              onClick={() => void autosave.resolveConflictReload()}
            >
              Загрузить актуальную версию
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="ui-hover h-7 text-xs"
              onClick={() => void autosave.resolveConflictOverwrite()}
            >
              Сохранить мою копию
            </Button>
          </AlertDescription>
        </Alert>
      ) : autosave.error ? (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs">Ошибка сохранения</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            {autosave.error}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              onClick={autosave.retry}
            >
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="abilities" className="flex min-h-0 flex-1 flex-col">
        <TabsList
          className={`grid h-auto w-full grid-cols-2 ${hasLss ? "md:grid-cols-8" : "md:grid-cols-7"}`}
        >
          <TabsTrigger value="abilities" className="ui-hover text-xs">Характеристики</TabsTrigger>
          <TabsTrigger value="skills" className="ui-hover text-xs">Навыки</TabsTrigger>
          <TabsTrigger value="spells" className="ui-hover text-xs">Заклинания</TabsTrigger>
          <TabsTrigger value="inventory" className="ui-hover text-xs">Инвентарь</TabsTrigger>
          <TabsTrigger value="attacks" className="ui-hover text-xs">Атаки</TabsTrigger>
          <TabsTrigger value="traits" className="ui-hover text-xs">Свойства</TabsTrigger>
          <TabsTrigger value="vitals" className="ui-hover text-xs">Лист 2024</TabsTrigger>
          {hasLss ? (
            <TabsTrigger value="lss" className="ui-hover text-xs">LSS</TabsTrigger>
          ) : null}
        </TabsList>
        <ScrollArea className="mt-3 min-h-0 flex-1 pr-3">
          <TabsContent value="abilities">
            <AbilitiesTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="skills">
            <SkillsTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="spells">
            <SpellsTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="inventory">
            <InventoryTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="attacks">
            <AttacksTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="traits">
            <TraitsTab sheet={sheet} patch={patch} />
          </TabsContent>
          <TabsContent value="vitals">
            <VitalsTab sheet={sheet} patch={patch} />
          </TabsContent>
          {hasLss ? (
            <TabsContent value="lss">
              <LssExtensionTab sheet={sheet} patch={patch} />
            </TabsContent>
          ) : null}
        </ScrollArea>
      </Tabs>
    </>
  );
}

function SaveStatus({
  saving,
  dirty,
  version,
}: {
  saving: boolean;
  dirty: boolean;
  version: number | null;
}) {
  if (saving) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Loader2 className="size-3 animate-spin" /> Сохранение…
      </Badge>
    );
  }
  if (dirty) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px]">
        <CloudUpload className="size-3" /> Есть изменения
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      <CloudCheck className="size-3" /> Сохранено{version !== null ? ` · v${version}` : ""}
    </Badge>
  );
}

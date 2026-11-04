import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileUp, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { trpcErrorMessage } from "@/lib/api";
import type { UserDto } from "@/lib/game-contract";
import type { CompendiumType } from "@contracts/constants";
import { compendiumTypes } from "@contracts/constants";
import type { CompendiumCardDto, CompendiumListInput } from "@contracts/compendium";
import { useCompendiumCards, useCompendiumMutations } from "@/hooks/useCompendium";
import {
  COMPENDIUM_TYPE_LABELS,
  COMPENDIUM_VISIBILITY_LABELS,
  compendiumCardSummary,
} from "./compendiumLabels";
import { CompendiumCardDetail } from "./CompendiumCardDetail";
import { CompendiumCardEditor } from "./CompendiumCardEditor";
import { CompendiumImportDialog } from "./CompendiumImportDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Дебаунс строки поиска, чтобы не слать запрос на каждое нажатие. */
function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Главный диалог компедиума: единый список compendium.list для браузера
 * (пикеры используют CompendiumCardPicker). Мастер управляет карточками и
 * импортом; игрок видит общие и свои приватные карточки (кроме монстров —
 * они только для мастера) и может копировать.
 *
 * Пока диалог открыт, список опрашивается каждые 4 секунды — это покрывает
 * fallback без WS; при живом WS useGameSync дополнительно инвалидирует список
 * по compendium.changed.
 */
export function CompendiumDialog({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: UserDto;
}) {
  // Тело монтируется только при открытом диалоге: состояние каждый раз
  // начинается с чистых начальных значений, сброс через эффекты не нужен.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CompendiumDialogBody me={me} /> : null}
    </Dialog>
  );
}

function CompendiumDialogBody({ me }: { me: UserDto }) {
  const isMaster = me.gameRole === "master";

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CompendiumType | "all">("all");
  const [classFilter, setClassFilter] = useState("");
  const [subclassFilter, setSubclassFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CompendiumCardDto | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const debouncedSearch = useDebouncedValue(search);
  const debouncedClass = useDebouncedValue(classFilter);
  const debouncedSubclass = useDebouncedValue(subclassFilter);

  const listInput = useMemo<CompendiumListInput>(() => {
    const input: CompendiumListInput = {};
    if (typeFilter !== "all") input.type = typeFilter;
    if (debouncedSearch.trim()) input.search = debouncedSearch.trim();
    if (debouncedClass.trim()) input.class = debouncedClass.trim();
    if (debouncedSubclass.trim()) input.subclass = debouncedSubclass.trim();
    return input;
  }, [typeFilter, debouncedSearch, debouncedClass, debouncedSubclass]);

  const listQuery = useCompendiumCards(listInput, {
    enabled: true,
    refetchInterval: 4_000,
  });
  const mutations = useCompendiumMutations();
  const busy =
    mutations.remove.isPending || mutations.copy.isPending;

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const selected = items.find((c) => c.id === selectedId) ?? null;

  const openCreate = () => {
    setEditingCard(null);
    setEditorOpen(true);
  };

  const openEdit = (card: CompendiumCardDto) => {
    setEditingCard(card);
    setEditorOpen(true);
  };

  const copyCard = async (card: CompendiumCardDto) => {
    try {
      const result = await mutations.copy.mutateAsync({ id: card.id });
      toast.success(
        isMaster
          ? "Копия создана"
          : "Приватная копия создана — теперь это ваша карточка",
      );
      setSelectedId(result.card.id);
    } catch (e) {
      toast.error(trpcErrorMessage(e, "Не удалось скопировать карточку"));
    }
  };

  const deleteCard = async (card: CompendiumCardDto) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await mutations.remove.mutateAsync({ id: card.id });
      toast.success("Карточка удалена");
      setSelectedId(null);
      setConfirmDelete(false);
    } catch (e) {
      toast.error(trpcErrorMessage(e, "Не удалось удалить карточку"));
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-4xl">
        <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4" />
              Компедиум
            </DialogTitle>
            <DialogDescription className="text-xs">
              {isMaster
                ? "Все карточки. Мастер создаёт, редактирует, копирует, удаляет и импортирует."
                : "Общие карточки и ваши приватные, кроме монстров — они доступны только мастеру. Любую видимую карточку можно скопировать себе."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-40 flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                placeholder="Поиск по названию…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as CompendiumType | "all")}
            >
              <SelectTrigger className="ui-hover h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Все типы
                </SelectItem>
                {compendiumTypes
                  .filter((t) => isMaster || t !== "monster")
                  .map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {COMPENDIUM_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Input
              className="h-7 w-32 text-xs"
              placeholder="Класс (точно)…"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            />
            <Input
              className="h-7 w-32 text-xs"
              placeholder="Подкласс (точно)…"
              value={subclassFilter}
              onChange={(e) => setSubclassFilter(e.target.value)}
            />
            {isMaster ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="ui-hover h-7 text-xs"
                  onClick={openCreate}
                >
                  <Plus className="size-3" />
                  Создать
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ui-hover h-7 text-xs"
                  onClick={() => setImportOpen(true)}
                >
                  <FileUp className="size-3" />
                  Импорт
                </Button>
              </>
            ) : null}
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(100px,0.8fr)_minmax(0,1.5fr)] gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:grid-rows-none">
            <ScrollArea className="min-h-0 rounded-md border border-border">
              {listQuery.isLoading ? (
                <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Загрузка…
                </p>
              ) : listQuery.isError ? (
                <div className="space-y-2 py-10 text-center">
                  <p className="text-xs text-destructive-foreground">
                    {trpcErrorMessage(listQuery.error, "Не удалось загрузить компедиум")}
                  </p>
                  <button
                    type="button"
                    className="ui-hover text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => void listQuery.refetch()}
                  >
                    Повторить
                  </button>
                </div>
              ) : items.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  Карточки не найдены
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((card) => {
                    const summary = compendiumCardSummary(card);
                    return (
                      <li key={card.id}>
                        <button
                          type="button"
                          className={cn(
                            "ui-hover flex w-full flex-col gap-0.5 px-2 py-1.5 text-left",
                            selectedId === card.id && "bg-accent",
                          )}
                          onClick={() => {
                            setSelectedId(card.id);
                            setConfirmDelete(false);
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">
                              {card.name}
                            </span>
                            <Badge variant="outline" className="shrink-0 px-1 text-[9px]">
                              {COMPENDIUM_TYPE_LABELS[card.type]}
                            </Badge>
                            <Badge
                              variant={
                                card.visibility === "shared" ? "default" : "secondary"
                              }
                              className="shrink-0 px-1 text-[9px]"
                            >
                              {COMPENDIUM_VISIBILITY_LABELS[card.visibility]}
                            </Badge>
                          </span>
                          {summary ? (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {summary}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>

            <ScrollArea className="min-h-0 rounded-md border border-border">
              <div className="p-3">
                {selected ? (
                  <CompendiumCardDetail
                    card={selected}
                    canManage={isMaster}
                    busy={busy}
                    confirmDelete={confirmDelete}
                    onEdit={() => openEdit(selected)}
                    onCopy={() => void copyCard(selected)}
                    onDelete={() => void deleteCard(selected)}
                  />
                ) : (
                  <p className="py-10 text-center text-xs text-muted-foreground">
                    Выберите карточку слева
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
      </DialogContent>

      {isMaster ? (
        <>
          <CompendiumCardEditor
            open={editorOpen}
            onOpenChange={setEditorOpen}
            card={editingCard}
            initialType={typeFilter === "all" ? "item" : typeFilter}
          />
          <CompendiumImportDialog open={importOpen} onOpenChange={setImportOpen} />
        </>
      ) : null}
    </>
  );
}

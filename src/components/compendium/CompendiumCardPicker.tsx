import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { trpcErrorMessage } from "@/lib/api";
import type { CompendiumType } from "@contracts/constants";
import type { CompendiumCardDto, CompendiumListInput } from "@contracts/compendium";
import { useCompendiumCards } from "@/hooks/useCompendium";
import {
  COMPENDIUM_TYPE_LABELS,
  compendiumCardSummary,
} from "./compendiumLabels";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Переиспользуемый пикер карточек компедиума (для листов персонажей:
 * заклинания, инвентарь, черты и т.п.). Использует тот же compendium.list,
 * что и браузер; фильтры класса/подкласса — точное case-insensitive
 * совпадение на сервере, карточки без ограничения доступны всем.
 */
export function CompendiumCardPicker({
  open,
  onOpenChange,
  onPick,
  types,
  classFilter,
  subclassFilter,
  title = "Выбор карточки",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вызывается с полной карточкой (включая data) при выборе. */
  onPick: (card: CompendiumCardDto) => void;
  /** Ограничение типов; по умолчанию — все. */
  types?: CompendiumType[];
  /** Точное имя класса листа (например, "Wizard"). */
  classFilter?: string;
  /** Точное имя подкласса листа. */
  subclassFilter?: string;
  title?: string;
}) {
  // Тело монтируется только при открытом диалоге: вкладка типа и поиск
  // каждый раз начинаются с начальных значений без эффектов сброса.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CompendiumCardPickerBody
          onOpenChange={onOpenChange}
          onPick={onPick}
          types={types}
          classFilter={classFilter}
          subclassFilter={subclassFilter}
          title={title}
        />
      ) : null}
    </Dialog>
  );
}

function CompendiumCardPickerBody({
  onOpenChange,
  onPick,
  types,
  classFilter,
  subclassFilter,
  title,
}: {
  onOpenChange: (open: boolean) => void;
  onPick: (card: CompendiumCardDto) => void;
  types?: CompendiumType[];
  classFilter?: string;
  subclassFilter?: string;
  title: string;
}) {
  const allowedTypes = types && types.length > 0 ? types : undefined;
  const [activeType, setActiveType] = useState<CompendiumType | "all">(
    allowedTypes?.length === 1 ? allowedTypes[0] : "all",
  );
  const [search, setSearch] = useState("");

  const listInput = useMemo<CompendiumListInput>(() => {
    const input: CompendiumListInput = {};
    if (activeType !== "all") input.type = activeType;
    if (search.trim()) input.search = search.trim();
    if (classFilter?.trim()) input.class = classFilter.trim();
    if (subclassFilter?.trim()) input.subclass = subclassFilter.trim();
    return input;
  }, [activeType, search, classFilter, subclassFilter]);

  const listQuery = useCompendiumCards(listInput, {
    enabled: true,
    refetchInterval: 4_000,
  });
  const items = listQuery.data?.items ?? [];

  return (
    <DialogContent className="flex h-[70vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            Показаны карточки, доступные листу
            {classFilter ? ` класса «${classFilter}»` : ""}
            {subclassFilter ? ` / «${subclassFilter}»` : ""}
            ; карточки без ограничения класса доступны всегда.
          </DialogDescription>
        </DialogHeader>

        {allowedTypes && allowedTypes.length > 1 ? (
          <Tabs
            value={activeType}
            onValueChange={(v) => setActiveType(v as CompendiumType | "all")}
          >
            <TabsList className="h-7">
              <TabsTrigger value="all" className="h-6 px-2 text-xs">
                Все
              </TabsTrigger>
              {allowedTypes.map((t) => (
                <TabsTrigger key={t} value={t} className="h-6 px-2 text-xs">
                  {COMPENDIUM_TYPE_LABELS[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 pl-7 text-xs"
            placeholder="Поиск по названию…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
          {listQuery.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Загрузка…
            </p>
          ) : listQuery.isError ? (
            <div className="space-y-2 py-10 text-center">
              <p className="text-xs text-destructive-foreground">
                {trpcErrorMessage(listQuery.error, "Не удалось загрузить карточки")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ui-hover h-7 text-xs"
                onClick={() => void listQuery.refetch()}
              >
                Повторить
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              Подходящих карточек нет
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
                        "ui-hover flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left",
                      )}
                      onClick={() => {
                        onPick(card);
                        onOpenChange(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-xs font-medium">{card.name}</span>
                        {summary ? (
                          <span className="truncate text-[10px] text-muted-foreground">
                            {summary}
                          </span>
                        ) : null}
                      </span>
                      <Badge variant="outline" className="shrink-0 px-1 text-[9px]">
                        {COMPENDIUM_TYPE_LABELS[card.type]}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
    </DialogContent>
  );
}

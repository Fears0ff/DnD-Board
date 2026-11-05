import { useRef, useState } from "react";
import { format } from "date-fns";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { UserDto } from "@/lib/game-contract";
import { trpcErrorMessage } from "@/lib/api";
import { charactersApi, invalidateCharacters } from "@/hooks/useCharactersApi";
import { boardImageUrl } from "@/lib/media";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CharacterEditorDialog } from "./CharacterEditorDialog";

/**
 * Карточка компендиума типа `character`, доступная как источник копирования.
 * Список поставляет интегратор (например, из compendium.list с фильтром
 * type=character); без него доступно создание только пустого листа.
 */
export interface CharacterCardOption {
  id: number;
  name: string;
}

export function CharactersDialog({
  open,
  onOpenChange,
  me,
  characterCards,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: UserDto;
  characterCards?: CharacterCardOption[];
}) {
  const listQuery = charactersApi.list.useQuery(undefined, {
    enabled: open,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const createMutation = charactersApi.create.useMutation();
  const removeMutation = charactersApi.remove.useMutation();
  const importMutation = charactersApi.importLss.useMutation();
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [newName, setNewName] = useState("");
  const [sourceCardId, setSourceCardId] = useState<string>("blank");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const create = () => {
    const name = newName.trim();
    createMutation.mutate(
      {
        ...(name ? { name } : {}),
        ...(sourceCardId !== "blank" ? { sourceCardId: Number(sourceCardId) } : {}),
      },
      {
        onSuccess: (created) => {
          invalidateCharacters();
          setNewName("");
          setSourceCardId("blank");
          setEditingId(created.id);
          setEditorOpen(true);
        },
        onError: (err) =>
          toast.error(trpcErrorMessage(err, "Не удалось создать лист")),
      },
    );
  };

  /** Импорт выгрузки Long Story Short: выбор .json-файла, отправка текста. */
  const importLssFile = async (file: File) => {
    let jsonText: string;
    try {
      jsonText = await file.text();
    } catch {
      toast.error("Не удалось прочитать файл");
      return;
    }
    importMutation.mutate(
      { jsonText },
      {
        onSuccess: (created) => {
          invalidateCharacters();
          toast.success(`Импортирован персонаж «${created.name}»`);
          setEditingId(created.id);
          setEditorOpen(true);
        },
        onError: (err) =>
          toast.error(trpcErrorMessage(err, "Не удалось импортировать файл LSS")),
      },
    );
  };

  const remove = (id: number) => {
    removeMutation.mutate(
      { id },
      {
        onSuccess: () => invalidateCharacters(),
        onError: (err) =>
          toast.error(trpcErrorMessage(err, "Не удалось удалить лист")),
      },
    );
  };

  const characters = listQuery.data ?? [];
  const cards = characterCards ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Листы персонажей</DialogTitle>
            <DialogDescription className="text-xs">
              {me.gameRole === "master"
                ? "Мастер видит и редактирует листы всех участников."
                : "Ваши листы персонажей редакции 2024."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="ui-hover h-7 w-48 text-xs"
              placeholder="Имя нового персонажа"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select value={sourceCardId} onValueChange={setSourceCardId}>
              <SelectTrigger className="ui-hover h-7 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank" className="text-xs">
                  Пустой лист
                </SelectItem>
                {cards.map((card) => (
                  <SelectItem key={card.id} value={String(card.id)} className="text-xs">
                    Копия карточки: {card.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="ui-hover h-7 text-xs"
              disabled={createMutation.isPending}
              onClick={create}
            >
              <Plus className="size-3.5" /> Создать
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importLssFile(file);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              disabled={importMutation.isPending}
              title="Импорт выгрузки Long Story Short (.json)"
              onClick={() => importInputRef.current?.click()}
            >
              <FileUp className="size-3.5" />
              {importMutation.isPending ? "Импорт…" : "Импорт LSS"}
            </Button>
          </div>

          {listQuery.isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Загрузка…</p>
          ) : listQuery.isError ? (
            <div className="space-y-2 py-4 text-center">
              <p className="text-xs text-destructive-foreground">
                {trpcErrorMessage(listQuery.error, "Не удалось загрузить листы")}
              </p>
              <button
                type="button"
                className="ui-hover text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => void listQuery.refetch()}
              >
                Повторить
              </button>
            </div>
          ) : characters.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Листов пока нет — создайте первый выше.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 text-xs">Имя</TableHead>
                  {me.gameRole === "master" ? (
                    <TableHead className="h-7 w-20 text-xs">Владелец</TableHead>
                  ) : null}
                  <TableHead className="h-7 w-32 text-xs">Изменён</TableHead>
                  <TableHead className="h-7 w-24 text-right text-xs">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {characters.map((ch) => (
                  <TableRow key={ch.id}>
                    <TableCell className="py-1 text-xs font-medium">
                      {ch.portraitKey ? (
                        <img
                          src={boardImageUrl(ch.portraitKey)}
                          alt=""
                          className="mr-1.5 inline-block size-6 rounded-full object-cover align-middle"
                        />
                      ) : null}
                      {ch.name}
                      <Badge variant="secondary" className="ml-1.5 px-1 text-[10px]">
                        v{ch.version}
                      </Badge>
                    </TableCell>
                    {me.gameRole === "master" ? (
                      <TableCell className="py-1 text-xs text-muted-foreground">
                        #{ch.ownerId}
                        {ch.ownerId === me.id ? " (вы)" : ""}
                      </TableCell>
                    ) : null}
                    <TableCell className="py-1 text-xs text-muted-foreground">
                      {format(new Date(ch.updatedAt), "dd.MM.yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ui-hover size-7"
                        title="Открыть лист"
                        onClick={() => {
                          setEditingId(ch.id);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="ui-hover size-7"
                            title="Удалить лист"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm">
                              Удалить лист «{ch.name}»?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-xs">
                              Действие необратимо. Токены, ссылающиеся на лист,
                              сохранятся без привязки.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="ui-hover h-8 text-xs">
                              Отмена
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="ui-hover h-8 text-xs"
                              onClick={() => remove(ch.id)}
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <CharacterEditorDialog
        characterId={editingId}
        open={editorOpen}
        onOpenChange={(next) => {
          setEditorOpen(next);
          if (!next) invalidateCharacters();
        }}
      />
    </>
  );
}

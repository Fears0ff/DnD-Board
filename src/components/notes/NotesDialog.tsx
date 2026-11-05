import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CloudCheck, CloudUpload, Eye, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { trpcErrorMessage } from "@/lib/api";
import { invalidateNotes, notesApi } from "@/hooks/useCharactersApi";
import { useMarkdownPreview } from "@/hooks/useMarkdownPreview";
import {
  useVersionedAutosave,
  type VersionedAutosave,
} from "@/hooks/useVersionedAutosave";
import type { NoteDto } from "@contracts/notes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

type CloseGuard = () => Promise<boolean>;

/**
 * Персональные Markdown-заметки: слева список, справа редактор с
 * санитизированным предпросмотром (marked + dompurify). Автосейв с
 * expectedVersion и разбором конфликтов 409 — как в листе персонажа.
 * Заметки строго личные: сервер отдаёт только собственные.
 *
 * Переключение заметки и закрытие диалога проходят через flush: при ошибке
 * сохранения или конфликте уйти нельзя, пока проблема видна и не решена.
 */
export function NotesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const listQuery = notesApi.list.useQuery(undefined, {
    enabled: open,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: open ? 4000 : false,
  });
  const createMutation = notesApi.create.useMutation();
  const removeMutation = notesApi.remove.useMutation();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const flushGuardRef = useRef<CloseGuard>(async () => true);

  const selectNote = (id: number) => {
    if (id === selectedId) return;
    // Перед переключением — flush текущей заметки; при ошибке не уходим.
    void flushGuardRef.current().then((ok) => {
      if (ok) setSelectedId(id);
    });
  };

  const createNote = () => {
    void flushGuardRef.current().then((ok) => {
      if (!ok) return;
      createMutation.mutate(
        {},
        {
          onSuccess: (note) => {
            invalidateNotes();
            setSelectedId(note.id);
          },
          onError: (err) =>
            toast.error(trpcErrorMessage(err, "Не удалось создать заметку")),
        },
      );
    });
  };

  const removeNote = (id: number) => {
    removeMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidateNotes();
          if (selectedId === id) setSelectedId(null);
        },
        onError: (err) =>
          toast.error(trpcErrorMessage(err, "Не удалось удалить заметку")),
      },
    );
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    void flushGuardRef.current().then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  const notes = listQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Заметки</DialogTitle>
          <DialogDescription className="text-xs">
            Личные Markdown-заметки и заметки, которыми с вами поделились. Владелец управляет доступом.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[104px_minmax(0,1fr)] gap-2 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-3">
          <div className="flex min-h-0 flex-col gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              disabled={createMutation.isPending}
              onClick={createNote}
            >
              <Plus className="size-3.5" /> Новая заметка
            </Button>
            <ScrollArea className="min-h-0 flex-1">
              {listQuery.isLoading ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Загрузка…
                </p>
              ) : listQuery.isError ? (
                <button
                  type="button"
                  className="ui-hover w-full py-4 text-center text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => void listQuery.refetch()}
                >
                  Повторить
                </button>
              ) : notes.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Заметок нет
                </p>
              ) : (
                <ul className="space-y-1 pr-2">
                  {notes.map((note) => (
                    <li
                      key={note.id}
                      className={`group flex items-center gap-1 rounded-md border px-2 py-1 ${
                        note.id === selectedId ? "border-primary bg-accent" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="ui-hover min-w-0 flex-1 text-left"
                        onClick={() => selectNote(note.id)}
                      >
                        <div className="truncate text-xs font-medium">{note.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {note.isOwner ? format(new Date(note.updatedAt), "dd.MM.yyyy HH:mm") : `От: ${note.ownerName}`}
                        </div>
                      </button>
                      {note.isOwner ? <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="ui-hover size-6 opacity-0 group-hover:opacity-100"
                            title="Удалить заметку"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-sm">
                              Удалить заметку «{note.title}»?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-xs">
                              Действие необратимо.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="ui-hover h-8 text-xs">
                              Отмена
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="ui-hover h-8 text-xs"
                              onClick={() => removeNote(note.id)}
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog> : null}
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            {selectedId === null ? (
              <p className="py-10 text-center text-xs text-muted-foreground">
                Выберите заметку слева или создайте новую.
              </p>
            ) : (
              <NoteEditorLoader
                key={selectedId}
                noteId={selectedId}
                registerCloseGuard={(guard) => {
                  flushGuardRef.current = guard;
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteEditorLoader({
  noteId,
  registerCloseGuard,
}: {
  noteId: number;
  registerCloseGuard: (guard: CloseGuard) => void;
}) {
  const noteQuery = notesApi.get.useQuery(
    { id: noteId },
    { retry: 1, refetchOnWindowFocus: true, refetchInterval: 4000 },
  );

  if (noteQuery.data) {
    return (
      <NoteEditor
        dto={noteQuery.data}
        refetch={noteQuery.refetch}
        registerCloseGuard={registerCloseGuard}
      />
    );
  }
  if (noteQuery.isError) {
    return (
      <div className="space-y-2 py-10 text-center">
        <p className="text-xs text-destructive-foreground">
          {trpcErrorMessage(noteQuery.error, "Заметка недоступна")}
        </p>
        <button
          type="button"
          className="ui-hover text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => void noteQuery.refetch()}
        >
          Повторить
        </button>
      </div>
    );
  }
  return (
    <p className="py-10 text-center text-xs text-muted-foreground">
      Загрузка заметки…
    </p>
  );
}

function NoteEditor({
  dto,
  refetch,
  registerCloseGuard,
}: {
  dto: NoteDto;
  refetch: () => Promise<unknown>;
  registerCloseGuard: (guard: CloseGuard) => void;
}) {
  const [title, setTitle] = useState(dto.title);
  const [content, setContent] = useState(dto.content);
  const [preview, setPreview] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const updateMutation = notesApi.update.useMutation();

  const [receivedVersion, setReceivedVersion] = useState(dto.version);
  if (!dto.isOwner && receivedVersion !== dto.version) {
    setReceivedVersion(dto.version);
    setTitle(dto.title);
    setContent(dto.content);
  }

  const autosaveRef = useRef<VersionedAutosave | null>(null);
  const applyEntity = useCallback((fresh: NoteDto) => {
    setTitle(fresh.title);
    setContent(fresh.content);
    autosaveRef.current?.reset(fresh.version);
  }, []);

  const autosave = useVersionedAutosave<{ title: string; content: string }>({
    enabled: dto.isOwner,
    initialVersion: dto.version,
    buildPayload: () => ({ title, content }),
    save: async (expectedVersion, payload) => {
      const saved = await updateMutation.mutateAsync({
        id: dto.id,
        expectedVersion,
        title: payload.title,
        content: payload.content,
      });
      // Обновляем list/get-кэш: при повторном открытии редактор не должен
      // инициализироваться снимком, который был создан до автосохранения.
      invalidateNotes();
      return saved;
    },
    reload: async () => {
      const result = (await refetch()) as { data?: NoteDto };
      const fresh = result.data;
      if (!fresh) return null;
      applyEntity(fresh);
      return fresh.version;
    },
    fetchVersion: async () => {
      const result = (await refetch()) as { data?: NoteDto };
      return result.data?.version ?? null;
    },
  });

  useEffect(() => {
    autosaveRef.current = autosave;
  });

  useEffect(() => {
    registerCloseGuard(autosave.requestClose);
    // Размонтирование: гарант больше не должен ссылаться на мёртвый редактор.
    return () => registerCloseGuard(async () => true);
  }, [registerCloseGuard, autosave.requestClose]);

  const onTitleChange = (value: string) => {
    setTitle(value);
    autosaveRef.current?.notifyEdited();
  };
  const onContentChange = (value: string) => {
    setContent(value);
    autosaveRef.current?.notifyEdited();
  };

  const previewHtml = useMarkdownPreview(preview ? content : "");

  return (
    <>
      {autosave.conflict ? (
        <Alert variant="destructive" className="py-2">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs">Конфликт версий</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
            Заметка изменена в другом окне
            {autosave.conflict.currentVersion !== null
              ? ` (актуальная версия — ${autosave.conflict.currentVersion})`
              : ""}
            .
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="ui-hover h-7 min-w-32 flex-1 text-xs"
          value={title}
          maxLength={120}
          placeholder="Название заметки"
          onChange={(e) => onTitleChange(e.target.value)}
          readOnly={!dto.isOwner}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ui-hover h-7 text-xs"
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? (
            <>
              <Pencil className="size-3.5" /> Текст
            </>
          ) : (
            <>
              <Eye className="size-3.5" /> Просмотр
            </>
          )}
        </Button>
        {dto.isOwner ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 gap-1 text-xs"
              onClick={() => setShareOpen(true)}
            >
              <Users className="size-3.5" /> Доступ{dto.sharedWith.length > 0 ? ` (${dto.sharedWith.length})` : ""}
            </Button>
            <NoteSaveStatus saving={autosave.saving} dirty={autosave.dirty} version={autosave.version} />
          </>
        ) : <Badge variant="secondary" className="text-[10px]">Только чтение · {dto.ownerName}</Badge>}
      </div>
      {preview ? (
        <ScrollArea className="min-h-0 flex-1 rounded-md border p-3">
          <div
            data-testid="note-preview"
            className="text-xs leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:my-1 [&_h1]:text-base [&_h1]:font-bold [&_h2]:my-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-xs [&_h3]:font-semibold [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:my-1 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </ScrollArea>
      ) : (
        <Textarea
          className="ui-hover min-h-0 flex-1 resize-none font-mono text-xs"
          value={content}
          maxLength={200_000}
          placeholder="Markdown-текст заметки…"
          onChange={(e) => onContentChange(e.target.value)}
          readOnly={!dto.isOwner}
        />
      )}
      {dto.isOwner ? (
        <NoteShareDialog note={dto} open={shareOpen} onOpenChange={setShareOpen} />
      ) : null}
    </>
  );
}

function NoteShareDialog({ note, open, onOpenChange }: {
  note: NoteDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const candidatesQuery = notesApi.shareCandidates.useQuery(undefined, { enabled: open, retry: 1 });
  const setShares = notesApi.setShares.useMutation();
  const [selected, setSelected] = useState<number[]>(note.sharedWith.map((user) => user.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" onOpenAutoFocus={() => setSelected(note.sharedWith.map((user) => user.id))}>
        <DialogHeader>
          <DialogTitle className="text-sm">Доступ к заметке</DialogTitle>
          <DialogDescription className="text-xs">Выбранные пользователи смогут только читать «{note.title}».</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-72 rounded-md border p-2">
          <div className="space-y-1">
            {(candidatesQuery.data ?? []).map((user) => (
              <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
                <input
                  type="checkbox"
                  checked={selected.includes(user.id)}
                  onChange={() => setSelected((ids) => ids.includes(user.id) ? ids.filter((id) => id !== user.id) : [...ids, user.id])}
                />
                <span>{user.displayName || user.login}</span>
              </label>
            ))}
            {candidatesQuery.data?.length === 0 ? <p className="p-3 text-xs text-muted-foreground">Других пользователей пока нет.</p> : null}
          </div>
        </ScrollArea>
        <div className="flex justify-end">
          <Button
            size="sm"
            className="ui-hover h-8 text-xs"
            disabled={setShares.isPending}
            onClick={() => setShares.mutate(
              { id: note.id, userIds: selected },
              {
                onSuccess: () => { invalidateNotes(); onOpenChange(false); toast.success("Доступ к заметке обновлён"); },
                onError: (error) => toast.error(trpcErrorMessage(error, "Не удалось изменить доступ")),
              },
            )}
          >Сохранить доступ</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteSaveStatus({
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

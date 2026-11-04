import { useRef, useState } from "react";
import { FileJson, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpcErrorMessage } from "@/lib/api";
import {
  COMPENDIUM_IMPORT_MAX_BYTES,
  validateCompendiumImport,
  type CompendiumImportIssue,
} from "@contracts/compendium";
import { useCompendiumMutations } from "@/hooks/useCompendium";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Импорт компедиума (только мастер). Клиентская проверка той же схемой
 * envelope, что и на сервере: ошибки показываются с индексом карточки и
 * путём поля до отправки; серверные ошибки показываются как есть.
 * Импорт атомарен — при любой ошибке не создаётся ни одной карточки.
 */
export function CompendiumImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Тело монтируется только при открытом диалоге, поэтому состояние
  // всегда начинается чистым — сброс через эффекты не нужен.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CompendiumImportBody onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function CompendiumImportBody({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [issues, setIssues] = useState<CompendiumImportIssue[]>([]);
  const [cardCount, setCardCount] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { importJson } = useCompendiumMutations();

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setServerError(null);
    setImportedCount(null);
    setFileName(file.name);
    const text = await file.text();
    setJson(text);
    if (new TextEncoder().encode(text).length > COMPENDIUM_IMPORT_MAX_BYTES) {
      setIssues([{ index: -1, path: "$", message: "Файл больше 20 МиБ" }]);
      setCardCount(0);
      return;
    }
    const result = validateCompendiumImport(text);
    if (result.ok) {
      setIssues([]);
      setCardCount(result.cards.length);
    } else {
      setIssues(result.issues);
      setCardCount(0);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runImport = async () => {
    if (!json) return;
    setServerError(null);
    try {
      const result = await importJson.mutateAsync({ json });
      setImportedCount(result.imported);
      toast.success(`Импортировано карточек: ${result.imported}`);
    } catch (e) {
      // Сервер возвращает 422 с индексированными ошибками в message,
      // 413 при превышении 20 МиБ.
      setServerError(trpcErrorMessage(e, "Импорт не выполнен"));
    }
  };

  const canImport =
    json !== null && issues.length === 0 && !importJson.isPending && importedCount === null;

  return (
    <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Импорт компедиума</DialogTitle>
          <DialogDescription className="text-xs">
            Файл JSON формата import-schemas/v1 (schemaVersion 1, до 500 карточек,
            до 20 МиБ). Импортированные карточки становятся общими.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              disabled={importJson.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileJson className="size-3" />
              Выбрать файл…
            </Button>
            {fileName ? (
              <span className="truncate text-xs text-muted-foreground">{fileName}</span>
            ) : null}
          </div>

          {issues.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive-foreground">
                Найдено ошибок: {issues.length}. Ни одна карточка не будет создана.
              </p>
              <ScrollArea className="max-h-48 rounded-md border border-border">
                <ul className="space-y-0.5 p-2">
                  {issues.map((issue, i) => (
                    <li key={i} className="text-[11px] text-destructive-foreground">
                      {issue.index >= 0 ? (
                        <>
                          <span className="font-medium">
                            Карточка #{issue.index + 1}
                          </span>
                          {issue.path !== "$" ? ` · ${issue.path}` : ""}: {issue.message}
                        </>
                      ) : (
                        <>
                          <span className="font-medium">Файл</span>
                          {issue.path !== "$" ? ` · ${issue.path}` : ""}: {issue.message}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : null}

          {json !== null && issues.length === 0 && importedCount === null ? (
            <p className="text-xs text-muted-foreground">
              Файл корректен. Карточек к импорту: {cardCount}.
            </p>
          ) : null}

          {importedCount !== null ? (
            <p className="text-xs font-medium text-primary">
              Импорт завершён: создано карточек {importedCount}.
            </p>
          ) : null}

          {serverError ? (
            <p className="whitespace-pre-wrap text-xs text-destructive-foreground">
              {serverError}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ui-hover h-7 text-xs"
            disabled={importJson.isPending}
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          <Button
            type="button"
            size="sm"
            className="ui-hover h-7 text-xs"
            disabled={!canImport}
            onClick={() => void runImport()}
          >
            {importJson.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            Импортировать
          </Button>
        </div>
    </DialogContent>
  );
}

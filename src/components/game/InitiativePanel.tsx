import { useEffect, useState } from "react";
import { Eraser, Save } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import type { InitiativeEntry, TokenDto } from "@/lib/game-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface InitiativePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokens: TokenDto[];
  initiative: InitiativeEntry[];
  isMaster: boolean;
}

export function InitiativePanel({
  open,
  onOpenChange,
  tokens,
  initiative,
  isMaster,
}: InitiativePanelProps) {
  // локальный ввод: tokenId -> строка (пустая = без инициативы)
  const [values, setValues] = useState<Record<number, string>>({});
  const setMutation = api.initiative.set.useMutation();

  useEffect(() => {
    if (!open) return;
    const next: Record<number, string> = {};
    for (const t of tokens) {
      const entry = initiative.find((e) => e.tokenId === t.id);
      next[t.id] = entry ? String(entry.value) : "";
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = tokens
    .map((t) => {
      const raw = values[t.id] ?? "";
      const parsed = raw.trim() === "" ? null : Number(raw);
      return { token: t, raw, value: parsed !== null && Number.isFinite(parsed) ? parsed : null };
    })
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.token.label.localeCompare(b.token.label);
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });

  const save = (entries: InitiativeEntry[]) => {
    setMutation.mutate(
      { entries },
      {
        onSuccess: () => {
          invalidateGameState();
          onOpenChange(false);
        },
        onError: (e) => toast.error(trpcErrorMessage(e, "Не удалось сохранить инициативу")),
      },
    );
  };

  const saveCurrent = () => {
    const entries: InitiativeEntry[] = [];
    for (const row of rows) {
      if (row.value !== null) entries.push({ tokenId: row.token.id, value: row.value });
    }
    save(entries);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Инициатива</DialogTitle>
          <DialogDescription className="text-xs">
            {isMaster
              ? "Ручной ввод значений. Пустое поле — токен вне порядка ходов."
              : "Порядок ходов на активном поле. Редактирует только мастер."}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            На поле нет токенов
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {rows.map(({ token, raw, value }) => (
              <div
                key={token.id}
                className="ui-hover flex items-center gap-2 rounded-sm border border-transparent px-2 py-1 hover:border-border hover:bg-accent/50"
              >
                <span className="w-10 text-right text-sm font-medium text-primary">
                  {value !== null ? value : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{token.label}</span>
                {isMaster ? (
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={raw}
                    placeholder="—"
                    onChange={(e) =>
                      setValues((s) => ({ ...s, [token.id]: e.target.value }))
                    }
                    className="ui-hover h-7 w-20 text-xs"
                    disabled={setMutation.isPending}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}

        {isMaster && rows.length > 0 ? (
          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="ui-hover h-8 gap-1.5 text-xs text-muted-foreground"
              disabled={setMutation.isPending}
              onClick={() => save([])}
              title="Очистить инициативу"
            >
              <Eraser className="size-3.5" /> Очистить
            </Button>
            <Button
              size="sm"
              className="ui-hover h-8 gap-1.5 text-xs"
              disabled={setMutation.isPending}
              onClick={saveCurrent}
            >
              <Save className="size-3.5" /> Сохранить
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

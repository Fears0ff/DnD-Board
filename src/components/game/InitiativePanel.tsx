import { useEffect, useRef, useState } from "react";
import { Eraser, ListOrdered, Save, X } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import type { InitiativeEntry, TokenDto } from "@/lib/game-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 480;
const WIDTH_STORAGE_KEY = "dnd-board.initiative-width";

function clampWidth(value: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, value));
}

function initialWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : 280;
  } catch {
    return 280;
  }
}

interface InitiativePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: number;
  boardName: string;
  tokens: TokenDto[];
  initiative: InitiativeEntry[];
  isMaster: boolean;
}

export function InitiativePanel({
  open,
  onOpenChange,
  boardId,
  boardName,
  tokens,
  initiative,
  isMaster,
}: InitiativePanelProps) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [width, setWidth] = useState(initialWidth);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const setMutation = api.initiative.set.useMutation();

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Размер панели сохраняется только как локальная настройка браузера.
    }
  }, [width]);

  useEffect(() => {
    if (!open) return;
    const next: Record<number, string> = {};
    for (const token of tokens) {
      const entry = initiative.find((item) => item.tokenId === token.id);
      next[token.id] = entry ? String(entry.value) : "";
    }
    setValues(next);
    // При смене поля ввод обязан переключиться на его собственную инициативу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  if (!open) return null;

  const rows = tokens
    .map((token) => {
      const raw = values[token.id] ?? (() => {
        const entry = initiative.find((item) => item.tokenId === token.id);
        return entry ? String(entry.value) : "";
      })();
      const parsed = raw.trim() === "" ? null : Number(raw);
      return { token, raw, value: parsed !== null && Number.isFinite(parsed) ? parsed : null };
    })
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.token.label.localeCompare(b.token.label);
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });

  const save = (entries: InitiativeEntry[]) => {
    setMutation.mutate(
      { entries, boardId },
      {
        onSuccess: () => invalidateGameState(),
        onError: (error) => toast.error(trpcErrorMessage(error, "Не удалось сохранить инициативу")),
      },
    );
  };

  const saveCurrent = () => {
    save(rows.filter((row) => row.value !== null).map((row) => ({
      tokenId: row.token.id,
      value: row.value!,
    })));
  };

  return (
    <aside
      data-testid="initiative-panel"
      className="relative flex h-full min-h-0 max-w-[85vw] shrink-0 flex-col border-r bg-card/85 shadow-[6px_0_24px_rgba(0,0,0,0.18)] backdrop-blur-md"
      style={{ width }}
      aria-label={`Инициатива поля ${boardName}`}
    >
      <div className="flex items-start gap-2 border-b px-3 py-3">
        <ListOrdered className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Инициатива</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={boardName}>
            {boardName}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ui-hover size-7 p-0"
          onClick={() => onOpenChange(false)}
          aria-label="Скрыть инициативу"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <p className="border-b px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {isMaster
          ? "Ручной ввод. Пустое поле исключает токен из порядка ходов."
          : "Порядок ходов активного поля. Редактирует только мастер."}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">На поле нет токенов</p>
        ) : (
          <div className="space-y-1">
            {rows.map(({ token, raw, value }) => (
              <div
                key={token.id}
                className="ui-hover flex items-center gap-2 rounded-sm border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/50"
              >
                <span className="w-9 text-right text-sm font-semibold text-primary">
                  {value ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs" title={token.label}>
                  {token.label}
                </span>
                {isMaster ? (
                  <Input
                    type="number"
                    inputMode="numeric"
                    aria-label={`Инициатива: ${token.label}`}
                    value={raw}
                    placeholder="—"
                    onChange={(event) =>
                      setValues((state) => ({ ...state, [token.id]: event.target.value }))
                    }
                    className="ui-hover h-8 w-20 text-xs"
                    disabled={setMutation.isPending}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {isMaster && rows.length > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="ui-hover h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            disabled={setMutation.isPending}
            onClick={() => save([])}
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
        </div>
      ) : null}

      <div
        role="separator"
        aria-label="Ширина панели инициативы"
        aria-orientation="vertical"
        aria-valuemin={MIN_PANEL_WIDTH}
        aria-valuemax={MAX_PANEL_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        data-testid="initiative-resizer"
        className="absolute -right-2.5 top-0 z-20 h-full w-5 cursor-col-resize touch-none outline-none after:absolute after:left-2 after:top-0 after:h-full after:w-px after:bg-border after:transition-colors hover:after:bg-primary focus-visible:after:bg-primary"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          setWidth(clampWidth(resize.startWidth + event.clientX - resize.startX));
        }}
        onPointerUp={(event) => {
          if (resizeRef.current?.pointerId !== event.pointerId) return;
          resizeRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { resizeRef.current = null; }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setWidth((current) => clampWidth(current + (event.key === "ArrowRight" ? 16 : -16)));
          }
        }}
      />
    </aside>
  );
}

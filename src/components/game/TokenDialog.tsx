import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import {
  TOKEN_KIND_LABELS,
  type BoardDto,
  type TokenDto,
  type TokenKind,
} from "@/lib/game-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TokenDialogState =
  | { mode: "add" }
  | { mode: "edit"; token: TokenDto }
  | null;

interface TokenDialogProps {
  state: Exclude<TokenDialogState, null>;
  board: BoardDto;
  onClose: () => void;
}

export function TokenDialog({ state, board, onClose }: TokenDialogProps) {
  const isEdit = state.mode === "edit";
  const token = isEdit ? state.token : null;

  const [label, setLabel] = useState(token?.label ?? "");
  const [kind, setKind] = useState<TokenKind>(token?.kind ?? "hero");
  const [ownerId, setOwnerId] = useState<string>(token?.ownerId != null ? String(token.ownerId) : "none");
  const [hp, setHp] = useState(token?.hp ?? 10);
  const [maxHp, setMaxHp] = useState(token?.maxHp ?? 10);
  const [size, setSize] = useState(token?.size ?? 1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // сброс локального состояния при смене редактируемого токена
  useEffect(() => {
    setLabel(token?.label ?? "");
    setKind(token?.kind ?? "hero");
    setOwnerId(token?.ownerId != null ? String(token.ownerId) : "none");
    setHp(token?.hp ?? 10);
    setMaxHp(token?.maxHp ?? 10);
    setSize(token?.size ?? 1);
    setConfirmDelete(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const usersQuery = api.users.list.useQuery(undefined, { enabled: true, retry: 1 });
  const addMutation = api.tokens.add.useMutation();
  const updateMutation = api.tokens.update.useMutation();
  const removeMutation = api.tokens.remove.useMutation();
  const pending = addMutation.isPending || updateMutation.isPending || removeMutation.isPending;

  const clampHp = (value: number, max: number) => Math.max(0, Math.min(max, value));

  const submit = () => {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Введите имя токена");
      return;
    }
    const safeMax = Math.max(0, Math.floor(maxHp));
    const safeHp = clampHp(Math.floor(hp), safeMax);
    const safeSize = Math.max(1, Math.floor(size));
    const owner = ownerId === "none" ? null : Number(ownerId);

    if (isEdit && token) {
      updateMutation.mutate(
        { id: token.id, label: trimmed, kind, ownerId: owner, hp: safeHp, maxHp: safeMax, size: safeSize },
        {
          onSuccess: () => { invalidateGameState(); onClose(); },
          onError: (e) => setError(trpcErrorMessage(e, "Не удалось сохранить токен")),
        },
      );
    } else {
      addMutation.mutate(
        {
          label: trimmed,
          kind,
          ownerId: owner,
          hp: safeHp,
          maxHp: safeMax,
          size: safeSize,
          // новый токен появляется в центре активного поля
          cellX: Math.max(0, Math.floor((board.gridWidth - safeSize) / 2)),
          cellY: Math.max(0, Math.floor((board.gridHeight - safeSize) / 2)),
        },
        {
          onSuccess: () => { invalidateGameState(); onClose(); },
          onError: (e) => setError(trpcErrorMessage(e, "Не удалось создать токен")),
        },
      );
    }
  };

  const remove = () => {
    if (!token) return;
    removeMutation.mutate(
      { id: token.id },
      {
        onSuccess: () => {
          toast.success(`Токен «${token.label}» удалён`);
          invalidateGameState();
          onClose();
        },
        onError: (e) => setError(trpcErrorMessage(e, "Не удалось удалить токен")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEdit ? `Токен «${token?.label}»` : "Новый токен"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit ? "Изменение параметров токена." : "Токен появится в центре активного поля."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="token-label" className="text-xs">Имя</Label>
            <Input
              id="token-label"
              value={label}
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="ui-hover h-8 text-sm"
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TokenKind)} disabled={pending}>
                <SelectTrigger className="ui-hover h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TOKEN_KIND_LABELS) as TokenKind[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {TOKEN_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Владелец</Label>
              <Select value={ownerId} onValueChange={setOwnerId} disabled={pending}>
                <SelectTrigger className="ui-hover h-8 text-xs">
                  <SelectValue placeholder="Нет" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Нет</SelectItem>
                  {(usersQuery.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={String(u.id)} className="text-xs">
                      {u.displayName || u.login}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">HP</Label>
              <span className="text-xs text-muted-foreground">{Math.max(0, Math.min(maxHp, hp))} / {maxHp}</span>
            </div>
            <Slider
              value={[clampHp(hp, maxHp)]}
              min={0}
              max={Math.max(1, maxHp)}
              step={1}
              onValueChange={([v]) => setHp(v)}
              disabled={pending || maxHp <= 0}
            />
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="token-hp" className="text-[11px] text-muted-foreground">HP</Label>
                <Input
                  id="token-hp"
                  type="number"
                  min={0}
                  max={maxHp}
                  value={hp}
                  onChange={(e) => setHp(clampHp(Number(e.target.value) || 0, maxHp))}
                  className="ui-hover h-8 text-sm"
                  disabled={pending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="token-maxhp" className="text-[11px] text-muted-foreground">Max HP</Label>
                <Input
                  id="token-maxhp"
                  type="number"
                  min={0}
                  value={maxHp}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0);
                    setMaxHp(v);
                    setHp((h) => clampHp(h, v));
                  }}
                  className="ui-hover h-8 text-sm"
                  disabled={pending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="token-size" className="text-[11px] text-muted-foreground">Размер, кл.</Label>
                <Input
                  id="token-size"
                  type="number"
                  min={1}
                  max={10}
                  value={size}
                  onChange={(e) => setSize(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="ui-hover h-8 text-sm"
                  disabled={pending}
                />
              </div>
            </div>
          </div>

          {error ? (
            <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {isEdit ? (
            confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="destructive"
                  size="sm"
                  className="ui-hover h-8 text-xs"
                  onClick={remove}
                  disabled={pending}
                >
                  Точно удалить
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ui-hover h-8 text-xs"
                  onClick={() => setConfirmDelete(false)}
                  disabled={pending}
                >
                  Отмена
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="ui-hover h-8 gap-1.5 text-xs text-destructive-foreground"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
              >
                <Trash2 className="size-3.5" /> Удалить
              </Button>
            )
          ) : (
            <span />
          )}
          <Button size="sm" className="ui-hover h-8 text-xs" onClick={submit} disabled={pending}>
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

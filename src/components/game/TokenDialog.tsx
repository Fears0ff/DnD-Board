import { useEffect, useState, type FormEvent } from "react";
import { api, trpcErrorMessage } from "@/lib/api";
import type {
  TokenAddInput,
  TokenDto,
  TokenKind,
  TokenUpdateInput,
} from "@/lib/game-contract";
import { TOKEN_KIND_LABELS } from "@/lib/game-contract";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TokenDialogProps {
  mode: "add" | "edit";
  token: TokenDto | null;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: TokenAddInput | (TokenUpdateInput & { id: number })) => void;
}

export function TokenDialog({
  mode,
  token,
  open,
  pending,
  onClose,
  onSubmit,
}: TokenDialogProps) {
  const [kind, setKind] = useState<TokenKind>("hero");
  const [label, setLabel] = useState("");
  const [hp, setHp] = useState("1");
  const [maxHp, setMaxHp] = useState("1");
  const [size, setSize] = useState("1");
  const [ownerId, setOwnerId] = useState<string>("none");
  const [error, setError] = useState<string | null>(null);

  // Owners list is master-only by API; the dialog itself is master-only.
  const usersQuery = api.users.list.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const users = usersQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && token) {
      setKind(token.kind);
      setLabel(token.label);
      setHp(String(token.hp));
      setMaxHp(String(token.maxHp));
      setSize(String(token.size));
      setOwnerId(token.ownerId !== null ? String(token.ownerId) : "none");
    } else {
      setKind("hero");
      setLabel("");
      setHp("1");
      setMaxHp("1");
      setSize("1");
      setOwnerId("none");
    }
  }, [open, mode, token]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Введите имя токена");
      return;
    }
    const hpNum = Number(hp);
    const maxHpNum = Number(maxHp);
    const sizeNum = Number(size);
    if (!Number.isInteger(hpNum) || hpNum < 0) {
      setError("HP — целое число не меньше 0");
      return;
    }
    if (!Number.isInteger(maxHpNum) || maxHpNum < 1) {
      setError("Макс. HP — целое число не меньше 1");
      return;
    }
    if (hpNum > maxHpNum) {
      setError("HP не может быть больше максимума");
      return;
    }
    if (!Number.isFinite(sizeNum) || sizeNum < 0.5 || sizeNum > 10) {
      setError("Размер — от 0.5 до 10 клеток");
      return;
    }
    const owner = ownerId === "none" ? null : Number(ownerId);

    if (mode === "edit" && token) {
      const values: TokenUpdateInput & { id: number } = {
        id: token.id,
        label: trimmed,
        kind,
        ownerId: owner,
        hp: hpNum,
        maxHp: maxHpNum,
        size: sizeNum,
      };
      onSubmit(values);
    } else {
      const values: TokenAddInput = {
        kind,
        label: trimmed,
        ownerId: owner,
        hp: hpNum,
        maxHp: maxHpNum,
        size: sizeNum,
      };
      onSubmit(values);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md" data-testid="token-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Править токен" : "Новый токен"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Изменения увидят все за столом."
              : "Токен появится в левом верхнем углу активной доски."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as TokenKind)}>
                <SelectTrigger className="ui-hover w-full" data-testid="token-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TOKEN_KIND_LABELS) as TokenKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TOKEN_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Владелец</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="ui-hover w-full" data-testid="token-owner">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без владельца</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="token-label" className="text-xs">Имя</Label>
            <Input
              id="token-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="ui-hover h-9 text-sm"
              placeholder="Имя"
              autoFocus
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="token-hp" className="text-xs">HP</Label>
              <Input
                id="token-hp"
                inputMode="numeric"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
                className="ui-hover h-9 text-sm"
                data-testid="token-hp"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-maxhp" className="text-xs">Макс. HP</Label>
              <Input
                id="token-maxhp"
                inputMode="numeric"
                value={maxHp}
                onChange={(e) => setMaxHp(e.target.value)}
                className="ui-hover h-9 text-sm"
                data-testid="token-maxhp"
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token-size" className="text-xs">Размер</Label>
              <Input
                id="token-size"
                inputMode="decimal"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="ui-hover h-9 text-sm"
                data-testid="token-size"
                disabled={pending}
              />
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {usersQuery.isError ? (
            <p className="text-[11px] text-muted-foreground">
              {trpcErrorMessage(usersQuery.error, "Список игроков недоступен")}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ui-hover"
              onClick={onClose}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" size="sm" className="ui-hover" disabled={pending}>
              {mode === "edit" ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

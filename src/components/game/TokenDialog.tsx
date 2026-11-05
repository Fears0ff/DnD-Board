import { useEffect, useRef, useState } from "react";
import { EyeOff, ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import {
  IMAGE_ACCEPT_ATTR,
  boardImageUrl,
  fileToBase64,
  mediaApi,
  validatePickedImage,
} from "@/lib/media";
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
import { Switch } from "@/components/ui/switch";
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
  const [characterId, setCharacterId] = useState<string>(
    token?.characterId != null ? String(token.characterId) : "none",
  );
  const [compendiumId, setCompendiumId] = useState<string>(
    token?.compendiumId != null ? String(token.compendiumId) : "none",
  );
  const [hp, setHp] = useState(token?.hp ?? 10);
  const [maxHp, setMaxHp] = useState(token?.maxHp ?? 10);
  const [size, setSize] = useState(token?.size ?? 1);
  const [invisible, setInvisible] = useState(token?.invisible ?? false);
  const [imageKey, setImageKey] = useState<string | null>(
    token?.compendiumId != null ? null : token?.imageKey ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // сброс локального состояния при смене редактируемого токена
  useEffect(() => {
    setLabel(token?.label ?? "");
    setKind(token?.kind ?? "hero");
    setOwnerId(token?.ownerId != null ? String(token.ownerId) : "none");
    setCharacterId(token?.characterId != null ? String(token.characterId) : "none");
    setCompendiumId(token?.compendiumId != null ? String(token.compendiumId) : "none");
    setHp(token?.hp ?? 10);
    setMaxHp(token?.maxHp ?? 10);
    setSize(token?.size ?? 1);
    setInvisible(token?.invisible ?? false);
    setImageKey(token?.compendiumId != null ? null : token?.imageKey ?? null);
    setUploading(false);
    setConfirmDelete(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const usersQuery = api.users.list.useQuery(undefined, { enabled: true, retry: 1 });
  const charactersQuery = api.characters.list.useQuery(undefined, {
    enabled: kind === "hero",
    retry: 1,
  });
  const monstersQuery = api.compendium.list.useQuery(
    { type: "monster" },
    { enabled: kind === "monster", retry: 1 },
  );
  const selectedCharacterId = characterId === "none" ? 0 : Number(characterId);
  const heroDetailQuery = api.characters.get.useQuery(
    { id: selectedCharacterId },
    {
      enabled: kind === "hero" && selectedCharacterId > 0,
      retry: 1,
    },
  );

  // Подтягиваем HP только для НОВОЙ привязки. Открытие редактора или refetch
  // уже привязанного листа не должен перезаписывать ручные HP токена.
  useEffect(() => {
    const character = heroDetailQuery.data;
    if (
      kind !== "hero" ||
      selectedCharacterId <= 0 ||
      token?.characterId === selectedCharacterId ||
      character?.id !== selectedCharacterId
    ) {
      return;
    }
    const fullHp = character.data.vitals.maxHp;
    setMaxHp(fullHp);
    setHp(fullHp);
    setOwnerId(String(character.ownerId));
    setLabel((current) => current.trim() ? current : character.name);
  }, [heroDetailQuery.data, kind, selectedCharacterId, token?.characterId]);

  const addMutation = api.tokens.add.useMutation();
  const updateMutation = api.tokens.update.useMutation();
  const removeMutation = api.tokens.remove.useMutation();
  const uploadMutation = mediaApi.uploadImage.useMutation();
  const pending =
    addMutation.isPending ||
    updateMutation.isPending ||
    removeMutation.isPending ||
    uploadMutation.isPending ||
    uploading;
  const selectedMonsterId = compendiumId === "none" ? 0 : Number(compendiumId);
  const selectedMonster = (monstersQuery.data?.items ?? []).find(
    (card) => card.id === selectedMonsterId,
  );
  const displayImageKey =
    selectedMonsterId > 0
      ? selectedMonster?.imageKey ??
        (token?.compendiumId === selectedMonsterId ? token.imageKey : null)
      : imageKey;

  const changeKind = (next: TokenKind) => {
    if (next === kind) return;
    setKind(next);
    setCharacterId("none");
    setCompendiumId("none");
    if (selectedMonsterId > 0) setImageKey(null);
  };

  const selectCharacter = (value: string) => {
    setCharacterId(value);
    setCompendiumId("none");
    if (value === "none") return;
    if (token?.characterId === Number(value)) {
      setHp(token.hp ?? 0);
      setMaxHp(token.maxHp ?? 0);
      setOwnerId(token.ownerId != null ? String(token.ownerId) : "none");
      return;
    }
    const character = (charactersQuery.data ?? []).find(
      (item) => item.id === Number(value),
    );
    if (character) setOwnerId(String(character.ownerId));
  };

  const selectMonster = (value: string) => {
    setCompendiumId(value);
    setCharacterId("none");
    setImageKey(null);
    if (value === "none") return;
    const monster = (monstersQuery.data?.items ?? []).find(
      (card) => card.id === Number(value),
    );
    if (!monster || monster.type !== "monster") return;
    // Возврат к исходной привязке отменяет временный выбор другой карточки.
    if (token?.compendiumId === monster.id) {
      setHp(token.hp ?? 0);
      setMaxHp(token.maxHp ?? 0);
      return;
    }
    const fullHp =
      "hitPoints" in monster.data && typeof monster.data.hitPoints === "number"
        ? monster.data.hitPoints
        : 0;
    setMaxHp(fullHp);
    setHp(fullHp);
    setLabel((current) => current.trim() ? current : monster.name);
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    const problem = validatePickedImage(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const asset = await uploadMutation.mutateAsync({ dataBase64, purpose: "token" });
      setImageKey(asset.key);
    } catch (e) {
      setError(trpcErrorMessage(e, "Не удалось загрузить изображение"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
    const linkedCharacterId =
      kind === "hero" && characterId !== "none" ? Number(characterId) : null;
    const linkedCompendiumId =
      kind === "monster" && compendiumId !== "none" ? Number(compendiumId) : null;
    const linkedImageKey = linkedCompendiumId !== null ? null : imageKey;

    if (isEdit && token) {
      updateMutation.mutate(
        {
          id: token.id,
          label: trimmed,
          kind,
          ownerId: owner,
          characterId: linkedCharacterId,
          compendiumId: linkedCompendiumId,
          hp: safeHp,
          maxHp: safeMax,
          size: safeSize,
          invisible,
          imageKey: linkedImageKey,
        },
        {
          onSuccess: () => { invalidateGameState(); onClose(); },
          onError: (e) => setError(trpcErrorMessage(e, "Не удалось сохранить токен")),
        },
      );
    } else {
      addMutation.mutate(
        {
          boardId: board.id,
          label: trimmed,
          kind,
          ownerId: owner,
          characterId: linkedCharacterId,
          compendiumId: linkedCompendiumId,
          hp: safeHp,
          maxHp: safeMax,
          size: safeSize,
          imageKey: linkedImageKey ?? undefined,
          // новый токен появляется в центре просматриваемого поля
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEdit ? `Токен «${token?.label}»` : "Новый токен"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEdit ? "Изменение параметров токена." : `Токен появится в центре поля «${board.name}».`}
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
              <Select value={kind} onValueChange={(v) => changeKind(v as TokenKind)} disabled={pending}>
                <SelectTrigger className="ui-hover h-8 text-xs" aria-label="Тип токена">
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
              <Label className="text-xs">
                {characterId !== "none" && kind === "hero" ? "Владелец (из листа)" : "Владелец"}
              </Label>
              <Select
                value={ownerId}
                onValueChange={setOwnerId}
                disabled={pending || (kind === "hero" && characterId !== "none")}
              >
                <SelectTrigger className="ui-hover h-8 text-xs" aria-label="Владелец токена">
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

          {kind === "hero" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Лист героя</Label>
              <Select value={characterId} onValueChange={selectCharacter} disabled={pending}>
                <SelectTrigger className="ui-hover h-8 w-full text-xs" aria-label="Лист героя">
                  <SelectValue placeholder="Без привязки" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Без привязки</SelectItem>
                  {(charactersQuery.data ?? []).map((character) => {
                    const owner = (usersQuery.data ?? []).find(
                      (user) => user.id === character.ownerId,
                    );
                    return (
                      <SelectItem
                        key={character.id}
                        value={String(character.id)}
                        className="text-xs"
                      >
                        {character.name} — {owner?.displayName || owner?.login || `игрок #${character.ownerId}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {charactersQuery.isLoading
                  ? "Загрузка листов…"
                  : charactersQuery.isError
                    ? "Не удалось загрузить листы персонажей."
                    : "При новой привязке владелец берётся из листа, а HP заполняется до максимума."}
              </p>
            </div>
          ) : null}

          {kind === "monster" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Карточка монстра</Label>
              <Select value={compendiumId} onValueChange={selectMonster} disabled={pending}>
                <SelectTrigger className="ui-hover h-8 w-full text-xs" aria-label="Карточка монстра">
                  <SelectValue placeholder="Без привязки" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Без привязки</SelectItem>
                  {(monstersQuery.data?.items ?? []).map((monster) => (
                    <SelectItem
                      key={monster.id}
                      value={String(monster.id)}
                      className="text-xs"
                    >
                      {monster.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {monstersQuery.isLoading
                  ? "Загрузка монстров…"
                  : monstersQuery.isError
                    ? "Не удалось загрузить карточки монстров."
                    : "При новой привязке HP заполняется до максимума; изображение берётся из карточки."}
              </p>
            </div>
          ) : null}

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

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <EyeOff className="size-4 text-muted-foreground" />
              <div>
                <Label htmlFor="token-invisible" className="text-xs">Невидимый для игроков</Label>
                <p className="text-[11px] text-muted-foreground">Мастер продолжает видеть и редактировать токен.</p>
              </div>
            </div>
            <Switch
              id="token-invisible"
              checked={invisible}
              onCheckedChange={setInvisible}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Изображение</Label>
            <div className="flex items-center gap-2.5">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
                {displayImageKey ? (
                  <img
                    src={boardImageUrl(displayImageKey)}
                    alt="Изображение токена"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-semibold text-muted-foreground">
                    {(label.trim().slice(0, 2) || "?").toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ui-hover h-8 gap-1.5 text-xs"
                  disabled={pending || selectedMonsterId > 0}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="size-3.5" />
                  {uploading || uploadMutation.isPending
                    ? "Загрузка…"
                    : imageKey
                      ? "Заменить"
                      : "Загрузить"}
                </Button>
                {imageKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ui-hover h-8 gap-1.5 text-xs text-muted-foreground"
                    disabled={pending}
                    onClick={() => setImageKey(null)}
                  >
                    <X className="size-3.5" /> Убрать
                  </Button>
                ) : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                className="hidden"
                onChange={(e) => void pickImage(e.target.files?.[0])}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {selectedMonsterId > 0
                ? "Для привязанного монстра используется изображение его карточки."
                : "PNG, JPEG или WebP до 15 МиБ."}
            </p>
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

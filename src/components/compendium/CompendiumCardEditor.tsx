import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { trpcErrorMessage } from "@/lib/api";
import { boardImageUrl } from "@/lib/media";
import { IMAGE_ACCEPT_ATTR } from "@/lib/media";
import type { CompendiumType, Visibility } from "@contracts/constants";
import { compendiumTypes } from "@contracts/constants";
import type { CompendiumCardDto } from "@contracts/compendium";
import {
  useCompendiumImageUpload,
  useCompendiumMutations,
} from "@/hooks/useCompendium";
import { emptyCardData, validateCardData } from "./compendiumSchema";
import { CompendiumFieldEditor } from "./CompendiumFieldEditor";
import { COMPENDIUM_TYPE_LABELS } from "./compendiumLabels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

/**
 * Диалог создания/редактирования карточки компедиума (только мастер —
 * права дополнительно проверяются сервером). Поля данных строятся из
 * compendiumEditorMeta, валидация — той же Zod-схемой, что на сервере.
 */
export function CompendiumCardEditor({
  open,
  onOpenChange,
  card,
  initialType = "item",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null — создание новой карточки. */
  card: CompendiumCardDto | null;
  initialType?: CompendiumType;
}) {
  // Тело монтируется только при открытом диалоге: начальные значения формы
  // берутся из props при монтировании, сброс через эффекты не нужен.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CompendiumCardEditorBody
          card={card}
          initialType={initialType}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function CompendiumCardEditorBody({
  card,
  initialType,
  onOpenChange,
}: {
  card: CompendiumCardDto | null;
  initialType: CompendiumType;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = card !== null;
  const [type, setType] = useState<CompendiumType>(card?.type ?? initialType);
  const [name, setName] = useState(card?.name ?? "");
  const [source, setSource] = useState(card?.source ?? "");
  const [isMagic, setIsMagic] = useState(card?.isMagic ?? false);
  const [visibility, setVisibility] = useState<Visibility>(card?.visibility ?? "private");
  const [imageKey, setImageKey] = useState<string | null>(card?.imageKey ?? null);
  const [data, setData] = useState<Record<string, unknown>>(() =>
    card
      ? ({ ...(card.data as Record<string, unknown>) } as Record<string, unknown>)
      : (emptyCardData(initialType) as Record<string, unknown>),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutations = useCompendiumMutations();
  const imageUpload = useCompendiumImageUpload();
  const pending =
    mutations.create.isPending || mutations.update.isPending || imageUpload.isPending;

  const changeType = (next: CompendiumType) => {
    setType(next);
    setData(emptyCardData(next));
    setFieldErrors({});
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    const key = await imageUpload.upload(file, card?.id);
    if (key) setImageKey(key);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("Укажите название карточки");
      return;
    }
    const check = validateCardData(type, data);
    if (!check.ok) {
      setFieldErrors(check.fieldErrors);
      setFormError("Проверьте выделенные поля карточки");
      return;
    }
    setFieldErrors({});
    try {
      if (editing) {
        await mutations.update.mutateAsync({
          id: card.id,
          name: trimmedName,
          source: source.trim(),
          isMagic,
          visibility,
          imageKey,
          data: check.data,
        });
        toast.success("Карточка сохранена");
      } else {
        await mutations.create.mutateAsync({
          type,
          name: trimmedName,
          source: source.trim(),
          isMagic,
          visibility,
          imageKey: imageKey ?? undefined,
          data: check.data,
        } as Parameters<typeof mutations.create.mutateAsync>[0]);
        toast.success("Карточка создана");
      }
      onOpenChange(false);
    } catch (e) {
      setFormError(trpcErrorMessage(e, "Не удалось сохранить карточку"));
    }
  };

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
          <DialogTitle className="text-sm">
            {editing ? "Редактирование карточки" : "Новая карточка компедиума"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {editing
              ? `Тип: ${COMPENDIUM_TYPE_LABELS[type]}. Изменения видны согласно видимости карточки.`
              : "Тип карточки нельзя изменить после создания."}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-3">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">
                  Название <span className="text-destructive-foreground">*</span>
                </Label>
                <Input
                  className="h-7 text-xs"
                  value={name}
                  disabled={pending}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Тип</Label>
                <Select
                  value={type}
                  disabled={pending || editing}
                  onValueChange={(v) => changeType(v as CompendiumType)}
                >
                  <SelectTrigger className="ui-hover h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {compendiumTypes.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {COMPENDIUM_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Источник</Label>
                <Input
                  className="h-7 text-xs"
                  placeholder="Например: PHB 2024"
                  value={source}
                  disabled={pending}
                  onChange={(e) => setSource(e.target.value)}
                />
              </div>
              <div className="flex items-end justify-between gap-3 pb-0.5">
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={isMagic}
                    disabled={pending}
                    onCheckedChange={setIsMagic}
                  />
                  Магическая
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={visibility === "shared"}
                    disabled={pending}
                    onCheckedChange={(v) => setVisibility(v ? "shared" : "private")}
                  />
                  {visibility === "shared" ? "Общая" : "Приватная"}
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Изображение</Label>
              <div className="flex items-center gap-2">
                {imageKey ? (
                  <img
                    src={boardImageUrl(imageKey)}
                    alt=""
                    className="size-10 rounded border border-border object-cover"
                  />
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={IMAGE_ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => void pickImage(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ui-hover h-7 text-xs"
                  disabled={pending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imageUpload.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ImagePlus className="size-3" />
                  )}
                  {imageKey ? "Заменить" : "Загрузить"}
                </Button>
                {imageKey ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ui-hover h-7 text-xs"
                    disabled={pending}
                    onClick={() => setImageKey(null)}
                  >
                    <X className="size-3" />
                    Убрать
                  </Button>
                ) : null}
                {imageUpload.error ? (
                  <span className="text-[10px] text-destructive-foreground">
                    {imageUpload.error}
                  </span>
                ) : null}
              </div>
            </div>

            <CompendiumFieldEditor
              type={type}
              value={data}
              errors={fieldErrors}
              disabled={pending}
              onChange={setData}
            />

            {formError ? (
              <p className="text-xs text-destructive-foreground">{formError}</p>
            ) : null}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ui-hover h-7 text-xs"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            className="ui-hover h-7 text-xs"
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : null}
            {editing ? "Сохранить" : "Создать"}
          </Button>
        </div>
    </DialogContent>
  );
}

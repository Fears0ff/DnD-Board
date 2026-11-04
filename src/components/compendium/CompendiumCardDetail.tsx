import type { z } from "zod";
import type { CompendiumType } from "@contracts/constants";
import {
  compendiumCardSchemas,
  compendiumEditorMeta,
  type CompendiumCardDto,
  type CompendiumFieldMeta,
} from "@contracts/compendium";
import { useMarkdownPreview } from "@/hooks/useMarkdownPreview";
import { boardImageUrl } from "@/lib/media";
import { inspectCompendiumField } from "./compendiumSchema";
import {
  COMPENDIUM_NESTED_LABELS,
  COMPENDIUM_TYPE_LABELS,
  COMPENDIUM_VISIBILITY_LABELS,
  compendiumOptionLabel,
} from "./compendiumLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Pencil, Trash2 } from "lucide-react";

/** Просмотр карточки: значения рендерятся по compendiumEditorMeta + схеме. */

function MarkdownBlock({ text }: { text: string }) {
  const html = useMarkdownPreview(text);
  if (!text.trim()) return <span className="text-muted-foreground">—</span>;
  return (
    <div
      className="prose-xs max-w-none text-xs [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs"
      // Санитизировано DOMPurify в useMarkdownPreview.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ValueView({
  type,
  fieldKey,
  schema,
  widget,
  options,
  value,
}: {
  type: CompendiumType;
  fieldKey: string;
  schema: z.ZodType;
  widget: CompendiumFieldMeta["widget"];
  options?: string[];
  value: unknown;
}) {
  const info = inspectCompendiumField(schema);
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  switch (widget) {
    case "checkbox":
      return <span>{value === true ? "Да" : "Нет"}</span>;
    case "number":
      return <span>{String(value)}</span>;
    case "select":
      return (
        <span>
          {compendiumOptionLabel(type, fieldKey, String(value)) || String(value)}
        </span>
      );
    case "tags":
    case "list": {
      if (!Array.isArray(value) || value.length === 0) {
        return <span className="text-muted-foreground">—</span>;
      }
      const elInfo =
        info.kind === "array" && info.element
          ? inspectCompendiumField(info.element)
          : null;
      if (elInfo?.kind === "object") {
        return (
          <ul className="space-y-1.5">
            {(value as Record<string, unknown>[]).map((entry, i) => (
              <li key={i} className="rounded-md border border-border p-1.5">
                <p className="text-xs font-medium">{String(entry.name ?? `#${i + 1}`)}</p>
                {typeof entry.text === "string" && entry.text.trim() !== "" ? (
                  <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                    {entry.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        );
      }
      const opts = options ?? elInfo?.enumOptions;
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={String(v)} variant="secondary" className="px-1.5 text-[10px]">
              {opts ? compendiumOptionLabel(type, fieldKey, String(v)) : String(v)}
            </Badge>
          ))}
        </span>
      );
    }
    case "group": {
      if (info.kind !== "object" || !info.shape) return <span>{String(value)}</span>;
      const record = value as Record<string, unknown>;
      return (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {Object.entries(info.shape).map(([subKey]) => (
            <span key={subKey} className="text-xs">
              <span className="text-muted-foreground">
                {COMPENDIUM_NESTED_LABELS[subKey] ?? subKey}:
              </span>{" "}
              {String(record[subKey] ?? "—")}
            </span>
          ))}
        </span>
      );
    }
    case "markdown":
      return <MarkdownBlock text={String(value)} />;
    default:
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
}

export function CompendiumCardDetail({
  card,
  canManage,
  busy,
  onEdit,
  onCopy,
  onDelete,
  confirmDelete,
}: {
  card: CompendiumCardDto;
  /** Мастер: редактирование/удаление. */
  canManage: boolean;
  busy?: boolean;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  /** Двухшаговое подтверждение удаления управляется родителем. */
  confirmDelete?: boolean;
}) {
  const schema = compendiumCardSchemas[card.type];
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const data = (card.data ?? {}) as Record<string, unknown>;
  const isImported = card.createdBy === null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {card.imageKey ? (
            <img
              src={boardImageUrl(card.imageKey)}
              alt=""
              className="size-12 rounded border border-border object-cover"
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold leading-tight">{card.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {COMPENDIUM_TYPE_LABELS[card.type]}
              {card.source ? ` · ${card.source}` : ""}
              {card.isMagic ? " · магическая" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge
            variant={card.visibility === "shared" ? "default" : "secondary"}
            className="px-1.5 text-[10px]"
          >
            {COMPENDIUM_VISIBILITY_LABELS[card.visibility]}
          </Badge>
          {isImported ? (
            <span className="text-[10px] text-muted-foreground">импортирована</span>
          ) : null}
        </div>
      </div>

      {compendiumEditorMeta[card.type].map((meta) => {
        const fieldSchema = shape[meta.key] as z.ZodType | undefined;
        if (!fieldSchema) return null;
        return (
          <div key={meta.key} className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {meta.label}
            </p>
            <div className="text-xs">
              <ValueView
                type={card.type}
                fieldKey={meta.key}
                schema={fieldSchema}
                widget={meta.widget}
                options={meta.options}
                value={data[meta.key]}
              />
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2 border-t border-border pt-2">
        {canManage && onEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ui-hover h-7 text-xs"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil className="size-3" />
            Изменить
          </Button>
        ) : null}
        {onCopy ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ui-hover h-7 text-xs"
            disabled={busy}
            onClick={onCopy}
          >
            <Copy className="size-3" />
            Копировать
          </Button>
        ) : null}
        {canManage && onDelete ? (
          <Button
            type="button"
            size="sm"
            variant={confirmDelete ? "destructive" : "ghost"}
            className="ui-hover h-7 text-xs"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 className="size-3" />
            {confirmDelete ? "Подтвердить удаление" : "Удалить"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

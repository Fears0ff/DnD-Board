import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { z } from "zod";
import type { CompendiumType } from "@contracts/constants";
import {
  compendiumCardSchemas,
  compendiumEditorMeta,
  type CompendiumFieldMeta,
} from "@contracts/compendium";
import {
  defaultValueForField,
  inspectCompendiumField,
  type InspectedField,
} from "./compendiumSchema";
import { COMPENDIUM_NESTED_LABELS, compendiumOptionLabel } from "./compendiumLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Редактор данных карточки, управляемый схемой: поля, их виджеты и
 * обязательность берутся из compendiumEditorMeta + Zod-схемы
 * (compendiumCardSchemas), вложенные group/list редактируются рекурсивно.
 * Форма не содержит захардкоженных наборов полей под типы.
 */

export interface CompendiumFieldEditorProps {
  type: CompendiumType;
  value: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  /** Ошибки по ключам полей (из validateCardData). */
  errors?: Record<string, string>;
  disabled?: boolean;
}

interface ValueEditorProps {
  type: CompendiumType;
  fieldKey: string;
  schema: z.ZodType;
  widget: CompendiumFieldMeta["widget"];
  options?: string[];
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  compact?: boolean;
}

function nestedLabel(key: string): string {
  return COMPENDIUM_NESTED_LABELS[key] ?? key;
}

function NumberInput({
  value,
  onChange,
  disabled,
  isInt,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  isInt?: boolean;
}) {
  return (
    <Input
      type="number"
      className="h-7 text-xs"
      step={isInt === false ? "any" : 1}
      disabled={disabled}
      value={typeof value === "number" ? String(value) : ""}
      onChange={(e) => {
        if (e.target.value === "") {
          onChange(undefined);
          return;
        }
        const parsed = Number(e.target.value);
        onChange(Number.isNaN(parsed) ? undefined : parsed);
      }}
    />
  );
}

function TagsEditor({
  type,
  fieldKey,
  values,
  options,
  onChange,
  disabled,
}: {
  type: CompendiumType;
  fieldKey: string;
  values: string[];
  options?: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  };
  const remaining = (options ?? []).filter((o) => !values.includes(o));
  return (
    <div className="space-y-1.5">
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 px-1.5 text-[10px]">
              {options ? compendiumOptionLabel(type, fieldKey, v) : v}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Убрать ${v}`}
                  className="ui-hover rounded-full hover:text-destructive-foreground"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <X className="size-2.5" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
      {!disabled ? (
        options ? (
          remaining.length > 0 ? (
            <Select onValueChange={(v) => add(v)}>
              <SelectTrigger className="ui-hover h-7 text-xs">
                <SelectValue placeholder="Добавить значение…" />
              </SelectTrigger>
              <SelectContent>
                {remaining.map((o) => (
                  <SelectItem key={o} value={o} className="text-xs">
                    {compendiumOptionLabel(type, fieldKey, o)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        ) : (
          <div className="flex gap-1.5">
            <Input
              className="h-7 text-xs"
              placeholder="Новое значение…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(draft);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ui-hover h-7 text-xs"
              disabled={draft.trim() === ""}
              onClick={() => add(draft)}
            >
              <Plus className="size-3" />
              Добавить
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function ObjectArrayEditor({
  type,
  element,
  values,
  onChange,
  disabled,
}: {
  type: CompendiumType;
  element: z.ZodType;
  values: Record<string, unknown>[];
  onChange: (v: Record<string, unknown>[]) => void;
  disabled?: boolean;
}) {
  const info = inspectCompendiumField(element);
  if (info.kind !== "object" || !info.shape) {
    // Массив нестандартных элементов: редактируем как список строк.
    return (
      <TagsEditor
        type={type}
        fieldKey=""
        values={values.map((v) => String(v))}
        onChange={(next) => onChange(next as unknown as Record<string, unknown>[])}
        disabled={disabled}
      />
    );
  }
  const shape = info.shape;
  const addEntry = () => {
    onChange([...values, defaultValueForField(element) as Record<string, unknown>]);
  };
  return (
    <div className="space-y-2">
      {values.map((entry, index) => (
        <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Запись {index + 1}
            </span>
            {!disabled ? (
              <button
                type="button"
                aria-label={`Удалить запись ${index + 1}`}
                className="ui-hover rounded p-0.5 text-muted-foreground hover:text-destructive-foreground"
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          {Object.entries(shape).map(([subKey, subSchema]) => {
            const subInfo = inspectCompendiumField(subSchema as z.ZodType);
            return (
              <div key={subKey} className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  {nestedLabel(subKey)}
                </Label>
                <ValueEditor
                  type={type}
                  fieldKey={subKey}
                  schema={subSchema as z.ZodType}
                  widget={widgetFor(subInfo)}
                  value={entry[subKey]}
                  disabled={disabled}
                  compact
                  onChange={(v) => {
                    const next = values.slice();
                    next[index] = { ...entry, [subKey]: v };
                    onChange(next);
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
      {!disabled ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ui-hover h-7 text-xs"
          onClick={addEntry}
        >
          <Plus className="size-3" />
          Добавить запись
        </Button>
      ) : null}
    </div>
  );
}

function widgetFor(info: InspectedField): CompendiumFieldMeta["widget"] {
  switch (info.kind) {
    case "string":
      return (info.maxLength ?? 0) >= 500 ? "textarea" : "text";
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    case "enum":
      return "select";
    case "literalUnion":
      return "select";
    case "array":
      return "list";
    case "object":
      return "group";
    default:
      return "text";
  }
}

function ValueEditor({
  type,
  fieldKey,
  schema,
  widget,
  options,
  value,
  onChange,
  disabled,
  compact,
}: ValueEditorProps) {
  const info = inspectCompendiumField(schema);
  switch (widget) {
    case "checkbox":
      return (
        <Switch
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case "number":
      return (
        <NumberInput value={value} onChange={onChange} disabled={disabled} isInt={info.isInt} />
      );
    case "select": {
      if (info.kind === "literalUnion" && info.literalOptions) {
        const current = value === undefined || value === null ? undefined : String(value);
        return (
          <Select
            value={current}
            disabled={disabled}
            onValueChange={(v) => {
              const lit = info.literalOptions?.find((o) => String(o) === v);
              onChange(lit ?? v);
            }}
          >
            <SelectTrigger className="ui-hover h-7 text-xs">
              <SelectValue placeholder="Выберите…" />
            </SelectTrigger>
            <SelectContent>
              {info.literalOptions.map((o) => (
                <SelectItem key={String(o)} value={String(o)} className="text-xs">
                  {String(o)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      const enumOptions = options ?? info.enumOptions ?? [];
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="ui-hover h-7 text-xs">
            <SelectValue placeholder="Выберите…" />
          </SelectTrigger>
          <SelectContent>
            {enumOptions.map((o) => (
              <SelectItem key={o} value={o} className="text-xs">
                {compendiumOptionLabel(type, fieldKey, o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "tags":
      return (
        <TagsEditor
          type={type}
          fieldKey={fieldKey}
          values={Array.isArray(value) ? value.map(String) : []}
          options={options}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "list": {
      if (info.kind === "array" && info.element) {
        const elInfo = inspectCompendiumField(info.element);
        if (elInfo.kind === "object") {
          return (
            <ObjectArrayEditor
              type={type}
              element={info.element}
              values={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
              onChange={onChange}
              disabled={disabled}
            />
          );
        }
        if (elInfo.kind === "enum") {
          return (
            <TagsEditor
              type={type}
              fieldKey={fieldKey}
              values={Array.isArray(value) ? value.map(String) : []}
              options={elInfo.enumOptions}
              onChange={onChange}
              disabled={disabled}
            />
          );
        }
      }
      return (
        <TagsEditor
          type={type}
          fieldKey={fieldKey}
          values={Array.isArray(value) ? value.map(String) : []}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    case "group": {
      if (info.kind !== "object" || !info.shape) return null;
      const record = (value ?? {}) as Record<string, unknown>;
      const entries = Object.entries(info.shape);
      const allNumbers = entries.every(
        ([, s]) => inspectCompendiumField(s as z.ZodType).kind === "number",
      );
      return (
        <div
          className={cn(
            "rounded-md border border-border p-2",
            allNumbers ? "grid grid-cols-3 gap-1.5" : "space-y-1.5",
          )}
        >
          {entries.map(([subKey, subSchema]) => {
            const subInfo = inspectCompendiumField(subSchema as z.ZodType);
            return (
              <div key={subKey} className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  {nestedLabel(subKey)}
                </Label>
                <ValueEditor
                  type={type}
                  fieldKey={subKey}
                  schema={subSchema as z.ZodType}
                  widget={widgetFor(subInfo)}
                  value={record[subKey]}
                  disabled={disabled}
                  compact
                  onChange={(v) => onChange({ ...record, [subKey]: v })}
                />
              </div>
            );
          })}
        </div>
      );
    }
    case "textarea":
    case "markdown":
      return (
        <Textarea
          className={cn("text-xs", compact ? "min-h-14" : "min-h-24")}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          className="h-7 text-xs"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function CompendiumFieldEditor({
  type,
  value,
  onChange,
  errors,
  disabled,
}: CompendiumFieldEditorProps) {
  const schema = compendiumCardSchemas[type];
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  return (
    <div className="space-y-2.5">
      {compendiumEditorMeta[type].map((meta) => {
        const fieldSchema = shape[meta.key] as z.ZodType | undefined;
        if (!fieldSchema) return null;
        const error = errors?.[meta.key];
        return (
          <div key={meta.key} className="space-y-1">
            <div className="flex items-baseline gap-1.5">
              <Label className="text-xs">
                {meta.label}
                {meta.required ? <span className="text-destructive-foreground"> *</span> : null}
              </Label>
              {meta.hint ? (
                <span className="text-[10px] text-muted-foreground">{meta.hint}</span>
              ) : null}
            </div>
            <ValueEditor
              type={type}
              fieldKey={meta.key}
              schema={fieldSchema}
              widget={meta.widget}
              options={meta.options}
              value={value[meta.key]}
              disabled={disabled}
              onChange={(v) => onChange({ ...value, [meta.key]: v })}
            />
            {error ? (
              <p className="text-[10px] text-destructive-foreground">{error}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

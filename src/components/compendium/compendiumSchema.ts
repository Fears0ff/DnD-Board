import { z } from "zod";
import type { CompendiumType } from "@contracts/constants";
import { compendiumCardSchemas } from "@contracts/compendium";

/**
 * Лёгкая интроспекция Zod-схем карточек для UI: редактор и просмотр
 * рендерятся из compendiumEditorMeta + этих сведений, поэтому форма не
 * дублирует структуру контрактов (plan §9.1 — единый источник).
 */

export type CompendiumFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "literalUnion"
  | "array"
  | "object"
  | "unknown";

export interface InspectedField {
  kind: CompendiumFieldKind;
  /** Строковые значения опций для enum. */
  enumOptions?: string[];
  /** Литеральные значения опций (например, кость хитов 6/8/10/12). */
  literalOptions?: (string | number)[];
  /** Схема элемента массива. */
  element?: z.ZodType;
  /** Форма объекта. */
  shape?: z.ZodRawShape;
  maxLength?: number | null;
  isInt?: boolean;
}

/** Снимает optional/nullable/default/prefault/readonly-обёртки. */
export function unwrapCompendiumSchema(schema: z.ZodType): z.ZodType {
  let cur = schema;
  for (let i = 0; i < 12; i++) {
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault ||
      cur instanceof z.ZodReadonly
    ) {
      cur = cur.unwrap() as z.ZodType;
      continue;
    }
    const def = (cur as unknown as { _zod?: { def?: { type?: string; innerType?: z.ZodType } } })
      ._zod?.def;
    if (def && def.type === "prefault" && def.innerType) {
      cur = def.innerType;
      continue;
    }
    break;
  }
  return cur;
}

export function inspectCompendiumField(schema: z.ZodType): InspectedField {
  const core = unwrapCompendiumSchema(schema);
  if (core instanceof z.ZodString) {
    return { kind: "string", maxLength: core.maxLength };
  }
  if (core instanceof z.ZodNumber) {
    return { kind: "number", isInt: core.isInt };
  }
  if (core instanceof z.ZodBoolean) return { kind: "boolean" };
  if (core instanceof z.ZodEnum) {
    return { kind: "enum", enumOptions: core.options.map(String) };
  }
  if (core instanceof z.ZodLiteral) {
    return { kind: "literalUnion", literalOptions: [core.value as string | number] };
  }
  if (core instanceof z.ZodUnion) {
    const options = core.options as z.ZodType[];
    if (options.every((o) => o instanceof z.ZodLiteral)) {
      return {
        kind: "literalUnion",
        literalOptions: options.map((o) => (o as z.ZodLiteral).value as string | number),
      };
    }
    return { kind: "unknown" };
  }
  if (core instanceof z.ZodArray) {
    return { kind: "array", element: core.element as z.ZodType };
  }
  if (core instanceof z.ZodObject) {
    return { kind: "object", shape: core.shape };
  }
  return { kind: "unknown" };
}

/** Начальное значение поля: серверный дефолт, иначе разумный «пустой» каркас. */
export function defaultValueForField(schema: z.ZodType): unknown {
  const attempt = schema.safeParse(undefined);
  if (attempt.success) return attempt.data as unknown;
  const info = inspectCompendiumField(schema);
  switch (info.kind) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return info.enumOptions?.[0] ?? "";
    case "literalUnion":
      return info.literalOptions?.[0] ?? null;
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(info.shape ?? {})) {
        out[key] = defaultValueForField(sub as z.ZodType);
      }
      return out;
    }
    default:
      return null;
  }
}

/** Стартовый payload для новой карточки данного типа. */
export function emptyCardData(type: CompendiumType): Record<string, unknown> {
  return defaultValueForField(compendiumCardSchemas[type]) as Record<string, unknown>;
}

export interface CardDataValidationOk {
  ok: true;
  data: unknown;
}
export interface CardDataValidationFailed {
  ok: false;
  /** Ошибки по ключам полей верхнего уровня (для подсветки в форме). */
  fieldErrors: Record<string, string>;
}

/** Клиентская проверка данных карточки той же схемой, что и на сервере. */
export function validateCardData(
  type: CompendiumType,
  data: unknown,
): CardDataValidationOk | CardDataValidationFailed {
  const schema = compendiumCardSchemas[type];
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data as unknown };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const top = String(issue.path[0] ?? "$");
    if (!(top in fieldErrors)) {
      const nested = issue.path.slice(1).map(String).join(".");
      fieldErrors[top] = nested ? `${nested}: ${issue.message}` : issue.message;
    }
  }
  return { ok: false, fieldErrors };
}

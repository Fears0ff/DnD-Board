import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Подписанное поле листа: плотная сетка, мелкие подписи. */
export function SheetField({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
      ) : null}
      {children}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  className,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <SheetField label={label} className={className}>
      <Input
        className="ui-hover h-7 text-xs"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </SheetField>
  );
}

/**
 * Числовое поле с зажимом в допустимый диапазон контракта, чтобы черновик
 * листа не выходил за границы Zod-схемы даже во время набора.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  className,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  className?: string;
}) {
  return (
    <SheetField label={label} className={className}>
      <Input
        type="number"
        className="ui-hover h-7 text-xs"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = e.target.valueAsNumber;
          if (Number.isNaN(raw)) return;
          onChange(Math.min(max, Math.max(min, Math.trunc(raw))));
        }}
      />
    </SheetField>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
  className,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <SheetField label={label} className={className}>
      <Textarea
        className="ui-hover min-h-0 text-xs"
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </SheetField>
  );
}

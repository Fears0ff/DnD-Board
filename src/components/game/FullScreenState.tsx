import { Loader2, TriangleAlert, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FullScreenLoader({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function FullScreenError({
  title = "Не удалось загрузить данные",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {message ? (
          <p className="max-w-md text-xs text-muted-foreground">{message}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="ui-hover">
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

export function BrandMark({ className = "size-8" }: { className?: string }) {
  return <Dices className={`${className} text-primary`} />;
}

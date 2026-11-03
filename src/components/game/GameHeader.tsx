import { useState, type FormEvent } from "react";
import {
  Check,
  Layers,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Star,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, invalidateAuth, reportMutationError } from "@/lib/api";
import type { RealtimeStatus } from "@/lib/realtime";
import type { BoardDto, UserDto } from "@/lib/game-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { BrandMark } from "./FullScreenState";

interface GameHeaderProps {
  me: UserDto;
  boards: BoardDto[];
  activeBoard: BoardDto | null;
  wsStatus: RealtimeStatus;
  busy: boolean;
  onAddBoard?: (name: string) => void;
  onRenameBoard?: (id: number, name: string) => void;
  onRemoveBoard?: (id: number) => void;
  onSetActiveBoard?: (id: number) => void;
  onOpenUsers?: () => void;
}

function WsBadge({ status }: { status: RealtimeStatus }) {
  if (status === "open") {
    return (
      <Badge variant="secondary" className="gap-1 text-xs" data-testid="ws-status">
        <Wifi className="size-3 text-emerald-400" />
        онлайн
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-xs" data-testid="ws-status">
      <WifiOff className="size-3 text-amber-400" />
      {status === "connecting" ? "подключение…" : "офлайн (опрос)"}
    </Badge>
  );
}

export function GameHeader({
  me,
  boards,
  activeBoard,
  wsStatus,
  busy,
  onAddBoard,
  onRenameBoard,
  onRemoveBoard,
  onSetActiveBoard,
  onOpenUsers,
}: GameHeaderProps) {
  const [boardDialog, setBoardDialog] = useState<
    { mode: "add" } | { mode: "rename"; id: number; current: string } | null
  >(null);
  const [boardName, setBoardName] = useState("");
  const logout = api.auth.logout.useMutation({ onSuccess: invalidateAuth });
  const isMaster = me.gameRole === "master";

  const submitBoardDialog = (e: FormEvent) => {
    e.preventDefault();
    const name = boardName.trim();
    if (!name) return;
    if (boardDialog?.mode === "rename") {
      onRenameBoard?.(boardDialog.id, name);
    } else {
      onAddBoard?.(name);
    }
    setBoardDialog(null);
    setBoardName("");
  };

  return (
    <header
      className="flex h-12 items-center gap-3 border-b bg-card/60 px-3 backdrop-blur"
      data-testid="game-header"
    >
      <div className="flex items-center gap-2">
        <BrandMark className="size-5" />
        <span className="text-sm font-semibold tracking-wide">DnD Board</span>
      </div>

      {/* Board switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="ui-hover h-8 gap-1.5 text-xs" data-testid="boards-menu">
            <Layers className="size-3.5" />
            {activeBoard ? activeBoard.name : "Нет доски"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {boards.length === 0 ? (
            <DropdownMenuItem disabled>Досок пока нет</DropdownMenuItem>
          ) : (
            boards.map((b) => (
              <DropdownMenuItem
                key={b.id}
                onSelect={() => (isMaster ? onSetActiveBoard?.(b.id) : undefined)}
                className="flex items-center justify-between gap-2"
                data-testid={`board-item-${b.id}`}
              >
                <span className="truncate">{b.name}</span>
                <span className="flex items-center gap-1">
                  {b.isActive ? <Star className="size-3.5 text-primary" /> : null}
                  {isMaster ? (
                    <>
                      <button
                        type="button"
                        className="ui-hover rounded-sm p-0.5 hover:bg-accent"
                        aria-label={`Переименовать ${b.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setBoardName(b.name);
                          setBoardDialog({ mode: "rename", id: b.id, current: b.name });
                        }}
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        className="ui-hover rounded-sm p-0.5 hover:bg-destructive/20"
                        aria-label={`Удалить ${b.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (window.confirm(`Удалить доску «${b.name}» со всеми токенами?`)) {
                            onRemoveBoard?.(b.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))
          )}
          {isMaster ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setBoardName("");
                  setBoardDialog({ mode: "add" });
                }}
                data-testid="add-board"
              >
                <Plus className="size-3.5" />
                Новая доска
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}

      <div className="ml-auto flex items-center gap-2">
        <WsBadge status={wsStatus} />
        <Badge variant={isMaster ? "default" : "secondary"} className="text-xs">
          {isMaster ? "Мастер" : "Игрок"}
        </Badge>
        <span className="text-xs text-muted-foreground">{me.displayName}</span>
        {isMaster ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ui-hover"
            onClick={onOpenUsers}
            aria-label="Люди за столом"
            data-testid="users-button"
          >
            <Users className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ui-hover"
          onClick={() => logout.mutate()}
          aria-label="Выйти"
          data-testid="logout-button"
        >
          <LogOut className="size-4" />
        </Button>
      </div>

      {/* Add / rename board dialog */}
      <Dialog open={boardDialog !== null} onOpenChange={(o) => (!o ? setBoardDialog(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {boardDialog?.mode === "rename" ? "Переименовать доску" : "Новая доска"}
            </DialogTitle>
            <DialogDescription>
              {boardDialog?.mode === "rename"
                ? `Текущее имя: ${boardDialog.current}`
                : "Доска появится у всех участников."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitBoardDialog} className="space-y-3">
            <Input
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="Название доски"
              className="ui-hover h-9 text-sm"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ui-hover"
                onClick={() => setBoardDialog(null)}
              >
                Отмена
              </Button>
              <Button type="submit" size="sm" className="ui-hover" disabled={!boardName.trim()}>
                <Check className="size-4" />
                {boardDialog?.mode === "rename" ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  );
}

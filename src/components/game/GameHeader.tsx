import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Grid3x3,
  Image as ImageIcon,
  ImageOff,
  ListOrdered,
  LogOut,
  Map as MapIcon,
  Pencil,
  Plus,
  Trash2,
  Users as UsersIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/providers/trpc";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import {
  IMAGE_ACCEPT_ATTR,
  boardBackgroundApi,
  fileToBase64,
  mediaApi,
  validatePickedImage,
} from "@/lib/media";
import type { BoardDto, CampaignDto, UserDto } from "@/lib/game-contract";
import type { RealtimeStatus } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { BrandMark } from "./FullScreenState";
import { LibraryMenu } from "./LibraryMenu";
import { CampaignsMenu } from "./CampaignsMenu";

interface BoardFormDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  initialName?: string;
  initialGridWidth?: number;
  initialGridHeight?: number;
  withSize?: boolean;
  pending: boolean;
  onSubmit: (values: { name: string; gridWidth: number; gridHeight: number }) => void;
  onOpenChange: (open: boolean) => void;
}

function BoardFormDialog({
  open,
  title,
  confirmLabel,
  initialName = "",
  initialGridWidth = 24,
  initialGridHeight = 16,
  withSize = false,
  pending,
  onSubmit,
  onOpenChange,
}: BoardFormDialogProps) {
  const [name, setName] = useState(initialName);
  const [gridWidth, setGridWidth] = useState(24);
  const [gridHeight, setGridHeight] = useState(16);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, gridWidth, gridHeight });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs" onOpenAutoFocus={() => {
          setName(initialName);
          setGridWidth(initialGridWidth);
          setGridHeight(initialGridHeight);
        }}>
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="board-name" className="text-xs">Название</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="ui-hover h-8 text-sm"
            />
          </div>
          {withSize ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="board-w" className="text-xs">Ширина, клеток</Label>
                <Input
                  id="board-w"
                  type="number"
                  min={1}
                  max={500}
                  value={gridWidth}
                  onChange={(e) => setGridWidth(Math.max(1, Number(e.target.value) || 1))}
                  className="ui-hover h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-h" className="text-xs">Высота, клеток</Label>
                <Input
                  id="board-h"
                  type="number"
                  min={1}
                  max={500}
                  value={gridHeight}
                  onChange={(e) => setGridHeight(Math.max(1, Number(e.target.value) || 1))}
                  className="ui-hover h-8 text-sm"
                />
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending || !name.trim()} className="ui-hover">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardsMenu({
  boards,
  viewedBoard,
  viewedCampaign,
  onViewBoard,
}: {
  boards: BoardDto[];
  viewedBoard: BoardDto | null;
  viewedCampaign: CampaignDto | null;
  onViewBoard: (id?: number) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const onError = (err: unknown, fallback: string) =>
    toast.error(trpcErrorMessage(err, fallback));
  const onSuccess = () => invalidateGameState();

  const createMutation = api.boards.create.useMutation();
  const renameMutation = api.boards.rename.useMutation();
  const updateGridMutation = api.boards.updateGrid.useMutation();
  const removeMutation = api.boards.remove.useMutation();
  const setActiveMutation = api.boards.setActive.useMutation();
  const uploadMutation = mediaApi.uploadImage.useMutation();
  const setBackgroundMutation = boardBackgroundApi.setBackground.useMutation();

  // Фон поля: загрузка → media.uploadImage(purpose:"board") → boards.setBackground.
  // Старый фон сервер удаляет сам после успешной замены.
  const pickBackground = async (file: File | undefined) => {
    if (!file || !viewedBoard) return;
    const problem = validatePickedImage(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBgUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const asset = await uploadMutation.mutateAsync({ dataBase64, purpose: "board" });
      await setBackgroundMutation.mutateAsync({ id: viewedBoard.id, imageKey: asset.key });
      invalidateGameState();
      toast.success(`Фон поля «${viewedBoard.name}» обновлён`);
    } catch (err) {
      onError(err, "Не удалось загрузить фон поля");
    } finally {
      setBgUploading(false);
      if (bgInputRef.current) bgInputRef.current.value = "";
    }
  };

  const clearBackground = () => {
    if (!viewedBoard) return;
    setBackgroundMutation.mutate(
      { id: viewedBoard.id, imageKey: null },
      {
        onSuccess: () => {
          invalidateGameState();
          toast.success("Фон поля убран");
        },
        onError: (err) => onError(err, "Не удалось убрать фон"),
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="ui-hover h-8 max-w-56 gap-1.5 text-xs">
            <MapIcon className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{viewedBoard ? viewedBoard.name : "Нет поля"}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {boards.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Полей пока нет
            </DropdownMenuItem>
          ) : (
            boards.map((board) => (
              <DropdownMenuItem
                key={board.id}
                className="ui-hover flex items-center gap-2 text-xs"
                onSelect={() => onViewBoard(board.id)}
              >
                <span className="flex size-3.5 items-center justify-center">
                  {viewedBoard?.id === board.id ? <Check className="size-3.5 text-primary" /> : null}
                </span>
                <span className="truncate">{board.name}</span>
                {board.isActive ? (
                  <span className="ml-auto shrink-0 text-[10px] font-medium text-primary">у игроков</span>
                ) : (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {board.gridWidth}×{board.gridHeight}
                  </span>
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          {viewedBoard && !viewedBoard.isActive ? (
            <DropdownMenuItem
              className="ui-hover text-xs font-medium text-primary"
              disabled={setActiveMutation.isPending}
              onSelect={() =>
                setActiveMutation.mutate(
                  { id: viewedBoard.id },
                  {
                    onSuccess: () => {
                      onSuccess();
                      toast.success(`Поле «${viewedBoard.name}» теперь видно игрокам`);
                    },
                    onError: (error) => onError(error, "Не удалось активировать поле"),
                  },
                )
              }
            >
              <MapIcon className="size-3.5" /> Сделать активным для игроков
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="ui-hover text-xs"
            disabled={!viewedCampaign}
            onSelect={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" /> Создать поле
          </DropdownMenuItem>
          {viewedBoard ? (
            <>
              <DropdownMenuItem
                className="ui-hover text-xs"
                disabled={bgUploading || uploadMutation.isPending || setBackgroundMutation.isPending}
                onSelect={() => bgInputRef.current?.click()}
              >
                <ImageIcon className="size-3.5" />
                {bgUploading || uploadMutation.isPending
                  ? "Загрузка фона…"
                  : viewedBoard.backgroundKey
                    ? "Заменить фон"
                    : "Загрузить фон"}
              </DropdownMenuItem>
              {viewedBoard.backgroundKey ? (
                <DropdownMenuItem
                  className="ui-hover text-xs"
                  disabled={setBackgroundMutation.isPending}
                  onSelect={clearBackground}
                >
                  <ImageOff className="size-3.5" /> Убрать фон
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="ui-hover text-xs" onSelect={() => setRenameOpen(true)}>
                <Pencil className="size-3.5" /> Название и размер
              </DropdownMenuItem>
              <DropdownMenuItem
                className="ui-hover text-xs text-destructive-foreground"
                onSelect={() => setRemoveOpen(true)}
              >
                <Trash2 className="size-3.5" /> Удалить поле
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={bgInputRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        className="hidden"
        aria-label="Файл фона поля"
        onChange={(e) => void pickBackground(e.target.files?.[0])}
      />

      <BoardFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Новое поле"
        confirmLabel="Создать"
        withSize
        pending={createMutation.isPending}
        onSubmit={({ name, gridWidth, gridHeight }) =>
          createMutation.mutate(
            { name, gridWidth, gridHeight, campaignId: viewedCampaign?.id },
            {
              onSuccess: () => { onSuccess(); setCreateOpen(false); },
              onError: (e) => onError(e, "Не удалось создать поле"),
            },
          )
        }
      />
      <BoardFormDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Название и размер поля"
        confirmLabel="Сохранить"
        initialName={viewedBoard?.name ?? ""}
        initialGridWidth={viewedBoard?.gridWidth ?? 24}
        initialGridHeight={viewedBoard?.gridHeight ?? 16}
        withSize
        pending={renameMutation.isPending || updateGridMutation.isPending}
        onSubmit={async ({ name, gridWidth, gridHeight }) => {
          if (!viewedBoard) return;
          try {
            if (name !== viewedBoard.name) {
              await renameMutation.mutateAsync({ id: viewedBoard.id, name });
            }
            if (gridWidth !== viewedBoard.gridWidth || gridHeight !== viewedBoard.gridHeight) {
              await updateGridMutation.mutateAsync({ id: viewedBoard.id, gridWidth, gridHeight });
            }
            onSuccess();
            setRenameOpen(false);
            toast.success("Поле сохранено; токены за новой границей сдвинуты внутрь");
          } catch (e) {
            onError(e, "Не удалось сохранить поле");
          }
        }}
      />
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Удалить поле</DialogTitle>
            <DialogDescription className="text-xs">
              Поле «{viewedBoard?.name}» и все его токены будут удалены безвозвратно.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoveOpen(false)} className="ui-hover">
              Отмена
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removeMutation.isPending}
              className="ui-hover"
              onClick={() =>
                viewedBoard &&
                removeMutation.mutate(
                  { id: viewedBoard.id },
                  {
                    onSuccess: () => {
                      onViewBoard();
                      onSuccess();
                      setRemoveOpen(false);
                    },
                    onError: (e) => onError(e, "Не удалось удалить поле"),
                  },
                )
              }
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectionBadge({ status }: { status: RealtimeStatus }) {
  if (status === "open") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Realtime-соединение активно">
        <Wifi className="size-3.5 text-primary" />
        <span className="hidden lg:inline">онлайн</span>
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title={status === "connecting" ? "Подключение к серверу…" : "Нет соединения — опрос каждые 4 с"}
    >
      <WifiOff className={`size-3.5 ${status === "connecting" ? "animate-pulse text-primary" : "text-destructive"}`} />
      <span className="hidden lg:inline">{status === "connecting" ? "подключение…" : "офлайн · опрос"}</span>
    </span>
  );
}

export interface GameHeaderProps {
  me: UserDto;
  boards: BoardDto[];
  campaigns: CampaignDto[];
  activeCampaign: CampaignDto | null;
  viewedCampaign: CampaignDto | null;
  onViewCampaign: (id?: number) => void;
  activeBoard: BoardDto | null;
  viewedBoard: BoardDto | null;
  onViewBoard: (id?: number) => void;
  isMaster: boolean;
  gridOn: boolean;
  onGridChange: (value: boolean) => void;
  wsStatus: RealtimeStatus;
  onAddToken: () => void;
  onOpenInitiative: () => void;
  onOpenUsers: () => void;
  onOpenCompendium: () => void;
  onOpenCharacters: () => void;
  onOpenNotes: () => void;
}

export function GameHeader({
  me,
  boards,
  campaigns,
  activeCampaign,
  viewedCampaign,
  onViewCampaign,
  activeBoard,
  viewedBoard,
  onViewBoard,
  isMaster,
  gridOn,
  onGridChange,
  wsStatus,
  onAddToken,
  onOpenInitiative,
  onOpenUsers,
  onOpenCompendium,
  onOpenCharacters,
  onOpenNotes,
}: GameHeaderProps) {
  const logoutMutation = api.auth.logout.useMutation();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b bg-card/60 px-3">
      <div className="flex items-center gap-2 pr-1">
        <BrandMark className="size-5" />
        <span className="hidden text-sm font-semibold tracking-wide sm:inline">DnD WormsBoard</span>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {isMaster ? (
        <>
          <CampaignsMenu
            campaigns={campaigns}
            activeCampaign={activeCampaign}
            viewedCampaign={viewedCampaign}
            onViewCampaign={onViewCampaign}
          />
          <BoardsMenu
            boards={boards}
            viewedBoard={viewedBoard}
            viewedCampaign={viewedCampaign}
            onViewBoard={onViewBoard}
          />
        </>
      ) : (
        <span className="flex h-8 max-w-56 items-center gap-1.5 truncate px-1 text-xs text-muted-foreground">
          <MapIcon className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">
            {activeCampaign
              ? `${activeCampaign.name} · ${activeBoard?.name ?? "Нет поля"}`
              : "Кампания не выбрана"}
          </span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <div className="mr-1 hidden items-center gap-2 md:flex" title="Показывать сетку">
          <Grid3x3 className="size-3.5 text-muted-foreground" />
          <Switch checked={gridOn} onCheckedChange={onGridChange} aria-label="Сетка" />
        </div>

        <LibraryMenu
          onOpenCompendium={onOpenCompendium}
          onOpenCharacters={onOpenCharacters}
          onOpenNotes={onOpenNotes}
        />

        {isMaster ? (
          <Button
            variant="outline"
            size="sm"
            className="ui-hover h-8 gap-1.5 text-xs"
            onClick={onAddToken}
            disabled={!viewedBoard}
            title="Добавить токен в центр просматриваемого поля"
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">Токен</span>
          </Button>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          className="ui-hover h-8 gap-1.5 text-xs"
          onClick={onOpenInitiative}
          disabled={!viewedBoard}
          title="Инициатива просматриваемого поля"
        >
          <ListOrdered className="size-3.5" />
          <span className="hidden sm:inline">Инициатива</span>
        </Button>

        {isMaster ? (
          <Button
            variant="outline"
            size="sm"
            className="ui-hover h-8 gap-1.5 text-xs"
            onClick={onOpenUsers}
            title="Пользователи и роли"
          >
            <UsersIcon className="size-3.5" />
            <span className="hidden sm:inline">Люди</span>
          </Button>
        ) : null}

        <Separator orientation="vertical" className="mx-1 h-6" />

        <div className="hidden sm:block">
          <ConnectionBadge status={wsStatus} />
        </div>

        <Badge
          variant={isMaster ? "default" : "secondary"}
          className="ml-1 hidden h-6 px-2 text-[11px] font-medium md:inline-flex"
          title={isMaster ? "Мастер" : "Игрок"}
        >
          {me.displayName || me.login}
        </Badge>

        <Button
          variant="ghost"
          size="sm"
          className="ui-hover h-8 gap-1.5 text-xs text-muted-foreground"
          disabled={logoutMutation.isPending}
          onClick={() =>
            logoutMutation.mutate(undefined, {
              onSuccess: () => {
                queryClient.clear();
                window.location.replace("/");
              },
              onError: (e) => toast.error(trpcErrorMessage(e, "Не удалось выйти")),
            })
          }
          title="Выйти"
          aria-label="Выход"
        >
          <LogOut className="size-3.5" />
          <span className="hidden sm:inline">Выход</span>
        </Button>
      </div>
    </header>
  );
}

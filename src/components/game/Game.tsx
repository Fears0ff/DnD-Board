import { useMemo, useState } from "react";
import { EyeOff, Map as MapIcon, Minus, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorCode, trpcErrorMessage } from "@/lib/api";
import { TOKEN_KIND_LABELS, type TokenDto } from "@/lib/game-contract";
import {
  applyPendingMoves,
  clearPendingMove,
  EMPTY_PENDING_MOVES,
  setPendingMove,
  type PendingMoves,
} from "@/lib/pendingMoves";
import { useGameSync } from "@/hooks/useGameSync";
import { BoardCanvas } from "@/components/board/BoardCanvas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FullScreenError, FullScreenLoader } from "./FullScreenState";
import { GameHeader } from "./GameHeader";
import { UsersDialog } from "./UsersDialog";
import { TokenDialog, type TokenDialogState } from "./TokenDialog";
import { InitiativePanel } from "./InitiativePanel";
import { CharactersDialog } from "@/components/characters/CharactersDialog";
import { NotesDialog } from "@/components/notes/NotesDialog";
import { CompendiumDialog } from "@/components/compendium/CompendiumDialog";

export function Game() {
  const [viewBoardId, setViewBoardId] = useState<number | undefined>(undefined);
  const { query, wsStatus } = useGameSync(true, viewBoardId);
  const data = query.data;
  const board = data?.viewedBoard ?? null;

  const [gridOn, setGridOn] = useState(true);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [pendingMoves, setPendingMoves] = useState<PendingMoves>(EMPTY_PENDING_MOVES);
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState>(null);
  const [initiativeOpen, setInitiativeOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [compendiumOpen, setCompendiumOpen] = useState(false);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const moveMutation = api.tokens.move.useMutation();
  const updateMutation = api.tokens.update.useMutation();
  const adjustHpMutation = api.tokens.adjustHp.useMutation();
  const createBoardMutation = api.boards.create.useMutation();
  const characterCardsQuery = api.compendium.list.useQuery(
    { type: "character" },
    { enabled: charactersOpen, retry: 1, refetchOnWindowFocus: true },
  );

  const isMaster = data?.me.gameRole === "master";

  // Если просматриваемое поле удалили или роль изменилась, возвращаемся к
  // глобально активному полю. Условный сброс во время render — рекомендованный
  // React-паттерн для состояния, зависящего от нового snapshot.
  if (data && viewBoardId !== undefined
    && (data.me.gameRole !== "master" || data.viewedBoard?.id !== viewBoardId)) {
    setViewBoardId(undefined);
  }

  // Поле могло удалить другое подключение мастера: selector устарел.
  if (viewBoardId !== undefined && query.isError && trpcErrorCode(query.error) === "NOT_FOUND") {
    setViewBoardId(undefined);
  }

  // Локальное состояние одного поля не должно протекать в другое.
  const [previousBoardId, setPreviousBoardId] = useState(board?.id);
  if (previousBoardId !== board?.id) {
    setPreviousBoardId(board?.id);
    setSelectedTokenId(null);
    setPendingMoves(EMPTY_PENDING_MOVES);
    setTokenDialog(null);
  }

  // Выбранный токен мог быть удалён другим участником: устаревший id безвреден.
  const displayTokens = useMemo(
    () => (data ? applyPendingMoves(data.tokens, pendingMoves) : []),
    [data, pendingMoves],
  );
  const pendingTokenIds = useMemo(
    () => new Set(Object.keys(pendingMoves).map(Number)),
    [pendingMoves],
  );

  /** Drag завершён: локальная позиция остаётся pending до settle мутации. */
  const handleTokenDrop = (token: TokenDto, cellX: number, cellY: number) => {
    if (!board || (!isMaster && !board.isActive)) return;
    setPendingMoves((state) => setPendingMove(state, token.id, cellX, cellY));
    const options = {
      onSuccess: () => invalidateGameState(),
      onError: (error: unknown) => {
        toast.error(trpcErrorMessage(error, "Не удалось переместить токен"));
        invalidateGameState();
      },
      onSettled: () => setPendingMoves((state) => clearPendingMove(state, token.id)),
    };
    if (isMaster) {
      updateMutation.mutate({ id: token.id, cellX, cellY }, options);
    } else {
      moveMutation.mutate({ tokenId: token.id, cellX, cellY }, options);
    }
  };

  const adjustHp = (token: TokenDto, delta: number) => {
    if (!isMaster || !board || token.hp === null) return;
    adjustHpMutation.mutate(
      { id: token.id, delta },
      {
        onSuccess: () => invalidateGameState(),
        onError: (error) => toast.error(trpcErrorMessage(error, "Не удалось изменить HP")),
      },
    );
  };

  if (query.isLoading) {
    return <FullScreenLoader label="Загрузка игры…" />;
  }
  if (query.isError || !data) {
    return (
      <FullScreenError
        title="Не удалось загрузить состояние игры"
        message={trpcErrorMessage(query.error, "Проверьте соединение с сервером")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const selectedToken = selectedTokenId !== null
    ? displayTokens.find((token) => token.id === selectedTokenId) ?? null
    : null;
  const selectedHpVisible = selectedToken !== null
    && selectedToken.hp !== null
    && selectedToken.maxHp !== null;

  return (
    <div className="flex h-full min-h-screen flex-col">
      <GameHeader
        me={data.me}
        boards={data.boards}
        activeBoard={data.activeBoard}
        viewedBoard={board}
        onViewBoard={setViewBoardId}
        isMaster={!!isMaster}
        gridOn={gridOn}
        onGridChange={setGridOn}
        wsStatus={wsStatus}
        onAddToken={() => setTokenDialog({ mode: "add" })}
        onOpenInitiative={() => setInitiativeOpen(true)}
        onOpenUsers={() => setUsersOpen(true)}
        onOpenCompendium={() => setCompendiumOpen(true)}
        onOpenCharacters={() => setCharactersOpen(true)}
        onOpenNotes={() => setNotesOpen(true)}
      />

      {wsStatus !== "open" ? (
        <div className="flex h-7 shrink-0 items-center justify-center border-b bg-secondary/70 px-3 text-[11px] text-muted-foreground">
          {wsStatus === "connecting"
            ? "Подключение к серверу…"
            : "Realtime-соединение потеряно — данные обновляются опросом каждые 4 с, переподключение выполняется автоматически"}
        </div>
      ) : null}

      {isMaster && board && !board.isActive ? (
        <div className="flex min-h-7 shrink-0 items-center justify-center border-b bg-secondary/70 px-3 py-1 text-center text-[11px] text-muted-foreground">
          Это поле сейчас не видно игрокам. Мастер может редактировать его токены, HP и инициативу независимо от активности.
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1">
        {board ? (
          <InitiativePanel
            open={initiativeOpen}
            onOpenChange={setInitiativeOpen}
            boardId={board.id}
            boardName={board.name}
            tokens={data.tokens}
            initiative={data.initiative}
            isMaster={!!isMaster}
          />
        ) : null}

        <section className="relative min-w-0 flex-1">
          {board ? (
            <BoardCanvas
              board={board}
              tokens={displayTokens}
              meId={data.me.id}
              isMaster={!!isMaster}
              showGrid={gridOn}
              selectedTokenId={selectedTokenId}
              pendingTokenIds={pendingTokenIds}
              onSelectToken={setSelectedTokenId}
              onTokenDrop={handleTokenDrop}
              onEditToken={(token) => setTokenDialog({ mode: "edit", token })}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <MapIcon className="size-10 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Игровое поле не создано</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {isMaster
                    ? "Создайте первое поле — оно сразу станет активным для всех участников."
                    : "Мастер ещё не создал игровое поле. Страница обновится автоматически."}
                </p>
              </div>
              {isMaster ? (
                <Button
                  size="sm"
                  className="ui-hover gap-1.5 text-xs"
                  disabled={createBoardMutation.isPending}
                  onClick={() =>
                    createBoardMutation.mutate(
                      {
                        name: `Поле ${data.boards.length + 1}`,
                        gridWidth: 24,
                        gridHeight: 16,
                      },
                      {
                        onSuccess: () => invalidateGameState(),
                        onError: (error) => toast.error(trpcErrorMessage(error, "Не удалось создать поле")),
                      },
                    )
                  }
                >
                  <Plus className="size-3.5" /> Создать поле
                </Button>
              ) : null}
            </div>
          )}

          {board && selectedToken ? (
            <div
              data-testid="token-inspector"
              className="panel absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-3 px-3 py-2 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">{selectedToken.label}</span>
                  <Badge variant="secondary" className="px-1 text-[10px]">
                    {TOKEN_KIND_LABELS[selectedToken.kind]}
                  </Badge>
                  {selectedToken.invisible ? (
                    <Badge variant="outline" className="gap-1 px-1 text-[10px]">
                      <EyeOff className="size-3" /> невидимый
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Клетка ({selectedToken.cellX}; {selectedToken.cellY})
                  {selectedToken.ownerId === data.me.id ? " · ваш" : ""}
                </p>
                {selectedHpVisible ? (
                  isMaster ? (
                    <div className="mt-1.5 flex items-center gap-1.5" data-testid="hp-controls">
                      <Button
                        variant="outline"
                        size="sm"
                        className="ui-hover size-7 p-0"
                        disabled={adjustHpMutation.isPending || selectedToken.hp === 0}
                        onClick={() => adjustHp(selectedToken, -1)}
                        aria-label={`Уменьшить HP: ${selectedToken.label}`}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <span className="min-w-16 text-center text-[11px] font-medium" data-testid="selected-token-hp">
                        HP {selectedToken.hp}/{selectedToken.maxHp}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="ui-hover size-7 p-0"
                        disabled={adjustHpMutation.isPending || selectedToken.hp === selectedToken.maxHp}
                        onClick={() => adjustHp(selectedToken, 1)}
                        aria-label={`Увеличить HP: ${selectedToken.label}`}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-[11px] font-medium" data-testid="selected-token-hp">
                      HP {selectedToken.hp}/{selectedToken.maxHp}
                    </p>
                  )
                ) : null}
              </div>
              {isMaster ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ui-hover h-7 gap-1 text-[11px]"
                  onClick={() => setTokenDialog({ mode: "edit", token: selectedToken })}
                >
                  <Pencil className="size-3" /> Изменить
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="ui-hover h-7 w-7 p-0"
                onClick={() => setSelectedTokenId(null)}
                aria-label="Закрыть"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </section>
      </main>

      {isMaster && tokenDialog && board ? (
        <TokenDialog state={tokenDialog} board={board} onClose={() => setTokenDialog(null)} />
      ) : null}

      <CompendiumDialog open={compendiumOpen} onOpenChange={setCompendiumOpen} me={data.me} />
      <CharactersDialog
        open={charactersOpen}
        onOpenChange={setCharactersOpen}
        me={data.me}
        characterCards={characterCardsQuery.data?.items ?? []}
      />
      <NotesDialog open={notesOpen} onOpenChange={setNotesOpen} />

      {isMaster ? (
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} me={data.me} />
      ) : null}
    </div>
  );
}

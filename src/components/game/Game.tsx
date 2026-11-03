import { useMemo, useState } from "react";
import { Map as MapIcon, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import {
  TOKEN_KIND_LABELS,
  type TokenDto,
} from "@/lib/game-contract";
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

export function Game() {
  const { query, wsStatus } = useGameSync(true);
  const data = query.data;

  const [gridOn, setGridOn] = useState(true);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [pendingMoves, setPendingMoves] = useState<PendingMoves>(EMPTY_PENDING_MOVES);
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState>(null);
  const [initiativeOpen, setInitiativeOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

  const moveMutation = api.tokens.move.useMutation();
  const updateMutation = api.tokens.update.useMutation();
  const createBoardMutation = api.boards.create.useMutation();

  const isMaster = data?.me.gameRole === "master";

  // выбранный токен мог быть удалён другим участником: инспектор и подсветка
  // вычисляются по факту наличия id в актуальном снимке, устаревший id безвреден
  const displayTokens = useMemo(
    () => (data ? applyPendingMoves(data.tokens, pendingMoves) : []),
    [data, pendingMoves],
  );
  const pendingTokenIds = useMemo(
    () => new Set(Object.keys(pendingMoves).map(Number)),
    [pendingMoves],
  );

  /**
   * Drag завершён: одна мутация, локальная позиция pending до settle.
   * Ошибка — откат к серверному снимку (pending снимается) и перечитывание.
   */
  const handleTokenDrop = (token: TokenDto, cellX: number, cellY: number) => {
    setPendingMoves((s) => setPendingMove(s, token.id, cellX, cellY));
    const options = {
      onSuccess: () => invalidateGameState(),
      onError: (err: unknown) => {
        toast.error(trpcErrorMessage(err, "Не удалось переместить токен"));
        invalidateGameState();
      },
      onSettled: () => setPendingMoves((s) => clearPendingMove(s, token.id)),
    };
    if (isMaster) {
      updateMutation.mutate({ id: token.id, cellX, cellY }, options);
    } else {
      moveMutation.mutate({ tokenId: token.id, cellX, cellY }, options);
    }
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

  const board = data.activeBoard;
  const selectedToken = selectedTokenId !== null
    ? displayTokens.find((t) => t.id === selectedTokenId) ?? null
    : null;

  return (
    <div className="flex h-full min-h-screen flex-col">
      <GameHeader
        me={data.me}
        boards={data.boards}
        activeBoard={board}
        isMaster={!!isMaster}
        gridOn={gridOn}
        onGridChange={setGridOn}
        wsStatus={wsStatus}
        onAddToken={() => setTokenDialog({ mode: "add" })}
        onOpenInitiative={() => setInitiativeOpen(true)}
        onOpenUsers={() => setUsersOpen(true)}
      />

      {wsStatus !== "open" ? (
        <div className="flex h-7 shrink-0 items-center justify-center border-b bg-secondary/70 px-3 text-[11px] text-muted-foreground">
          {wsStatus === "connecting"
            ? "Подключение к серверу…"
            : "Realtime-соединение потеряно — данные обновляются опросом каждые 4 с, переподключение выполняется автоматически"}
        </div>
      ) : null}

      <main className="relative min-h-0 flex-1">
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
            onEditToken={(t) => setTokenDialog({ mode: "edit", token: t })}
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
                      onError: (e) => toast.error(trpcErrorMessage(e, "Не удалось создать поле")),
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
            className="panel absolute bottom-3 left-3 flex max-w-xs items-center gap-3 px-3 py-2 shadow-sm"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium">{selectedToken.label}</span>
                <Badge variant="secondary" className="px-1 text-[10px]">
                  {TOKEN_KIND_LABELS[selectedToken.kind]}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                HP {selectedToken.hp}/{selectedToken.maxHp} · клетка ({selectedToken.cellX}; {selectedToken.cellY})
                {selectedToken.ownerId === data.me.id ? " · ваш" : ""}
              </p>
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
      </main>

      {isMaster && tokenDialog && board ? (
        <TokenDialog state={tokenDialog} board={board} onClose={() => setTokenDialog(null)} />
      ) : null}

      {board ? (
        <InitiativePanel
          open={initiativeOpen}
          onOpenChange={setInitiativeOpen}
          tokens={data.tokens}
          initiative={data.initiative}
          isMaster={!!isMaster}
        />
      ) : null}

      {isMaster ? (
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} me={data.me} />
      ) : null}
    </div>
  );
}

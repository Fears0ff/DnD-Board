import { useCallback, useMemo, useState } from "react";
import { api, gameStateKey, reportMutationError } from "@/lib/api";
import { queryClient } from "@/providers/trpc";
import { useGameSync } from "@/hooks/useGameSync";
import {
  applyPendingMoves,
  clearPendingMove,
  EMPTY_PENDING_MOVES,
  setPendingMove,
  type PendingMoves,
} from "@/lib/pendingMoves";
import { log } from "@/lib/logger";
import type {
  BoardDto,
  GameStateDto,
  InitiativeEntry,
  TokenAddInput,
  TokenUpdateInput,
} from "@/lib/game-contract";
import { BoardCanvas } from "@/components/board/BoardCanvas";
import { GameHeader } from "./GameHeader";
import { InitiativePanel } from "./InitiativePanel";
import { TokenDialog } from "./TokenDialog";
import { UsersDialog } from "./UsersDialog";
import { FullScreenError, FullScreenLoader } from "./FullScreenState";
import { toast } from "sonner";

interface TokenDialogState {
  mode: "add" | "edit";
  tokenId?: number;
}

export function Game() {
  const { query, wsStatus } = useGameSync(true);
  const state = query.data;

  const [pendingMoves, setPendingMoves] = useState<PendingMoves>(EMPTY_PENDING_MOVES);
  const [usersOpen, setUsersOpen] = useState(false);
  const [tokenDialog, setTokenDialog] = useState<TokenDialogState | null>(null);

  const invalidateGame = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [...gameStateKey] }),
    [],
  );

  /* ------------------------------- mutations ------------------------------ */

  const onMutationError = reportMutationError("board mutation");

  const createBoard = api.boards.create.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const renameBoard = api.boards.rename.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const removeBoard = api.boards.remove.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const setActiveBoard = api.boards.setActive.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });

  const addToken = api.tokens.add.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const updateToken = api.tokens.update.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const removeToken = api.tokens.remove.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const clearTokens = api.tokens.clear.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });
  const setInitiative = api.initiative.set.useMutation({
    onSuccess: () => void invalidateGame(),
    onError: onMutationError,
  });

  const moveToken = api.tokens.move.useMutation();

  const anyPending =
    createBoard.isPending ||
    renameBoard.isPending ||
    removeBoard.isPending ||
    setActiveBoard.isPending ||
    addToken.isPending ||
    updateToken.isPending ||
    removeToken.isPending ||
    clearTokens.isPending ||
    setInitiative.isPending;

  /* ------------------------------ token moves ----------------------------- */

  const tokens = useMemo(
    () => (state ? applyPendingMoves(state.tokens, pendingMoves) : []),
    [state, pendingMoves],
  );

  const handleTokenMove = useCallback(
    (tokenId: number, cellX: number, cellY: number) => {
      const snapshot = queryClient.getQueryData<GameStateDto>([...gameStateKey]);
      const serverToken = snapshot?.tokens.find((t) => t.id === tokenId);
      if (!serverToken) return;
      if (serverToken.cellX === cellX && serverToken.cellY === cellY) return;

      setPendingMoves((prev) => setPendingMove(prev, tokenId, cellX, cellY));
      moveToken.mutate(
        { tokenId, cellX, cellY },
        {
          onSuccess: () => {
            setPendingMoves((prev) => clearPendingMove(prev, tokenId));
            void invalidateGame();
          },
          onError: (error) => {
            setPendingMoves((prev) => clearPendingMove(prev, tokenId));
            log.error("token move failed", { tokenId, error: String(error) });
            toast.error("Не удалось переместить токен");
            void invalidateGame();
          },
        },
      );
    },
    [moveToken, invalidateGame],
  );

  /* -------------------------------- render -------------------------------- */

  if (query.isLoading) return <FullScreenLoader label="Загрузка поля…" />;
  if (query.isError || !state) {
    return (
      <FullScreenError
        title="Не удалось загрузить игровое поле"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const me = state.me;
  const isMaster = me.gameRole === "master";
  const activeBoard: BoardDto | null = state.activeBoard;
  const boards: BoardDto[] = state.boards;
  const initiative: InitiativeEntry[] = state.initiative;

  const editingToken =
    tokenDialog?.mode === "edit"
      ? tokens.find((t) => t.id === tokenDialog.tokenId) ?? null
      : null;

  const handleAddBoard = (name: string) => {
    createBoard.mutate({ name });
  };
  const handleRenameBoard = (id: number, name: string) => {
    renameBoard.mutate({ id, name });
  };
  const handleRemoveBoard = (id: number) => {
    removeBoard.mutate({ id });
  };
  const handleSetActive = (id: number) => {
    setActiveBoard.mutate({ id });
  };

  const handleTokenDialogSubmit = (values: TokenAddInput | (TokenUpdateInput & { id: number })) => {
    if (tokenDialog?.mode === "edit" && "id" in values) {
      updateToken.mutate(values, { onSuccess: () => setTokenDialog(null) });
    } else {
      addToken.mutate(values as TokenAddInput, { onSuccess: () => setTokenDialog(null) });
    }
  };

  const handleInitiativeChange = (entries: InitiativeEntry[]) => {
    setInitiative.mutate({ entries });
  };

  return (
    <div className="flex h-screen flex-col" data-testid="game-root">
      <GameHeader
        me={me}
        boards={boards}
        activeBoard={activeBoard}
        wsStatus={wsStatus}
        busy={anyPending}
        onAddBoard={isMaster ? handleAddBoard : undefined}
        onRenameBoard={isMaster ? handleRenameBoard : undefined}
        onRemoveBoard={isMaster ? handleRemoveBoard : undefined}
        onSetActiveBoard={isMaster ? handleSetActive : undefined}
        onOpenUsers={isMaster ? () => setUsersOpen(true) : undefined}
      />

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {activeBoard ? (
            <BoardCanvas
              board={activeBoard}
              tokens={tokens}
              isMaster={isMaster}
              myUserId={me.id}
              busy={anyPending}
              onTokenMove={handleTokenMove}
              onAddToken={isMaster ? () => setTokenDialog({ mode: "add" }) : undefined}
              onEditToken={
                isMaster ? (id) => setTokenDialog({ mode: "edit", tokenId: id }) : undefined
              }
              onRemoveToken={isMaster ? (id) => removeToken.mutate({ id }) : undefined}
              onClearTokens={
                isMaster ? () => clearTokens.mutate({ boardId: activeBoard.id }) : undefined
              }
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-muted-foreground">
                {isMaster
                  ? "Создайте первую доску, чтобы начать."
                  : "Мастер ещё не создал доску. Ожидайте."}
              </p>
            </div>
          )}
        </main>

        {activeBoard ? (
          <InitiativePanel
            tokens={tokens}
            initiative={initiative}
            isMaster={isMaster}
            busy={anyPending}
            onChange={isMaster ? handleInitiativeChange : undefined}
          />
        ) : null}
      </div>

      {tokenDialog ? (
        <TokenDialog
          mode={tokenDialog.mode}
          token={editingToken}
          open
          pending={addToken.isPending || updateToken.isPending}
          onClose={() => setTokenDialog(null)}
          onSubmit={handleTokenDialogSubmit}
        />
      ) : null}

      {isMaster ? (
        <UsersDialog open={usersOpen} onOpenChange={setUsersOpen} myId={me.id} />
      ) : null}
    </div>
  );
}

import type { TokenDto } from "./game-contract";

/**
 * Локальные pending-перемещения токенов.
 *
 * После drag координата помечается pending ровно до settle своей мутации
 * (без TTL и tombstone-таймеров): успех снимает pending и состояние
 * перечитывается, ошибка откатывает к последнему серверному снимку.
 */
export interface PendingMove {
  cellX: number;
  cellY: number;
}

export type PendingMoves = Readonly<Record<number, PendingMove>>;

export const EMPTY_PENDING_MOVES: PendingMoves = {};

export function setPendingMove(
  state: PendingMoves,
  tokenId: number,
  cellX: number,
  cellY: number,
): PendingMoves {
  return { ...state, [tokenId]: { cellX, cellY } };
}

export function clearPendingMove(state: PendingMoves, tokenId: number): PendingMoves {
  if (!(tokenId in state)) return state;
  const next = { ...state };
  delete next[tokenId];
  return next;
}

/** Накладывает pending-координаты поверх серверного снимка для отрисовки. */
export function applyPendingMoves(
  tokens: ReadonlyArray<TokenDto>,
  pending: PendingMoves,
): TokenDto[] {
  const ids = Object.keys(pending);
  if (ids.length === 0) return tokens.slice();
  return tokens.map((t) => {
    const p = pending[t.id];
    return p ? { ...t, cellX: p.cellX, cellY: p.cellY } : t;
  });
}

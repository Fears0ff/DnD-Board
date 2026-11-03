/**
 * Чистая геометрия поля: projection и hit-testing.
 * Используется и рендером canvas, и unit-тестами, чтобы формулы координат
 * существовали в одном месте.
 */

export interface ViewState {
  /** экранное смещение мирового начала координат, px */
  x: number;
  y: number;
  /** масштаб: screen = world * scale + offset */
  scale: number;
}

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(
  view: ViewState,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: wx * view.scale + view.x, y: wy * view.scale + view.y };
}

export function screenToWorld(
  view: ViewState,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

export function cellAtWorld(
  cellSize: number,
  wx: number,
  wy: number,
): { cellX: number; cellY: number } {
  return { cellX: Math.floor(wx / cellSize), cellY: Math.floor(wy / cellSize) };
}

/** Zoom к курсору: точка (sx, sy) остаётся неподвижной на экране. */
export function zoomAt(
  view: ViewState,
  sx: number,
  sy: number,
  factor: number,
): ViewState {
  const scale = clampScale(view.scale * factor);
  const world = screenToWorld(view, sx, sy);
  return { scale, x: sx - world.x * scale, y: sy - world.y * scale };
}

export interface BoardDims {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
}

/** Вид, в котором всё поле помещается во viewport с отступом и центрируется. */
export function fitView(
  board: BoardDims,
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
): ViewState {
  const worldW = board.gridWidth * board.cellSize;
  const worldH = board.gridHeight * board.cellSize;
  const availW = Math.max(64, viewportWidth - padding * 2);
  const availH = Math.max(64, viewportHeight - padding * 2);
  const scale = clampScale(Math.min(availW / worldW, availH / worldH));
  return {
    scale,
    x: (viewportWidth - worldW * scale) / 2,
    y: (viewportHeight - worldH * scale) / 2,
  };
}

/** Центр токена в мировых координатах (size — диаметр в клетках). */
export function tokenCenterWorld(
  token: { cellX: number; cellY: number; size: number },
  cellSize: number,
): { x: number; y: number } {
  return {
    x: (token.cellX + token.size / 2) * cellSize,
    y: (token.cellY + token.size / 2) * cellSize,
  };
}

/**
 * Hit-test по кругу токена. Возвращает id верхнего токена
 * (последний в массиве рисуется поверх) или null.
 */
export function hitTestToken(
  tokens: ReadonlyArray<{ id: number; cellX: number; cellY: number; size: number }>,
  cellSize: number,
  wx: number,
  wy: number,
): number | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    const c = tokenCenterWorld(t, cellSize);
    const r = (t.size * cellSize) / 2;
    const dx = wx - c.x;
    const dy = wy - c.y;
    if (dx * dx + dy * dy <= r * r) return t.id;
  }
  return null;
}

/** true, если событие клавиатуры пришло из поля ввода — перехватывать нельзя. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

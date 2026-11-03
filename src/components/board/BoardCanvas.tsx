import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Eraser } from "lucide-react";
import type { BoardDto, TokenDto } from "@/lib/game-contract";
import { TOKEN_KIND_LABELS } from "@/lib/game-contract";
import {
  cellAtWorld,
  clampScale,
  fitView,
  hitTestToken,
  isEditableTarget,
  screenToWorld,
  tokenCenterWorld,
  zoomAt,
  type ViewState,
} from "@/lib/geometry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BoardCanvasProps {
  board: BoardDto;
  tokens: TokenDto[];
  isMaster: boolean;
  myUserId: number;
  busy: boolean;
  onTokenMove: (tokenId: number, cellX: number, cellY: number) => void;
  onAddToken?: () => void;
  onEditToken?: (tokenId: number) => void;
  onRemoveToken?: (tokenId: number) => void;
  onClearTokens?: () => void;
}

const KIND_COLORS: Record<TokenDto["kind"], string> = {
  hero: "#3b82f6",
  monster: "#ef4444",
  prop: "#a78b71",
};

interface DragState {
  tokenId: number;
  /** grabbed point inside the token, world coords offset from its center */
  dx: number;
  dy: number;
  cellX: number;
  cellY: number;
  moved: boolean;
}

export function BoardCanvas({
  board,
  tokens,
  isMaster,
  myUserId,
  busy,
  onTokenMove,
  onAddToken,
  onEditToken,
  onRemoveToken,
  onClearTokens,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewState>(() =>
    fitView(board, 800, 600),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tokenId: number;
    x: number;
    y: number;
  } | null>(null);

  const movable = useCallback(
    (t: TokenDto) => isMaster || t.ownerId === myUserId,
    [isMaster, myUserId],
  );

  /* ------------------------------ resize/fit ------------------------------ */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit when the board itself changes (another board selected / resized).
  const boardKey = `${board.id}:${board.gridWidth}x${board.gridHeight}@${board.cellSize}`;
  useEffect(() => {
    setView(fitView(board, size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  /* -------------------------------- drawing ------------------------------- */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const cs = board.cellSize;
    const worldW = board.gridWidth * cs;
    const worldH = board.gridHeight * cs;

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    // board surface
    ctx.fillStyle = "rgba(42, 37, 32, 0.85)";
    ctx.fillRect(0, 0, worldW, worldH);

    // grid
    ctx.strokeStyle = "rgba(244, 236, 216, 0.08)";
    ctx.lineWidth = 1 / view.scale;
    ctx.beginPath();
    for (let x = 0; x <= board.gridWidth; x += 1) {
      ctx.moveTo(x * cs, 0);
      ctx.lineTo(x * cs, worldH);
    }
    for (let y = 0; y <= board.gridHeight; y += 1) {
      ctx.moveTo(0, y * cs);
      ctx.lineTo(worldW, y * cs);
    }
    ctx.stroke();

    // border
    ctx.strokeStyle = "rgba(255, 202, 52, 0.35)";
    ctx.lineWidth = 2 / view.scale;
    ctx.strokeRect(0, 0, worldW, worldH);

    // tokens
    for (const t of tokens) {
      const isDragging = drag?.tokenId === t.id;
      const cx = (isDragging ? drag.cellX : t.cellX);
      const cy = (isDragging ? drag.cellY : t.cellY);
      const centerX = (cx + t.size / 2) * cs;
      const centerY = (cy + t.size / 2) * cs;
      const r = (t.size * cs) / 2;

      ctx.beginPath();
      ctx.arc(centerX, centerY, r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLORS[t.kind] ?? "#888";
      ctx.globalAlpha = isDragging ? 0.7 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (movable(t)) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1.5 / view.scale;
        ctx.stroke();
      }

      // label
      ctx.fillStyle = "#f4ecd8";
      ctx.font = `${Math.max(10, cs * 0.22)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = t.label.length > 12 ? `${t.label.slice(0, 11)}…` : t.label;
      ctx.fillText(label, centerX, centerY);

      // hp bar
      if (t.maxHp > 0) {
        const w = r * 1.6;
        const h = Math.max(3, cs * 0.08);
        const x = centerX - w / 2;
        const y = centerY + r * 0.9 + h;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = t.hp / t.maxHp > 0.35 ? "#4ade80" : "#f87171";
        ctx.fillRect(x, y, (w * t.hp) / t.maxHp, h);
      }
    }

    // drag ghost cell highlight
    if (drag) {
      const t = tokens.find((x) => x.id === drag.tokenId);
      if (t) {
        ctx.strokeStyle = "rgba(255, 202, 52, 0.8)";
        ctx.lineWidth = 2 / view.scale;
        ctx.strokeRect(drag.cellX * cs, drag.cellY * cs, t.size * cs, t.size * cs);
      }
    }

    ctx.restore();
  }, [board, tokens, view, size, drag, movable]);

  useEffect(() => {
    draw();
  }, [draw]);

  /* ------------------------------ interactions ---------------------------- */

  const eventPos = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const { sx, sy } = eventPos(e);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => zoomAt(v, sx, sy, factor));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setContextMenu(null);
    const { sx, sy } = eventPos(e);
    const world = screenToWorld(view, sx, sy);
    const hitId = hitTestToken(tokens, board.cellSize, world.x, world.y);
    const hit = hitId !== null ? tokens.find((t) => t.id === hitId) : undefined;

    if (e.button === 2) {
      if (hit && isMaster) {
        setContextMenu({ tokenId: hit.id, x: sx, y: sy });
      }
      return;
    }
    if (e.button !== 0) return;

    if (hit && movable(hit)) {
      const c = tokenCenterWorld(hit, board.cellSize);
      setDrag({
        tokenId: hit.id,
        dx: world.x - c.x,
        dy: world.y - c.y,
        cellX: hit.cellX,
        cellY: hit.cellY,
        moved: false,
      });
    } else {
      setPanning({ x: e.clientX, y: e.clientY });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag) {
      const { sx, sy } = eventPos(e);
      const world = screenToWorld(view, sx, sy);
      const t = tokens.find((x) => x.id === drag.tokenId);
      if (!t) return;
      const anchorX = world.x - drag.dx - (t.size * board.cellSize) / 2;
      const anchorY = world.y - drag.dy - (t.size * board.cellSize) / 2;
      const cell = cellAtWorld(board.cellSize, anchorX, anchorY);
      const clampedX = Math.min(
        Math.max(0, cell.cellX),
        Math.max(0, board.gridWidth - Math.ceil(t.size)),
      );
      const clampedY = Math.min(
        Math.max(0, cell.cellY),
        Math.max(0, board.gridHeight - Math.ceil(t.size)),
      );
      setDrag({ ...drag, cellX: clampedX, cellY: clampedY, moved: true });
    } else if (panning) {
      const dx = e.clientX - panning.x;
      const dy = e.clientY - panning.y;
      setPanning({ x: e.clientX, y: e.clientY });
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag) {
      const t = tokens.find((x) => x.id === drag.tokenId);
      if (
        t &&
        drag.moved &&
        (drag.cellX !== t.cellX || drag.cellY !== t.cellY)
      ) {
        onTokenMove(drag.tokenId, drag.cellX, drag.cellY);
      } else if (t && !drag.moved && isMaster) {
        onEditToken?.(drag.tokenId);
      }
      setDrag(null);
    }
    setPanning(null);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Keyboard: +/- zoom, 0 fit, arrows pan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "+" || e.key === "=") {
        setView((v) => ({ ...v, scale: clampScale(v.scale * 1.15) }));
      } else if (e.key === "-") {
        setView((v) => ({ ...v, scale: clampScale(v.scale / 1.15) }));
      } else if (e.key === "0") {
        setView(fitView(board, size.width, size.height));
      } else if (e.key.startsWith("Arrow")) {
        const step = 40;
        setView((v) => ({
          ...v,
          x: v.x + (e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0),
          y: v.y + (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0),
        }));
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, size]);

  const menuToken = useMemo(
    () => (contextMenu ? tokens.find((t) => t.id === contextMenu.tokenId) : null),
    [contextMenu, tokens],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        width={size.width * (window.devicePixelRatio || 1)}
        height={size.height * (window.devicePixelRatio || 1)}
        style={{ width: size.width, height: size.height }}
        className={cn("block touch-none", busy && "opacity-90")}
        data-testid="board-canvas"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      {isMaster ? (
        <div className="absolute right-3 top-3 flex gap-2">
          {onAddToken ? (
            <Button size="sm" className="ui-hover gap-1" onClick={onAddToken} data-testid="add-token">
              <Plus className="size-4" />
              Токен
            </Button>
          ) : null}
          {onClearTokens ? (
            <Button
              size="sm"
              variant="outline"
              className="ui-hover gap-1"
              onClick={() => {
                if (window.confirm("Убрать все токены с доски?")) onClearTokens();
              }}
              data-testid="clear-tokens"
            >
              <Eraser className="size-4" />
              Очистить
            </Button>
          ) : null}
        </div>
      ) : null}

      {contextMenu && menuToken ? (
        <div
          className="panel absolute z-10 min-w-[160px] p-1 text-sm shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-testid="token-context-menu"
        >
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {menuToken.label} · {TOKEN_KIND_LABELS[menuToken.kind]}
          </div>
          <button
            type="button"
            className="ui-hover flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => {
              onEditToken?.(menuToken.id);
              setContextMenu(null);
            }}
          >
            Править
          </button>
          <button
            type="button"
            className="ui-hover flex w-full rounded-sm px-2 py-1.5 text-left text-destructive hover:bg-destructive/15"
            onClick={() => {
              onRemoveToken?.(menuToken.id);
              setContextMenu(null);
            }}
          >
            Удалить
          </button>
        </div>
      ) : null}
    </div>
  );
}

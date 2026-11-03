import { useEffect, useRef } from "react";
import type { BoardDto, TokenDto, TokenKind } from "@/lib/game-contract";
import {
  cellAtWorld,
  fitView,
  hitTestToken,
  isEditableTarget,
  screenToWorld,
  tokenCenterWorld,
  zoomAt,
  type ViewState,
} from "@/lib/geometry";

export interface BoardCanvasProps {
  board: BoardDto;
  tokens: TokenDto[];
  meId: number;
  isMaster: boolean;
  showGrid: boolean;
  selectedTokenId: number | null;
  /** токен, для которого сейчас идёт pending-мутация перемещения */
  pendingTokenIds?: ReadonlySet<number>;
  onSelectToken: (id: number | null) => void;
  /** drag завершён: итоговая клетка (отличается от исходной) */
  onTokenDrop: (token: TokenDto, cellX: number, cellY: number) => void;
  /** dblclick по токену (мастер) — открыть редактор */
  onEditToken: (token: TokenDto) => void;
}

const TOKEN_COLORS: Record<TokenKind, { fill: string; ring: string; text: string }> = {
  hero: { fill: "#ffca34", ring: "#ffe08a", text: "#191715" },
  monster: { fill: "#b04a3a", ring: "#d97a66", text: "#f4ecd8" },
  prop: { fill: "#7d8c5c", ring: "#a5b583", text: "#191715" },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Процедурный фон-заглушка поля: тёмная «пергаментная» текстура с шумом
 * и пятнами. Генерируется один раз на поле в offscreen-тайл 256×256.
 */
function createBackgroundTile(seed: number): HTMLCanvasElement {
  const size = 256;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  const rand = mulberry32(seed * 2654435761 + 97);
  if (!ctx) return tile;

  ctx.fillStyle = "#2a2520";
  ctx.fillRect(0, 0, size, size);

  // крупные пятна потемнения/посветления
  for (let i = 0; i < 26; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 46;
    const lighten = rand() > 0.5;
    const alpha = 0.03 + rand() * 0.05;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, lighten ? `rgba(244,236,216,${alpha})` : `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // точечный шум
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n * 0.8));
  }
  ctx.putImageData(image, 0, 0);

  // редкие царапины
  ctx.strokeStyle = "rgba(244,236,216,0.04)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90);
    ctx.stroke();
  }
  return tile;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface DragState {
  tokenId: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCellX: number;
  startCellY: number;
  cellX: number;
  cellY: number;
  moved: boolean;
}

interface PanState {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
}

export function BoardCanvas(props: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const viewRef = useRef<ViewState | null>(null);
  const dirtyRef = useRef(true);
  const rafRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const spaceRef = useRef(false);
  const panningRef = useRef(false);
  const bgRef = useRef<{ boardId: number; tile: HTMLCanvasElement } | null>(null);

  const drawRef = useRef<() => void>(() => {});
  // Кадр рисуется только по dirty-flag: без постоянного цикла 60 fps.
  const markDirty = () => {
    dirtyRef.current = true;
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        drawRef.current();
      });
    }
  };

  // ---- отрисовка по dirty-flag ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      markDirty();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const p = propsRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const vw = canvas.width / dpr;
      const vh = canvas.height / dpr;
      if (vw <= 0 || vh <= 0) return;

      if (!viewRef.current) {
        viewRef.current = fitView(p.board, vw, vh);
      }
      const view = viewRef.current;
      const cell = p.board.cellSize;
      const boardW = p.board.gridWidth * cell;
      const boardH = p.board.gridHeight * cell;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // подложка всего экрана
      ctx.fillStyle = "#191715";
      ctx.fillRect(0, 0, vw, vh);

      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);

      // фон поля (процедурная текстура)
      if (!bgRef.current || bgRef.current.boardId !== p.board.id) {
        bgRef.current = { boardId: p.board.id, tile: createBackgroundTile(p.board.id) };
      }
      const pattern = ctx.createPattern(bgRef.current.tile, "repeat");
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, boardW, boardH);
      ctx.clip();
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, boardW, boardH);
      } else {
        ctx.fillStyle = "#2a2520";
        ctx.fillRect(0, 0, boardW, boardH);
      }

      // сетка поверх фона
      if (p.showGrid && cell * view.scale >= 6) {
        ctx.strokeStyle = "rgba(244,236,216,0.09)";
        ctx.lineWidth = 1 / view.scale;
        ctx.beginPath();
        for (let x = 0; x <= p.board.gridWidth; x += 1) {
          ctx.moveTo(x * cell, 0);
          ctx.lineTo(x * cell, boardH);
        }
        for (let y = 0; y <= p.board.gridHeight; y += 1) {
          ctx.moveTo(0, y * cell);
          ctx.lineTo(boardW, y * cell);
        }
        ctx.stroke();
      }
      ctx.restore();

      // рамка поля
      ctx.strokeStyle = "rgba(244,236,216,0.22)";
      ctx.lineWidth = 1.5 / view.scale;
      ctx.strokeRect(0, 0, boardW, boardH);

      // подсветка целевой клетки при drag
      const drag = dragRef.current;
      if (drag) {
        ctx.fillStyle = "rgba(255,202,52,0.16)";
        ctx.strokeStyle = "rgba(255,202,52,0.65)";
        ctx.lineWidth = 1.5 / view.scale;
        const dt = p.tokens.find((t) => t.id === drag.tokenId);
        const size = dt ? dt.size : 1;
        ctx.fillRect(drag.cellX * cell, drag.cellY * cell, size * cell, size * cell);
        ctx.strokeRect(drag.cellX * cell, drag.cellY * cell, size * cell, size * cell);
      }

      // токены: круг, инициалы, HP, подпись
      const fontLabel = Math.max(10, 12 / view.scale);
      const fontHp = Math.max(9, 10 / view.scale);
      for (const t of p.tokens) {
        const isDragged = drag?.tokenId === t.id && drag.moved;
        const cx = isDragged ? (drag.cellX + t.size / 2) * cell : tokenCenterWorld(t, cell).x;
        const cy = isDragged ? (drag.cellY + t.size / 2) * cell : tokenCenterWorld(t, cell).y;
        const r = (t.size * cell) / 2 - 2;
        if (r <= 0) continue;
        const colors = TOKEN_COLORS[t.kind] ?? TOKEN_COLORS.prop;
        const selected = p.selectedTokenId === t.id;
        const pending = p.pendingTokenIds?.has(t.id) ?? false;

        // тень
        ctx.beginPath();
        ctx.arc(cx, cy + 2 / view.scale, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();

        // тело
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.fill;
        ctx.globalAlpha = isDragged ? 0.85 : pending ? 0.75 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = selected ? 3 / view.scale : 1.5 / view.scale;
        ctx.strokeStyle = selected ? "#f4ecd8" : colors.ring;
        ctx.stroke();

        // инициалы
        const fontSize = Math.min(r * 0.9, Math.max(9, 14 / view.scale));
        ctx.fillStyle = colors.text;
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(t.label), cx, cy);

        // HP-бар над токеном
        if (t.maxHp > 0) {
          const pct = Math.max(0, Math.min(1, t.hp / t.maxHp));
          const barW = r * 1.7;
          const barH = Math.max(3, 4 / view.scale);
          const bx = cx - barW / 2;
          const by = cy - r - barH - Math.max(3, 4 / view.scale);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(bx, by, barW, barH);
          ctx.fillStyle = pct > 0.5 ? "#7da05c" : pct > 0.25 ? "#c99a3a" : "#b04a3a";
          ctx.fillRect(bx, by, barW * pct, barH);
          ctx.strokeStyle = "rgba(244,236,216,0.3)";
          ctx.lineWidth = 1 / view.scale;
          ctx.strokeRect(bx, by, barW, barH);
        }

        // подпись под токеном
        ctx.font = `${fontLabel}px system-ui, sans-serif`;
        const label = t.maxHp > 0 ? `${t.label} · ${t.hp}/${t.maxHp}` : t.label;
        const ty = cy + r + fontLabel * 0.75;
        const metrics = ctx.measureText(label);
        const pad = 3 / view.scale;
        ctx.fillStyle = "rgba(25,23,21,0.72)";
        ctx.fillRect(
          cx - metrics.width / 2 - pad,
          ty - fontLabel * 0.62,
          metrics.width + pad * 2,
          fontLabel * 1.24,
        );
        ctx.fillStyle = selected ? "#ffca34" : "#f4ecd8";
        ctx.fillText(label, cx, ty);

        if (pending) {
          ctx.font = `${fontHp}px system-ui, sans-serif`;
          ctx.fillStyle = "rgba(255,202,52,0.9)";
          ctx.fillText("…", cx, cy - r - Math.max(10, 12 / view.scale));
        }
      }

      ctx.restore();
    };

    drawRef.current = draw;
    // первый кадр после монтирования
    if (dirtyRef.current && rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        drawRef.current();
      });
    }

    return () => {
      ro.disconnect();
      drawRef.current = () => {};
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, []);

  // данные/флаги изменились → кадр грязный
  useEffect(() => {
    markDirty();
  }, [
    props.tokens,
    props.board,
    props.showGrid,
    props.selectedTokenId,
    props.pendingTokenIds,
    props.meId,
    props.isMaster,
  ]);

  // смена поля → сброс вида
  useEffect(() => {
    viewRef.current = null;
    markDirty();
  }, [props.board.id]);

  // ---- клавиатура: Space = pan, Escape = отмена ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.code === "Space") {
        spaceRef.current = true;
        e.preventDefault();
        markDirty();
      } else if (e.code === "Escape") {
        if (dragRef.current) {
          dragRef.current = null;
          markDirty();
        } else if (propsRef.current.selectedTokenId !== null) {
          propsRef.current.onSelectToken(null);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    const onBlur = () => {
      spaceRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ---- колесо: zoom к курсору (непассивный слушатель) ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      if (!view) return;
      const factor = Math.exp(-e.deltaY * 0.0015);
      viewRef.current = zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, factor);
      markDirty();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  };

  const canDragToken = (t: TokenDto): boolean =>
    propsRef.current.isMaster || t.ownerId === propsRef.current.meId;

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return;
    const p = propsRef.current;
    const { x, y } = toLocal(e);

    // средняя кнопка или Space+левая — pan
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      panRef.current = { pointerId: e.pointerId, lastClientX: e.clientX, lastClientY: e.clientY };
      panningRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const world = screenToWorld(view, x, y);
    const hitId = hitTestToken(p.tokens, p.board.cellSize, world.x, world.y);
    if (hitId !== null) {
      const token = p.tokens.find((t) => t.id === hitId);
      if (token && canDragToken(token)) {
        dragRef.current = {
          tokenId: token.id,
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startCellX: token.cellX,
          startCellY: token.cellY,
          cellX: token.cellX,
          cellY: token.cellY,
          moved: false,
        };
        canvas.setPointerCapture(e.pointerId);
      } else if (token) {
        // чужой токен для игрока — только выбор
        p.onSelectToken(token.id);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const p = propsRef.current;

    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      const dx = e.clientX - pan.lastClientX;
      const dy = e.clientY - pan.lastClientY;
      pan.lastClientX = e.clientX;
      pan.lastClientY = e.clientY;
      viewRef.current = { ...view, x: view.x + dx, y: view.y + dy };
      markDirty();
      return;
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (!drag.moved && dist < 4) return;
      drag.moved = true;
      const { x, y } = toLocal(e);
      const world = screenToWorld(view, x, y);
      const token = p.tokens.find((t) => t.id === drag.tokenId);
      const size = token ? token.size : 1;
      // снапшот к клеткам: указатель — центр токена
      const cellPos = cellAtWorld(
        p.board.cellSize,
        world.x - ((size - 1) * p.board.cellSize) / 2,
        world.y - ((size - 1) * p.board.cellSize) / 2,
      );
      const maxX = p.board.gridWidth - size;
      const maxY = p.board.gridHeight - size;
      drag.cellX = Math.max(0, Math.min(maxX, cellPos.cellX));
      drag.cellY = Math.max(0, Math.min(maxY, cellPos.cellY));
      markDirty();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      panRef.current = null;
      panningRef.current = false;
      if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      dragRef.current = null;
      if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const p = propsRef.current;
      const token = p.tokens.find((t) => t.id === drag.tokenId);
      if (!token) {
        markDirty();
        return;
      }
      if (!drag.moved) {
        // клик без перемещения — выбор токена
        p.onSelectToken(p.selectedTokenId === token.id ? null : token.id);
      } else if (drag.cellX !== drag.startCellX || drag.cellY !== drag.startCellY) {
        p.onTokenDrop(token, drag.cellX, drag.cellY);
      }
      markDirty();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    const p = propsRef.current;
    const { x, y } = toLocal(e);
    const world = screenToWorld(view, x, y);
    const hitId = hitTestToken(p.tokens, p.board.cellSize, world.x, world.y);
    if (hitId !== null) {
      const token = p.tokens.find((t) => t.id === hitId);
      if (token && p.isMaster) {
        p.onEditToken(token);
        return;
      }
    }
    // dblclick по пустому месту — сброс вида
    const container = containerRef.current;
    if (container) {
      viewRef.current = fitView(p.board, container.clientWidth, container.clientHeight);
      markDirty();
    }
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background">
      <canvas
        ref={canvasRef}
        aria-label="Игровое поле"
        data-testid="board-canvas"
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

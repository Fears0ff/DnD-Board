import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * E2E: загрузка изображений — фон поля (мастер, через меню поля) и
 * изображение токена (через диалог токена). Проверяются UI-флоу,
 * авторизованная раздача GET /api/board-image и фактическая отрисовка
 * на canvas (пиксельная проба).
 *
 * Пользователи suite: первый пользователь БД (master_e2e из board.spec.ts)
 * уже мастер, поэтому свой мастер продвигается через users.setGameRole.
 */

interface BoardDto {
  id: number;
  name: string;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
  isActive: boolean;
  backgroundKey: string | null;
}

interface TokenDto {
  id: number;
  boardId: number;
  label: string;
  imageKey: string | null;
  cellX: number;
  cellY: number;
}

interface GameStateDto {
  revision: number;
  me: { id: number; login: string; gameRole: string };
  boards: BoardDto[];
  activeBoard: BoardDto | null;
  viewedBoard: BoardDto | null;
  tokens: TokenDto[];
}

const PASSWORD = "correct-horse-42";
const MASTER_LOGIN = "dm_media";
const PLAYER_LOGIN = "pc_media";
// Мастер всего suite (создаётся в board.spec.ts, который идёт первым).
const SUITE_MASTER = { login: "master_e2e", password: PASSWORD };

/* ------------------------------ tRPC helpers ------------------------------ */

function unwrapTrpc(payload: { result?: { data?: unknown } }): unknown {
  const data = payload?.result?.data;
  return data && typeof data === "object" && "json" in data ? data.json : data;
}

async function trpcQuery<T>(api: APIRequestContext, path: string): Promise<T> {
  const response = await api.get(`/api/trpc/${path}`);
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  return unwrapTrpc(payload) as T;
}

async function trpcMutation<T>(
  api: APIRequestContext,
  path: string,
  input: unknown,
): Promise<T> {
  const response = await api.post(`/api/trpc/${path}`, {
    data: { json: input },
    headers: { "content-type": "application/json" },
  });
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  const data = unwrapTrpc(payload);
  if (data && typeof data === "object") {
    if ("board" in data) return (data as { board: unknown }).board as T;
    if ("card" in data) return (data as { card: unknown }).card as T;
  }
  return data as T;
}

/* ------------------------------ setup helpers ----------------------------- */

async function registerOrLogin(
  context: BrowserContext,
  login: string,
  displayName: string,
): Promise<void> {
  const res = await context.request.post("/api/trpc/auth.register", {
    data: { json: { login, password: PASSWORD, displayName } },
    headers: { "content-type": "application/json" },
  });
  if (res.status() === 409) {
    // Пользователь уже создан (повторный прогон beforeAll в том же suite).
    const loginRes = await context.request.post("/api/trpc/auth.login", {
      data: { json: { login, password: PASSWORD } },
      headers: { "content-type": "application/json" },
    });
    if (!loginRes.ok()) throw new Error(`login ${login}: ${loginRes.status()}`);
    return;
  }
  if (!res.ok())
    throw new Error(`register ${login}: ${res.status()} ${await res.text()}`);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    await registerOrLogin(ctx, MASTER_LOGIN, "Мастер картинок");
    const me = await trpcQuery<{ id: number; gameRole: string }>(
      ctx.request,
      "auth.me",
    );
    if (me.gameRole === "master") return;
    const admin = await browser.newContext();
    try {
      const loginRes = await admin.request.post("/api/trpc/auth.login", {
        data: { json: SUITE_MASTER },
        headers: { "content-type": "application/json" },
      });
      if (!loginRes.ok())
        throw new Error(`bootstrap: suite master unavailable: ${loginRes.status()}`);
      await trpcMutation(admin.request, "users.setGameRole", {
        userId: me.id,
        gameRole: "master",
      });
    } finally {
      await admin.close();
    }
  } finally {
    await ctx.close();
  }
});

async function loginContext(
  browser: Browser,
  login: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/trpc/auth.login", {
    data: { json: { login, password: PASSWORD } },
    headers: { "content-type": "application/json" },
  });
  if (!res.ok()) throw new Error(`login ${login}: ${res.status()}`);
  return context;
}

/** Реальный маленький PNG заданного цвета, сгенерированный в браузере. */
async function makePng(page: Page, color: string): Promise<Buffer> {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/png");
  }, color);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Пиксель canvas в точке поля (fx, fy — клетки), с учётом fitView и DPR. */
async function canvasPixel(
  page: Page,
  board: BoardDto,
  fx: number,
  fy: number,
): Promise<[number, number, number] | null> {
  return page.evaluate(
    ([fx, fy, gw, gh, cell]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="board-canvas"]',
      );
      if (!canvas) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const scale = Math.max(
        0.25,
        Math.min(4, (w - 96) / (gw * cell), (h - 96) / (gh * cell)),
      );
      const offsetX = (w - gw * cell * scale) / 2;
      const offsetY = (h - gh * cell * scale) / 2;
      const x = Math.round((offsetX + fx * cell * scale) * dpr);
      const y = Math.round((offsetY + fy * cell * scale) * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [fx, fy, board.gridWidth, board.gridHeight, board.cellSize],
  );
}

/** Ждёт, пока пиксель поля (fx, fy — клетки) не удовлетворит предикату. */
async function expectPixel(
  page: Page,
  board: BoardDto,
  fx: number,
  fy: number,
  predicate: (px: [number, number, number]) => boolean,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const px = await canvasPixel(page, board, fx, fy);
        return px !== null && predicate(px);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** Меню полей в шапке (триггер с иконкой карты). */
function boardsMenuTrigger(page: Page) {
  return page.locator('header button[aria-haspopup="menu"]:has(svg.lucide-map)');
}

/** realtime-обновление может закрыть открытое меню между hover и click. */
async function clickBoardMenuItem(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const item = page.getByRole("menuitem", { name });
    if (!(await item.isVisible())) await boardsMenuTrigger(page).click();
    await expect(item).toBeVisible();
    try {
      await item.click({ timeout: 3_000 });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.keyboard.press("Escape");
    }
  }
}

async function boardState(page: Page, boardId: number): Promise<BoardDto> {
  const state = await trpcQuery<GameStateDto>(page.request, "game.state");
  const board = state.boards.find((b) => b.id === boardId);
  if (!board) throw new Error(`board ${boardId} not found in game.state`);
  return board;
}

/* --------------------------------- tests ---------------------------------- */

test("фон поля: загрузка PNG, отрисовка, замена и удаление", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await loginContext(browser, MASTER_LOGIN);
  const page = await context.newPage();
  try {
    // Поле создаётся до открытия страницы, чтобы UI сразу показал canvas.
    const board = await trpcMutation<BoardDto>(context.request, "boards.create", {
      name: "Карта медиа",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(context.request, "boards.setActive", { id: board.id });

    await page.goto("/");
    await expect(page.getByTestId("board-canvas")).toBeVisible();

    // --- загрузка фона через меню поля ---
    const red = await makePng(page, "#e11d48");
    await clickBoardMenuItem(page, "Загрузить фон");
    await page
      .locator('input[aria-label="Файл фона поля"]')
      .setInputFiles({ name: "bg-red.png", mimeType: "image/png", buffer: red });
    await expect(page.getByText("Фон поля «Карта медиа» обновлён")).toBeVisible();

    let current = await boardState(page, board.id);
    expect(current.backgroundKey).toBeTruthy();
    const firstKey = current.backgroundKey as string;

    // --- авторизованная раздача: байты, MIME, заголовки безопасности ---
    const delivery = await page.request.get(
      `/api/board-image?key=${encodeURIComponent(firstKey)}`,
    );
    expect(delivery.status()).toBe(200);
    expect(delivery.headers()["content-type"]).toBe("image/png");
    expect(delivery.headers()["x-content-type-options"]).toBe("nosniff");
    expect(delivery.headers()["cache-control"]).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(Buffer.from(await delivery.body()).equals(red)).toBe(true);

    // --- canvas реально рисует фон (красный пиксель внутри поля) ---
    await expectPixel(
      page,
      board,
      board.gridWidth / 4,
      board.gridHeight / 2,
      (px) => px[0] > 180 && px[1] < 90 && px[2] < 120,
    );

    // --- замена фона: новый ключ, старый объект удалён (404) ---
    const blue = await makePng(page, "#1d4ed8");
    await clickBoardMenuItem(page, "Заменить фон");
    await page
      .locator('input[aria-label="Файл фона поля"]')
      .setInputFiles({ name: "bg-blue.png", mimeType: "image/png", buffer: blue });
    // Ждём смену ключа в серверном состоянии (тост может совпасть с первым).
    await expect
      .poll(async () => (await boardState(page, board.id)).backgroundKey, {
        timeout: 15_000,
      })
      .not.toBe(firstKey);

    current = await boardState(page, board.id);
    expect(current.backgroundKey).toBeTruthy();
    const secondKey = current.backgroundKey as string;
    const oldDelivery = await page.request.get(
      `/api/board-image?key=${encodeURIComponent(firstKey)}`,
    );
    expect(oldDelivery.status()).toBe(404);

    await expectPixel(
      page,
      board,
      board.gridWidth / 4,
      board.gridHeight / 2,
      (px) => px[2] > 180 && px[0] < 90,
    );

    // --- удаление фона: ключ второй замены тоже удаляется (404) ---
    await clickBoardMenuItem(page, "Убрать фон");
    await expect(page.getByText("Фон поля убран")).toBeVisible();
    await expect
      .poll(async () => (await boardState(page, board.id)).backgroundKey, {
        timeout: 15_000,
      })
      .toBeNull();
    const removedDelivery = await page.request.get(
      `/api/board-image?key=${encodeURIComponent(secondKey)}`,
    );
    expect(removedDelivery.status()).toBe(404);
  } finally {
    await context.close();
  }
});

test("изображение токена: загрузка через диалог, раздача, отрисовка; права", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await loginContext(browser, MASTER_LOGIN);
  const page = await context.newPage();
  const playerContext = await browser.newContext();
  try {
    // Игрок для негативных проверок прав.
    await registerOrLogin(playerContext, PLAYER_LOGIN, "Игрок медиа");

    const board = await trpcMutation<BoardDto>(context.request, "boards.create", {
      name: "Карта токенов",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(context.request, "boards.setActive", { id: board.id });

    await page.goto("/");
    await expect(page.getByTestId("board-canvas")).toBeVisible();

    // --- диалог нового токена: имя + загрузка изображения ---
    await page.getByRole("button", { name: "Токен", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("#token-label").fill("Зелёный герой");

    const green = await makePng(page, "#16a34a");
    await dialog.getByRole("button", { name: "Загрузить", exact: true }).click();
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: "token.png", mimeType: "image/png", buffer: green });
    // превью появляется после аплоада
    await expect(dialog.locator('img[alt="Изображение токена"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog).toBeHidden();

    // --- серверное состояние: у токена есть imageKey, байты раздаются ---
    let token: TokenDto | undefined;
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(page.request, "game.state");
        token = state.tokens.find((t) => t.label === "Зелёный герой");
        return token?.imageKey ?? null;
      })
      .not.toBeNull();
    const imageKey = token?.imageKey as string;
    const delivery = await page.request.get(
      `/api/board-image?key=${encodeURIComponent(imageKey)}`,
    );
    expect(delivery.status()).toBe(200);
    expect(delivery.headers()["content-type"]).toBe("image/png");
    expect(Buffer.from(await delivery.body()).equals(green)).toBe(true);

    // --- canvas рисует изображение токена (зелёный центр токена) ---
    const state = await trpcQuery<GameStateDto>(page.request, "game.state");
    const placed = state.tokens.find((t) => t.imageKey === imageKey);
    if (!placed) throw new Error("token missing in state");
    await expectPixel(
      page,
      board,
      placed.cellX + 0.5,
      placed.cellY + 0.5,
      (px) => px[1] > 120 && px[0] < 90 && px[2] < 110,
    );

    // --- права: аноним 401 на раздаче, игроку 403 на upload для поля ---
    const anon = await browser.newContext();
    try {
      const anonDelivery = await anon.request.get(
        `/api/board-image?key=${encodeURIComponent(imageKey)}`,
      );
      expect(anonDelivery.status()).toBe(401);
    } finally {
      await anon.close();
    }

    const playerUpload = await playerContext.request.post(
      "/api/trpc/media.uploadImage",
      {
        data: {
          json: { dataBase64: green.toString("base64"), purpose: "board" },
        },
        headers: { "content-type": "application/json" },
      },
    );
    expect(playerUpload.status()).toBe(403);

    // ...но для собственной item-карточки игроку разрешено (права §4.3).
    // compendium.create — master-only, поэтому игрок получает собственную
    // карточку через compendium.copy общей карточки мастера.
    const sharedCard = await trpcMutation<{ id: number }>(
      context.request,
      "compendium.create",
      { type: "item", name: "Общее кольцо", visibility: "shared", data: {} },
    );
    const ownCard = await trpcMutation<{ id: number }>(
      playerContext.request,
      "compendium.copy",
      { id: sharedCard.id },
    );
    const okUpload = await playerContext.request.post(
      "/api/trpc/media.uploadImage",
      {
        data: {
          json: {
            dataBase64: green.toString("base64"),
            purpose: "compendium",
            compendiumId: ownCard.id,
          },
        },
        headers: { "content-type": "application/json" },
      },
    );
    expect(okUpload.status()).toBe(200);

    // Чужая карточка (createdBy = мастер) игроку запрещена.
    const foreignUpload = await playerContext.request.post(
      "/api/trpc/media.uploadImage",
      {
        data: {
          json: {
            dataBase64: green.toString("base64"),
            purpose: "compendium",
            compendiumId: sharedCard.id,
          },
        },
        headers: { "content-type": "application/json" },
      },
    );
    expect(foreignUpload.status()).toBe(403);
  } finally {
    await context.close();
    await playerContext.close();
  }
});

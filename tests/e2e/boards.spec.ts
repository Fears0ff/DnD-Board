import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * E2E: UX управления несколькими полями — переименование, просмотр неактивного
 * поля мастером, удаление просматриваемого неактивного (возврат к активному),
 * удаление активного (другое поле становится активным и у игрока), удаление
 * последнего поля (пустое состояние) и повторное создание первого поля.
 *
 * Пользователи suite: master_e2e (board.spec.ts) уже мастер; свой мастер
 * продвигается через users.setGameRole, как в controls.spec.ts.
 */

interface BoardDto {
  id: number;
  name: string;
  isActive: boolean;
}

interface GameStateDto {
  boards: BoardDto[];
  activeBoard: BoardDto | null;
  viewedBoard: BoardDto | null;
}

const PASSWORD = "correct-horse-42";
const MASTER_LOGIN = "dm_boards";
const PLAYER_LOGIN = "pc_boards";
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
  if (data && typeof data === "object" && "board" in data) {
    return (data as { board: unknown }).board as T;
  }
  return data as T;
}

async function gameState(api: APIRequestContext): Promise<GameStateDto> {
  return trpcQuery<GameStateDto>(api, "game.state");
}

/* ------------------------------ setup helpers ----------------------------- */

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    const res = await ctx.request.post("/api/trpc/auth.register", {
      data: {
        json: { login: MASTER_LOGIN, password: PASSWORD, displayName: "Мастер полей" },
      },
      headers: { "content-type": "application/json" },
    });
    if (res.status() === 409) {
      // Уже создан (повторный beforeAll в том же suite) — просто логинимся.
      const loginRes = await ctx.request.post("/api/trpc/auth.login", {
        data: { json: { login: MASTER_LOGIN, password: PASSWORD } },
        headers: { "content-type": "application/json" },
      });
      if (!loginRes.ok())
        throw new Error(`bootstrap login: ${loginRes.status()}`);
    } else if (!res.ok()) {
      throw new Error(`bootstrap register: ${res.status()} ${await res.text()}`);
    }
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

async function registerPlayer(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/trpc/auth.register", {
    data: {
      json: { login: PLAYER_LOGIN, password: PASSWORD, displayName: "Игрок полей" },
    },
    headers: { "content-type": "application/json" },
  });
  if (res.status() === 409) {
    const loginRes = await context.request.post("/api/trpc/auth.login", {
      data: { json: { login: PLAYER_LOGIN, password: PASSWORD } },
      headers: { "content-type": "application/json" },
    });
    if (!loginRes.ok()) throw new Error(`player login: ${loginRes.status()}`);
    return context;
  }
  if (!res.ok()) throw new Error(`player register: ${res.status()}`);
  return context;
}

/** Меню полей в шапке (триггер с иконкой карты). */
function boardsMenuTrigger(page: Page) {
  return page.locator('header button[aria-haspopup="menu"]:has(svg.lucide-map)');
}

async function openBoardsMenu(page: Page) {
  await boardsMenuTrigger(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Создать поле" }),
  ).toBeVisible();
}

/** Мастер смотрит конкретное поле через меню. */
async function viewBoard(page: Page, name: string) {
  await openBoardsMenu(page);
  await page.getByRole("menuitem", { name, exact: false }).first().click();
  await expect(boardsMenuTrigger(page)).toContainText(name);
}

/** Удаление просматриваемого поля через меню + диалог подтверждения. */
async function deleteViewedBoard(page: Page) {
  await openBoardsMenu(page);
  await page.getByRole("menuitem", { name: "Удалить поле" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/* --------------------------------- tests ---------------------------------- */

test("переименование, просмотр неактивного и удаление просматриваемого неактивного поля", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await loginContext(browser, MASTER_LOGIN);
  const page = await context.newPage();
  try {
    const alpha = await trpcMutation<BoardDto>(context.request, "boards.create", {
      name: "Альфа",
    });
    const beta = await trpcMutation<BoardDto>(context.request, "boards.create", {
      name: "Бета",
    });
    await trpcMutation(context.request, "boards.setActive", { id: alpha.id });

    await page.goto("/");
    await expect(page.getByTestId("board-canvas")).toBeVisible();
    await expect(boardsMenuTrigger(page)).toContainText("Альфа");

    // Просмотр неактивного поля: предупреждающая плашка видна.
    await viewBoard(page, "Бета");
    await expect(
      page.getByText("Это поле сейчас не видно игрокам", { exact: false }),
    ).toBeVisible();

    // Переименование просматриваемого поля.
    await openBoardsMenu(page);
    await page.getByRole("menuitem", { name: "Переименовать" }).click();
    const renameDialog = page.getByRole("dialog");
    await renameDialog.locator("#board-name").fill("Бета-2");
    await renameDialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(renameDialog).toBeHidden();
    await expect(boardsMenuTrigger(page)).toContainText("Бета-2");
    let state = await gameState(page.request);
    expect(state.boards.find((b) => b.id === beta.id)?.name).toBe("Бета-2");

    // Удаление просматриваемого НЕАКТИВНОГО поля: вид возвращается к активному.
    await deleteViewedBoard(page);
    await expect(boardsMenuTrigger(page)).toContainText("Альфа");
    await expect(
      page.getByText("Это поле сейчас не видно игрокам", { exact: false }),
    ).toBeHidden();
    state = await gameState(page.request);
    expect(state.boards.map((b) => b.id)).not.toContain(beta.id);
    expect(state.activeBoard?.id).toBe(alpha.id);
    expect(state.viewedBoard?.id).toBe(alpha.id);
  } finally {
    await context.close();
  }
});

test("удаление активного поля: другое становится активным и у игрока", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await loginContext(browser, MASTER_LOGIN);
  const playerCtx = await registerPlayer(browser);
  const page = await context.newPage();
  const player = await playerCtx.newPage();
  try {
    const gamma = await trpcMutation<BoardDto>(context.request, "boards.create", {
      name: "Гамма",
    });
    await trpcMutation(context.request, "boards.setActive", { id: gamma.id });

    await page.goto("/");
    await player.goto("/");
    await expect(page.getByTestId("board-canvas")).toBeVisible();
    await expect(player.getByTestId("board-canvas")).toBeVisible();
    await expect(player.locator("header")).toContainText("Гамма");

    // Ожидаемое следующее активное поле — первое из оставшихся (по id).
    const before = await gameState(context.request);
    const expectedNext = before.boards
      .filter((b) => b.id !== gamma.id)
      .sort((a, b) => a.id - b.id)[0];
    expect(expectedNext).toBeDefined();

    // Мастер смотрит активное «Гамма» и удаляет его.
    await viewBoard(page, "Гамма");
    await deleteViewedBoard(page);

    // Мастер возвращается к новому активному полю…
    await expect(boardsMenuTrigger(page)).toContainText(expectedNext.name);
    // …и игрок тоже переключается на него (WS/polling).
    await expect(player.locator("header")).toContainText(expectedNext.name, {
      timeout: 15_000,
    });
    const playerState = await gameState(player.request);
    expect(playerState.activeBoard?.id).toBe(expectedNext.id);
    expect(playerState.viewedBoard?.id).toBe(expectedNext.id);
  } finally {
    await context.close();
    await playerCtx.close();
  }
});

test("удаление последнего поля: пустое состояние и создание первого заново", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await loginContext(browser, MASTER_LOGIN);
  const page = await context.newPage();
  try {
    // Удаляем ВСЕ поля (включая оставшиеся от других spec-файлов — они уже
    // отработали; controls/media создают собственные поля).
    const state = await gameState(context.request);
    for (const board of state.boards) {
      await trpcMutation(context.request, "boards.remove", { id: board.id });
    }
    expect((await gameState(context.request)).boards).toHaveLength(0);

    await page.goto("/");
    // Пустое состояние: заглушка и кнопка создания.
    await expect(page.getByText("Игровое поле не создано")).toBeVisible();
    await expect(boardsMenuTrigger(page)).toContainText("Нет поля");
    await expect(
      page.getByRole("button", { name: "Токен", exact: true }),
    ).toBeDisabled();

    // Создание первого поля заново из пустого состояния.
    await page
      .getByRole("button", { name: "Создать поле", exact: true })
      .click();
    await expect(page.getByTestId("board-canvas")).toBeVisible();
    const after = await gameState(context.request);
    expect(after.boards).toHaveLength(1);
    expect(after.boards[0].isActive).toBe(true);
    expect(after.activeBoard?.id).toBe(after.boards[0].id);
    await expect(boardsMenuTrigger(page)).toContainText(after.boards[0].name);
  } finally {
    await context.close();
  }
});

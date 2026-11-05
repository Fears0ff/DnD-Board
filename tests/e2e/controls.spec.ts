import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

/* -------------------------------------------------------------------------- */
/* DTO + tRPC helpers (образец — board.spec.ts; input опускаем, когда его нет) */
/* -------------------------------------------------------------------------- */

interface BoardDto {
  id: number;
  name: string;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
  isActive: boolean;
}

interface TokenDto {
  id: number;
  boardId: number;
  label: string;
  ownerId: number | null;
  characterId: number | null;
  compendiumId: number | null;
  cellX: number;
  cellY: number;
  hp: number | null;
  maxHp: number | null;
}

interface GameStateDto {
  revision: number;
  me: { id: number; login: string; gameRole: string };
  activeBoard: BoardDto | null;
  viewedBoard: BoardDto | null;
  tokens: TokenDto[];
  initiative: Array<{ tokenId: number; value: number }>;
}

function unwrapTrpc(payload: { result?: { data?: unknown } }): unknown {
  const data = payload?.result?.data;
  return data && typeof data === "object" && "json" in data ? data.json : data;
}

async function trpcQuery<T>(
  api: APIRequestContext,
  path: string,
  input?: unknown,
): Promise<T> {
  const suffix =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await api.get(`/api/trpc/${path}${suffix}`);
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
    if ("board" in data) return data.board as T;
    if ("token" in data) return data.token as T;
  }
  return data as T;
}

async function trpcQueryStatus(
  api: APIRequestContext,
  path: string,
): Promise<number> {
  const response = await api.get(`/api/trpc/${path}`);
  return response.status();
}

/* ------------------------------ UI helpers -------------------------------- */

const PASSWORD = "correct-horse-42";
const MASTER_LOGIN = "dm_controls";
// Мастер всего suite (создаётся в board.spec.ts, который идёт первым).
const SUITE_MASTER = { login: "master_e2e", password: PASSWORD };

async function register(page: Page, login: string, displayName: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await page.getByLabel("Логин").fill(login);
  await page.getByLabel("Имя за столом").fill(displayName);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Повторите пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
}

async function login(page: Page, userLogin: string) {
  await page.goto("/");
  await page.getByLabel("Логин").fill(userLogin);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
}

/**
 * Первый пользователь БД становится мастером автоматически. При запуске всего
 * suite мастером уже является master_e2e из board.spec.ts, поэтому наш пользователь
 * получает роль мастера через users.setGameRole.
 */
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  try {
    const res = await ctx.request.post("/api/trpc/auth.register", {
      data: {
        json: { login: MASTER_LOGIN, password: PASSWORD, displayName: "Ведущий" },
      },
      headers: { "content-type": "application/json" },
    });
    if (!res.ok())
      throw new Error(`bootstrap register: ${res.status()} ${await res.text()}`);
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
        throw new Error(
          `bootstrap: suite master ${SUITE_MASTER.login} unavailable: ${loginRes.status()}`,
        );
      await trpcMutation(admin.request, "users.setGameRole", {
        userId: me.id,
        gameRole: "master",
      });
    } finally {
      await admin.close();
    }
    const promoted = await trpcQuery<{ gameRole: string }>(ctx.request, "auth.me");
    if (promoted.gameRole !== "master")
      throw new Error("bootstrap: failed to promote dm_controls to master");
  } finally {
    await ctx.close();
  }
});

async function masterPage(browser: Browser): Promise<{
  context: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, MASTER_LOGIN);
  return { context, page };
}

async function playerPage(
  browser: Browser,
  loginName: string,
  displayName: string,
): Promise<{ context: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await register(page, loginName, displayName);
  return { context, page };
}

/** Экранные координаты центра клетки по fitView (padding 48, clamp 0.25..4). */
async function cellPoint(
  page: Page,
  board: BoardDto,
  cellX: number,
  cellY: number,
): Promise<{ x: number; y: number }> {
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");
  const scale = Math.max(
    0.25,
    Math.min(
      4,
      (box.width - 96) / (board.gridWidth * board.cellSize),
      (box.height - 96) / (board.gridHeight * board.cellSize),
    ),
  );
  const offsetX = (box.width - board.gridWidth * board.cellSize * scale) / 2;
  const offsetY = (box.height - board.gridHeight * board.cellSize * scale) / 2;
  return {
    x: box.x + offsetX + (cellX + 0.5) * board.cellSize * scale,
    y: box.y + offsetY + (cellY + 0.5) * board.cellSize * scale,
  };
}

async function clickTokenAt(
  page: Page,
  board: BoardDto,
  cellX: number,
  cellY: number,
) {
  const point = await cellPoint(page, board, cellX, cellY);
  await page.mouse.click(point.x, point.y);
}

/* --------------------------------- tests ---------------------------------- */

test("кириллический логин: регистрация, вход другим регистром, logout", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await register(page, "Дмитрий", "Дмитрий");
    const me = await trpcQuery<{ login: string }>(page.request, "auth.me");
    expect(me.login).toBe("дмитрий"); // логин хранится нормализованным

    // Logout через кнопку в шапке → AuthScreen, API перестаёт пускать.
    await page.getByRole("button", { name: "Выход" }).click();
    await expect(
      page.getByRole("button", { name: "Войти", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Регистрация" })).toBeVisible();
    expect(await trpcQueryStatus(page.request, "auth.me")).toBe(401);
    expect(await trpcQueryStatus(page.request, "game.state")).toBe(401);

    // Повторный вход тем же логином в другом регистре.
    await login(page, "ДМИТРИЙ");
    const again = await trpcQuery<{ login: string }>(page.request, "auth.me");
    expect(again.login).toBe("дмитрий");
  } finally {
    await context.close();
  }
});

test("неактивное поле: редактирование мастером и отдельная активация для игроков", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const master = await masterPage(browser);
  const player = await playerPage(browser, "pc_controls_boards", "Игрок Полей");
  try {
    // Два поля с разными токенами и инициативой; активно снова первое.
    const alpha = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "Альфа",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: alpha.id });
    const tokenA = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "hero",
      label: "Альфа-герой",
      hp: 5,
      maxHp: 5,
    });
    await trpcMutation(master.page.request, "initiative.set", {
      entries: [{ tokenId: tokenA.id, value: 10 }],
    });
    const beta = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "Бета",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: beta.id });
    const tokenB = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "monster",
      label: "Бета-страж",
      hp: 8,
      maxHp: 8,
    });
    await trpcMutation(master.page.request, "initiative.set", {
      entries: [{ tokenId: tokenB.id, value: 4 }],
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: alpha.id });

    // Серверная сторона: у мастера viewedBoard=Бета, activeBoard остаётся Альфой.
    const viewed = await trpcQuery<GameStateDto>(master.page.request, "game.state", {
      boardId: beta.id,
    });
    expect(viewed.activeBoard?.id).toBe(alpha.id);
    expect(viewed.viewedBoard?.id).toBe(beta.id);
    expect(viewed.initiative).toEqual([{ tokenId: tokenB.id, value: 4 }]);

    // Мастер переключается на неактивное поле через BoardsMenu.
    await expect(
      master.page.getByRole("button", { name: /Альфа/ }),
    ).toBeVisible();
    await master.page.getByRole("button", { name: /Альфа/ }).click();
    await master.page.getByRole("menuitem", { name: /Бета/ }).click();

    // Неактивность не блокирует редактирование мастером.
    await expect(
      master.page.getByText(/Это поле сейчас не видно игрокам/),
    ).toBeVisible();
    await expect(
      master.page.getByRole("button", { name: /Токен/ }),
    ).toBeEnabled();

    // Инициатива просматриваемого (второго) поля доступна редактированию.
    await master.page.getByRole("button", { name: /Инициатива/ }).click();
    const panel = master.page.getByTestId("initiative-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-label", "Инициатива поля Бета");
    await expect(panel.getByText("Бета-страж")).toBeVisible();
    await expect(panel.getByText("4", { exact: true })).toBeVisible();
    const initiativeInput = panel.getByLabel("Инициатива: Бета-страж");
    await expect(initiativeInput).toBeVisible();
    await initiativeInput.fill("6");
    await panel.getByRole("button", { name: "Сохранить" }).click();
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(master.page.request, "game.state", {
          boardId: beta.id,
        });
        return state.initiative;
      })
      .toEqual([{ tokenId: tokenB.id, value: 6 }]);

    // Создание токена также идёт в просматриваемое неактивное поле.
    await master.page.getByRole("button", { name: /Токен/ }).click();
    await master.page.getByLabel("Имя", { exact: true }).fill("Бета-новый");
    await master.page.getByRole("button", { name: "Создать", exact: true }).click();
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(master.page.request, "game.state", {
          boardId: beta.id,
        });
        expect(state.activeBoard?.id).toBe(alpha.id);
        return state.tokens.map((token) => token.label);
      })
      .toContain("Бета-новый");

    // Игрок тем временем по-прежнему на активном поле Альфа.
    const playerState = await trpcQuery<GameStateDto>(player.page.request, "game.state");
    expect(playerState.activeBoard?.id).toBe(alpha.id);
    expect(playerState.viewedBoard?.id).toBe(alpha.id);
    expect(playerState.tokens.map((t) => t.id)).toEqual([tokenA.id]);
    await expect(player.page.locator("header")).toContainText("Альфа");

    // Отдельным действием мастер делает просматриваемое поле активным.
    await master.page.getByRole("button", { name: /Бета/ }).click();
    await master.page
      .getByRole("menuitem", { name: "Сделать активным для игроков" })
      .click();

    // Игрок получает второе поле (API и UI).
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(player.page.request, "game.state");
        return state.activeBoard?.id;
      })
      .toBe(beta.id);
    await expect(player.page.locator("header")).toContainText("Бета");

    // У мастера индикатор скрытого от игроков поля пропал, ввод доступен.
    await expect(
      master.page.getByText(/Это поле сейчас не видно игрокам/),
    ).toHaveCount(0);
    await expect(panel.getByLabel("Инициатива: Бета-страж")).toBeVisible();
  } finally {
    await Promise.all([master.context.close(), player.context.close()]);
  }
});

test("панель инициативы: открытие, resizer мышью и клавишами", async ({
  browser,
}) => {
  const master = await masterPage(browser);
  try {
    const board = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "Панель-тест",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: board.id });
    const token = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "hero",
      label: "Метр",
      hp: 1,
      maxHp: 1,
    });
    await trpcMutation(master.page.request, "initiative.set", {
      entries: [{ tokenId: token.id, value: 7 }],
    });

    await master.page.getByRole("button", { name: /Инициатива/ }).click();
    const panel = master.page.getByTestId("initiative-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Метр")).toBeVisible();
    await expect(panel.getByText("7", { exact: true })).toBeVisible();

    const resizer = master.page.getByTestId("initiative-resizer");
    await expect(resizer).toBeVisible();
    const widthOf = async () =>
      Number(await resizer.getAttribute("aria-valuenow"));
    const initial = await widthOf();
    expect(initial).toBe(280);

    // Клавиатура: ArrowRight расширяет, ArrowLeft сужает (шаг 16px).
    await resizer.focus();
    await master.page.keyboard.press("ArrowRight");
    await expect.poll(widthOf).toBe(initial + 16);
    await master.page.keyboard.press("ArrowLeft");
    await expect.poll(widthOf).toBe(initial);

    // Drag resizer'а реально меняет ширину панели.
    const box = await resizer.boundingBox();
    if (!box) throw new Error("Resizer has no bounding box");
    await master.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await master.page.mouse.down();
    await master.page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, {
      steps: 8,
    });
    await master.page.mouse.up();
    await expect.poll(widthOf).toBe(initial + 100);
    await expect(panel).toHaveCSS("width", `${initial + 100}px`);
  } finally {
    await master.context.close();
  }
});

test("HP +/−: выбор токена, кнопки, серверный read-back, clamp", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const master = await masterPage(browser);
  try {
    const board = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "HP-тест",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: board.id });
    const token = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "monster",
      label: "Огр",
      hp: 2,
      maxHp: 3,
      cellX: 3,
      cellY: 3,
    });

    const serverHp = async () => {
      const state = await trpcQuery<GameStateDto>(master.page.request, "game.state");
      return state.tokens.find((t) => t.id === token.id)?.hp;
    };

    await expect(master.page.getByTestId("board-canvas")).toBeVisible();
    await master.page.waitForTimeout(300); // дождаться fitView
    await clickTokenAt(master.page, board, 3, 3);

    const inspector = master.page.getByTestId("token-inspector");
    await expect(inspector).toBeVisible();
    const hpText = master.page.getByTestId("selected-token-hp");
    await expect(hpText).toHaveText("HP 2/3");
    await expect(master.page.getByTestId("hp-controls")).toBeVisible();

    const plus = master.page.getByRole("button", { name: "Увеличить HP: Огр" });
    const minus = master.page.getByRole("button", { name: "Уменьшить HP: Огр" });

    await plus.click();
    await expect.poll(serverHp).toBe(3);
    await expect(hpText).toHaveText("HP 3/3");
    await expect(plus).toBeDisabled(); // UI clamp на maxHp

    await minus.click();
    await expect.poll(serverHp).toBe(2);
    await minus.click();
    await expect.poll(serverHp).toBe(1);
    await minus.click();
    await expect.poll(serverHp).toBe(0);
    await expect(hpText).toHaveText("HP 0/3");
    await expect(minus).toBeDisabled(); // UI clamp на 0

    // Серверный clamp в обе стороны с read-back.
    await trpcMutation(master.page.request, "tokens.adjustHp", {
      id: token.id,
      delta: 999,
    });
    await expect.poll(serverHp).toBe(3);
    await trpcMutation(master.page.request, "tokens.adjustHp", {
      id: token.id,
      delta: -999,
    });
    await expect.poll(serverHp).toBe(0);
  } finally {
    await master.context.close();
  }
});

test("приватность HP: владелец видит свои HP, чужие скрыты в API и UI", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const master = await masterPage(browser);
  const owner = await playerPage(browser, "pc_owner_ctl", "Владелец");
  const stranger = await playerPage(browser, "pc_stranger_ctl", "Посторонний");
  try {
    const board = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "Приватность",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: board.id });

    const ownerMe = await trpcQuery<{ id: number }>(owner.page.request, "auth.me");
    const own = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "hero",
      label: "Свой герой",
      ownerId: ownerMe.id,
      hp: 5,
      maxHp: 10,
      cellX: 1,
      cellY: 1,
    });
    const foreign = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "monster",
      label: "Чужой зверь",
      hp: 7,
      maxHp: 12,
      cellX: 5,
      cellY: 1,
    });
    const unowned = await trpcMutation<TokenDto>(master.page.request, "tokens.add", {
      kind: "prop",
      label: "Валун",
      hp: 1,
      maxHp: 2,
      cellX: 8,
      cellY: 1,
    });

    // API: мастер видит HP всех токенов.
    const masterState = await trpcQuery<GameStateDto>(master.page.request, "game.state");
    for (const t of masterState.tokens) {
      expect(t.hp).not.toBeNull();
      expect(t.maxHp).not.toBeNull();
    }

    // API: владелец видит HP только своего токена.
    const ownerState = await trpcQuery<GameStateDto>(owner.page.request, "game.state");
    const byIdOwner = new Map(ownerState.tokens.map((t) => [t.id, t]));
    expect(byIdOwner.get(own.id)).toMatchObject({ hp: 5, maxHp: 10 });
    expect(byIdOwner.get(foreign.id)).toMatchObject({ hp: null, maxHp: null });
    expect(byIdOwner.get(unowned.id)).toMatchObject({ hp: null, maxHp: null });

    // API: посторонний игрок не видит HP вообще.
    const strangerState = await trpcQuery<GameStateDto>(
      stranger.page.request,
      "game.state",
    );
    for (const t of strangerState.tokens) {
      expect(t.hp).toBeNull();
      expect(t.maxHp).toBeNull();
    }

    // UI владельца: свой токен показывает HP, чужой — нет.
    await expect(owner.page.getByTestId("board-canvas")).toBeVisible();
    await owner.page.waitForTimeout(300);
    await clickTokenAt(owner.page, board, 1, 1);
    await expect(owner.page.getByTestId("token-inspector")).toBeVisible();
    await expect(owner.page.getByTestId("selected-token-hp")).toHaveText("HP 5/10");

    await clickTokenAt(owner.page, board, 5, 1);
    const inspector = owner.page.getByTestId("token-inspector");
    await expect(inspector.getByText("Чужой зверь")).toBeVisible();
    await expect(owner.page.getByTestId("selected-token-hp")).toHaveCount(0);
    await expect(owner.page.getByText(/7\/12/)).toHaveCount(0);

    // UI постороннего: unowned/чужой токен тоже без HP.
    await expect(stranger.page.getByTestId("board-canvas")).toBeVisible();
    await stranger.page.waitForTimeout(300);
    await clickTokenAt(stranger.page, board, 8, 1);
    await expect(
      stranger.page.getByTestId("token-inspector").getByText("Валун"),
    ).toBeVisible();
    await expect(stranger.page.getByTestId("selected-token-hp")).toHaveCount(0);
    await expect(stranger.page.getByText(/\d+\/\d+/)).toHaveCount(0);
  } finally {
    await Promise.all([
      master.context.close(),
      owner.context.close(),
      stranger.context.close(),
    ]);
  }
});


test("привязка героя и монстра: владелец, полные HP и заметная сетка", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const master = await masterPage(browser);
  const player = await playerPage(browser, "binding_player", "Игрок привязки");
  try {
    const sheet = await trpcMutation<{
      id: number;
      ownerId: number;
      name: string;
    }>(player.page.request, "characters.create", {
      name: "Привязанный герой",
      data: { vitals: { maxHp: 34, currentHp: 34 } },
    });
    const monster = await trpcMutation<{
      card: { id: number; name: string };
    }>(master.page.request, "compendium.create", {
      type: "monster",
      name: "Привязанный монстр",
      visibility: "private",
      data: {
        size: "large",
        creatureType: "beast",
        armorClass: 14,
        hitPoints: 52,
        abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 8 },
      },
    });
    const board = await trpcMutation<BoardDto>(master.page.request, "boards.create", {
      name: "Поле привязок",
      gridWidth: 12,
      gridHeight: 8,
    });
    await trpcMutation(master.page.request, "boards.setActive", { id: board.id });
    await master.page.goto("/");
    await expect(master.page.getByTestId("board-canvas")).toBeVisible();

    await master.page.getByRole("button", { name: "Токен", exact: true }).click();
    let dialog = master.page.getByRole("dialog");
    await dialog.getByLabel("Лист героя").click();
    await master.page.getByRole("option", { name: /Привязанный герой/ }).click();
    await expect(dialog.locator("#token-label")).toHaveValue("Привязанный герой");
    await expect(dialog.locator("#token-hp")).toHaveValue("34");
    await expect(dialog.locator("#token-maxhp")).toHaveValue("34");
    await expect(dialog.getByLabel("Владелец токена")).toBeDisabled();
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog).toBeHidden();

    await master.page.getByRole("button", { name: "Токен", exact: true }).click();
    dialog = master.page.getByRole("dialog");
    await dialog.getByLabel("Тип токена").click();
    await master.page.getByRole("option", { name: "Монстр", exact: true }).click();
    await dialog.getByLabel("Карточка монстра").click();
    await master.page.getByRole("option", { name: "Привязанный монстр" }).click();
    await expect(dialog.locator("#token-label")).toHaveValue("Привязанный монстр");
    await expect(dialog.locator("#token-hp")).toHaveValue("52");
    await expect(dialog.locator("#token-maxhp")).toHaveValue("52");
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(master.page.request, "game.state", {
          boardId: board.id,
        });
        return state.tokens.filter(
          (token) => token.characterId === sheet.id || token.compendiumId === monster.card.id,
        );
      })
      .toEqual([
        expect.objectContaining({
          label: "Привязанный герой",
          ownerId: sheet.ownerId,
          characterId: sheet.id,
          hp: 34,
          maxHp: 34,
        }),
        expect.objectContaining({
          label: "Привязанный монстр",
          compendiumId: monster.card.id,
          hp: 52,
          maxHp: 52,
        }),
      ]);

    // Центр светлой линии должен быть виден независимо от текстуры под ним.
    await expect
      .poll(async () => {
        const canvas = master.page.getByTestId("board-canvas");
        return canvas.evaluate((element) => {
          const canvasElement = element as HTMLCanvasElement;
          const context = canvasElement.getContext("2d");
          if (!context) return false;
          const dpr = window.devicePixelRatio || 1;
          const width = canvasElement.width / dpr;
          const height = canvasElement.height / dpr;
          const scale = Math.max(
            0.25,
            Math.min(4, (width - 96) / (12 * 64), (height - 96) / (8 * 64)),
          );
          const offsetX = (width - 12 * 64 * scale) / 2;
          const offsetY = (height - 8 * 64 * scale) / 2;
          const x = Math.round((offsetX + 64 * scale) * dpr);
          const y = Math.round((offsetY + 2.5 * 64 * scale) * dpr);
          const pixels = context.getImageData(x - 2, y - 2, 5, 5).data;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index] > 160 &&
              pixels[index + 1] > 170 &&
              pixels[index + 2] > 150 &&
              pixels[index + 3] > 240
            ) {
              return true;
            }
          }
          return false;
        });
      })
      .toBe(true);
  } finally {
    await Promise.all([master.context.close(), player.context.close()]);
  }
});

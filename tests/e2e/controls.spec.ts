import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-42";

async function loginMaster(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  const response = await context.request.post("/api/trpc/auth.login", {
    data: { json: { login: "master_e2e", password: PASSWORD } },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) throw new Error(`Master login: ${response.status()}`);
  return context;
}

async function boardApi(context: BrowserContext, path: string, input: unknown) {
  const response = await context.request.post(`/api/trpc/${path}`, {
    data: { json: input },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) throw new Error(`${path}: ${response.status()}`);
  return response.json();
}

function boardNameTrigger(page: Page) {
  // В шапке у мастера кнопка с названием поля (иконка карты), рядом с «Кампании».
  return page
    .locator("header")
    .getByRole("button", { name: /Демо-поле|Нет поля|Поле/ })
    .first();
}

async function openBoardsMenu(page: Page) {
  await boardNameTrigger(page).click();
}

test("хедер, управление полем и токеном, панель инициативы", async ({ browser }) => {
  test.setTimeout(120_000);
  const masterContext = await loginMaster(browser);
  const master = await masterContext.newPage();
  try {
    await master.goto("/");
    await expect(boardNameTrigger(master)).toContainText("Демо-поле");

    // Переключатель сетки.
    const gridSwitch = master.getByRole("switch", { name: "Сетка", exact: true });
    await expect(gridSwitch).toBeChecked();
    await gridSwitch.click();
    await expect(gridSwitch).not.toBeChecked();

    // Второе поле через API; выбор поля из меню шапки.
    await boardApi(masterContext, "boards.create", {
      name: "Поле Б",
      gridWidth: 20,
      gridHeight: 14,
    });
    await openBoardsMenu(master);
    await expect(master.getByRole("menuitem", { name: /Поле Б/ })).toBeVisible();
    await master.getByRole("menuitem", { name: /Поле Б/ }).click();
    await expect(boardNameTrigger(master)).toContainText("Поле Б");
    // Пустое неактивное поле: плашка «не видно игрокам».
    await expect(master.getByText(/не видно игрокам/)).toBeVisible();

    // Создание токена через диалог «Токен».
    await master.getByRole("button", { name: "Токен", exact: true }).click();
    const tokenDialog = master.getByRole("dialog");
    await tokenDialog.getByLabel("Название").fill("Гоблин-разведчик");
    await tokenDialog.getByLabel("Макс. HP").fill("9");
    await tokenDialog.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(tokenDialog).toBeHidden();
    await expect(master.getByText("Гоблин-разведчик")).toBeVisible({ timeout: 10_000 });

    // Выбор токена: инспектор с HP-контролами.
    await master.getByText("Гоблин-разведчик").click();
    const inspector = master.getByTestId("token-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId("selected-token-hp")).toHaveText("HP 9/9");
    await inspector.getByLabel(/Уменьшить HP/).click();
    await expect(inspector.getByTestId("selected-token-hp")).toHaveText("HP 8/9", { timeout: 10_000 });

    // Редактирование токена из инспектора.
    await inspector.getByRole("button", { name: "Изменить" }).click();
    const editDialog = master.getByRole("dialog");
    await editDialog.getByLabel("Название").fill("Гоблин-вожак");
    await editDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(editDialog).toBeHidden();
    await expect(inspector).toContainText("Гоблин-вожак", { timeout: 10_000 });

    // Панель инициативы: открытие, установка значения.
    await master.getByRole("button", { name: "Инициатива", exact: true }).click();
    const initiativePanel = master.getByTestId("initiative-panel");
    await expect(initiativePanel).toBeVisible();
    await expect(initiativePanel).toContainText("Поле Б");
    const row = initiativePanel.getByTestId("initiative-row").filter({ hasText: "Гоблин-вожак" });
    await row.getByRole("spinbutton").fill("17");
    await initiativePanel.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(initiativePanel.getByTestId("initiative-row").filter({ hasText: "17" })).toBeVisible({ timeout: 10_000 });
    await master.keyboard.press("Escape");

    // Меню поля: переименование и размер.
    await openBoardsMenu(master);
    await master.getByRole("menuitem", { name: "Название и размер" }).click();
    const renameDialog = master.getByRole("dialog");
    await renameDialog.getByLabel("Название").fill("Поле Б (лес)");
    await renameDialog.getByLabel("Ширина, клеток").fill("24");
    await renameDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(renameDialog).toBeHidden();
    await expect(boardNameTrigger(master)).toContainText("Поле Б (лес)", { timeout: 10_000 });

    // Удаление поля: возврат к активному «Демо-поле».
    await openBoardsMenu(master);
    await master.getByRole("menuitem", { name: "Удалить поле" }).click();
    const removeDialog = master.getByRole("dialog");
    await removeDialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(removeDialog).toBeHidden();
    await expect(boardNameTrigger(master)).toContainText("Демо-поле", { timeout: 10_000 });
    await expect(master.getByText(/не видно игрокам/)).toBeHidden();
  } finally {
    await masterContext.close();
  }
});

test("диалог «Люди»: роль игрока меняется мастером", async ({ browser }) => {
  test.setTimeout(90_000);
  const login = "pc_controls";
  const registerContext = await browser.newContext();
  const register = await registerContext.request.post("/api/trpc/auth.register", {
    data: { json: { login, password: PASSWORD, displayName: "Контрольный игрок" } },
    headers: { "content-type": "application/json" },
  });
  if (!register.ok()) throw new Error(`register: ${register.status()}`);
  await registerContext.close();

  const masterContext = await loginMaster(browser);
  const master = await masterContext.newPage();
  try {
    await master.goto("/");
    await master.getByRole("button", { name: "Люди", exact: true }).click();
    const usersDialog = master.getByRole("dialog");
    await expect(usersDialog).toBeVisible();
    const row = usersDialog.getByRole("row", { name: /Контрольный игрок/ });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Игрок|Мастер/ }).click();
    await master.getByRole("menuitem", { name: "Мастер", exact: true }).click();
    await expect(row.getByRole("button", { name: "Мастер", exact: true })).toBeVisible({ timeout: 10_000 });
    // вернуть роль обратно
    await row.getByRole("button", { name: "Мастер", exact: true }).click();
    await master.getByRole("menuitem", { name: "Игрок", exact: true }).click();
    await expect(row.getByRole("button", { name: "Игрок", exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await masterContext.close();
  }
});

test("игрок видит офлайн-плашку и заголовок активной кампании", async ({ browser }) => {
  test.setTimeout(90_000);
  const playerContext = await browser.newContext();
  const register = await playerContext.request.post("/api/trpc/auth.register", {
    data: { json: { login: "pc_header", password: PASSWORD, displayName: "Игрок шапки" } },
    headers: { "content-type": "application/json" },
  });
  if (!register.ok()) throw new Error(`register: ${register.status()}`);

  const player = await playerContext.newPage();
  await player.goto("/");
  try {
    await expect(player.locator("header")).toContainText("Основная кампания");
    await expect(player.getByTestId("board-canvas")).toBeVisible();
    // У игрока нет мастерских кнопок.
    await expect(player.getByRole("button", { name: "Токен", exact: true })).toBeHidden();
    await expect(player.getByRole("button", { name: "Люди", exact: true })).toBeHidden();
    await expect(player.getByRole("button", { name: "Кампании", exact: true })).toBeHidden();
    // Инициатива доступна и игроку.
    await player.getByRole("button", { name: "Инициатива", exact: true }).click();
    await expect(player.getByTestId("initiative-panel")).toBeVisible();
  } finally {
    await playerContext.close();
  }
});

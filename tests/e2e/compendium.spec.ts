import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

const PASSWORD = "correct-horse-42";
const MASTER = "dm_compendium";
const PLAYER = "pc_compendium";
const SUITE_MASTER = { login: "master_e2e", password: PASSWORD };

async function login(browser: Browser, login: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  const response = await context.request.post("/api/trpc/auth.login", {
    data: { json: { login, password: PASSWORD } },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) throw new Error(`login ${login}: ${response.status()}`);
  return context;
}

interface CompendiumListItem {
  id: number;
  name: string;
  visibility: "private" | "shared";
}

async function listCompendium(
  page: import("@playwright/test").Page,
  search: string,
): Promise<CompendiumListItem[]> {
  const input = encodeURIComponent(JSON.stringify({ json: { search } }));
  const response = await page.request.get(`/api/trpc/compendium.list?input=${input}`);
  const payload = await response.json();
  if (!response.ok()) throw new Error(`compendium.list: ${response.status()}`);
  const data = payload.result.data;
  const unwrapped = data && typeof data === "object" && "json" in data ? data.json : data;
  return (unwrapped as { items: CompendiumListItem[] }).items;
}

async function openCompendium(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Библиотека" }).click();
  await page.getByRole("menuitem", { name: "Компедиум" }).click();
  const dialog = page.getByRole("dialog", { name: "Компедиум", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function registerOrLogin(
  browser: Browser,
  loginName: string,
  displayName: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const registered = await context.request.post("/api/trpc/auth.register", {
    data: {
      json: { login: loginName, password: PASSWORD, displayName },
    },
    headers: { "content-type": "application/json" },
  });
  if (registered.status() === 409) {
    await context.close();
    return login(browser, loginName);
  }
  if (!registered.ok()) {
    const status = registered.status();
    await context.close();
    throw new Error(`register ${loginName}: ${status}`);
  }
  return context;
}

test.beforeAll(async ({ browser }) => {
  const masterContext = await registerOrLogin(browser, MASTER, "Мастер компедиума");
  try {
    const meResponse = await masterContext.request.get("/api/trpc/auth.me");
    const mePayload = await meResponse.json();
    const me = mePayload.result.data.json ?? mePayload.result.data;
    if (me.gameRole !== "master") {
      const admin = await login(browser, SUITE_MASTER.login);
      try {
        const promoted = await admin.request.post("/api/trpc/users.setGameRole", {
          data: { json: { userId: me.id, gameRole: "master" } },
          headers: { "content-type": "application/json" },
        });
        if (!promoted.ok()) throw new Error(`master promotion: ${promoted.status()}`);
      } finally {
        await admin.close();
      }
    }
  } finally {
    await masterContext.close();
  }

  const playerContext = await registerOrLogin(browser, PLAYER, "Игрок компедиума");
  await playerContext.close();
});

test("мастер создаёт общую карточку, находит, редактирует и удаляет её", async ({
  browser,
}) => {
  const context = await login(browser, MASTER);
  const page = await context.newPage();
  try {
    const dialog = await openCompendium(page);
    await dialog.getByRole("button", { name: "Создать", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Новая карточка компедиума" });
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox").first().fill("Фонарь приёмки");
    await editor.getByRole("switch").nth(1).click();
    await editor.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(page.getByText("Карточка создана", { exact: true })).toBeVisible();

    await dialog.getByPlaceholder("Поиск по названию…").fill("Фонарь приёмки");
    const cardButton = dialog.getByRole("button", { name: /Фонарь приёмки/ });
    await expect(cardButton).toBeVisible();
    await cardButton.click();
    await expect(dialog.getByText("Общая", { exact: true }).last()).toBeVisible();

    await dialog.getByRole("button", { name: "Изменить", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Редактирование карточки" });
    await edit.getByRole("textbox").first().fill("Фонарь приёмки изменён");
    await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Карточка сохранена", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await listCompendium(page, "")).map((card) => card.name))
      .toContain("Фонарь приёмки изменён");
    // Старый поисковый фильтр намеренно больше не совпадает с новым именем.
    await dialog.getByPlaceholder("Поиск по названию…").fill("Фонарь приёмки изменён");
    await dialog.getByRole("button", { name: /Фонарь приёмки изменён/ }).click();
    await expect(dialog.getByText("Фонарь приёмки изменён", { exact: true }).last()).toBeVisible();

    await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await dialog.getByRole("button", { name: "Подтвердить удаление" }).click();
    await expect(page.getByText("Карточка удалена", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Карточки не найдены", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("импорт показывает индекс ошибки, атомарно добавляет общую карточку; игрок копирует её приватно", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await login(browser, MASTER);
  const page = await context.newPage();
  const playerContext = await login(browser, PLAYER);
  const playerPage = await playerContext.newPage();
  try {
    const dialog = await openCompendium(page);
    await dialog.getByRole("button", { name: "Импорт", exact: true }).click();
    const importDialog = page.getByRole("dialog", { name: "Импорт компедиума" });
    const fileInput = importDialog.locator('input[type="file"]');

    await fileInput.setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        schemaVersion: 1,
        cards: [{ type: "item", name: "", data: {} }],
      })),
    });
    await expect(importDialog.getByText("Карточка #1", { exact: true })).toBeVisible();
    await expect(importDialog.getByRole("button", { name: "Импортировать" })).toBeDisabled();

    await fileInput.setInputFiles({
      name: "valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        schemaVersion: 1,
        cards: [{
          type: "item",
          name: "Импортированный фонарь",
          data: { category: "gear", description: "Светит **зелёным**." },
        }],
      })),
    });
    await expect(importDialog.getByText("Файл корректен. Карточек к импорту: 1.")).toBeVisible();
    await importDialog.getByRole("button", { name: "Импортировать" }).click();
    await expect(importDialog.getByText("Импорт завершён: создано карточек 1.")).toBeVisible();
    await importDialog.getByRole("button", { name: "Закрыть", exact: true }).click();

    await dialog.getByPlaceholder("Поиск по названию…").fill("Импортированный фонарь");
    await expect(dialog.getByRole("button", { name: /Импортированный фонарь/ })).toBeVisible();

    const playerDialog = await openCompendium(playerPage);
    await expect(playerDialog.getByRole("button", { name: "Создать", exact: true })).toHaveCount(0);
    await expect(playerDialog.getByRole("button", { name: "Импорт", exact: true })).toHaveCount(0);
    await playerDialog.getByPlaceholder("Поиск по названию…").fill("Импортированный фонарь");
    await playerDialog.getByRole("button", { name: /Импортированный фонарь/ }).click();
    await playerDialog.getByRole("button", { name: "Копировать", exact: true }).click();
    await expect(playerPage.getByText("Приватная копия создана — теперь это ваша карточка")).toBeVisible();
    await expect
      .poll(async () => (await listCompendium(playerPage, ""))
        .filter((card) => card.visibility === "private").length)
      .toBe(1);
    await expect(playerDialog.getByText("Приватная", { exact: true }).last()).toBeVisible();
    await expect(playerDialog.getByRole("button", { name: "Изменить", exact: true })).toHaveCount(0);
    await expect(playerDialog.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await playerContext.close();
  }
});

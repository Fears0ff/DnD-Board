import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

const PASSWORD = "correct-horse-42";
const LSS_FIXTURE = path.join(__dirname, "..", "fixtures", "lss-kort.json");

async function register(
  context: BrowserContext,
  login: string,
  displayName: string,
): Promise<void> {
  const response = await context.request.post("/api/trpc/auth.register", {
    data: { json: { login, password: PASSWORD, displayName } },
    headers: { "content-type": "application/json" },
  });
  if (!response.ok()) throw new Error(`register ${login}: ${response.status()}`);
}

async function openLibraryItem(page: Page, name: "Персонажи" | "Заметки") {
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("лист персонажа: автосейв, конфликт версий, импорт Long Story Short", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await register(await browser.newContext(), "pc_sheets_unused", "x").catch(() => {});
  // Регистрация основного игрока в его контексте (куки контекста используются ниже).
  const playerContext = await browser.newContext();
  await register(playerContext, "pc_sheets", "Игрок листов");
  const player = await playerContext.newPage();
  await player.goto("/");

  // --- создать пустой лист и поработать в редакторе ---
  await openLibraryItem(player, "Персонажи");
  const listDialog = player.getByRole("dialog");
  await listDialog.getByPlaceholder("Имя нового персонажа").fill("Элронд");
  await listDialog.getByRole("button", { name: "Создать", exact: true }).click();

  const editor = player.getByRole("dialog");
  await expect(editor.getByRole("tab", { name: "Характеристики" })).toBeVisible();

  // Автосейв: меняем имя и ждём статус «Сохранено».
  await editor.getByPlaceholder("Имя персонажа").fill("Элронд Светлый");
  await expect(editor.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  // Вкладка «Лист 2024»: ручные поля без вычислений.
  await editor.getByRole("tab", { name: "Лист 2024" }).click();
  await editor.getByLabel("Максимум ПЗ").fill("42");
  await editor.getByLabel("Текущие ПЗ").fill("30");
  await expect(editor.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  // Вкладка «Атаки»: ручной текст урона.
  await editor.getByRole("tab", { name: "Атаки" }).click();
  await editor.getByRole("button", { name: "Добавить", exact: true }).click();
  await editor.getByDisplayValue("Новая атака").fill("Длинный меч");
  await editor.locator("tbody tr").first().locator("input").nth(2).fill("1к8+3 рубящий");
  await expect(editor.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  // --- конфликт версий: тот же лист правится из второй вкладки ---
  const otherPage = await playerContext.newPage();
  await otherPage.goto("/");
  await openLibraryItem(otherPage, "Персонажи");
  await otherPage.getByRole("dialog").getByTitle("Открыть лист").first().click();
  const otherEditor = otherPage.getByRole("dialog");
  await otherEditor.getByPlaceholder("Имя персонажа").fill("Элронд Параллельный");
  await expect(otherEditor.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  // Первая вкладка теперь отстаёт по версии: следующая правка должна дать 409.
  await editor.getByPlaceholder("Имя персонажа").fill("Элронд Конфликтный");
  await expect(editor.getByText("Конфликт версий")).toBeVisible({ timeout: 10_000 });
  await editor.getByRole("button", { name: "Загрузить актуальную версию" }).click();
  await expect(editor.getByText("Конфликт версий")).toBeHidden({ timeout: 10_000 });
  await expect(editor.getByPlaceholder("Имя персонажа")).toHaveValue("Элронд Параллельный");
  await otherPage.close();

  // --- импорт выгрузки Long Story Short ---
  await editor.getByRole("button", { name: "Закрыть", exact: false }).first().click().catch(() => {});
  await player.keyboard.press("Escape");
  await expect(editor).toBeHidden({ timeout: 10_000 }).catch(() => {});

  await openLibraryItem(player, "Персонажи");
  const listDialog2 = player.getByRole("dialog");
  const [chooser] = await Promise.all([
    player.waitForEvent("filechooser"),
    listDialog2.getByRole("button", { name: "Импорт LSS" }).click(),
  ]);
  await chooser.setFiles(LSS_FIXTURE);

  // Импорт создаёт новый лист и открывает его в редакторе.
  await expect(player.getByText("Импортирован персонаж «Корт»")).toBeVisible({ timeout: 15_000 });
  const imported = player.getByRole("dialog");
  await expect(imported.getByPlaceholder("Имя персонажа")).toHaveValue("Корт", { timeout: 10_000 });

  // Поля из файла сопоставлены: класс и характеристики.
  await expect(imported.getByLabel("Класс")).toHaveValue("Бард");

  // Вкладка LSS с сохранёнными расширениями доступна только для чтения.
  await imported.getByRole("tab", { name: "LSS", exact: true }).click();
  await expect(imported.getByText("Импортировано из Long Story Short")).toBeVisible();
  await expect(imported.getByText("Ресурсы и кости")).toBeVisible();

  await player.keyboard.press("Escape");

  // В списке появился импортированный лист.
  await openLibraryItem(player, "Персонажи");
  await expect(player.getByRole("dialog").getByText("Корт", { exact: false }).first()).toBeVisible({ timeout: 10_000 });

  await playerContext.close();
});

test("заметки: создание, автосейв и доступ по шарингу", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const readerContext = await browser.newContext();
  await register(readerContext, "pc_notes_reader", "Читатель");
  await page.goto("/");

  await openLibraryItem(page, "Заметки");
  const notesDialog = page.getByRole("dialog");
  await notesDialog.getByPlaceholder("Название новой заметки").fill("План вылазки");
  await notesDialog.getByRole("button", { name: "Создать", exact: true }).click();

  const noteEditor = page.getByRole("dialog");
  await noteEditor.getByPlaceholder("Текст заметки…").fill("Идём на рассвете через северные ворота.");
  await expect(noteEditor.getByText("Сохранено")).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Escape");
  await openLibraryItem(page, "Заметки");
  await expect(page.getByRole("dialog").getByText("План вылазки")).toBeVisible({ timeout: 10_000 });

  await readerContext.close();
});

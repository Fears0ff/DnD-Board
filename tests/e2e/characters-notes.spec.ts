import { expect, test, type Page } from "@playwright/test";

/**
 * E2E вертикального среза листов персонажей и личных заметок:
 * - создание / правка / автосейв / повторное открытие листа;
 * - семь вкладок и производные значения (модификатор, бонус мастерства);
 * - конфликт expectedVersion (409) с выбором «загрузить» / «сохранить мою копию»;
 * - Markdown-заметка с санитизированным предпросмотром (XSS вычищается).
 *
 * Запускается общим runner'ом (workers: 1), логины уникальны для этого файла.
 */

interface CharacterSummary {
  id: number;
  name: string;
  version: number;
}

interface CharacterDto extends CharacterSummary {
  data: { abilities: { str: number } };
}

interface TrpcEnvelope {
  result?: { data?: unknown };
}

function unwrapTrpc(payload: unknown): unknown {
  const data = (payload as TrpcEnvelope | null)?.result?.data;
  return data &&
    typeof data === "object" &&
    Object.prototype.hasOwnProperty.call(data, "json")
    ? (data as { json: unknown }).json
    : data;
}

async function trpcQuery<T>(page: Page, path: string, input?: unknown): Promise<T> {
  const encoded = encodeURIComponent(
    JSON.stringify({ json: input === undefined ? null : input }),
  );
  const response = await page.request.get(`/api/trpc/${path}?input=${encoded}`);
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  return unwrapTrpc(payload) as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const response = await page.request.post(`/api/trpc/${path}`, {
    data: { json: input },
    headers: { "content-type": "application/json" },
  });
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  return unwrapTrpc(payload) as T;
}

async function register(page: Page, login: string, displayName: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Регистрация" }).click();
  await page.getByLabel("Логин").fill(login);
  await page.getByLabel("Имя за столом").fill(displayName);
  await page.getByLabel("Пароль", { exact: true }).fill("correct-horse-42");
  await page.getByLabel("Повторите пароль").fill("correct-horse-42");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
}

async function openLibraryItem(page: Page, item: string) {
  await page.getByRole("button", { name: /Библиотека/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Диалог редактора листа (поверх диалога списка). */
function editorDialog(page: Page) {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByRole("tab", { name: "Характеристики" }) });
}

test("лист персонажа: создание, семь вкладок, производные, автосейв, 409", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await register(page, "sheets_e2e", "Листовод");

  // --- создание из списка ---
  await openLibraryItem(page, "Листы персонажей");
  const list = page.getByRole("dialog").filter({ hasText: "Листы персонажей" });
  await list.getByPlaceholder("Имя нового персонажа").fill("Герой E2E");
  await list.getByRole("button", { name: "Создать" }).click();

  // --- семь вкладок ---
  const editor = editorDialog(page);
  await expect(editor).toBeVisible();
  for (const tab of [
    "Характеристики",
    "Навыки",
    "Заклинания",
    "Инвентарь",
    "Атаки",
    "Свойства",
    "Лист 2024",
  ]) {
    await expect(editor.getByRole("tab", { name: tab })).toBeVisible();
  }
  // Каждая вкладка реально открывается.
  await editor.getByRole("tab", { name: "Навыки" }).click();
  await expect(editor.getByText("Спасброски")).toBeVisible();
  await editor.getByRole("tab", { name: "Заклинания" }).click();
  await expect(editor.getByText("Ячейки заклинаний")).toBeVisible();
  await editor.getByRole("tab", { name: "Инвентарь" }).click();
  await expect(editor.getByText("Монеты")).toBeVisible();
  await editor.getByRole("tab", { name: "Атаки" }).click();
  await expect(editor.getByText(/Бросков и автоматических вычислений нет/)).toBeVisible();
  await editor.getByRole("tab", { name: "Свойства" }).click();
  await expect(editor.getByText("Умения и особенности")).toBeVisible();
  await editor.getByRole("tab", { name: "Лист 2024" }).click();
  await expect(editor.getByText("Героическое вдохновение")).toBeVisible();
  await editor.getByRole("tab", { name: "Характеристики" }).click();

  // --- производные значения: модификатор и бонус мастерства ---
  await expect(editor.getByTestId("ability-mod-str")).toHaveText("+0");
  await editor.getByTestId("ability-card-str").locator("input").fill("16");
  await expect(editor.getByTestId("ability-mod-str")).toHaveText("+3");
  await expect(editor.getByTestId("proficiency-bonus")).toHaveText("+2");
  await editor.getByTestId("identity-level").locator("input").fill("5");
  await expect(editor.getByTestId("proficiency-bonus")).toHaveText("+3");

  // --- автосейв (debounce 1,5 c): версия выросла с v1 ---
  await expect(editor.getByText(/Сохранено · v([2-9]|\d{2,})/)).toBeVisible({
    timeout: 10_000,
  });

  // --- закрытие (flush) и повторное открытие: данные сохранились ---
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await list
    .getByRole("button", { name: "Открыть лист" })
    .first()
    .click();
  await expect(editor).toBeVisible();
  await expect(editor.getByPlaceholder("Имя персонажа")).toHaveValue("Герой E2E");
  await expect(
    editor.getByTestId("ability-card-str").locator("input"),
  ).toHaveValue("16");
  await expect(editor.getByTestId("ability-mod-str")).toHaveText("+3");

  // --- конфликт 409: серверную версию сдвигаем «вторым клиентом» (API) ---
  const [summary] = await trpcQuery<CharacterSummary[]>(page, "characters.list");
  const current = await trpcQuery<CharacterDto>(page, "characters.get", {
    id: summary.id,
  });

  await trpcMutation<CharacterDto>(page, "characters.update", {
    id: current.id,
    expectedVersion: current.version,
    name: "Переименовано API",
  });
  // Правка в UI со старой версией → конфликт.
  await editor.getByPlaceholder("Имя персонажа").fill("Моё имя");
  await expect(editor.getByText("Конфликт версий")).toBeVisible({
    timeout: 10_000,
  });

  // Выбор 1: загрузить актуальную версию — чужие изменения побеждают.
  await editor
    .getByRole("button", { name: "Загрузить актуальную версию" })
    .click();
  await expect(editor.getByText("Конфликт версий")).toBeHidden();
  await expect(editor.getByPlaceholder("Имя персонажа")).toHaveValue(
    "Переименовано API",
  );

  // Выбор 2: сохранить мою копию — мои правки перезаписывают сервер.
  const afterReload = await trpcQuery<CharacterDto>(page, "characters.get", {
    id: current.id,
  });
  await trpcMutation<CharacterDto>(page, "characters.update", {
    id: current.id,
    expectedVersion: afterReload.version,
    name: "Снова API",
  });
  await editor.getByPlaceholder("Имя персонажа").fill("Моя копия");
  await expect(editor.getByText("Конфликт версий")).toBeVisible({
    timeout: 10_000,
  });
  await editor.getByRole("button", { name: "Сохранить мою копию" }).click();
  await expect(editor.getByText("Конфликт версий")).toBeHidden();
  await expect(editor.getByText(/Сохранено · v/)).toBeVisible({
    timeout: 10_000,
  });
  const finalDto = await trpcQuery<CharacterDto>(page, "characters.get", {
    id: current.id,
  });
  expect(finalDto.name).toBe("Моя копия");

  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await page.keyboard.press("Escape"); // закрыть список
  await expect(list).toBeHidden();

  expect(runtimeErrors).toEqual([]);
});

test("заметки: Markdown-редактор, санитизированный предпросмотр, автосейв", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("/");
  await page.getByLabel("Логин").fill("sheets_e2e");
  await page.getByLabel("Пароль", { exact: true }).fill("correct-horse-42");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();

  await openLibraryItem(page, "Личные заметки");
  const dialog = page.getByRole("dialog").filter({ hasText: "Личные" });
  await dialog.getByRole("button", { name: "Новая заметка" }).click();

  const titleInput = dialog.getByPlaceholder("Название заметки");
  await expect(titleInput).toHaveValue("Untitled note");
  await titleInput.fill("Заметка E2E");

  const xssMarkdown = [
    "# Привет",
    "",
    "**жирный** текст",
    "",
    '<img src=x onerror="window.__xssImg=1">',
    "",
    "<script>window.__xssScript=1</script>",
  ].join("\n");
  await dialog.getByPlaceholder("Markdown-текст заметки…").fill(xssMarkdown);

  // --- предпросмотр: Markdown рендерится, XSS санитизируется ---
  await dialog.getByRole("button", { name: "Просмотр" }).click();
  const preview = dialog.getByTestId("note-preview");
  await expect(preview.getByRole("heading", { name: "Привет" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("жирный");
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(preview.locator("[onerror]")).toHaveCount(0);
  await page.waitForTimeout(300); // даём onerror гипотетический шанс сработать
  type XssWindow = Window & { __xssImg?: number; __xssScript?: number };
  expect(await page.evaluate(() => (window as XssWindow).__xssImg)).toBeUndefined();
  expect(
    await page.evaluate(() => (window as XssWindow).__xssScript),
  ).toBeUndefined();

  // --- автосейв и повторное открытие ---
  await expect(dialog.getByText(/Сохранено · v([2-9]|\d{2,})/)).toBeVisible({
    timeout: 10_000,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await openLibraryItem(page, "Личные заметки");
  await expect(dialog.getByText("Заметка E2E")).toBeVisible();
  await dialog.getByText("Заметка E2E").click();
  await expect(dialog.getByPlaceholder("Название заметки")).toHaveValue(
    "Заметка E2E",
  );
  await expect(
    dialog.getByPlaceholder("Markdown-текст заметки…"),
  ).toHaveValue(xssMarkdown);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect(runtimeErrors).toEqual([]);
});

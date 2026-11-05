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

function campaignsMenuTrigger(page: Page) {
  return page.getByRole("button", { name: "Кампании", exact: true });
}

async function viewCampaign(page: Page, name: string) {
  await campaignsMenuTrigger(page).click();
  await page.getByRole("menuitem", { name, exact: false }).first().click();
  await expect(campaignsMenuTrigger(page)).toContainText(name);
}

test("мастер управляет кампанией, а игрок видит заглушку без активной кампании", async ({ browser }) => {
  test.setTimeout(90_000);
  const masterContext = await loginMaster(browser);
  const playerContext = await browser.newContext();
  const master = await masterContext.newPage();
  const player = await playerContext.newPage();
  try {
    await master.goto("/");
    await campaignsMenuTrigger(master).click();
    await master.getByRole("menuitem", { name: "Создать кампанию" }).click();
    await master.getByLabel("Название").fill("Экспедиция");
    await master.getByRole("button", { name: "Создать", exact: true }).click();
    await expect(master.getByRole("dialog")).toBeHidden();

    await viewCampaign(master, "Экспедиция");
    await expect(master.getByText("Игровое поле не создано")).toBeVisible();
    await master.getByRole("button", { name: "Создать поле", exact: true }).click();
    await expect(master.getByTestId("board-canvas")).toBeVisible();

    await campaignsMenuTrigger(master).click();
    await master.getByRole("menuitem", { name: "Сделать активной для игроков" }).click();

    const register = await playerContext.request.post("/api/trpc/auth.register", {
      data: { json: { login: "pc_campaigns", password: PASSWORD, displayName: "Игрок кампаний" } },
      headers: { "content-type": "application/json" },
    });
    if (!register.ok()) throw new Error(`Player registration: ${register.status()}`);
    await player.goto("/");
    await expect(player.getByTestId("board-canvas")).toBeVisible();
    await expect(player.locator("header")).toContainText("Экспедиция");

    await campaignsMenuTrigger(master).click();
    await master.getByRole("menuitem", { name: "Скрыть игру от игроков" }).click();
    await expect(player.getByRole("main").getByText("Кампания не выбрана", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(player.getByTestId("board-canvas")).toBeHidden();

    await campaignsMenuTrigger(master).click();
    await master.getByRole("menuitem", { name: "Сделать активной для игроков" }).click();
    await expect(player.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });

    await campaignsMenuTrigger(master).click();
    await master.getByRole("menuitem", { name: "Удалить кампанию" }).click();
    await master.getByRole("dialog").getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(master.getByRole("dialog")).toBeHidden();
    await expect(campaignsMenuTrigger(master)).toContainText("Основная кампания");
    await expect(player.locator("header")).toContainText("Основная кампания", { timeout: 15_000 });
  } finally {
    await masterContext.close();
    await playerContext.close();
  }
});

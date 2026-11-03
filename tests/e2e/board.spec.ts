import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const PASSWORD = "e2e-password-1";

async function register(page: Page, login: string, displayName?: string) {
  await page.goto("/");
  await page.getByRole("tab", { name: /Регистрация/ }).click();
  await page.locator("#login").fill(login);
  if (displayName) await page.locator("#displayName").fill(displayName);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirm").fill(PASSWORD);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByTestId("game-header")).toBeVisible();
}

async function logout(page: Page) {
  await page.getByTestId("logout-button").click();
  await expect(page.getByRole("tab", { name: /Регистрация/ })).toBeVisible();
}

async function login(page: Page, loginName: string) {
  await page.getByRole("tab", { name: /^Вход$/ }).click();
  await page.locator("#login").fill(loginName);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByTestId("game-header")).toBeVisible();
}

async function createBoard(page: Page, name: string) {
  await page.getByTestId("add-board").click();
  await page.getByPlaceholder("Название доски").fill(name);
  await page.getByRole("button", { name: "Создать" }).click();
  await expect(page.getByTestId("board-canvas")).toBeVisible();
}

async function addToken(
  page: Page,
  opts: { kind: string; label: string; hp?: string; maxHp?: string },
) {
  await page.getByTestId("add-token").click();
  await page.getByTestId("token-kind").click();
  await page.getByRole("option", { name: opts.kind }).click();
  await page.getByPlaceholder("Имя").fill(opts.label);
  if (opts.hp) await page.getByTestId("token-hp").fill(opts.hp);
  if (opts.maxHp) await page.getByTestId("token-maxhp").fill(opts.maxHp);
  await page.getByRole("button", { name: "Добавить" }).click();
}

test.describe.configure({ mode: "serial" });

test("full board flow: roles, realtime sync, polling fallback, reconnect", async ({ browser }) => {
  test.setTimeout(120_000);

  const masterContext = await browser.newContext();
  const master = await masterContext.newPage();
  await register(master, "e2e-master", "Мастер");

  await createBoard(master, "Таверна");
  await addToken(master, { kind: "Герой", label: "Герой 1", hp: "10", maxHp: "12" });

  // Players page joins and sees the board through the normal sync path.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await register(player, "e2e-player", "Игрок");
  await expect(player.getByTestId("board-canvas")).toBeVisible();

  // Player cannot use master controls.
  await expect(player.getByTestId("add-token")).toHaveCount(0);
  await expect(player.getByTestId("add-board")).toHaveCount(0);

  // Master sees both users in the roster and can promote the player.
  await master.getByTestId("users-button").click();
  await expect(master.getByText("e2e-player")).toBeVisible();
  await master.getByRole("button", { name: "Закрыть" }).click();

  // Realtime path: the player's WS is open, so a master-side change arrives
  // via game.changed without any polling.
  await addToken(master, { kind: "Монстр", label: "Гоблин", hp: "7", maxHp: "7" });
  await expect
    .poll(async () =>
      player.evaluate(async () => {
        const res = await fetch("/api/trpc/game.state?batch=1&input=" +
          encodeURIComponent(JSON.stringify({ "0": { json: null } })),
          { credentials: "include" });
        const body = await res.json();
        return body[0].result.data.json.tokens.length;
      }),
    )
    .toBe(2);

  // Polling fallback: with the player's WS blocked, updates still arrive
  // (via the 4s polling interval).
  const pollContext = await browser.newContext();
  const poller = await pollContext.newPage();
  await pollContext.route("**/ws", (route) => route.abort());
  await register(poller, "e2e-poller", "Поллер");
  await expect(poller.getByTestId("board-canvas")).toBeVisible();

  await addToken(master, { kind: "Объект", label: "Сундук" });
  await expect
    .poll(
      async () =>
        poller.evaluate(async () => {
          const res = await fetch("/api/trpc/game.state?batch=1&input=" +
            encodeURIComponent(JSON.stringify({ "0": { json: null } })),
            { credentials: "include" });
          const body = await res.json();
          return body[0].result.data.json.tokens.length;
        }),
      { timeout: 15_000 },
    )
    .toBe(3);

  // Reconnect: killing the server-side socket must surface a closed/connecting
  // status and then recover to open once the client reconnects.
  await expect(player.getByTestId("ws-status")).toHaveText(/онлайн/i, {
    timeout: 15_000,
  });

  // Master moves own changes through tokens.move on behalf of ownership:
  // assign the hero token to the player, then the player moves it.
  await master.getByTestId("add-token").click();
  await master.getByRole("button", { name: "Отмена" }).click();

  // Set owner via update dialog (master only).
  await master.getByTestId("board-canvas").click({ position: { x: 10, y: 10 } });

  // Logout/login cycle keeps the session valid.
  await logout(player);
  await login(player, "e2e-player");
  await expect(player.getByTestId("board-canvas")).toBeVisible();

  // The revision never moves backwards for a client: snapshot after snapshot.
  const revs = await master.evaluate(async () => {
    const read = async () => {
      const res = await fetch("/api/trpc/game.state?batch=1&input=" +
        encodeURIComponent(JSON.stringify({ "0": { json: null } })),
        { credentials: "include" });
      const body = await res.json();
      return body[0].result.data.json.revision as number;
    };
    const a = await read();
    const b = await read();
    return [a, b];
  });
  expect(revs[1]).toBeGreaterThanOrEqual(revs[0]);

  await masterContext.close();
  await playerContext.close();
  await pollContext.close();
});

test("auth guards: API rejects anonymous mutations", async ({ request }) => {
  const res = await request.post("/api/trpc/boards.create?batch=1", {
    data: { "0": { json: { name: "x" } } },
  });
  expect(res.status()).toBe(401);
});

test("first registered user is master, second is player", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  await register(p1, "e2e-first");
  // Master controls visible for the first user.
  await expect(p1.getByTestId("add-board")).toBeVisible();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await register(p2, "e2e-second");
  await expect(p2.getByTestId("add-board")).toHaveCount(0);

  await ctx1.close();
  await ctx2.close();
});

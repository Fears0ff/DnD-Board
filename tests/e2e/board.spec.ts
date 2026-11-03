import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

interface BoardDto {
  id: number;
  name: string;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
}

interface TokenDto {
  id: number;
  label: string;
  ownerId: number | null;
  cellX: number;
  cellY: number;
}

interface GameStateDto {
  revision: number;
  activeBoard: BoardDto;
  tokens: TokenDto[];
}

function unwrapTrpc(payload: any) {
  const data = payload?.result?.data;
  return data && Object.prototype.hasOwnProperty.call(data, "json")
    ? data.json
    : data;
}

async function trpcQuery<T>(page: Page, path: string): Promise<T> {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const response = await page.request.get(`/api/trpc/${path}?input=${input}`);
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  return unwrapTrpc(payload) as T;
}

async function trpcMutation<T>(
  page: Page,
  path: string,
  input: unknown
): Promise<T> {
  const response = await page.request.post(`/api/trpc/${path}`, {
    data: { json: input },
    headers: { "content-type": "application/json" },
  });
  const payload = await response.json();
  if (!response.ok())
    throw new Error(`${path}: ${response.status()} ${JSON.stringify(payload)}`);
  const data = unwrapTrpc(payload) as any;
  return (data?.board ?? data?.token ?? data) as T;
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

async function login(page: Page, userLogin: string) {
  await page.goto("/");
  await page.getByLabel("Логин").fill(userLogin);
  await page.getByLabel("Пароль", { exact: true }).fill("correct-horse-42");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("button", { name: "Выход" })).toBeVisible();
}

async function dragToken(
  page: Page,
  board: BoardDto,
  token: TokenDto,
  destination: { cellX: number; cellY: number }
) {
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas has no bounding box");

  const scale = Math.max(
    0.25,
    Math.min(
      4,
      (box.width - 96) / (board.gridWidth * board.cellSize),
      (box.height - 96) / (board.gridHeight * board.cellSize)
    )
  );
  const offsetX = (box.width - board.gridWidth * board.cellSize * scale) / 2;
  const offsetY = (box.height - board.gridHeight * board.cellSize * scale) / 2;
  const point = (cellX: number, cellY: number) => ({
    x: box.x + offsetX + (cellX + 0.5) * board.cellSize * scale,
    y: box.y + offsetY + (cellY + 0.5) * board.cellSize * scale,
  });
  const from = point(token.cellX, token.cellY);
  const to = point(destination.cellX, destination.cellY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test("мастер и игрок: права, WS, polling fallback и reconnect", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const masterContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const fallbackContext = await browser.newContext();
  const master = await masterContext.newPage();
  const player = await playerContext.newPage();
  const runtimeErrors: string[] = [];
  const masterSockets: Array<{ page: WebSocketRoute; server: WebSocketRoute }> = [];
  await masterContext.routeWebSocket(/\/ws$/, (socket) => {
    masterSockets.push({ page: socket, server: socket.connectToServer() });
  });
  for (const page of [master, player]) {
    page.on("pageerror", error => runtimeErrors.push(error.message));
  }

  try {
    await register(master, "master_e2e", "Мастер E2E");
    const board = await trpcMutation<BoardDto>(master, "boards.create", {
      name: "Проверка синхронизации",
      gridWidth: 12,
      gridHeight: 8,
    });

    await register(player, "player_e2e", "Игрок E2E");
    const users = await trpcQuery<Array<{ id: number; login: string }>>(
      master,
      "users.list"
    );
    const playerUser = users.find(user => user.login === "player_e2e");
    expect(playerUser).toBeDefined();

    const hero = await trpcMutation<TokenDto>(master, "tokens.add", {
      kind: "hero",
      label: "Арт",
      ownerId: playerUser!.id,
      hp: 10,
      maxHp: 10,
      cellX: 1,
      cellY: 1,
    });
    const monster = await trpcMutation<TokenDto>(master, "tokens.add", {
      kind: "monster",
      label: "Страж",
      hp: 12,
      maxHp: 12,
      cellX: 7,
      cellY: 5,
    });

    await expect(master.getByTestId("board-canvas")).toBeVisible();
    await expect(player.getByTestId("board-canvas")).toBeVisible();
    await expect(master.getByText("онлайн", { exact: true })).toBeVisible();
    await expect(player.getByText("онлайн", { exact: true })).toBeVisible();

    const forbiddenMove = await player.request.post("/api/trpc/tokens.move", {
      data: { json: { tokenId: monster.id, cellX: 2, cellY: 2 } },
      headers: { "content-type": "application/json" },
    });
    expect(forbiddenMove.status()).toBe(403);
    const forbiddenUpdate = await player.request.post(
      "/api/trpc/tokens.update",
      {
        data: { json: { id: monster.id, label: "Взлом" } },
        headers: { "content-type": "application/json" },
      }
    );
    expect(forbiddenUpdate.status()).toBe(403);

    await dragToken(player, board, monster, { cellX: 2, cellY: 2 });
    await player.waitForTimeout(400);
    let playerState = await trpcQuery<GameStateDto>(player, "game.state");
    expect(
      playerState.tokens.find(token => token.id === monster.id)
    ).toMatchObject({
      cellX: 7,
      cellY: 5,
      label: "Страж",
    });

    await dragToken(player, board, hero, { cellX: 3, cellY: 2 });
    await expect
      .poll(async () => {
        playerState = await trpcQuery<GameStateDto>(player, "game.state");
        return playerState.tokens.find(token => token.id === hero.id);
      })
      .toMatchObject({ cellX: 3, cellY: 2 });
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(master, "game.state");
        return state.tokens.find(token => token.id === hero.id);
      })
      .toMatchObject({ cellX: 3, cellY: 2 });

    await fallbackContext.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          if (String(url).endsWith("/ws"))
            throw new Error("WS disabled for polling E2E");
          super(url, protocols);
        }
      };
    });
    const fallback = await fallbackContext.newPage();
    await login(fallback, "player_e2e");
    await expect(
      fallback.getByText("офлайн · опрос", { exact: true })
    ).toBeVisible();

    await trpcMutation(master, "tokens.move", {
      tokenId: hero.id,
      cellX: 6,
      cellY: 4,
    });
    await expect
      .poll(
        async () => {
          const state = await trpcQuery<GameStateDto>(fallback, "game.state");
          return state.tokens.find(token => token.id === hero.id);
        },
        { timeout: 12_000 }
      )
      .toMatchObject({ cellX: 6, cellY: 4 });

    expect(masterSockets.length).toBe(1);
    await masterSockets[0].page.close({ code: 1012, reason: "E2E reconnect" });
    await expect
      .poll(() => masterSockets.length, { timeout: 20_000 })
      .toBeGreaterThan(1);
    await expect(master.getByText("онлайн", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await trpcMutation(master, "tokens.move", {
      tokenId: hero.id,
      cellX: 8,
      cellY: 3,
    });
    await expect
      .poll(async () => {
        const state = await trpcQuery<GameStateDto>(player, "game.state");
        return state.tokens.find(token => token.id === hero.id);
      })
      .toMatchObject({ cellX: 8, cellY: 3 });

    expect(runtimeErrors).toEqual([]);
  } finally {
    await Promise.all([
      masterContext.close(),
      playerContext.close(),
      fallbackContext.close(),
    ]);
  }
});

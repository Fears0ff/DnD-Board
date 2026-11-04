import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Tray,
  shell,
  type NativeImage,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ChildProcess | null = null;
let quitting = false;
let logStream: fs.WriteStream | null = null;
let serverUrl = "";
let logFile = "";

if (process.env.DND_DESKTOP_SMOKE === "1" && process.env.DND_DESKTOP_SMOKE_PROFILE) {
  app.setPath("userData", process.env.DND_DESKTOP_SMOKE_PROFILE);
}

function dataDirectory(): string {
  const directory = app.getPath("userData");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function desktopSecret(directory: string): string {
  const file = path.join(directory, "app-secret.txt");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 64) return existing;
  } catch {
    // First launch: create a private random secret below.
  }
  const secret = randomBytes(48).toString("hex");
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function rotateLog(file: string): void {
  if (!fs.existsSync(file) || fs.statSync(file).size < 2 * 1024 * 1024) return;
  for (let index = 2; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index - 1}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${file}.${index}`);
  }
}

function writeLog(message: string): void {
  logStream?.write(`${new Date().toISOString()} ${message}\n`);
}

function trayImage(): NativeImage {
  // A tiny original bitmap avoids platform-dependent icon files: green field,
  // dark border, light center. NativeImage expects straight BGRA pixels.
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const center = x >= 5 && x <= 10 && y >= 4 && y <= 11;
      pixels[offset] = border ? 0x35 : center ? 0xb9 : 0x7b;
      pixels[offset + 1] = border ? 0x45 : center ? 0xd7 : 0x9f;
      pixels[offset + 2] = border ? 0x3b : center ? 0xe8 : 0x6f;
      pixels[offset + 3] = 0xff;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function availablePort(): Promise<number> {
  for (let port = 3000; port <= 3010; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error("Порты 3000–3010 заняты. Закройте лишние приложения и повторите запуск.");
}

async function waitUntilHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Локальный сервер завершился с кодом ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The migration may still be running; keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Локальный сервер не ответил за 30 секунд. Подробности — в журнале приложения.");
}

async function startServer(): Promise<number> {
  const port = await availablePort();
  serverUrl = `http://127.0.0.1:${port}/`;
  const data = dataDirectory();
  const entry = path.join(app.getAppPath(), "dist", "boot.js");
  const media = path.join(data, "uploads");
  const secret = desktopSecret(data);
  fs.mkdirSync(media, { recursive: true });
  server = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      APP_ID: "dnd-board-desktop",
      APP_SECRET: secret,
      DATABASE_URL: `file:${path.join(data, "dnd-board.db")}`,
      PORT: String(port),
      SQLITE_PATH: path.join(data, "dnd-board.db"),
      DND_BACKUP_DIR: path.join(data, "backups"),
      DND_MEDIA_DIR: media,
      LOCAL_STORAGE_DIR: media,
      MEDIA_STORAGE_BACKEND: "local",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout?.on("data", (chunk: Buffer) => writeLog(`server ${chunk.toString().trimEnd()}`));
  server.stderr?.on("data", (chunk: Buffer) => writeLog(`server error ${chunk.toString().trimEnd()}`));
  server.on("exit", (code, signal) => writeLog(`server exit code=${code} signal=${signal}`));
  server.on("error", (error) => writeLog(`server spawn error ${error.stack ?? error.message}`));
  return port;
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Invalid URLs stay blocked.
  }
}

function loadingPage(): void {
  const location = serverUrl
    ? `<p>Локальный адрес: <strong>${serverUrl}</strong></p>`
    : "";
  void mainWindow?.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0;background:#101712;color:#d7e8b9;font:16px system-ui;display:grid;place-items:center;height:100vh"><main><h1>DnD Board</h1><p>Запуск локального игрового пространства…</p>${location}</main></body></html>`)}`,
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#101712",
    title: "DnD Board",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:dnd-board",
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("data:")) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

function createTray(): void {
  tray?.destroy();
  tray = new Tray(trayImage());
  tray.setToolTip("DnD Board");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть DnD Board", click: () => mainWindow?.show() },
      {
        label: serverUrl || "Локальный сервер запускается…",
        enabled: Boolean(serverUrl),
        click: () => mainWindow?.show(),
      },
      { label: "Открыть каталог журналов", click: () => void shell.showItemInFolder(logFile) },
      { type: "separator" },
      { label: "Выйти", click: () => app.quit() },
    ]),
  );
  tray.on("double-click", () => mainWindow?.show());
}

async function stopServer(): Promise<void> {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const logs = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logs, { recursive: true });
    logFile = path.join(logs, "desktop.log");
    rotateLog(logFile);
    logStream = fs.createWriteStream(logFile, { flags: "a" });
    writeLog("desktop starting");
    createWindow();
    createTray();
    loadingPage();
    try {
      const port = await startServer();
      loadingPage();
      createTray();
      await waitUntilHealthy(port);
      await mainWindow?.loadURL(serverUrl);
      writeLog(`desktop ready port=${port}`);
      if (process.env.DND_DESKTOP_SMOKE === "1") {
        const marker = process.env.DND_DESKTOP_SMOKE_FILE;
        if (marker) fs.writeFileSync(marker, `healthy ${serverUrl}`);
        app.quit();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(`startup failed ${message}`);
      await dialog.showMessageBox({
        type: "error",
        title: "DnD Board не запущен",
        message,
        detail: `Журнал: ${logFile}`,
      });
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void stopServer().finally(() => {
      logStream?.end();
      app.exit(0);
    });
  });

  app.on("window-all-closed", () => {
    // The application stays available in the tray until explicit Exit.
  });
}

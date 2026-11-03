import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "dnd-board-e2e-"));
let server;
let failed = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function freePort() {
  for (let port = 3100; port < 3200; port += 1) {
    const available = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error("No free E2E port in 3100..3199");
}

async function waitForHealth(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("E2E server did not become healthy");
}

try {
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: root });
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    APP_ID: "dnd-board-e2e",
    APP_SECRET: "e2e-secret-not-for-production-0123456789abcdef",
    DATABASE_URL: "sqlite://local",
    SQLITE_PATH: path.join(temp, "test.db"),
    LOCAL_STORAGE_DIR: path.join(temp, "uploads"),
  };
  server = spawn(process.execPath, ["dist/boot.js"], { cwd: root, env, stdio: "inherit" });
  server.once("exit", (code) => {
    if (code && code !== 0) failed = true;
  });
  await waitForHealth(port);
  await run(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "test", "--config", "playwright.config.ts"], {
    cwd: root,
    env: { ...env, E2E_BASE_URL: `http://127.0.0.1:${port}` },
  });
} finally {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await rm(temp, { recursive: true, force: true });
  if (failed) process.exitCode = 1;
}

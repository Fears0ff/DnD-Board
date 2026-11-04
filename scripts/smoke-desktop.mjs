import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") {
  throw new Error("The desktop smoke test must run on native Windows.");
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-board-desktop-smoke-"));
const marker = path.join(temporary, "healthy.txt");
const electron = path.resolve("node_modules", ".bin", "electron.cmd");
const child = spawn(electron, ["."], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DND_DESKTOP_SMOKE: "1",
    DND_DESKTOP_SMOKE_FILE: marker,
    DND_DESKTOP_SMOKE_PROFILE: path.join(temporary, "profile"),
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false,
});

let output = "";

function failSmoke(message) {
  const desktopLog = path.join(temporary, "profile", "logs", "desktop.log");
  const desktopOutput = fs.existsSync(desktopLog)
    ? fs.readFileSync(desktopLog, "utf8")
    : "<desktop.log was not created>";
  const details = `${message}\n${output.slice(-8000)}\nDesktop log:\n${desktopOutput.slice(-8000)}`;
  const annotation = details
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=Desktop smoke diagnostics::${annotation}`);
  throw new Error(details);
}

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

const timeout = setTimeout(() => {
  child.kill("SIGKILL");
}, 60_000);

try {
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0 || !fs.existsSync(marker)) {
    failSmoke(`Desktop smoke failed (exit ${code}).`);
  }
  const database = fs
    .readdirSync(temporary, { recursive: true })
    .find((name) => String(name).endsWith("dnd-board.db"));
  if (!database) failSmoke("Desktop smoke did not create its isolated database.");
  console.log(fs.readFileSync(marker, "utf8"));
  console.log("Native Electron startup, server health gate and SQLite startup passed.");
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(temporary, { recursive: true, force: true });
}

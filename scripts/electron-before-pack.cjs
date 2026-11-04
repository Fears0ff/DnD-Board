const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

function capturePackagingOutput() {
  const output = [];
  const methods = ["log", "warn", "error"];
  const original = Object.fromEntries(methods.map((name) => [name, console[name]]));
  for (const name of methods) {
    console[name] = (...args) => {
      original[name](...args);
      output.push(util.format(...args));
    };
  }
  process.once("exit", (code) => {
    if (code === 0) return;
    const details = output.join("\n").trim().slice(-24000) ||
      `electron-builder exited with code ${code}.`;
    original.error(`::error title=Windows installer packaging::${annotationText(details)}`);
  });
}

function annotationText(error) {
  return String(error instanceof Error ? error.stack : error)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/**
 * Precondition: build:desktop has already run `electron-builder install-app-deps`.
 * Packaging does not rebuild dependencies a second time (npmRebuild is false):
 * this hook copies the already-rebuilt Electron runtime into dist/node_modules.
 * The Vite build also refreshes that runtime for the preceding smoke test.
 */
module.exports = async function beforePack(context) {
  try {
    capturePackagingOutput();
    console.log("::notice title=Desktop packaging::beforePack started");
    if (context.electronPlatformName !== "win32") {
      throw new Error("DnD Board desktop releases are supported only on native Windows runners.");
    }
    const root = context.packager.projectDir;
    const sourceRoot = path.join(root, "node_modules");
    const targetRoot = path.join(root, "dist", "node_modules");
    const sqliteSource = path.join(sourceRoot, "better-sqlite3");
    const sqliteTarget = path.join(targetRoot, "better-sqlite3");
    const nativeBinary = path.join(sqliteSource, "build", "Release", "better_sqlite3.node");
    if (!fs.existsSync(nativeBinary)) {
      throw new Error(`Missing Electron SQLite binary: ${nativeBinary}`);
    }

    fs.rmSync(sqliteTarget, { recursive: true, force: true });
    fs.mkdirSync(path.join(sqliteTarget, "build", "Release"), { recursive: true });
    fs.cpSync(path.join(sqliteSource, "lib"), path.join(sqliteTarget, "lib"), { recursive: true });
    fs.copyFileSync(nativeBinary, path.join(sqliteTarget, "build", "Release", "better_sqlite3.node"));
    for (const file of ["package.json", "LICENSE"]) {
      fs.copyFileSync(path.join(sqliteSource, file), path.join(sqliteTarget, file));
    }
    for (const dependency of ["bindings", "file-uri-to-path"]) {
      const target = path.join(targetRoot, dependency);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(path.join(sourceRoot, dependency), target, { recursive: true });
    }
    console.log("::notice title=Desktop packaging::beforePack completed");
  } catch (error) {
    console.error(`::error title=Desktop packaging::${annotationText(error)}`);
    throw error;
  }
};

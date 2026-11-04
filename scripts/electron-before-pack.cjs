const fs = require("node:fs");
const path = require("node:path");

function capturePackagingOutput() {
  const output = [];
  const stderr = process.stderr.write.bind(process.stderr);
  const { log } = require("builder-util");
  const logError = log.error.bind(log);
  log.error = (fields, message) => {
    const error = message === undefined ? fields : [fields, message];
    stderr(`::error title=Windows installer error::${annotationText(error)}\n`);
    return logError(fields, message);
  };
  const logWarning = log.warn.bind(log);
  log.warn = (fields, message) => {
    if (message === "duplicate dependency references") {
      return;
    }
    return logWarning(fields, message);
  };
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, encoding, callback) => {
      output.push(String(chunk));
      return write(chunk, encoding, callback);
    };
  }
  process.once("exit", (code) => {
    if (code === 0) {
      return;
    }
    const details = output.join("").trim().slice(-4000);
    stderr(`::notice title=Windows installer exit::code=${code}%0A${annotationText(details)}\n`);
  });
}

function annotationText(error) {
  const text = Array.isArray(error)
    ? error.map((item) => (item instanceof Error ? item.stack : String(item))).join(" ")
    : String(error instanceof Error ? error.stack : error);
  return text
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

const util = require("node:util");

/**
 * build:desktop has already rebuilt native dependencies for Electron.
 * Returning false preserves that verified runtime instead of rebuilding it.
 * The temporary console capture also makes early packaging failures visible
 * in GitHub check annotations, where raw Actions logs are not always available.
 */
module.exports = () => {
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
    const annotation = details
      .replaceAll("%", "%25")
      .replaceAll("\r", "%0D")
      .replaceAll("\n", "%0A");
    original.error(`::error title=Windows installer packaging::${annotation}`);
  });

  console.log("::notice title=Desktop packaging::Using native dependencies verified by the desktop smoke test");
  return false;
};

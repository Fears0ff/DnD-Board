import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.GITHUB_ACTIONS) process.exit(0);

const archiveUrl = "https://www.kimi.com/apiv2-files/sign-obj/kimi-fs%2Ffiles%2Fblob%2F53a57ecfe91d4b2cbc98c6e3ec75ce9a01885ac175fe955f936101a5ad13ec4b?filename=dnd-verified-source-no-workflow.tar.gz&sig=r7J3yK-_lghCVtdklZ-h2aKWqP9t6OP--xg-dSnQyR8=&t=o";
const expectedChecksum = "53a57ecfe91d4b2cbc98c6e3ec75ce9a01885ac175fe955f936101a5ad13ec4b";
const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "dnd-source-import-"));
const archive = join(temp, "source.tar.gz");
const unpacked = join(temp, "source");
let stage = "archive download";

try {
  mkdirSync(unpacked, { recursive: true });
  const response = await fetch(archiveUrl);
  if (!response.ok) throw new Error(`Source archive download failed: ${response.status}`);
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  stage = "archive verification";
  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (checksum !== expectedChecksum) throw new Error("Source archive checksum mismatch");

  stage = "archive extraction";
  execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  if (names.length !== 87) throw new Error(`Expected 87 source files, got ${names.length}`);
  for (const name of names) {
    if (name.startsWith(".github/") || name.includes("..")) {
      throw new Error(`Unsafe or forbidden archive path: ${name}`);
    }
    const destination = join(root, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(unpacked, name), destination, { recursive: true, force: true });
  }

  stage = "final dependency installation";
  rmSync(fileURLToPath(import.meta.url));
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });

  stage = "source commit";
  execFileSync("git", ["config", "user.name", "github-actions[bot]"], { cwd: root });
  execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd: root });
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Add media, compendium, character sheets and desktop runtime"], { cwd: root, stdio: "inherit" });

  stage = "source push";
  try {
    execFileSync("git", ["push", "origin", "HEAD:main"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : "";
    const detail = stderr
      .replace(/https:\/\/[^\s/@]+@/g, "https://")
      .replace(/(authorization|password|token)[=:][^\s]+/gi, "$1=[redacted]")
      .trim()
      .split("\n")
      .slice(-8)
      .join(" | ");
    throw new Error(detail || (error instanceof Error ? error.message : String(error)));
  }
} catch (error) {
  const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0];
  console.error(`::error::Verified source import failed during ${stage}: ${detail}`);
  process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}

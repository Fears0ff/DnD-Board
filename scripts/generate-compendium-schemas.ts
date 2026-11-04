/**
 * Regenerates docs/import-schemas/v1/*.json from the Zod definitions in
 * contracts/compendium.ts (draft 2020-12). Run after changing card schemas:
 *
 *   npx vite-node scripts/generate-compendium-schemas.ts
 *
 * tests/integration/compendium.test.ts asserts the committed files match
 * this output after normalizing platform checkout line endings, so a schema
 * change without regeneration fails CI.
 */
import fs from "node:fs";
import path from "node:path";
import { buildCompendiumJsonSchemas } from "../contracts/compendium";

// Anchored at the working directory: run from the repository root (the
// esbuild bundle used in CI has no meaningful import.meta.dirname).
const outDir = path.resolve(process.cwd(), "docs/import-schemas/v1");

const files = buildCompendiumJsonSchemas();
fs.mkdirSync(outDir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, content);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${content.length} bytes)`);
}
console.log(`done: ${Object.keys(files).length} schema files`);

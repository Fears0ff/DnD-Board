const fs = require("node:fs");
const path = require("node:path");
const { version } = require("../package.json");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const expectedName = `DnD-Board-Setup-${version}.exe`;
  const expectedPath = path.resolve(buildResult.outDir, expectedName);
  const isReported = buildResult.artifactPaths.some(
    (artifact) => path.resolve(artifact) === expectedPath,
  );
  if (!isReported || !fs.existsSync(expectedPath)) {
    const artifacts = buildResult.artifactPaths.map((artifact) => path.basename(artifact)).join(", ");
    throw new Error(`Missing Windows installer ${expectedName}. Built artifacts: ${artifacts || "none"}`);
  }
  const size = fs.statSync(expectedPath).size;
  console.log(`::notice title=Windows installer::${expectedName} (${size} bytes)`);
  return [];
};

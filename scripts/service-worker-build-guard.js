const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BUILD_ID_PATTERN = /const BUILD_ID = "([^"]+)";/;

function readServiceWorkerBuildId(serviceWorkerPath) {
  if (!fs.existsSync(serviceWorkerPath)) {
    return null;
  }

  const source = fs.readFileSync(serviceWorkerPath, "utf8");
  return source.match(BUILD_ID_PATTERN)?.[1] ?? null;
}

function ensureServiceWorkerBuildMatch({
  root,
  distDir = ".next",
  runGenerator,
}) {
  const buildIdPath = path.join(root, distDir, "BUILD_ID");
  const serviceWorkerPath = path.join(root, "public", "service-worker.js");

  if (!fs.existsSync(buildIdPath)) {
    throw new Error(`No production build found (${distDir}/BUILD_ID missing).`);
  }

  const buildId = fs.readFileSync(buildIdPath, "utf8").trim();
  const currentWorkerBuildId = readServiceWorkerBuildId(serviceWorkerPath);
  if (currentWorkerBuildId === buildId) {
    return { buildId, regenerated: false };
  }

  const generate =
    runGenerator ??
    (() => {
      const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts", "generate-service-worker.mjs")],
        {
          cwd: root,
          env: {
            ...process.env,
            // start:stable always serves `.next`; do not inherit a test/dev dist
            // directory that would stamp the worker for a different bundle.
            SMART_NOTES_NEXT_DIST_DIR: distDir,
          },
          stdio: "inherit",
          windowsHide: true,
        }
      );

      if (result.status !== 0) {
        throw new Error(`Service-worker generation failed with status ${result.status ?? "unknown"}.`);
      }
    });

  generate({ buildId, serviceWorkerPath });

  const generatedWorkerBuildId = readServiceWorkerBuildId(serviceWorkerPath);
  if (generatedWorkerBuildId !== buildId) {
    throw new Error(
      `Service-worker build mismatch: expected ${buildId}, found ${generatedWorkerBuildId ?? "missing"}.`
    );
  }

  return { buildId, regenerated: true };
}

module.exports = {
  ensureServiceWorkerBuildMatch,
  readServiceWorkerBuildId,
};

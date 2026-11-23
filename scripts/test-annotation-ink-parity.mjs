import { spawnSync } from "node:child_process";
import path from "node:path";

const engines = ["tldraw", "smart-notes"];
const requestedEngine = process.env.SMART_NOTES_E2E_INK_ENGINE;
if (requestedEngine && !engines.includes(requestedEngine)) {
  throw new Error(`Unknown annotation ink engine: ${requestedEngine}`);
}

let failed = false;
const args = process.argv.slice(2);
const firstSpec = args.find((arg) => arg.endsWith(".spec.ts"));
const target = process.env.SMART_NOTES_E2E_PREVIEW_URL?.startsWith("https:") ? "https" : "local";
for (const engine of requestedEngine ? [requestedEngine] : engines) {
  const outputDir = path.join("test-results", "annotation-ink-parity",
    path.basename(firstSpec ?? "suite", ".spec.ts"), target, engine);
  process.stdout.write(`\nAnnotation ink engine: ${engine}\n`);
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...args, "--output", outputDir], {
    stdio: "inherit",
    env: { ...process.env, SMART_NOTES_E2E_INK_ENGINE: engine },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

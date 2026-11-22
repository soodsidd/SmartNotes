import { spawnSync } from "node:child_process";

let failed = false;
for (const engine of ["tldraw", "smart-notes"]) {
  process.stdout.write(`\nAnnotation ink engine: ${engine}\n`);
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, SMART_NOTES_E2E_INK_ENGINE: engine },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

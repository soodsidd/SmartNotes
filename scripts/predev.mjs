import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const sw = spawnSync(process.execPath, [path.join(__dirname, "generate-service-worker.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    SMART_NOTES_NEXT_DIST_DIR: process.env.SMART_NOTES_NEXT_DIST_DIR || ".next-dev",
  },
  stdio: "inherit",
  windowsHide: true,
});

if (sw.status !== 0) {
  process.exit(sw.status ?? 1);
}

const fonts = spawnSync(process.execPath, [path.join(__dirname, "sync-pdf-fonts.mjs")], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});

process.exit(fonts.status ?? 1);

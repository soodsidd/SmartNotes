import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = Number(process.env.PORT || 3216);
const VAULT = path.resolve(__dirname, ".e2e-vault");
const STATE_DIR = path.resolve(__dirname, ".e2e-state-sn151");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/sn-151-desktop-diag.spec.ts",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1900, height: 1000 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: "node serve-prebuilt.js",
    url: `http://127.0.0.1:${PORT}/api/version`,
    reuseExistingServer: false,
    timeout: 180_000,
    cwd: __dirname,
    env: {
      PORT: String(PORT),
      SMART_NOTES_VAULT: VAULT,
      SMART_NOTES_STATE_DIR: STATE_DIR,
      NODE_ENV: "production",
    },
  },
});

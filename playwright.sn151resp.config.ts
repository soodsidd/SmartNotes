import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * SN-151 responsiveness harness — production bundle + isolated e2e vault.
 * Gates: no main-thread freeze during open/paint, scroll stays live, all
 * visible pages paint, toolbar survives, warm reopen under budget.
 */
const PORT = Number(process.env.PORT || 3217);
const VAULT = path.resolve(__dirname, ".e2e-vault");
const STATE_DIR = path.resolve(__dirname, ".e2e-state-sn151-resp");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/sn-151-responsive-open.spec.ts",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 430, height: 1200 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
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

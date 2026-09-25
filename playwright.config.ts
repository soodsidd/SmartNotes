import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3199);
const VAULT = path.resolve(__dirname, '.e2e-vault');
const STATE_DIR = path.resolve(__dirname, '.e2e-state');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // SN-135/136/151 PDF harnesses seed a portable vault and leave large trees;
  // they have dedicated catalog entries (pre-merge). Keep them out of release
  // `test:e2e:desktop|mobile` smoke so they cannot re-pollute `.e2e-portable-vault`
  // mid-suite and time out later editor/tree tests.
  // SN-135/136/151 PDF harnesses seed a portable vault and leave large trees;
  // they have dedicated catalog entries (pre-merge). Keep them out of release
  // `test:e2e:desktop|mobile` smoke so they cannot re-pollute `.e2e-portable-vault`
  // mid-suite and time out later editor/tree tests.
  // SN-168 uses a separate `.e2e-portable-vault-sn168` root and restores the
  // registry in afterAll, so it may run in-suite without PDF pollution.
  testIgnore: ['**/sn-135-*.spec.ts', '**/sn-136-*.spec.ts', '**/sn-151-*.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 430, height: 1200 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    }
  ],
  webServer: {
    command: `node server.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    cwd: __dirname,
    env: {
      // Explicit merge — some Playwright versions replace env when `env` is set.
      ...process.env,
      PORT: String(PORT),
      SMART_NOTES_VAULT: VAULT,
      SMART_NOTES_STATE_DIR: STATE_DIR,
      // Isolate from production `.next` (start:stable on :3002) and from AV
      // preview `.next-dev`. Without this, NODE_ENV=development compiles into
      // `.next` and corrupts / deletes the live production BUILD_ID.
      SMART_NOTES_NEXT_DIST_DIR: '.next-e2e',
      SMART_NOTES_SKIP_SW_GENERATE: '1',
      NODE_ENV: 'development',
      ENABLE_DEV_SCREENS: '1'
    }
  }
});

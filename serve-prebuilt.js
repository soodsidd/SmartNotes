/**
 * Smart Notes stable runtime launcher.
 *
 * Serves the already-built optimized production bundle in `.next` with
 * NODE_ENV=production. Unlike runtime-start.js, it NEVER runs `next build` on
 * start — a valid build must already exist. This is deliberate: the per-start
 * `next build` in runtime-start.js is slow and, if interrupted by the runtime
 * panel (health-check timeout / process kill / Windows file lock), leaves
 * `.next` half-written and breaks every subsequent start.
 *
 * When sources change, run `npm run build` once; then the runtime just serves
 * the fresh optimized bundle. Optimized (not dev) mode is what keeps the mobile
 * companion fast enough that keyboard dictation does not lag or drop.
 */

const fs = require('fs');
const path = require('path');
const { ensureServiceWorkerBuildMatch } = require('./scripts/service-worker-build-guard');

process.env.NODE_ENV = 'production';

const buildIdPath = path.join(__dirname, '.next', 'BUILD_ID');
if (!fs.existsSync(buildIdPath)) {
  console.error(
    '[smart-notes] No production build found (.next/BUILD_ID missing). Run: npm run build'
  );
  process.exit(1);
}

try {
  const worker = ensureServiceWorkerBuildMatch({ root: __dirname, distDir: '.next' });
  if (worker.regenerated) {
    console.log(`[smart-notes] Synchronized service worker to production build ${worker.buildId}`);
  }
} catch (error) {
  console.error(`[smart-notes] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// server.js reads `dev` from NODE_ENV at require time; set above so it serves
// the optimized .next bundle rather than starting the dev compiler.
require('./server.js');

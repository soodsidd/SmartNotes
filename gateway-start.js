// gateway-start.js — invoked by the gateway supervisor.
// Builds the Next.js bundle if sources changed, then runs server.js.

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

process.title = 'smart-notes';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const appDir = __dirname;
const buildIdPath = path.join(appDir, '.next', 'BUILD_ID');
const nextCli = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');

function getLatestMtimeMs(target) {
  if (!fs.existsSync(target)) return 0;
  const st = fs.statSync(target);
  if (!st.isDirectory()) return st.mtimeMs;
  let latest = st.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (['.next', '.turbo', 'node_modules', 'vault', 'test-results'].includes(entry.name)) continue;
    latest = Math.max(latest, getLatestMtimeMs(path.join(target, entry.name)));
  }
  return latest;
}

function needsBuild() {
  if (!fs.existsSync(buildIdPath)) return true;
  const buildMtime = fs.statSync(buildIdPath).mtimeMs;
  const watched = [
    path.join(appDir, 'src'),
    path.join(appDir, 'public'),
    path.join(appDir, 'server.js'),
    path.join(appDir, 'package.json'),
    path.join(appDir, 'next.config.mjs')
  ];
  return watched.some((p) => getLatestMtimeMs(p) > buildMtime);
}

if (!fs.existsSync(nextCli)) {
  console.error('[smart-notes] next not installed. Run `pnpm install` from the repo root.');
  process.exit(1);
}

if (needsBuild()) {
  console.log('[smart-notes] Building production bundle...');
  const r = spawnSync(process.execPath, [nextCli, 'build'], {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const child = spawn(process.execPath, [path.join(appDir, 'server.js')], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

// Smart Notes gateway launcher and local lifecycle supervisor (SN-301).
// This process stays alive when the app child is stopped, so Settings → Server
// can still Start it. It serves the prebuilt bundle via serve-prebuilt.js and
// never starts a second server on a port that is already in use.
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.title = 'smart-notes-supervisor';

const appDir = __dirname;
const appPort = Number(process.env.PORT || 3002);
// 3002 → 3010 for production; previews on other ports get a matching offset.
const controlPort = Number(process.env.SMART_NOTES_CONTROL_PORT || appPort + 8);
const address = `http://localhost:${appPort}`;
const buildPath = path.join(appDir, '.next', 'BUILD_ID');
const logPath = path.join(appDir, '.smart-notes-server.log');
const LOG_TAIL_CHARS = 16000;
const LOG_FILE_MAX_BYTES = 512 * 1024;
let child = null;
let phase = 'stopped';
let startedAt = null;
let servingBuild = null;
let operation = Promise.resolve();
let logTail = '';

function buildId() {
  try { return fs.readFileSync(buildPath, 'utf8').trim(); } catch { return null; }
}

function seedLog() {
  try {
    const text = fs.readFileSync(logPath, 'utf8');
    logTail = text.slice(-LOG_TAIL_CHARS);
    if (Buffer.byteLength(text) > LOG_FILE_MAX_BYTES) fs.writeFileSync(logPath, logTail);
  } catch { /* first run */ }
}

function log(chunk) {
  const text = String(chunk);
  process.stdout.write(text);
  logTail = (logTail + text).slice(-LOG_TAIL_CHARS);
  try { fs.appendFileSync(logPath, text); } catch { /* log file is best-effort */ }
}

function status() {
  return {
    status: phase,
    address,
    reachable: phase === 'running',
    pid: child?.pid ?? null,
    uptimeSeconds: startedAt && child ? Math.floor((Date.now() - startedAt) / 1000) : null,
    build: child ? servingBuild : buildId(),
    log: logTail,
    supervised: true,
  };
}

function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect(appPort, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1200, () => { socket.destroy(); resolve(false); });
  });
}

async function start() {
  if (child) return status();
  if (await portInUse()) throw new Error(`Port ${appPort} is already in use; refusing to start another server.`);
  if (!buildId()) throw new Error('No production build found. Run npm run build before starting.');
  phase = 'starting';
  servingBuild = buildId();
  const proc = spawn(process.execPath, [path.join(appDir, 'serve-prebuilt.js')], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(appPort), SMART_NOTES_CONTROL_PORT: String(controlPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child = proc;
  startedAt = Date.now();
  proc.stdout.on('data', log);
  proc.stderr.on('data', log);
  proc.on('error', (error) => log(`[smart-notes] ${error.message}\n`));
  proc.on('exit', (code) => {
    log(`[smart-notes] server exited (${code ?? 'signal'})\n`);
    if (child === proc) { child = null; startedAt = null; phase = 'stopped'; }
  });
  for (let attempt = 0; attempt < 120 && child === proc; attempt++) {
    if (await portInUse()) { phase = 'running'; return status(); }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server did not become reachable. Check the recent server log.');
}

async function stop() {
  if (!child) return status();
  const proc = child;
  phase = 'stopping';
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10000);
    proc.once('exit', () => { clearTimeout(timeout); resolve(); });
    proc.kill('SIGTERM');
  });
  if (child === proc) throw new Error('Server did not stop within 10 seconds.');
  return status();
}

function run(action) {
  const result = operation.then(async () => {
    if (action === 'start') return start();
    if (action === 'stop') return stop();
    if (action === 'restart') { await stop(); return start(); }
    throw new Error('Unknown server action.');
  });
  operation = result.catch(() => {});
  return result;
}

// Only pages served by this app's port may drive the supervisor. Dotted DNS
// names are refused (except Tailscale/mDNS) so a rebinding page cannot reach it.
function trustedHostname(hostname) {
  return hostname === 'localhost' || net.isIP(hostname.replace(/^\[|\]$/g, '')) !== 0
    || !hostname.includes('.') || hostname.endsWith('.ts.net') || hostname.endsWith('.local');
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const source = new URL(origin);
    const host = new URL(`http://${req.headers.host || ''}`).hostname;
    return source.protocol === 'http:' && source.port === String(appPort)
      && source.hostname === host && trustedHostname(host);
  } catch { return false; }
}

const control = http.createServer(async (req, res) => {
  if (!allowedOrigin(req)) { res.writeHead(403).end(); return; }
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204).end();
    return;
  }
  // A newer launcher replaces this one. The custom header is never allowed in
  // CORS preflight, so pages cannot trigger it.
  if (req.url === '/shutdown' && req.method === 'POST' && req.headers['x-smart-notes-supervisor'] === 'takeover') {
    res.end(JSON.stringify({ ok: true }));
    log('[smart-notes] supervisor replaced by a newer launcher\n');
    shutdown();
    return;
  }
  if (req.url === '/status' && req.method === 'GET') {
    res.end(JSON.stringify(status()));
    return;
  }
  const action = req.url?.match(/^\/(start|stop|restart)$/)?.[1];
  if (action && req.method === 'POST') {
    try { res.end(JSON.stringify(await run(action))); }
    catch (error) { res.writeHead(409).end(JSON.stringify({ ...status(), error: error.message })); }
    return;
  }
  res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
});

// If an earlier supervisor still holds the control port (for example AV killed
// only the app listener), ask it to stop its child and exit, then retry.
function takeOver() {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: controlPort,
      path: '/shutdown',
      method: 'POST',
      headers: { Origin: `http://localhost:${appPort}`, Host: `localhost:${controlPort}`, 'X-Smart-Notes-Supervisor': 'takeover' },
      timeout: 2000,
    }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

let listenAttempts = 0;
control.on('error', async (error) => {
  if (error.code === 'EADDRINUSE' && listenAttempts++ < 30) {
    if (listenAttempts === 1 && !(await takeOver())) {
      log(`[smart-notes] control port ${controlPort} is held by another process; refusing to start.\n`);
      process.exit(1);
    }
    setTimeout(() => control.listen(controlPort, '0.0.0.0'), 500);
    return;
  }
  log(`[smart-notes] supervisor control port ${controlPort} unavailable: ${error.message}\n`);
  process.exit(1);
});

control.on('listening', () => {
  seedLog();
  log(`[smart-notes] lifecycle supervisor listening on ${controlPort}\n`);
  run('start').catch((error) => log(`[smart-notes] ${error.message}\n`));
});
control.listen(controlPort, '0.0.0.0');

function shutdown() {
  control.close();
  operation = new Promise(() => {}); // refuse further actions while exiting
  if (!child) process.exit(0);
  child.once('exit', () => process.exit(0));
  child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

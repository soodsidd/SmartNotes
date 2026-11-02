// SN-407: the browser cannot prevent the Windows Caps Lock toggle. A child in
// the interactive desktop session owns the low-level hook; this broker only
// arms it for a same-origin, focused Smart Notes editor/composer tab.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const readline = require('readline');

function sameOrigin(socket, inspectOrigin = null) {
  try {
    const origin = new URL(socket.handshake.headers.origin);
    const target = new URL(`http://${socket.handshake.headers.host}`);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return false;
    if (origin.host === target.host) return true;
    // AV's Inspect capture proxy forwards a loopback WebSocket but rewrites
    // Host to the preview port. Allow only this preview's verified proxy port.
    return process.env.npm_lifecycle_event === 'dev'
      && ['127.0.0.1', 'localhost'].includes(target.hostname)
      && origin.hostname === target.hostname
      && origin.origin === inspectOrigin;
  } catch { return false; }
}

function inspectOriginForPreview() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:8787/api/preview/list', { timeout: 1500 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); resolve(null); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) { resolve(null); response.destroy(); }
      });
      response.on('error', () => resolve(null));
      response.on('end', () => {
        try {
          const previews = JSON.parse(body).processes;
          const current = previews.find((preview) => preview.status === 'running'
            && preview.port === Number(process.env.PORT)
            && typeof preview.worktreePath === 'string'
            && path.resolve(preview.worktreePath).toLowerCase() === path.resolve(__dirname, '..').toLowerCase());
          const url = new URL(current?.url);
          resolve(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) ? url.origin : null);
        } catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function startWindowsCapsBridge(io) {
  if (process.platform !== 'win32' || process.env.SMART_NOTES_DISABLE_CAPS_BRIDGE === '1') return () => {};
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, '..', 'scripts', 'windows-caps-bridge.ps1')], {
    cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stderr.on('data', (chunk) => console.warn('[caps-bridge]', String(chunk).trim()));
  let ready = false;
  let stopped = false;
  const peers = new Map();
  const send = (message) => {
    if (ready && !stopped && child.stdin.writable) child.stdin.write(`${message}\n`);
  };
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === 'READY') {
      ready = true;
      for (const socket of peers.values()) socket.emit('dictation:caps-bridge', { ready: true });
      return;
    }
    const [event, id] = line.split('\t');
    if ((event === 'DOWN' || event === 'UP') && peers.has(id)) {
      peers.get(id).emit('dictation:caps-key', event === 'DOWN' ? 'keydown' : 'keyup');
    }
  });
  child.on('error', (error) => { ready = false; stopped = true; console.warn('[caps-bridge]', error.message); });
  child.on('exit', () => {
    ready = false;
    stopped = true;
    for (const socket of peers.values()) socket.emit('dictation:caps-bridge', { ready: false });
  });
  io.on('connection', async (socket) => {
    const allowed = sameOrigin(socket) || sameOrigin(socket, await inspectOriginForPreview());
    if (!allowed || !socket.connected) return;
    peers.set(socket.id, socket);
    socket.emit('dictation:caps-bridge', { ready });
    socket.on('dictation:caps-focus', (active) => send(`${active === true ? 'ARM' : 'DISARM'}\t${socket.id}`));
    socket.on('disconnect', () => {
      send(`DISARM\t${socket.id}`);
      peers.delete(socket.id);
    });
  });
  const close = () => {
    send('QUIT');
    child.stdin.end();
    child.kill();
  };
  process.once('exit', close);
  return close;
}

module.exports = { sameOrigin, inspectOriginForPreview, startWindowsCapsBridge };

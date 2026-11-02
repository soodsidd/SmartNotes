// SN-407: the browser cannot prevent the Windows Caps Lock toggle. A child in
// the interactive desktop session owns the low-level hook; this broker only
// arms it for a same-origin, focused Smart Notes editor/composer tab.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function sameOrigin(socket) {
  try {
    const origin = new URL(socket.handshake.headers.origin);
    return origin.host === socket.handshake.headers.host && (origin.protocol === 'http:' || origin.protocol === 'https:');
  } catch { return false; }
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
  io.on('connection', (socket) => {
    if (!sameOrigin(socket)) return;
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

module.exports = { startWindowsCapsBridge };

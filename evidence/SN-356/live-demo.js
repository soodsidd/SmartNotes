// SN-356 live demo: drives the WORKTREE cli-chat (not the symlinked main copy)
// with the real Claude CLI through /send, off -> on -> off in ONE thread.
// Usage: node evidence/SN-356/live-demo.js > evidence/SN-356/live-demo.log
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { createChatModule } = require('../../packages/cli-chat/index');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn356-live-'));
const waiters = new Map();
const texts = new Map();
const tools = new Map();
const io = {
  emit(name, event) {
    if (name !== 'chat_event' || !event) return;
    const id = event.turn_id;
    if (event.type === 'token') texts.set(id, (texts.get(id) || '') + (event.payload?.text || ''));
    if (event.type === 'tool_use' || event.type === 'tool' || /tool/.test(event.type)) {
      tools.set(id, [...(tools.get(id) || []), JSON.stringify(event.payload || {}).slice(0, 200)]);
    }
    if (event.type === 'done') waiters.get(id)?.(event.payload);
  },
};
const chat = createChatModule(null, io, {
  appId: 'smart-notes',
  workingDirectory: path.resolve(__dirname, '../..'),
  stateDir: root,
  configPath: path.join(root, 'settings.json'),
  recoverInterruptedOnStartup: false,
  uploadDir: path.join(root, 'uploads'),
  sandbox: 'editor',
  systemPrompt: 'You are the Smart Notes Companion. Be brief.',
});

function send(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: '/api/chat/send', method: 'POST', headers: { 'content-type': 'application/json' } });
  return new Promise((resolve) => {
    let status = 200;
    chat.handleRequest(req, { writeHead: (s) => { status = s; }, end: (t) => resolve({ status, body: JSON.parse(t || '{}') }) });
  });
}

const QUESTION = 'Diagnose my PC: report the exact current number of running processes on this PC (one number), and the name of the process using the most memory. If you cannot access this PC, say so in one sentence and why.';

(async () => {
  const thread = 'demo/diagnose.html::whole';
  for (const [label, armed] of [['1-off', false], ['2-on', true], ['3-off-again', false]]) {
    const started = Date.now();
    const { status, body } = await send({ provider: 'claude', model: 'sonnet', thread_key: thread, message: QUESTION, ...(armed ? { computer_access: true } : {}) });
    if (status !== 200) { console.log(label, 'send failed', status, body); continue; }
    const done = await new Promise((resolve) => { waiters.set(body.turn_id, resolve); setTimeout(() => resolve({ status: 'timeout' }), 240000); });
    const record = JSON.parse(fs.readFileSync(path.join(root, 'jobs', `${body.turn_id}.json`), 'utf8'));
    console.log(`=== Turn ${label} (computer_access sent: ${armed}; recorded: ${record.request.computer_access}; ${Math.round((Date.now() - started) / 1000)}s; ${done?.status})`);
    if (tools.get(body.turn_id)) console.log('tool events:', tools.get(body.turn_id).length);
    console.log((texts.get(body.turn_id) || '').trim());
    console.log();
  }
  process.exit(0);
})();

// SN-356 rework: real Cursor CLI through the worktree /send path, one thread.
// Usage: node evidence/SN-356/live-cursor-rework.js > evidence/SN-356/live-cursor-rework.log
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { createChatModule } = require('../../packages/cli-chat/index');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn356-cursor-rework-'));
const waiters = new Map();
const texts = new Map();
const toolCounts = new Map();
const chat = createChatModule(null, {
  emit(name, event) {
    if (name !== 'chat_event' || !event) return;
    const id = event.turn_id;
    if (event.type === 'token') texts.set(id, (texts.get(id) || '') + (event.payload?.text || ''));
    if (event.type === 'tool_call') toolCounts.set(id, (toolCounts.get(id) || 0) + 1);
    if (event.type === 'done') waiters.get(id)?.(event.payload);
  },
}, {
  appId: 'smart-notes',
  workingDirectory: path.resolve(__dirname, '../..'),
  stateDir: root,
  configPath: path.join(root, 'settings.json'),
  recoverInterruptedOnStartup: false,
  uploadDir: path.join(root, 'uploads'),
  sandbox: 'editor',
  verbose: true,
  systemPrompt: 'You are the Smart Notes Companion. Be brief and accurate.',
});

function send(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: '/api/chat/send', method: 'POST', headers: { 'content-type': 'application/json' } });
  return new Promise(resolve => {
    let status = 200;
    chat.handleRequest(req, { writeHead: s => { status = s; }, end: text => resolve({ status, body: JSON.parse(text || '{}') }) });
  });
}

(async () => {
  const threadKey = 'demo/camera-diagnosis.html::whole';
  const question = 'Diagnose this PC: use a PowerShell shell command to count currently running processes and report the exact count. If shell access is unavailable, say so; do not guess.';
  for (const [label, armed] of [['on', true], ['off-after-uncheck', false]]) {
    const { status, body } = await send({ provider: 'cursor', thread_key: threadKey, message: question, ...(armed ? { computer_access: true } : {}) });
    if (status !== 200) throw new Error(`${label} send failed: ${status} ${JSON.stringify(body)}`);
    const done = await new Promise(resolve => {
      const timeout = setTimeout(() => resolve({ status: 'timeout' }), 120000);
      waiters.set(body.turn_id, payload => { clearTimeout(timeout); resolve(payload); });
    });
    const record = JSON.parse(fs.readFileSync(path.join(root, 'jobs', `${body.turn_id}.json`), 'utf8'));
    console.log(`=== ${label}; thread=${threadKey}; grant=${record.request.computer_access}; status=${done?.status}; tool_calls=${toolCounts.get(body.turn_id) || 0}`);
    console.log((texts.get(body.turn_id) || '').trim());
    if (done?.status !== 'completed') throw new Error(`${label} did not complete`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

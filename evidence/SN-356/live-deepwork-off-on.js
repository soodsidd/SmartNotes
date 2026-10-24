// SN-356 rework cycle 2: real Cursor CLI through the worktree /api/chat/send path
// on a Deep Work thread (dwc_ capability, like the owner's failing turns).
// Sequence on ONE thread: Off -> On -> Off. On must run a real PC command.
// Usage: node evidence/SN-356/live-deepwork-off-on.js > evidence/SN-356/live-deepwork-off-on.log
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { createChatModule } = require('../../packages/cli-chat/index');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn356-deepwork-'));
const capability = `dwc_${'S'.repeat(43)}`;
const waiters = new Map();
const texts = new Map();
const tools = new Map();
const chat = createChatModule(null, {
  emit(name, event) {
    if (name !== 'chat_event' || !event) return;
    const id = event.turn_id;
    if (event.type === 'token') texts.set(id, (texts.get(id) || '') + (event.payload?.text || ''));
    if (event.type === 'tool_call') {
      const list = tools.get(id) || [];
      list.push(event.payload?.name || event.payload?.tool || 'tool');
      tools.set(id, list);
    }
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
  resolveDeepWorkTurn: async (cap) => (cap === capability ? {
    scopeKey: 'deep-work:sn356-live-demo',
    workingDirectory: path.resolve(__dirname, '../..'),
    companionBridgeRoot: path.join(root, 'bridge'),
  } : null),
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
  const threadKey = `${capability}::whole`;
  const appContext = [
    'Smart Notes Deep Work operating context:',
    '- Registered workspace root identity: C:\Projects\smart-notes',
    `- workspaceCapability: ${capability}`,
  ].join('\n');
  const question = 'Diagnose this PC: run a PowerShell command to count currently running processes and report the exact count and the top memory process. If you have no shell access, say so; do not guess.';
  const steps = [
    ['1-off (box unchecked)', false, question],
    ['2-on (box checked: "ok try again")', true, `ok try again. ${question}`],
    ['3-off (box unchecked again)', false, `check again. ${question}`],
  ];
  console.log(`thread=${threadKey} provider=cursor started=${new Date().toISOString()}`);
  for (const [label, armed, message] of steps) {
    const { status, body } = await send({ provider: 'cursor', thread_key: threadKey, app_context: appContext, message, computer_access: armed });
    if (status !== 200) throw new Error(`${label} send failed: ${status} ${JSON.stringify(body)}`);
    const done = await new Promise(resolve => {
      const timeout = setTimeout(() => resolve({ status: 'timeout' }), 180000);
      waiters.set(body.turn_id, payload => { clearTimeout(timeout); resolve(payload); });
    });
    const record = JSON.parse(fs.readFileSync(path.join(root, 'jobs', `${body.turn_id}.json`), 'utf8'));
    const used = tools.get(body.turn_id) || [];
    console.log(`\n=== ${label}; wire computer_access=${armed}; server grant=${record.request.computer_access}; scope=${record.scope_key}; status=${done?.status}; tool_calls=${used.length} [${used.join(', ')}]`);
    console.log((texts.get(body.turn_id) || '').trim());
    if (done?.status !== 'completed') throw new Error(`${label} did not complete`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

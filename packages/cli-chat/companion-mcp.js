#!/usr/bin/env node
'use strict';

// Codex Computer-OFF transport. The Smart Notes bridge watcher remains the
// authority for tool allowlists, capability checks, and managed API routing.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { ALLOWED_TOOLS, WORKSPACE_TOOLS, DEEP_WORK_HOST_PAGE_TOOLS } = require('../../server/companion-log-form-bridge');

const root = process.argv[2];
const capability = process.argv[3] || '';
if (!root || !path.isAbsolute(root) || (capability && !/^dwc_[A-Za-z0-9_-]{43}$/.test(capability))) {
  process.stderr.write('Invalid companion bridge scope.\n');
  process.exit(1);
}
// SN-404: host-page tools are listed for Deep Work; the bridge watcher still
// rejects them unless the capability has a verified host page subtree.
const allowedTools = capability ? new Set([...WORKSPACE_TOOLS, ...DEEP_WORK_HOST_PAGE_TOOLS]) : ALLOWED_TOOLS;
const requestsDir = path.join(root, 'requests');
const responsesDir = path.join(root, 'responses');
const schemas = {
  workspace_source_create: {
    properties: { workspace: { type: 'string' }, path: { type: 'string' }, source: { type: 'string', description: 'UTF-8 file contents; for a new notebook, a valid empty nbformat v4 skeleton.' } },
    required: ['workspace', 'path', 'source'],
  },
  workspace_cell_create: {
    properties: { workspace: { type: 'string' }, path: { type: 'string' }, expectedRevision: { type: 'string', description: 'The sha256 revision returned by the prior read or mutation.' }, cellType: { type: 'string', enum: ['markdown', 'code', 'raw'] }, source: { type: 'string' }, index: { type: 'integer' } },
    required: ['workspace', 'path', 'expectedRevision', 'cellType', 'source'],
  },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function callBridge(tool, args) {
  if (!allowedTools.has(tool)) return { ok: false, code: 'TOOL_NOT_ALLOWED' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, code: 'INVALID_INPUT' };
  if (capability && args.workspace !== capability) return { ok: false, code: 'WORKSPACE_CAPABILITY_MISMATCH' };
  const id = crypto.randomUUID();
  const request = path.join(requestsDir, `${id}.json`);
  const response = path.join(responsesDir, `${id}.json`);
  await fs.writeFile(`${request}.tmp`, JSON.stringify({ tool, args }), 'utf8');
  await fs.rename(`${request}.tmp`, request);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await fs.readFile(response, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await sleep(50);
  }
  return { ok: false, code: 'BRIDGE_TIMEOUT', error: 'The Smart Notes bridge did not respond.' };
}

function reply(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function error(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }
async function handle(message) {
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    reply(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'smart_notes_companion', version: '1.0.0' } });
  } else if (message.method === 'tools/list') {
    reply(message.id, { tools: [...allowedTools].map(name => ({
      name,
      description: `Smart Notes managed ${capability ? 'Deep Work workspace' : 'vault'} operation. Returns the bridge response as JSON.`,
      inputSchema: { type: 'object', ...schemas[name], additionalProperties: true },
    })) });
  } else if (message.method === 'tools/call') {
    const tool = message.params?.name;
    if (typeof tool !== 'string' || !allowedTools.has(tool)) {
      reply(message.id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'TOOL_NOT_ALLOWED' }) }] });
      return;
    }
    const result = await callBridge(tool, message.params?.arguments || {});
    reply(message.id, { isError: result.ok !== true, content: [{ type: 'text', text: JSON.stringify(result) }] });
  } else {
    error(message.id, -32601, 'Method not found');
  }
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  try { Promise.resolve(handle(JSON.parse(line))).catch(err => error(JSON.parse(line).id, -32603, err.message)); }
  catch { error(null, -32700, 'Parse error'); }
});

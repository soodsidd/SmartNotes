import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';

const { startCompanionLogFormBridge, WORKSPACE_TOOLS, ALLOWED_TOOLS } = require('../server/companion-log-form-bridge');
const script = path.join(__dirname, '../packages/cli-chat/companion-mcp.js');

describe('SN-399 Codex stdio MCP bridge', () => {
  const capability = `dwc_${'a'.repeat(43)}`;
  let root: string;
  let bridge: ReturnType<typeof startCompanionLogFormBridge>;
  let proc: ChildProcessWithoutNullStreams;
  let lines: readline.Interface;
  let nextId = 0;
  const pending = new Map<number, (response: any) => void>();
  const invoked: Array<{ tool: string; args: any }> = [];

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn399-mcp-'));
    invoked.length = 0;
    bridge = startCompanionLogFormBridge({
      rootDir: root,
      allowedTools: WORKSPACE_TOOLS,
      authorizeTool: (_tool: string, args: any) => args.workspace === capability,
      invokeTool: async (tool: string, args: any) => {
        invoked.push({ tool, args });
        return { ok: true, status: 200, value: 'bridge response' };
      },
    });
    await bridge.ready;
    proc = spawn(process.execPath, [script, root, capability], { stdio: ['pipe', 'pipe', 'pipe'] });
    lines = readline.createInterface({ input: proc.stdout });
    lines.on('line', line => {
      const response = JSON.parse(line);
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    });
  });

  afterEach(() => {
    lines.close();
    proc.kill();
    bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function request(method: string, params?: object): Promise<any> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 5000);
      pending.set(id, response => { clearTimeout(timer); resolve(response); });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  it('lists scoped host-page tools, returns bridge JSON, refuses unbound tools, and binds the session capability', async () => {
    expect((await request('initialize')).result.serverInfo.name).toBe('smart_notes_companion');
    const tools = (await request('tools/list')).result.tools;
    const listed = tools.map((tool: any) => tool.name);
    expect(listed).toContain('workspace_source_list');
    expect(listed).toContain('workspace_cell_create');
    expect(listed).toContain('page_children');
    expect(listed).not.toContain('page_list');
    expect(tools.find((tool: any) => tool.name === 'workspace_source_create').inputSchema.required).toContain('source');
    expect(tools.find((tool: any) => tool.name === 'workspace_source_delete').inputSchema.required).toContain('confirmPath');
    expect(tools.find((tool: any) => tool.name === 'workspace_source_move').inputSchema.required).toEqual(['workspace', 'path', 'destinationPath', 'expectedRevision']);
    expect(tools.find((tool: any) => tool.name === 'workspace_cell_create').inputSchema.required).toContain('expectedRevision');
    expect(ALLOWED_TOOLS.has('page_get')).toBe(true);

    const deniedVault = await request('tools/call', { name: 'page_children', arguments: { workspace: capability, path: 'x' } });
    expect(JSON.parse(deniedVault.result.content[0].text).code).toBe('TOOL_NOT_ALLOWED');
    expect(invoked).toHaveLength(0);

    const accepted = await request('tools/call', { name: 'workspace_source_list', arguments: { workspace: capability } });
    expect(accepted.result.isError).toBe(false);
    expect(JSON.parse(accepted.result.content[0].text)).toMatchObject({ ok: true, tool: 'workspace_source_list', result: { value: 'bridge response' } });
    expect(invoked).toEqual([{ tool: 'workspace_source_list', args: { workspace: capability } }]);

    // A model that miscopies or omits the long token still acts only on the
    // workspace this MCP process is bound to (the failure seen in production).
    invoked.length = 0;
    const miscopied = await request('tools/call', { name: 'workspace_source_list', arguments: { workspace: `dwc_${'a'.repeat(31)}` } });
    expect(miscopied.result.isError).toBe(false);
    const omitted = await request('tools/call', { name: 'workspace_source_list', arguments: {} });
    expect(omitted.result.isError).toBe(false);
    expect(invoked).toEqual([
      { tool: 'workspace_source_list', args: { workspace: capability } },
      { tool: 'workspace_source_list', args: { workspace: capability } },
    ]);
  });

  it('still refuses a capability the bridge watcher is not bound to', async () => {
    // The watcher, not this transport, is the authority: an MCP process launched
    // with a different capability than its bridge folder is still rejected.
    lines.close();
    proc.kill();
    const other = `dwc_${'b'.repeat(43)}`;
    proc = spawn(process.execPath, [script, root, other], { stdio: ['pipe', 'pipe', 'pipe'] });
    lines = readline.createInterface({ input: proc.stdout });
    lines.on('line', line => {
      const response = JSON.parse(line);
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    });
    const denied = await request('tools/call', { name: 'workspace_source_list', arguments: { workspace: other } });
    expect(JSON.parse(denied.result.content[0].text).code).toBe('WORKSPACE_CAPABILITY_MISMATCH');
    expect(invoked).toHaveLength(0);
  });
});

it('returns page photos as MCP vision blocks without duplicating base64 in text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-page-vision-'));
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const bridge = startCompanionLogFormBridge({
    rootDir: root,
    allowedTools: new Set(['page_image_read']),
    invokeTool: async () => ({ ok: true, status: 200, tool: 'page_image_read', result: {
      ok: true, data: { path: 'Notebook/Section/Page.html', imageCount: 3, index: 0, mimeType: 'image/png', dataBase64: base64 },
    } }),
  });
  await bridge.ready;
  const proc = spawn(process.execPath, [script, root], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const response = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP image response timed out')), 5000);
      proc.stdout.once('data', chunk => { clearTimeout(timer); resolve(JSON.parse(String(chunk).trim())); });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'page_image_read', arguments: { path: 'Notebook/Section/Page.html' } } })}\n`);
    });
    expect(response.result.isError).toBe(false);
    expect(response.result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: base64 });
    expect(response.result.content[0].text).toContain('"imageCount":3');
    expect(response.result.content[0].text).not.toContain(base64);
  } finally {
    proc.kill();
    bridge.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

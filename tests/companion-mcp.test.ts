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

  it('lists only Deep Work tools, returns bridge JSON, and refuses vault or mismatched capability calls', async () => {
    expect((await request('initialize')).result.serverInfo.name).toBe('smart_notes_companion');
    const tools = (await request('tools/list')).result.tools;
    const listed = tools.map((tool: any) => tool.name);
    expect(listed).toContain('workspace_source_list');
    expect(listed).toContain('workspace_cell_create');
    expect(listed).not.toContain('page_get');
    expect(tools.find((tool: any) => tool.name === 'workspace_source_create').inputSchema.required).toContain('source');
    expect(tools.find((tool: any) => tool.name === 'workspace_cell_create').inputSchema.required).toContain('expectedRevision');
    expect(ALLOWED_TOOLS.has('page_get')).toBe(true);

    const deniedVault = await request('tools/call', { name: 'page_get', arguments: { path: 'x' } });
    expect(JSON.parse(deniedVault.result.content[0].text).code).toBe('TOOL_NOT_ALLOWED');
    const deniedCapability = await request('tools/call', { name: 'workspace_source_list', arguments: { workspace: `dwc_${'b'.repeat(43)}` } });
    expect(JSON.parse(deniedCapability.result.content[0].text).code).toBe('WORKSPACE_CAPABILITY_MISMATCH');
    expect(invoked).toHaveLength(0);

    const accepted = await request('tools/call', { name: 'workspace_source_list', arguments: { workspace: capability } });
    expect(accepted.result.isError).toBe(false);
    expect(JSON.parse(accepted.result.content[0].text)).toMatchObject({ ok: true, tool: 'workspace_source_list', result: { value: 'bridge response' } });
    expect(invoked).toEqual([{ tool: 'workspace_source_list', args: { workspace: capability } }]);
  });
});

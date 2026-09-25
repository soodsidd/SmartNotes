/**
 * cli-chat-node — Drop-in Node.js chat module powered by local CLI tools.
 *
 * Usage:
 *   const { createChatModule } = require('cli-chat-node');
 *   const chat = createChatModule(httpServer, io, {
 *     systemPrompt: '...',
 *     workingDirectory: __dirname,
 *     sandbox: 'readonly',        // 'none' | 'readonly' | 'editor' | 'full' | custom object
 *   });
 *
 *   // In your HTTP router:
 *   if (url.startsWith('/api/chat/')) { chat.handleRequest(req, res); return; }
 *
 * The module handles:
 *   - Provider discovery, auth checking
 *   - Chat send/cancel with SocketIO streaming
 *   - Image upload, URL content fetch
 *   - Settings load/save
 *   - CLI sandboxing (read-only by default)
 */

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { resolveSandbox, claudeSandboxArgs, codexExecArgs, cursorHeadlessArgs } = require('./sandbox');
const { createTraceLogger } = require('./trace-log');

// pdf-parse (v2) is used for server-side text extraction from PDF attachments.
// Loaded lazily so the module still starts if the package is absent.
let _PdfParser = null;
let _pdfParserResolved = false;
function getPdfParser() {
  if (_pdfParserResolved) return _PdfParser;
  _pdfParserResolved = true;
  try {
    const m = require('pdf-parse');
    _PdfParser = m.PDFParse || null;
  } catch {
    _PdfParser = null;
  }
  return _PdfParser;
}

/* ──────────────────── Default Config ─────────────────────────── */

const DEFAULTS = {
  systemPrompt: 'You are a friendly, conversational AI assistant. Be helpful and natural in conversation.',
  workingDirectory: process.cwd(),
  projects: null,              // optional project catalog for per-project cwd/context
  uploadDir: path.join(os.tmpdir(), 'cli_chat_uploads'),
  stateDir: null,              // path to mutable runtime state (jobs/history/sessions/usage)
  configPath: null,            // path to JSON settings file (optional)
  urlPrefix: '/api/chat',
  maxBodySize: 200 * 1024,
  requestTimeout: 0,           // deprecated alias for idleKillMs (0 = disabled)
  idleWarningMs: 30_000,
  idleKillMs: 0,               // 0 = no idle-kill (codex/claude tool calls can run silently for >90s)
  maxHistoryJobs: 20,
  urlFetchMaxChars: 8000,
  verbose: true,
  sandbox: 'readonly',         // sandbox profile — see sandbox.js
  providers: null,             // custom provider config (or auto-detect)
  agent: null,                 // { name?, instructions?, sandbox? } | null
  recoverInterruptedOnStartup: null,
  traceFilePath: null,
  traceBootId: '',
  traceLogger: null,
};

/* ──────────────────── Agent Resolution ───────────────────────── */

/**
 * Resolve agent config into { name, instructions, sandbox } or null.
 * Accepts:
 *   - falsy            → no agent override
 *   - string           → inline instructions
 *   - object           → { name?, instructions?, sandbox? }
 */
function resolveAgent(agentCfg) {
  if (!agentCfg) return null;

  if (typeof agentCfg === 'string') {
    return {
      name: 'Custom Agent',
      instructions: agentCfg.trim(),
      sandbox: null,
    };
  }

  if (typeof agentCfg === 'object') {
    return {
      name: agentCfg.name || 'Custom Agent',
      instructions: typeof agentCfg.instructions === 'string' ? agentCfg.instructions.trim() : '',
      sandbox: agentCfg.sandbox || null,
    };
  }

  return null;
}

const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const ALLOWED_UPLOAD_EXT = new Set([...ALLOWED_IMAGE_EXT, '.pdf']);
const UPLOAD_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};
const STALE_RUNNING_GRACE_MS = 5_000;
const SYNTHETIC_TOOL_TRANSCRIPT_RE = /^\s*\[tool:\s*[^\]]+\]/i;

/* ──────────────────── Helpers ────────────────────────────────── */

function normalizeBrowserOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function normalizeBoundPort(value) {
  const port = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function resolveCompanionApiTarget({ boundPort, browserOrigin } = {}) {
  let configuredPort = boundPort;
  if (typeof configuredPort === 'function') {
    try { configuredPort = configuredPort(); } catch { configuredPort = 0; }
  }
  const port =
    normalizeBoundPort(configuredPort) ||
    normalizeBoundPort(typeof globalThis !== 'undefined' && globalThis._smartNotesListenPort) ||
    normalizeBoundPort(process.env.PORT) ||
    normalizeBoundPort(process.env.SMART_NOTES_PORT);
  return {
    browserOrigin: normalizeBrowserOrigin(browserOrigin),
    port,
    apiBaseUrl: port ? `http://127.0.0.1:${port}` : '',
  };
}

const DEEP_WORK_CONTEXT_MARKER = 'Smart Notes Deep Work operating context:';
const DEEP_WORK_CAPABILITY_PATTERN = /^dwc_[A-Za-z0-9_-]{43}$/;

function extractDeepWorkCapability(appContext) {
  const context = String(appContext || '');
  if (!context.includes(DEEP_WORK_CONTEXT_MARKER)) return null;
  const capability = context.match(/^- workspaceCapability:\s*(\S+)\s*$/mi)?.[1] || '';
  return DEEP_WORK_CAPABILITY_PATTERN.test(capability) ? capability : '';
}

function rewriteCompanionAppContext(appContext, target) {
  let context = String(appContext || '').trim();
  const deepWorkCapability = extractDeepWorkCapability(context);
  const isDeepWork = deepWorkCapability !== null;
  const markerOrigin = context.match(/^- (?:browserOrigin|apiBaseUrl)[^:]*:\s*(https?:\/\/\S+)\s*$/mi)?.[1] || '';
  const browserOrigin = target.browserOrigin || normalizeBrowserOrigin(markerOrigin);
  const companionBridgeRoot = String(target.companionBridgeRoot || '').trim();

  // A stale PWA can still submit the former apiBaseUrl line. Remove connection
  // metadata owned by the browser, rewrite any embedded remote URLs, and append
  // one server-authoritative loopback contract.
  context = context
    .replace(/^- (?:browserOrigin|apiBaseUrl)[^\r\n]*$/gmi, '')
    .replace(/^- Vault tool shell:[^\r\n]*$/gmi, '')
    .replace(/^- Shell-less editor sandbox:[^\r\n]*$/gmi, '')
    .replace(/^- For page_get\/page_write, the sandboxed vault bridge[^\r\n]*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (companionBridgeRoot) {
    context = context
      .split('.smart-notes-companion-log-form-bridge/requests/<unique-id>.json')
      .join(path.join(companionBridgeRoot, 'requests', '<unique-id>.json'))
      .split('.smart-notes-companion-log-form-bridge/responses/<unique-id>.json')
      .join(path.join(companionBridgeRoot, 'responses', '<unique-id>.json'));
  }
  if (browserOrigin && target.apiBaseUrl) {
    context = context.split(browserOrigin).join(target.apiBaseUrl);
  }

  const connectionLines = isDeepWork ? [
    'Host-side Deep Work connection (server-authoritative):',
    browserOrigin
      ? `- browserOrigin (browser-visible only; never call from host tools): ${browserOrigin}`
      : '- browserOrigin: unavailable (not needed by host tools)',
    target.apiBaseUrl
      ? `- apiBaseUrl (host-local Smart Notes server): ${target.apiBaseUrl}`
      : '- apiBaseUrl: unavailable because the server bound port could not be resolved',
    companionBridgeRoot
      ? `- Exact capability-bound bridge paths (use these literal absolute paths; do not search, inspect a README, or resolve them against cwd, the vault root, or the disk workspace): Write { tool, args } to ${path.join(companionBridgeRoot, 'requests', '<unique-id>.json')}, then Read ${path.join(companionBridgeRoot, 'responses', '<unique-id>.json')}. If the response is not present yet, retry only that same response path briefly. This bridge accepts only workspace_source_list, workspace_source_read, workspace_source_create, workspace_source_edit, workspace_annotations_get, and workspace_annotations_put, and every request must carry workspace ${JSON.stringify(deepWorkCapability)}.`
      : '- Capability-bound shell-less bridge is unavailable for this turn.',
    '- This turn is isolated to the active disk workspace. Vault page/tree/Jupyter-note tools are outside its authority and must not be used for discovery, reads, creation, or edits, even when prior conversation mentions a similarly named vault page.',
    '- Never switch provider cwd to the disk workspace, use direct filesystem access, probe processes, assume port 3002, or call browserOrigin. Use only the capability-authenticated workspace API/bridge operations above.',
  ] : [
    'Host-side companion connection (server-authoritative):',
    browserOrigin
      ? `- browserOrigin (browser-visible only; never call from host tools): ${browserOrigin}`
      : '- browserOrigin: unavailable (not needed by host tools)',
    target.apiBaseUrl
      ? `- apiBaseUrl (host-local Smart Notes server): ${target.apiBaseUrl}`
      : '- apiBaseUrl: unavailable because the server bound port could not be resolved',
    target.port
      ? `- Vault tool shell: use inherited PORT=${target.port} / SMART_NOTES_PORT=${target.port} with node scripts/vault-tool.mjs.`
      : '- Vault tool shell: requires the server-inherited PORT/SMART_NOTES_PORT.',
    companionBridgeRoot
      ? `- Exact shell-less companion bridge paths (use these literal absolute paths; do not search, inspect a README, or resolve them against cwd, the vault root, or resolvedDiskPath): Write { tool, args } to ${path.join(companionBridgeRoot, 'requests', '<unique-id>.json')}, then Read ${path.join(companionBridgeRoot, 'responses', '<unique-id>.json')}. If the response is not present yet, retry only that same response path briefly. The bridge accepts the existing vault tools, including the four spreadsheet tools, plus workspace_source_list, workspace_source_read, workspace_source_create, workspace_source_edit, workspace_annotations_get, and workspace_annotations_put; workspace tools require the server-issued capability from app_context and route only to /api/workspace/*.`
      : '- Shell-less vault bridge: use .smart-notes-companion-log-form-bridge in the Smart Notes app workspace.',
    '- Use apiBaseUrl for page_get/page_write when POST or the vault-tool shell is available; otherwise use the shell-less vault bridge. For Deep Work, never switch provider cwd to the project root: use only capability-authenticated workspace_* bridge/API operations. Do not probe processes, assume port 3002, call browserOrigin, or fall back to direct filesystem edits.',
  ];
  return [context, connectionLines.join('\n')].filter(Boolean).join('\n\n');
}

function buildCompanionProviderEnv(baseEnv, boundPort) {
  const port = normalizeBoundPort(boundPort);
  return {
    ...baseEnv,
    ...(port ? { PORT: String(port), SMART_NOTES_PORT: String(port) } : {}),
  };
}

function which(cmd) {
  try {
    const r = execSync(
      process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    return r.trim().split('\n')[0].trim();
  } catch { return null; }
}

/**
 * Claude receives the full Smart Notes system prompt (agent instructions, vault
 * tools, page context). Passing it via --system-prompt blows past the Windows
 * cmd.exe ~8 KB command-line limit. Deliver through --system-prompt-file instead.
 */
function writeClaudeSystemPromptFile(systemPrompt, chatId) {
  const filePath = path.join(os.tmpdir(), `cli-chat-claude-sp-${chatId}.txt`);
  fs.writeFileSync(filePath, String(systemPrompt || ''), 'utf8');
  return filePath;
}

function removeClaudeSystemPromptFile(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

function buildClaudeSystemPromptArgs(systemPrompt, chatId) {
  const normalized = String(systemPrompt || '');
  if (!normalized.trim()) {
    return { args: [], cleanup: null, viaFile: false };
  }
  const filePath = writeClaudeSystemPromptFile(normalized, chatId);
  return {
    args: ['--system-prompt-file', filePath],
    cleanup: () => removeClaudeSystemPromptFile(filePath),
    viaFile: true,
  };
}

/**
 * Resolve how to invoke cursor-agent.  On Windows, bypass the .cmd shim and
 * invoke node.exe + index.js directly to avoid the 8 KB cmd.exe command-line
 * limit for long prompts.  Returns null if cursor-agent is not installed.
 */
function getCursorAgentSpec() {
  // Verify cursor-agent is on PATH at all
  const onPath = which('cursor-agent');
  if (!onPath) return null;

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local');
    const versionsDir = path.join(localAppData, 'cursor-agent', 'versions');
    try {
      const entries = fs.readdirSync(versionsDir)
        .filter(e => /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/.test(e))
        .sort((a, b) => {
          const toNum = s => {
            const [date] = s.split('-');
            const [y, m, d] = date.split('.');
            return parseInt(y) * 10000 + parseInt(m) * 100 + parseInt(d);
          };
          return toNum(b) - toNum(a);
        });
      const latest = entries[0];
      if (latest) {
        const nodePath = path.join(versionsDir, latest, 'node.exe');
        const indexPath = path.join(versionsDir, latest, 'index.js');
        if (fs.existsSync(nodePath) && fs.existsSync(indexPath)) {
          // Invoke node.exe directly — no shell escaping, no 8K limit
          return { cmd: nodePath, baseArgs: [indexPath], shell: false, displayCommand: 'cursor-agent' };
        }
      }
    } catch {}
  }

  // Fallback: use cursor-agent command directly
  return { cmd: 'cursor-agent', baseArgs: [], shell: process.platform === 'win32', displayCommand: 'cursor-agent' };
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function getCodexAuthState() {
  const envKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  if (envKey) return { ok: true, mode: 'api-key' };

  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const fileKey = typeof auth.OPENAI_API_KEY === 'string' ? auth.OPENAI_API_KEY.trim() : '';
    if (fileKey) return { ok: true, mode: 'api-key' };

    const token = auth?.tokens?.access_token || auth?.tokens?.id_token || auth?.tokens?.refresh_token;
    if (!token) return { ok: false, error: "Not logged in. Open Codex or run 'codex login'." };

    const payload = decodeJwtPayload(auth?.tokens?.access_token || auth?.tokens?.id_token);
    return {
      ok: true,
      mode: 'chatgpt',
      email: payload?.['https://api.openai.com/profile']?.email || payload?.email || '',
    };
  } catch {
    return { ok: false, error: "Not logged in. Open Codex or run 'codex login'." };
  }
}

function getCodexCommandSpec(commandOverride = '') {
  const override = String(commandOverride || '').trim();
  const useShell = cmd => process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);

  if (override) {
    return {
      cmd: override,
      baseArgs: [],
      shell: useShell(override),
      displayCommand: override,
    };
  }

  const codexCmd = process.platform === 'win32' ? which('codex.cmd') : which('codex');
  if (codexCmd && !/\\Program Files\\WindowsApps\\/i.test(codexCmd)) {
    return {
      cmd: process.platform === 'win32' ? 'codex.cmd' : codexCmd,
      baseArgs: [],
      shell: process.platform === 'win32',
      displayCommand: 'codex',
    };
  }

  const npx = process.platform === 'win32' ? (which('npx.cmd') || 'npx.cmd') : (which('npx') || 'npx');
  if (!npx) return null;

  return {
    cmd: process.platform === 'win32' ? 'npx.cmd' : npx,
    baseArgs: ['-y', '@openai/codex'],
    shell: process.platform === 'win32',
    displayCommand: 'npx @openai/codex',
  };
}

function normalizeHistoryMessage(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const role = String(entry.role || '').trim().toLowerCase();
  if (!role) return null;
  return {
    ...entry,
    role,
    content: typeof entry.content === 'string'
      ? entry.content
      : entry.content == null
        ? ''
        : String(entry.content),
  };
}

function isPersistentHistoryStatus(entry) {
  const code = String(entry && (entry.code || entry.statusCode) || '');
  const kind = String(entry && entry.kind || '');
  return code === 'cancelled'
    || code === 'interrupted'
    || code === 'idle_warning'
    || code === 'idle_timeout'
    || kind === 'cancelled'
    || kind === 'interrupted'
    || kind === 'idle_warning'
    || kind === 'timeout';
}

function isLegacyVerboseHistoryTrace(entry) {
  const content = String(entry && entry.content || '');
  if (entry?.role !== 'system') return false;
  return content.indexOf('_Thinking_:') === 0
    || content === '_Thinking…_'
    || content.indexOf('▶ **') === 0
    || content.indexOf('Tool result from **') === 0;
}

function isVerboseHistoryTrace(entry) {
  return entry?.verboseTrace === true
    || entry?.eventType === 'thinking'
    || entry?.eventType === 'tool_call'
    || entry?.eventType === 'tool_result'
    || (entry?.eventType === 'status' && !isPersistentHistoryStatus(entry))
    || isLegacyVerboseHistoryTrace(entry);
}

function isSyntheticToolTranscriptEntry(entry) {
  if (!entry || (entry.role !== 'assistant' && entry.role !== 'system')) return false;
  const content = String(entry.content || '').trim();
  if (!content) return false;
  return SYNTHETIC_TOOL_TRANSCRIPT_RE.test(content);
}

function sanitizeStoredHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(normalizeHistoryMessage)
    .filter(Boolean)
    .filter((entry) => !isVerboseHistoryTrace(entry))
    .filter((entry) => !isSyntheticToolTranscriptEntry(entry));
}

function sanitizeConversationHistory(messages) {
  return sanitizeStoredHistory(messages)
    .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
}

function getProviderModelKey(provider) {
  if (provider === 'claude') return 'claudeModel';
  if (provider === 'ghcopilot') return 'ghcopilotModel';
  if (provider === 'codex') return 'codexModel';
  if (provider === 'cursor') return 'cursorModel';
  return 'model';
}

function getProviderEffortKey(provider) {
  if (provider === 'ghcopilot') return 'ghcopilotEffort';
  if (provider === 'codex') return 'codexEffort';
  if (provider === 'cursor') return 'cursorEffort';
  return '';
}

function getProviderModel(settings, provider) {
  const modelKey = getProviderModelKey(provider);
  return (settings?.[modelKey] || settings?.model || '').trim();
}

function getProviderEffort(settings, provider) {
  const effortKey = getProviderEffortKey(provider);
  return effortKey ? (settings?.[effortKey] || '').trim() : '';
}

function getProviderEffortForModel(settings, provider, model) {
  const normalizedModel = String(model || '').trim().toLowerCase();
  if (provider === 'ghcopilot' && normalizedModel === 'auto') return '';
  return resolveProviderEffort(settings, provider);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeProjectDescriptor(project) {
  if (!project || typeof project !== 'object') return null;
  const id = String(project.id || project.key || '').trim();
  if (!id) return null;

  const name = String(project.name || project.label || id).trim() || id;
  const repoRoot = String(
    project.repoRoot
    || project.repo_root
    || project.directory
    || project.workingDirectory
    || ''
  ).trim();
  if (!repoRoot) return null;

  return {
    id,
    name,
    repoRoot: path.resolve(repoRoot),
    instructions: typeof project.instructions === 'string' ? project.instructions.trim() : '',
  };
}

function normalizeProjectList(projects) {
  if (!Array.isArray(projects)) return [];
  const seen = new Set();
  const result = [];
  for (const project of projects) {
    const normalized = normalizeProjectDescriptor(project);
    if (!normalized) continue;
    const key = normalized.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function sanitizeScopeKeyFragment(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function buildScopeKey(appId, projectId) {
  const base = sanitizeScopeKeyFragment(appId) || 'chat';
  const project = sanitizeScopeKeyFragment(projectId);
  return project ? `${base}__${project}` : base;
}

function quoteShellArg(value) {
  return `"${String(value || '').replace(/(["\\$`])/g, '\\$1')}"`;
}

function captureCommandOutput(command, args = []) {
  const fullCommand = [quoteShellArg(command), ...args.map(quoteShellArg)].join(' ');
  try {
    return execSync(fullCommand, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
      windowsHide: true,
    });
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : String(error?.stdout || '');
    const stderr = typeof error?.stderr === 'string' ? error.stderr : String(error?.stderr || '');
    return stdout || stderr || '';
  }
}

function parseCursorModelsOutput(output) {
  const matches = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Available models')) continue;
    const match = trimmed.match(/^([a-z0-9][a-z0-9._-]*)\s+-/i);
    if (match?.[1]) matches.push(match[1]);
  }
  return uniqueStrings(matches);
}

function codexSupportsWebSearchConfig(codexSpec) {
  if (!codexSpec) return false;
  const helpText = captureCommandOutput(codexSpec.cmd, [...(codexSpec.baseArgs || []), 'exec', '--help']);
  return /tools\.web_search/i.test(String(helpText || ''));
}

const KNOWN_PROVIDER_MODELS = {
  claude: ['sonnet', 'opus', 'haiku'],
  ghcopilot: ['auto', 'gpt-4.1'],
  // Sourced from ~/.codex/models_cache.json (visibility:list) + live exec smoke.
  // ChatGPT-auth rejects gpt-5.3-codex / gpt-5.2; do not offer them here.
  codex: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
  ],
  cursor: [
    'auto',
    'gpt-5.5-high',
    'claude-opus-4-8-thinking-high',
    'claude-4.6-sonnet-medium-thinking',
    'gpt-5.5-medium',
    'gpt-5.3-codex',
    'composer-2.5',
  ],
};

const PROVIDER_MODEL_RANK_HINTS = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
  ],
  ghcopilot: ['gpt-4.1', 'gpt-4', 'auto'],
  cursor: [
    'thinking-high',
    'opus-4-8-thinking-high',
    'gpt-5.5-high',
    'gpt-5.3-codex',
    'gpt-5.5-medium',
    'composer-2.5',
    'auto',
  ],
};

function scoreModelForProvider(provider, model) {
  const hints = PROVIDER_MODEL_RANK_HINTS[provider] || [];
  const lower = String(model || '').toLowerCase();
  for (let index = 0; index < hints.length; index += 1) {
    if (lower.includes(hints[index].toLowerCase())) {
      return hints.length - index;
    }
  }
  return 0;
}

function pickHighestQualityModel(provider, models) {
  if (!Array.isArray(models) || !models.length) return '';
  return [...models].sort(
    (left, right) => scoreModelForProvider(provider, right) - scoreModelForProvider(provider, left)
  )[0] || '';
}

function resolveProviderModel(settings, provider, models) {
  const preferred = getProviderModel(settings, provider);
  if (preferred) {
    const exact = (models || []).find((model) => model.toLowerCase() === preferred.toLowerCase());
    if (exact) return exact;
    if (!models?.length) return preferred;
  }
  return pickHighestQualityModel(provider, models || []);
}

function resolveProviderEffort(settings, provider) {
  const stored = getProviderEffort(settings, provider);
  if (stored) return stored;
  return getProviderEffortKey(provider) ? 'high' : '';
}

function readBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxSize) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);
  if (!boundaryMatch) return null;
  const boundary = '--' + boundaryMatch[1].trim();
  const parts = [];
  const str = buf.toString('binary');
  const segments = str.split(boundary);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.startsWith('--')) break;
    const headerEnd = seg.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = seg.slice(0, headerEnd);
    const body = seg.slice(headerEnd + 4, seg.length - 2);
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      data: Buffer.from(body, 'binary'),
    });
  }
  return parts;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendText(res, code, text, contentType = 'text/plain; charset=utf-8') {
  const body = String(text || '');
  res.writeHead(code, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function isPathInsideDirectory(candidatePath, directory) {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedDirectory = path.resolve(directory);
  return resolvedCandidate === resolvedDirectory || resolvedCandidate.startsWith(resolvedDirectory + path.sep);
}

function sanitizeUploadedAttachments(items, uploadDir, allowedExts) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => {
      const filePath = String(item?.path || '').trim();
      const name = String(item?.name || path.basename(filePath) || 'attachment').trim();
      if (!filePath) return null;
      const resolvedPath = path.resolve(filePath);
      const ext = path.extname(resolvedPath).toLowerCase();
      if (!allowedExts.has(ext)) return null;
      if (!isPathInsideDirectory(resolvedPath, uploadDir)) return null;
      if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) return null;
      return {
        name,
        path: resolvedPath,
        ext,
        mimeType: UPLOAD_MIME_BY_EXT[ext] || 'application/octet-stream',
      };
    })
    .filter(Boolean);
}

/**
 * Extract plain text from an uploaded PDF file using pdf-parse v2.
 * Returns the extracted text string, or null when extraction is unavailable
 * (package not installed, encrypted PDF, scanned image-only PDF, etc.).
 * Text is suitable for injecting into the CLI prompt as a fenced code block
 * so all providers (Claude, Codex, Cursor, GH Copilot) receive the content
 * through the normal tool-enabled CLI path rather than a direct API bypass.
 */
async function extractPdfText(filePath) {
  const PdfParser = getPdfParser();
  if (!PdfParser) return null;
  try {
    const buf = fs.readFileSync(filePath);
    const parser = new PdfParser({ data: buf });
    const result = await parser.getText();
    return typeof result.text === 'string' ? result.text : null;
  } catch {
    return null;
  }
}

/* ──────────────────── Module Factory ─────────────────────────── */

function createChatModule(httpServer, io, userConfig = {}) {
  const cfg = { ...DEFAULTS, ...userConfig };
  const hasIdleWarningOverride = Object.prototype.hasOwnProperty.call(userConfig, 'idleWarningMs');
  const hasIdleKillOverride = Object.prototype.hasOwnProperty.call(userConfig, 'idleKillMs');
  const hasLegacyTimeoutOverride = Object.prototype.hasOwnProperty.call(userConfig, 'requestTimeout');
  const agentInfo = resolveAgent(cfg.agent);
  const sandboxCfg = resolveSandbox(agentInfo?.sandbox || cfg.sandbox);
  const appId = cfg.appId || path.basename(cfg.workingDirectory);
  const projectCatalog = Object.freeze(normalizeProjectList(cfg.projects));
  const uploadDir = path.resolve(cfg.uploadDir);
  const stateDir = path.resolve(cfg.stateDir || (cfg.configPath ? path.dirname(cfg.configPath) : uploadDir));
  const shouldRecoverInterruptedJobs = typeof cfg.recoverInterruptedOnStartup === 'boolean'
    ? cfg.recoverInterruptedOnStartup
    : !!httpServer;

  // Ensure upload directory
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  const jobsDir = path.join(stateDir, 'jobs');
  if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, { recursive: true });

  const traceLogger = cfg.traceLogger && typeof cfg.traceLogger.log === 'function'
    ? (typeof cfg.traceLogger.child === 'function'
        ? cfg.traceLogger.child({ app_id: appId }, { component: 'cli-chat' })
        : cfg.traceLogger)
    : createTraceLogger({
        dir: stateDir,
        filePath: cfg.traceFilePath ? path.resolve(cfg.traceFilePath) : path.join(stateDir, 'chat-trace.jsonl'),
        bootId: cfg.traceBootId || '',
        component: 'cli-chat',
        baseFields: { app_id: appId },
      });
  const traceFilePath = typeof traceLogger.getFilePath === 'function'
    ? traceLogger.getFilePath()
    : path.resolve(cfg.traceFilePath || path.join(stateDir, 'chat-trace.jsonl'));
  const traceBootId = typeof traceLogger.getBootId === 'function'
    ? traceLogger.getBootId()
    : String(cfg.traceBootId || '');

  function logTrace(event, fields = {}) {
    try {
      traceLogger.log(event, fields);
    } catch {
      // Trace logging must never break chat behavior.
    }
  }

  function getRequestClientDetails(req) {
    return {
      ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').trim(),
      user_agent: String(req.headers['user-agent'] || '').trim(),
    };
  }

  function readTraceLog(tail) {
    try {
      if (!fs.existsSync(traceFilePath)) return '';
      const content = fs.readFileSync(traceFilePath, 'utf8');
      if (!tail) return content;
      const lines = content.split(/\r?\n/);
      return lines.slice(Math.max(0, lines.length - tail)).join('\n');
    } catch {
      return '';
    }
  }

  function clearTraceLog() {
    try {
      fs.writeFileSync(traceFilePath, '', 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  logTrace('module_init', {
    upload_dir: uploadDir,
    state_dir: stateDir,
    jobs_dir: jobsDir,
    url_prefix: cfg.urlPrefix,
    has_external_trace_logger: !!cfg.traceLogger,
    startup_recovery_enabled: shouldRecoverInterruptedJobs,
  });

  // In-memory turn registry
  const jobs = {};

  // Provider session IDs — keyed by appId for resume support.
  // Persisted to disk so sessions survive server restarts / HMR reloads.
  const sessionsPath = path.join(stateDir, 'copilot-sessions.json');
  let sessionState = { ghcopilot: {}, codex: {}, cursor: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    if (raw && typeof raw === 'object' && (raw.ghcopilot || raw.codex || raw.cursor)) {
      sessionState = {
        ghcopilot: raw.ghcopilot || {},
        codex: raw.codex || {},
        cursor: raw.cursor || {},
      };
    } else if (raw && typeof raw === 'object') {
      // Backward compatibility with the old Copilot-only format.
      sessionState.ghcopilot = raw;
    }
  } catch {}
  function saveSessions() {
    try { fs.writeFileSync(sessionsPath, JSON.stringify(sessionState), 'utf8'); } catch {}
  }
  function getProviderSession(provider, scopeKey = buildScopeKey(appId, '')) {
    return sessionState?.[provider]?.[scopeKey] || '';
  }
  function clearProviderSession(provider, scopeKey = buildScopeKey(appId, '')) {
    if (sessionState[provider]) delete sessionState[provider][scopeKey];
    saveSessions();
  }
  function setProviderSession(provider, sessionId, scopeKey = buildScopeKey(appId, '')) {
    if (!sessionState[provider]) sessionState[provider] = {};
    sessionState[provider][scopeKey] = sessionId;
    saveSessions();
  }
  function clearProviderSessions(scopeKey = buildScopeKey(appId, '')) {
    for (const provider of Object.keys(sessionState)) {
      clearProviderSession(provider, scopeKey);
    }
  }

  /* ── Usage tracking ── */

  const usagePath = path.join(stateDir, 'usage-stats.json');

  function loadUsageStats() {
    try { return JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch { return { messages: [] }; }
  }

  function saveUsageStats(stats) {
    try { fs.writeFileSync(usagePath, JSON.stringify(stats), 'utf8'); } catch {}
  }

  function recordUsage(provider, model) {
    const stats = loadUsageStats();
    if (!stats.messages) stats.messages = [];
    stats.messages.push({
      ts: Date.now(),
      provider: provider || 'unknown',
      model: model || '',
    });
    // Keep only last 30 days of data
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    stats.messages = stats.messages.filter(m => m.ts > thirtyDaysAgo);
    saveUsageStats(stats);
  }

  function getUsageSummary() {
    const stats = loadUsageStats();
    const msgs = stats.messages || [];
    const now = Date.now();

    // Today: midnight local time
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();

    // This week: start of current week (Monday)
    const weekStart = new Date();
    const dayOfWeek = weekStart.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
    weekStart.setDate(weekStart.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekTs = weekStart.getTime();

    // Last 5 hours (rolling)
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;

    const todayMsgs = msgs.filter(m => m.ts >= todayTs);
    const weekMsgs = msgs.filter(m => m.ts >= weekTs);
    const rollingMsgs = msgs.filter(m => m.ts >= fiveHoursAgo);

    // Provider/model breakdown for the week
    const providerCounts = {};
    const modelCounts = {};
    weekMsgs.forEach(m => {
      providerCounts[m.provider] = (providerCounts[m.provider] || 0) + 1;
      if (m.model) modelCounts[m.model] = (modelCounts[m.model] || 0) + 1;
    });

    // Time until daily reset (next midnight)
    const nextMidnight = new Date(todayStart);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    const dailyResetMs = nextMidnight.getTime() - now;
    const dailyResetH = Math.ceil(dailyResetMs / (60 * 60 * 1000));

    // Time until weekly reset (next Monday)
    const nextMonday = new Date(weekStart);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const weeklyResetMs = nextMonday.getTime() - now;
    const weeklyResetD = Math.ceil(weeklyResetMs / (24 * 60 * 60 * 1000));

    // Rolling 5-hour reset: time until oldest message in window expires
    const rollingResetMs = rollingMsgs.length > 0
      ? Math.max(0, rollingMsgs[0].ts + 5 * 60 * 60 * 1000 - now)
      : 0;
    const rollingResetH = Math.ceil(rollingResetMs / (60 * 60 * 1000));

    // Current settings
    const settings = loadConfig();
    const preferredProvider = (settings.defaultProvider || '').trim()
      || (settings.codexModel ? 'codex' : '')
      || (settings.ghcopilotModel ? 'ghcopilot' : '')
      || (settings.claudeModel ? 'claude' : '');
    const currentModel = getProviderModel(settings, preferredProvider);
    const currentEffort = getProviderEffort(settings, preferredProvider);

    return {
      rolling: { count: rollingMsgs.length, resetsInH: rollingResetH },
      daily: { count: todayMsgs.length, resetsInH: dailyResetH },
      weekly: { count: weekMsgs.length, resetsInD: weeklyResetD },
      total: msgs.length,
      providers: providerCounts,
      models: modelCounts,
      currentModel,
      currentEffort,
      appId,
    };
  }

  /* ── Config persistence ── */

  function readStoredConfig() {
    if (!cfg.configPath) return {};
    try { return JSON.parse(fs.readFileSync(cfg.configPath, 'utf8')); } catch { return {}; }
  }

  function getProjectById(projectId) {
    const wanted = String(projectId || '').trim().toLowerCase();
    if (!wanted) return null;
    return projectCatalog.find((project) => project.id.toLowerCase() === wanted) || null;
  }

  function getDefaultProject(settings = {}) {
    return getProjectById(settings.projectId) || projectCatalog[0] || null;
  }

  function getProjectScopeKey(project) {
    return buildScopeKey(appId, project?.id || '');
  }

  function resolveSelectedProject(projectId, settings = {}) {
    if (!projectCatalog.length) return null;
    return getProjectById(projectId) || getDefaultProject(settings);
  }

  function buildPublicConfig(stored = readStoredConfig()) {
    const publicConfig = { ...(stored && typeof stored === 'object' ? stored : {}) };
    const project = resolveSelectedProject(publicConfig.projectId, publicConfig);
    if (project) {
      publicConfig.projectId = project.id;
      publicConfig.stateScopeId = getProjectScopeKey(project);
      publicConfig.workingDirectory = project.repoRoot;
    } else {
      delete publicConfig.projectId;
      publicConfig.stateScopeId = buildScopeKey(appId, '');
      publicConfig.workingDirectory = cfg.workingDirectory;
    }
    if (projectCatalog.length) {
      publicConfig.projects = projectCatalog.map((entry) => ({
        id: entry.id,
        name: entry.name,
        repoRoot: entry.repoRoot,
      }));
    }
    return publicConfig;
  }

  function loadConfig() {
    return buildPublicConfig(readStoredConfig());
  }

  function saveConfig(data) {
    if (!cfg.configPath) return;
    const current = readStoredConfig();
    if (typeof data.model === 'string')          current.model = data.model.trim();
    if (typeof data.command === 'string')        current.command = data.command.trim();
    if (typeof data.defaultProvider === 'string') current.defaultProvider = data.defaultProvider.trim();
    if (typeof data.claudeModel === 'string')    current.claudeModel = data.claudeModel.trim();
    if (typeof data.ghcopilotModel === 'string') current.ghcopilotModel = data.ghcopilotModel.trim();
    if (typeof data.ghcopilotEffort === 'string') current.ghcopilotEffort = data.ghcopilotEffort.trim();
    if (typeof data.codexModel === 'string')     current.codexModel = data.codexModel.trim();
    if (typeof data.codexEffort === 'string')    current.codexEffort = data.codexEffort.trim();
    if (typeof data.cursorModel === 'string')    current.cursorModel = data.cursorModel.trim();
    if (typeof data.cursorEffort === 'string')   current.cursorEffort = data.cursorEffort.trim();
    if (typeof data.codexCommand === 'string')   current.codexCommand = data.codexCommand.trim();
    if (typeof data.projectId === 'string') {
      const selectedProject = getProjectById(data.projectId);
      if (selectedProject) current.projectId = selectedProject.id;
      else delete current.projectId;
    }
    if (typeof data.verbose === 'boolean')       current.verbose = data.verbose;
    fs.writeFileSync(cfg.configPath, JSON.stringify(current, null, 2), 'utf8');
    return buildPublicConfig(current);
  }

  /* ── Chat history persistence (server-side, cross-device) ── */

  function getActiveScopeSettings(settings = readStoredConfig()) {
    const project = resolveSelectedProject(settings.projectId, settings);
    return {
      project,
      scopeKey: getProjectScopeKey(project),
      workingDirectory: project?.repoRoot || cfg.workingDirectory,
    };
  }

  function getScopedHistoryPath(scopeKey) {
    const safeScope = sanitizeScopeKeyFragment(scopeKey);
    if (!safeScope || safeScope === sanitizeScopeKeyFragment(appId)) {
      return path.join(stateDir, 'chat-history.json');
    }
    return path.join(stateDir, `chat-history.${safeScope}.json`);
  }

  function loadHistory(scopeKey = getActiveScopeSettings().scopeKey) {
    try { return sanitizeStoredHistory(JSON.parse(fs.readFileSync(getScopedHistoryPath(scopeKey), 'utf8'))); } catch { return []; }
  }

  function saveHistory(messages, scopeKey = getActiveScopeSettings().scopeKey) {
    fs.writeFileSync(getScopedHistoryPath(scopeKey), JSON.stringify(sanitizeStoredHistory(messages)), 'utf8');
  }

  function getJobFilePath(chatId) {
    return path.join(jobsDir, `${chatId}.json`);
  }

  function getLastEventSeq(record) {
    if (!record || !Array.isArray(record.events) || record.events.length === 0) return -1;
    return record.events.reduce((maxSeq, entry) => {
      return typeof entry?.seq === 'number' && entry.seq > maxSeq ? entry.seq : maxSeq;
    }, -1);
  }

  function createJobRecord(chatId, extra = {}) {
    const now = Date.now();
    return {
      version: 2,
      turn_id: chatId,
      status: extra.status || 'running',
      created_at: extra.created_at || now,
      updated_at: extra.updated_at || now,
      provider: extra.provider || '',
      model: extra.model || '',
      project_id: extra.project_id || '',
      scope_key: extra.scope_key || buildScopeKey(appId, ''),
      request: extra.request && typeof extra.request === 'object' ? extra.request : {},
      events: Array.isArray(extra.events) ? extra.events.slice() : [],
    };
  }

  function normalizePersistedJobRecord(chatId, raw) {
    const record = createJobRecord(chatId);
    if (!raw || typeof raw !== 'object') return record;

    const legacyEvents = Array.isArray(raw.events)
      ? raw.events
      : Array.isArray(raw.log)
        ? raw.log
        : [];

    record.version = Number(raw.version) || 2;
    record.turn_id = raw.turn_id || raw.chat_id || chatId;
    record.status = String(raw.status || record.status || 'running');
    record.created_at = Number(raw.created_at || raw.createdAt || raw.ts || record.created_at) || record.created_at;
    record.updated_at = Number(raw.updated_at || raw.updatedAt || raw.ts || record.updated_at) || record.updated_at;
    record.provider = raw.provider || raw.request?.provider || record.provider;
    record.model = raw.model || raw.request?.model || record.model;
    record.project_id = raw.project_id || raw.projectId || raw.request?.project_id || record.project_id;
    record.scope_key = raw.scope_key || raw.scopeKey || record.scope_key || buildScopeKey(appId, record.project_id);
    record.request = raw.request && typeof raw.request === 'object' ? raw.request : {};
    record.events = legacyEvents
      .filter(entry => entry && typeof entry === 'object')
      .map((entry, index) => ({
        turn_id: entry.turn_id || entry.chat_id || record.turn_id,
        seq: typeof entry.seq === 'number' ? entry.seq : index,
        ts: Number(entry.ts || record.updated_at || Date.now()) || Date.now(),
        type: entry.type || 'status',
        payload: entry.payload && typeof entry.payload === 'object'
          ? entry.payload
          : { message: String(entry.message || entry.text || '') },
      }))
      .sort((left, right) => left.seq - right.seq);

    const doneEvent = record.events.find(entry => entry.type === 'done');
    if (doneEvent?.payload?.status) record.status = String(doneEvent.payload.status);
    return record;
  }

  function loadPersistedJobRecord(chatId) {
    try {
      const raw = JSON.parse(fs.readFileSync(getJobFilePath(chatId), 'utf8'));
      return maybeFinalizeStaleRunningRecord(chatId, normalizePersistedJobRecord(chatId, raw));
    } catch {
      return null;
    }
  }

  function maybeFinalizeStaleRunningRecord(chatId, record) {
    if (!record || record.status !== 'running') return record;

    const liveJob = jobs[chatId];
    if (liveJob?.proc) return record;

    const staleTimeoutMs = getRuntimeSettings(loadConfig()).idleKillMs;
    if (!staleTimeoutMs) return record;

    const lastUpdatedAt = Number(record.updated_at || record.created_at || 0);
    if (!Number.isFinite(lastUpdatedAt) || lastUpdatedAt <= 0) return record;

    const ageMs = Date.now() - lastUpdatedAt;
    if (ageMs < staleTimeoutMs + STALE_RUNNING_GRACE_MS) return record;

    const provider = record.provider || '';
    const now = Date.now();
    const nextSeq = getLastEventSeq(record) + 1;

    record.status = 'interrupted';
    record.updated_at = now;
    record.events.push({
      turn_id: chatId,
      seq: nextSeq,
      ts: now,
      type: 'status',
      payload: {
        message: 'This turn stopped updating and could not be resumed. It was marked interrupted.',
        provider,
        kind: 'interrupted',
        code: 'interrupted',
      },
    });
    record.events.push({
      turn_id: chatId,
      seq: nextSeq + 1,
      ts: now + 1,
      type: 'done',
      payload: {
        status: 'interrupted',
        provider,
        code: 'interrupted',
      },
    });

    const normalized = savePersistedJobRecord(chatId, record);
    if (liveJob) {
      liveJob.status = normalized.status;
      liveJob.doneEmitted = true;
      liveJob.record = normalized;
    }
    logTrace('stale_running_turn_interrupted', {
      turn_id: chatId,
      provider,
      age_ms: ageMs,
      idle_kill_ms: staleTimeoutMs,
      last_seq: nextSeq - 1,
    });
    return normalized;
  }

  function savePersistedJobRecord(chatId, record) {
    const normalized = normalizePersistedJobRecord(chatId, record);
    normalized.updated_at = Date.now();
    try {
      if (!fs.existsSync(stateDir)) return normalized;
      if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, { recursive: true });
      fs.writeFileSync(getJobFilePath(chatId), JSON.stringify(normalized, null, 2), 'utf8');
    } catch (err) {
      logTrace('job_persist_failed', {
        turn_id: chatId,
        error: err,
      });
    }
    return normalized;
  }

  function persistJobEvent(chatId, event) {
    const job = ensureJob(chatId);
    const record = job.record || createJobRecord(chatId, {
      provider: job.provider || '',
      model: job.model || '',
      project_id: job.projectId || '',
      scope_key: job.scopeKey || buildScopeKey(appId, job.projectId || ''),
      request: job.request || {},
    });
    record.turn_id = chatId;
    record.provider = record.provider || job.provider || '';
    record.model = record.model || job.model || '';
    record.project_id = record.project_id || job.projectId || '';
    record.scope_key = record.scope_key || job.scopeKey || buildScopeKey(appId, record.project_id);
    record.request = record.request && typeof record.request === 'object' ? record.request : {};
    record.events.push(event);
    if (event.type === 'done' && event.payload?.status) record.status = String(event.payload.status);
    else if (job.status) record.status = job.status;
    job.record = savePersistedJobRecord(chatId, record);
  }

  function listPersistedJobRecords() {
    let files = [];
    try { files = fs.readdirSync(jobsDir); } catch { return []; }
    return files
      .filter(name => name.endsWith('.json'))
      .map(name => loadPersistedJobRecord(path.basename(name, '.json')))
      .filter(Boolean)
      .sort((left, right) => left.created_at - right.created_at);
  }

  function listActiveTurnSummaries(scopeKey = getActiveScopeSettings().scopeKey, includeAllScopes = false) {
    return listPersistedJobRecords()
      .filter(record =>
        record.status === 'running' &&
        (includeAllScopes ||
          String(record.scope_key || buildScopeKey(appId, record.project_id)) === String(scopeKey || ''))
      )
      .map(record => ({
        turn_id: record.turn_id,
        status: record.status,
        provider: record.provider || '',
        project_id: record.project_id || '',
        last_seq: getLastEventSeq(record),
        updated_at: record.updated_at,
      }))
      .sort((left, right) => right.updated_at - left.updated_at);
  }

  function truncateSessionText(text, maxLen = 140) {
    const value = String(text || '').trim();
    if (!value) return '';
    return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
  }

  function buildSessionMessages(record) {
    const messages = [];
    const requestMessage = String(record?.request?.message || '').trim();
    if (requestMessage) messages.push({ role: 'user', content: requestMessage });

    let assistantText = '';
    let lastSystemMessage = '';
    const events = Array.isArray(record?.events) ? record.events : [];
    for (const entry of events) {
      const payload = entry?.payload && typeof entry.payload === 'object' ? entry.payload : {};
      if (entry?.type === 'token') {
        assistantText += String(payload.text || '');
      } else if (entry?.type === 'error') {
        lastSystemMessage = String(payload.message || '').trim() || lastSystemMessage;
      } else if (entry?.type === 'status' && payload.code !== 'stderr') {
        const message = String(payload.message || '').trim();
        if (message) lastSystemMessage = message;
      }
    }

    if (assistantText) {
      let content = assistantText;
      if (record?.status === 'interrupted') content += '\n\n*(interrupted)*';
      else if (record?.status === 'cancelled') content += '\n\n*(cancelled)*';
      else if (record?.status === 'failed') content += '\n\n*(failed)*';
      messages.push({ role: 'assistant', content });
    } else if (lastSystemMessage) {
      messages.push({ role: 'system', content: lastSystemMessage });
    } else if (record?.status && record.status !== 'completed') {
      messages.push({ role: 'system', content: `Turn ${record.status}.` });
    }

    return messages;
  }

  function buildSessionSummary(record) {
    const requestMessage = String(record?.request?.message || '').trim();
    const messages = buildSessionMessages(record);
    return {
      turn_id: record.turn_id,
      status: record.status,
      provider: record.provider || '',
      model: record.model || '',
      project_id: record.project_id || '',
      created_at: record.created_at,
      updated_at: record.updated_at,
      last_seq: getLastEventSeq(record),
      active: record.status === 'running',
      preview: truncateSessionText(requestMessage || messages.at(-1)?.content || ''),
      request_message: requestMessage,
      message_count: messages.length,
    };
  }

  function listSessionSummaries(limit = cfg.maxHistoryJobs, scopeKey = getActiveScopeSettings().scopeKey) {
    const max = asPositiveInt(limit) || cfg.maxHistoryJobs;
    return listPersistedJobRecords()
      .filter((record) => String(record.scope_key || buildScopeKey(appId, record.project_id)) === String(scopeKey || ''))
      .sort((left, right) => right.updated_at - left.updated_at)
      .slice(0, max)
      .map(buildSessionSummary);
  }

  function loadSessionDetail(chatId, scopeKey = getActiveScopeSettings().scopeKey, includeAllScopes = false) {
    const record = loadPersistedJobRecord(chatId);
    if (!record) return null;
    if (
      !includeAllScopes &&
      String(record.scope_key || buildScopeKey(appId, record.project_id)) !== String(scopeKey || '')
    ) return null;
    return {
      session: buildSessionSummary(record),
      messages: buildSessionMessages(record),
    };
  }

  function replayTurnEvents(target, chatId, lastSeq) {
    const record = loadPersistedJobRecord(chatId);
    if (!record) {
      logTrace('resume_replay_missing', {
        turn_id: chatId,
        last_seq: lastSeq,
        socket_id: target && target.id ? target.id : '',
      });
      target.emit('chat_resume_ack', { turn_id: chatId, status: 'missing', replayed: 0, last_seq: lastSeq });
      return;
    }

    const replayFrom = typeof lastSeq === 'number' ? lastSeq : -1;
    const missed = record.events.filter(entry => typeof entry.seq !== 'number' || entry.seq > replayFrom);
    for (const entry of missed) target.emit('chat_event', entry);
    logTrace('resume_replay', {
      turn_id: chatId,
      socket_id: target && target.id ? target.id : '',
      last_seq: replayFrom,
      replayed: missed.length,
      status: record.status,
      replay_last_seq: getLastEventSeq(record),
    });
    target.emit('chat_resume_ack', {
      turn_id: chatId,
      status: record.status,
      replayed: missed.length,
      last_seq: getLastEventSeq(record),
    });
  }

  function recoverInterruptedJobs() {
    for (const record of listPersistedJobRecords()) {
      if (record.status !== 'running') continue;
      logTrace('startup_recover_interrupted_turn', {
        turn_id: record.turn_id,
        provider: record.provider || '',
        last_seq: getLastEventSeq(record),
      });
      const job = ensureJob(record.turn_id);
      job.status = 'interrupted';
      job.provider = job.provider || record.provider || '';
      job.projectId = job.projectId || record.project_id || '';
      job.scopeKey = job.scopeKey || record.scope_key || buildScopeKey(appId, record.project_id || '');
      emitStatus(record.turn_id, 'The server restarted while this reply was in progress. The turn was interrupted.', {
        provider: job.provider || '',
        kind: 'interrupted',
        code: 'interrupted',
      });
      emitDone(record.turn_id, 'interrupted', {
        provider: job.provider || '',
        code: 'interrupted',
      });
    }
  }

  function ensureJob(chatId) {
    if (!jobs[chatId]) {
      const persisted = loadPersistedJobRecord(chatId);
      jobs[chatId] = {
        status: persisted?.status || 'running',
        proc: null,
        nextSeq: persisted ? getLastEventSeq(persisted) + 1 : 0,
        provider: persisted?.provider || '',
        model: persisted?.model || '',
        request: persisted?.request || {},
        doneEmitted: !!persisted?.events?.some(entry => entry.type === 'done'),
        errorEmitted: !!persisted?.events?.some(entry => entry.type === 'error'),
        idleWarningEmitted: false,
        stderrRemainder: '',
        record: persisted,
      };
    }
    if (typeof jobs[chatId].nextSeq !== 'number') jobs[chatId].nextSeq = 0;
    return jobs[chatId];
  }

  function normalizeEventDetail(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function emitTurnEvent(chatId, type, payload = {}) {
    const job = ensureJob(chatId);
    const event = {
      turn_id: chatId,
      seq: job.nextSeq++,
      ts: Date.now(),
      type,
      payload,
    };
    persistJobEvent(chatId, event);
    io.emit('chat_event', event);
    logTrace('turn_event', event);
    return event;
  }

  function emitToken(chatId, text) {
    if (!text) return;
    emitTurnEvent(chatId, 'token', { text });
  }

  function emitThinking(chatId, text, extra = {}) {
    if (!text && !Object.keys(extra).length) return;
    emitTurnEvent(chatId, 'thinking', { text: text || '', ...extra });
  }

  function emitToolCall(chatId, name, detail = '', extra = {}) {
    emitTurnEvent(chatId, 'tool_call', { name: name || 'tool', detail: normalizeEventDetail(detail), ...extra });
  }

  function emitToolResult(chatId, name, content = '', extra = {}) {
    emitTurnEvent(chatId, 'tool_result', { name: name || 'tool', content: String(content || ''), ...extra });
  }

  function formatCodexCommandExecutionResult(item) {
    const output = typeof item?.aggregated_output === 'string'
      ? item.aggregated_output.trimEnd()
      : String(item?.output || item?.content || item?.result || '').trimEnd();
    const hasExitCode = typeof item?.exit_code === 'number';
    if (output) {
      return hasExitCode && item.exit_code !== 0
        ? `${output}\nExit code: ${item.exit_code}`
        : output;
    }
    if (hasExitCode) return `Exit code: ${item.exit_code}`;
    return '';
  }

  function buildCompactRolePrompt(prompt, systemPrompt, roleName) {
    const paragraphs = String(systemPrompt || '').split(/\n\s*\n/);
    const firstPara = paragraphs[0].replace(/\s+/g, ' ').trim();
    const operatingMarker = 'Smart Notes operating context:';
    const operatingStart = String(systemPrompt || '').indexOf(operatingMarker);
    let operatingContext = '';
    if (operatingStart >= 0) {
      const slice = String(systemPrompt || '').slice(operatingStart);
      const operatingEnd = slice.search(/\n\nThe user is on this page:/);
      operatingContext = (operatingEnd >= 0 ? slice.slice(0, operatingEnd) : slice).replace(/\s+/g, ' ').trim();
    }
    const roleBody = operatingContext ? `${firstPara} ${operatingContext}` : firstPara;
    const executionHint = [
      'When asked to change existing repository files, edit those files directly in the workspace instead of generating whole-file replacements unless the user explicitly asks for a full rewrite.',
      'When generating shell or PowerShell commands, quote any file or directory path that contains spaces.',
      'Before any destructive note edit (rewrite, bulk replace, or delete), summarize the planned change and wait for explicit owner confirmation.',
    ].join(' ');
    return `[Role: ${roleName || 'Assistant'}. ${roleBody} ${executionHint} Answer the user's question directly.] ${prompt}`;
  }

  function buildOperationalFollowupPrompt(prompt) {
    return `[Reminder: Prefer vault tools (POST /api/agent/vault page_write/page_delete) and Page API over raw filesystem edits for Smart Notes pages. Edit existing repository files directly instead of generating whole-file replacements unless explicitly asked. Quote any file or directory path that contains spaces when generating shell or PowerShell commands. Disk-vs-editor: vault writes save to disk immediately; the editor shows stale draft content until the user clicks Reload — a stale editor is NOT write failure. After page_write succeeds, call page_get to confirm content, then tell the user to click Reload.] ${prompt}`;
  }

  function emitStatus(chatId, message, extra = {}) {
    if (!message && !Object.keys(extra).length) return;
    emitTurnEvent(chatId, 'status', { message: message || '', ...extra });
  }

  function hasVisibleTurnOutput(job) {
    const events = Array.isArray(job?.record?.events) ? job.record.events : [];
    return events.some((entry) => ['token', 'thinking', 'tool_call', 'tool_result'].includes(entry?.type));
  }

  function emitError(chatId, message, extra = {}) {
    const job = ensureJob(chatId);
    job.errorEmitted = true;
    emitTurnEvent(chatId, 'error', { message: message || 'Unknown error', ...extra });
  }

  function emitDone(chatId, status, extra = {}) {
    const job = ensureJob(chatId);
    if (job.doneEmitted) return;
    if (typeof job.clearIdleTimers === 'function') job.clearIdleTimers();
    job.doneEmitted = true;
    job.status = status || job.status || 'completed';
    emitTurnEvent(chatId, 'done', { status: status || 'completed', ...extra });
  }

  function asPositiveInt(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function getRuntimeSettings(settings = {}) {
    const verbose = typeof settings.verbose === 'boolean'
      ? settings.verbose
      : !!cfg.verbose;

    const idleKillMs = asPositiveInt(settings.idleKillMs)
      || (hasIdleKillOverride ? asPositiveInt(cfg.idleKillMs) : 0)
      || asPositiveInt(settings.requestTimeout)
      || (hasLegacyTimeoutOverride ? asPositiveInt(cfg.requestTimeout) : 0)
      || DEFAULTS.idleKillMs;

    let idleWarningMs = asPositiveInt(settings.idleWarningMs)
      || (hasIdleWarningOverride ? asPositiveInt(cfg.idleWarningMs) : 0)
      || DEFAULTS.idleWarningMs;

    if (idleKillMs > 0 && idleWarningMs >= idleKillMs) idleWarningMs = Math.max(0, idleKillMs - 1000);

    return {
      verbose,
      idleWarningMs,
      idleKillMs,
    };
  }

  function isLikelyAuthFailure(provider, message, errorType = '') {
    const text = `${provider || ''} ${errorType || ''} ${message || ''}`.toLowerCase();
    if (!text || text.includes('unknown provider')) return false;
    return /not logged in|auth|login|unauthoriz|forbidden|invalid api key|api key|access token|refresh token|token expired|credentials|permission denied|expired/.test(text);
  }

  // Stderr lines that mean "this turn is dead — stop waiting". Without this,
  // a Codex tool-router exit-1 (or similar) is shown as a passive status note,
  // the CLI then goes silent, and the user only sees a 30s idle warning
  // followed by a 90s timeout — extremely frustrating, especially over a
  // remote connection.
  function isLikelyFatalProviderError(provider, message) {
    const text = String(message || '');
    if (!text) return false;
    if (provider === 'codex') {
      // codex_core::tools::router logs "error=Exit code: N" whenever ANY
      // tool subprocess (rg, git, pwsh, etc.) exits non-zero — that is
      // normal (rg returns 1 on no match, 2 on regex error) and codex
      // recovers from it. Do NOT treat tool-router errors as fatal.
      // Only treat genuine codex crashes / session-level errors as fatal.
      if (/\bERROR\s+codex_core::(?!tools::router\b)/.test(text)) return true;
    }
    if (/\bpanicked at\b/i.test(text)) return true;
    if (/^\s*fatal:/i.test(text)) return true;
    return false;
  }

  function isLikelyMissingCodexThread(message) {
    const text = String(message || '');
    if (!text) return false;
    return /codex_core::session/i.test(text) && /thread .* not found/i.test(text);
  }

  function createErrorPayload(provider, message, extra = {}) {
    const payload = { provider, ...extra };
    if (!payload.kind && isLikelyAuthFailure(provider, message, extra.error_type || '')) {
      payload.kind = 'auth';
      payload.code = 'auth_failed';
    }
    return payload;
  }

  function emitProviderError(chatId, provider, message, extra = {}) {
    emitError(chatId, message, createErrorPayload(provider, message, extra));
  }

  function emitStderrLine(chatId, provider, line) {
    const message = String(line || '').trim();
    if (!message) return;
    const job = ensureJob(chatId);

    const missingCodexThread = provider === 'codex' && isLikelyMissingCodexThread(message);
    if (missingCodexThread) {
      clearProviderSession('codex', job.scopeKey || buildScopeKey(appId, job.projectId || ''));
      if (hasVisibleTurnOutput(job)) return;
    }

    if (job.errorEmitted) return;

    if (isLikelyFatalProviderError(provider, message)) {
      emitStatus(chatId, message, { provider, source: 'stderr', code: 'stderr' });
      if (provider === 'codex') {
        clearProviderSession('codex', job.scopeKey || buildScopeKey(appId, job.projectId || ''));
      }
      // Don't wait the full idle window for a turn we know is dead.
      job.status = 'failed';
      if (job.proc) {
        try { job.proc.kill(); } catch {}
      }
      emitProviderError(chatId, provider, message, {
        source: 'stderr',
        kind: 'provider',
        code: 'provider_fatal',
      });
      emitDone(chatId, 'failed', { provider, code: 'provider_fatal' });
      return;
    }

    if (isLikelyAuthFailure(provider, message)) {
      emitProviderError(chatId, provider, message, { source: 'stderr' });
      return;
    }

    if (job.verbose !== false) {
      emitStatus(chatId, message, { provider, source: 'stderr', code: 'stderr' });
    }
  }

  function handleStderrChunk(chatId, provider, chunk) {
    const job = ensureJob(chatId);
    job.stderrRemainder = (job.stderrRemainder || '') + String(chunk || '');
    const lines = job.stderrRemainder.split(/\r?\n/);
    job.stderrRemainder = lines.pop();
    for (const line of lines) emitStderrLine(chatId, provider, line);
  }

  function flushStderrChunk(chatId, provider) {
    const job = ensureJob(chatId);
    if (job.stderrRemainder && job.stderrRemainder.trim()) {
      emitStderrLine(chatId, provider, job.stderrRemainder);
    }
    job.stderrRemainder = '';
  }

  function cancelJob(chatId, message = 'Request cancelled.') {
    const job = jobs[chatId];
    if (!job) {
      const record = loadPersistedJobRecord(chatId);
      if (!record) return false;
      logTrace('turn_cancel_requested', {
        turn_id: chatId,
        provider: record.provider || '',
        mode: 'persisted_only',
      });
      if (record.status === 'running') {
        const nextSeq = getLastEventSeq(record) + 1;
        const provider = record.provider || '';
        const now = Date.now();
        record.status = 'cancelled';
        record.updated_at = now;
        record.events.push({
          turn_id: chatId,
          seq: nextSeq,
          ts: now,
          type: 'status',
          payload: { message, provider, kind: 'cancelled', code: 'cancelled' },
        });
        record.events.push({
          turn_id: chatId,
          seq: nextSeq + 1,
          ts: now + 1,
          type: 'done',
          payload: { status: 'cancelled', provider, code: 'cancelled' },
        });
        savePersistedJobRecord(chatId, record);
      }
      return true;
    }
    if (job.status !== 'running') return true;
    logTrace('turn_cancel_requested', {
      turn_id: chatId,
      provider: job.provider || '',
      mode: 'live',
    });
    if (job.proc) {
      try { job.proc.kill(); } catch {}
    }
    job.status = 'cancelled';
    emitStatus(chatId, message, { provider: job.provider || '', kind: 'cancelled', code: 'cancelled' });
    emitDone(chatId, 'cancelled', { provider: job.provider || '', code: 'cancelled' });
    return true;
  }

  function cancelRunningTurnsInScope(scopeKey, message = 'Cancelled because a newer request started in this chat.') {
    const cancelled = [];
    for (const summary of listActiveTurnSummaries(scopeKey)) {
      if (!summary?.turn_id) continue;
      if (cancelJob(summary.turn_id, message)) cancelled.push(summary.turn_id);
    }
    return cancelled;
  }

  function getRecentProviderModels(provider, limit = 8) {
    const stats = loadUsageStats();
    const messages = Array.isArray(stats.messages) ? stats.messages : [];
    const recent = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const entry = messages[i] || {};
      if (entry.provider !== provider) continue;
      if (!entry.model) continue;
      recent.push(entry.model);
      if (recent.length >= limit) break;
    }
    return uniqueStrings(recent);
  }

  function discoverClaudeModels(claudeCommand) {
    if (!claudeCommand) return [];
    const helpText = captureCommandOutput(claudeCommand, ['--help']);
    const modelLine = String(helpText || '').split(/\r?\n/).find(line => line.includes('--model')) || '';
    const matches = [];
    for (const match of modelLine.matchAll(/'([^']+)'/g)) {
      const value = (match[1] || '').trim();
      if (/^(sonnet|opus|haiku)$/i.test(value) || /^claude-[a-z0-9-]+$/i.test(value)) {
        matches.push(value);
      }
    }
    return uniqueStrings([...matches, 'haiku']);
  }

  function discoverCodexModels(codexSpec) {
    if (!codexSpec) return [];
    const helpText = captureCommandOutput(codexSpec.cmd, [...(codexSpec.baseArgs || []), 'exec', '--help']);
    const matches = [];
    for (const match of String(helpText || '').matchAll(/model="?([A-Za-z0-9._-]+)"?/g)) {
      const value = (match[1] || '').trim();
      if (/^(o\d(?:-[a-z0-9-]+)?|gpt-[a-z0-9._-]+|codex-[a-z0-9._-]+)$/i.test(value)) {
        matches.push(value);
      }
    }
    for (const match of String(helpText || '').matchAll(/\b(o\d(?:-[a-z0-9-]+)?|gpt-[0-9][a-z0-9._-]*|codex-[a-z0-9._-]+)\b/gi)) {
      const value = (match[1] || '').trim();
      if (value) matches.push(value);
    }
    return uniqueStrings(matches);
  }

  function discoverCursorModels(cursorSpec) {
    if (!cursorSpec) return [];
    const output = captureCommandOutput(cursorSpec.cmd, [...(cursorSpec.baseArgs || []), 'models']);
    return parseCursorModelsOutput(output);
  }

  function discoverGhCopilotModels() {
    const helpText = captureCommandOutput('gh', ['copilot', '--', '--help']);
    const matches = [];
    for (const match of String(helpText || '').matchAll(/--model\s+<([^>]+)>/g)) {
      const value = (match[1] || '').trim();
      if (value && value !== 'model') matches.push(value);
    }
    return uniqueStrings(matches);
  }

  // Fallback catalogs when live provider queries fail or return nothing.
  const FALLBACK_PROVIDER_MODELS = {
    ghcopilot: KNOWN_PROVIDER_MODELS.ghcopilot,
    codex: KNOWN_PROVIDER_MODELS.codex,
    cursor: KNOWN_PROVIDER_MODELS.cursor,
  };

  function getProviderModelSuggestions(provider, settings, runtime) {
    const storedModel = getProviderModel(settings, provider);
    const recentModels = getRecentProviderModels(provider);
    const knownModels = KNOWN_PROVIDER_MODELS[provider] || [];

    if (provider === 'claude') {
      const discovered = discoverClaudeModels(runtime.claudeCommand);
      return uniqueStrings([
        storedModel,
        ...discovered,
        ...recentModels,
        ...knownModels,
      ]);
    }
    if (provider === 'ghcopilot') {
      const discovered = discoverGhCopilotModels();
      return uniqueStrings([
        storedModel,
        ...recentModels,
        ...discovered,
        ...knownModels,
        ...(discovered.length ? [] : FALLBACK_PROVIDER_MODELS.ghcopilot),
      ]);
    }
    if (provider === 'codex') {
      const discovered = discoverCodexModels(runtime.codexSpec);
      return uniqueStrings([
        storedModel,
        ...recentModels,
        ...discovered,
        ...knownModels,
        ...(discovered.length ? [] : FALLBACK_PROVIDER_MODELS.codex),
      ]);
    }
    if (provider === 'cursor') {
      const discovered = discoverCursorModels(runtime.cursorSpec);
      return uniqueStrings([
        storedModel,
        ...recentModels,
        ...discovered,
        ...knownModels,
        ...(discovered.length ? [] : FALLBACK_PROVIDER_MODELS.cursor),
      ]);
    }
    return storedModel ? [storedModel] : [];
  }

  /* ── Provider discovery ── */

  function getProviders() {
    if (cfg.providers) return cfg.providers;
    const settings = loadConfig();
    const claudeCommand = which('claude');
    const ghCommand = which('gh');
    const codexSpec = getCodexCommandSpec(settings.codexCommand);
    const cursorSpec = getCursorAgentSpec();
    const providers = [
      {
        id: 'claude', name: 'Claude CLI', command: 'claude',
        installed: !!claudeCommand, streaming: true,
        models: claudeCommand ? getProviderModelSuggestions('claude', settings, { claudeCommand, codexSpec, cursorSpec }) : [],
      },
      {
        id: 'ghcopilot', name: 'GitHub Copilot CLI', command: 'gh',
        installed: !!ghCommand, streaming: true,
        models: ghCommand ? getProviderModelSuggestions('ghcopilot', settings, { claudeCommand, codexSpec, cursorSpec }) : [],
      },
      {
        id: 'codex', name: 'Codex CLI', command: 'codex',
        installed: !!codexSpec,
        streaming: true,
        models: codexSpec ? getProviderModelSuggestions('codex', settings, { claudeCommand, codexSpec, cursorSpec }) : [],
      },
      {
        id: 'cursor', name: 'Cursor Agent CLI', command: 'cursor-agent',
        installed: !!cursorSpec,
        streaming: true,
        models: cursorSpec ? getProviderModelSuggestions('cursor', settings, { claudeCommand, codexSpec, cursorSpec }) : [],
      },
    ];
    const installedProviders = providers.filter(p => p.installed).map(p => p.id);
    const preferredDefault = (settings.defaultProvider || '').trim()
      || (settings.cursorModel || settings.cursorEffort ? 'cursor' : '')
      || (settings.codexModel ? 'codex' : '')
      || (settings.ghcopilotModel || settings.ghcopilotEffort ? 'ghcopilot' : '')
      || (settings.claudeModel ? 'claude' : '')
      || installedProviders[0]
      || 'claude';
    return {
      providers,
      default: preferredDefault,
    };
  }

  /* ── Auth check ── */

  function checkAuth(provider) {
    if (provider === 'claude') {
      const resolved = which('claude');
      if (!resolved) return { ok: false, provider, kind: 'provider', code: 'provider_unavailable', error: 'Claude CLI not installed' };
      try {
        const r = execSync(`"${resolved}" auth status`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, windowsHide: true,
        });
        const data = JSON.parse(r);
        if (data.loggedIn) return { ok: true, provider, email: data.email || '' };
        return { ok: false, provider, kind: 'auth', code: 'auth_failed', error: "Not logged in. Run 'claude login'." };
      } catch { return { ok: true, provider }; }
    }
    if (provider === 'ghcopilot') {
      const gh = which('gh');
      if (!gh) return { ok: false, provider, kind: 'provider', code: 'provider_unavailable', error: 'GitHub CLI not installed' };
      try {
        execSync(`"${gh}" auth status`, {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, windowsHide: true,
        });
        return { ok: true, provider };
      } catch { return { ok: false, provider, kind: 'auth', code: 'auth_failed', error: "Not logged in. Run 'gh auth login'." }; }
    }
    if (provider === 'codex') {
      const spec = getCodexCommandSpec(loadConfig().codexCommand);
      if (!spec) return { ok: false, provider, kind: 'provider', code: 'provider_unavailable', error: 'Codex CLI not installed' };
      const auth = getCodexAuthState();
      if (auth.ok) return { ...auth, provider };
      return { ...auth, provider, kind: 'auth', code: 'auth_failed' };
    }
    if (provider === 'cursor') {
      const spec = getCursorAgentSpec();
      if (!spec) return { ok: false, provider, kind: 'provider', code: 'provider_unavailable', error: 'Cursor agent CLI not installed' };
      try {
        const r = execSync('cursor-agent status', {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
          windowsHide: true, shell: process.platform === 'win32',
        });
        if (r.includes('Logged in')) return { ok: true, provider };
        return { ok: false, provider, kind: 'auth', code: 'auth_failed', error: "Not logged in. Run 'cursor-agent login'." };
      } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('Logged in')) return { ok: true, provider };
        return { ok: false, provider, kind: 'auth', code: 'auth_failed', error: "Not logged in. Run 'cursor-agent login'." };
      }
    }
    return { ok: false, provider, kind: 'config', code: 'unknown_provider', error: `Unknown provider: ${provider}` };
  }

  /* ── CLI Runner (sandboxed) ── */

  function runChat(chatId, prompt, systemPrompt, provider, model, runOptions = {}) {
    const job = jobs[chatId];
    const settings = readStoredConfig();
    const runtime = getRuntimeSettings(settings);
    const verboseEnabled = runtime.verbose;
    const normalizedSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt : '';
    const hasSystemPrompt = normalizedSystemPrompt.trim().length > 0;
    const workingDirectory = runOptions.workingDirectory || cfg.workingDirectory;
    const sessionScopeKey = runOptions.scopeKey || buildScopeKey(appId, '');
    let tracedCommand = '';

    job.provider = provider;
    job.verbose = verboseEnabled;
    job.scopeKey = sessionScopeKey;
    job.projectId = runOptions.projectId || job.projectId || '';

    // NOTE: PDF attachments are extracted to plain text server-side (extractPdfText)
    // before runChat is called, so they arrive as fenced code blocks in `prompt`.
    // There is no direct-API bypass here — all providers use the normal CLI path
    // so vault/action tool capabilities are preserved for every provider and turn.

    logTrace('turn_run_start', {
      turn_id: chatId,
      provider,
      requested_model: model || '',
      prompt_chars: String(prompt || '').length,
      has_system_prompt: hasSystemPrompt,
      system_prompt_via_file: provider === 'claude' && hasSystemPrompt,
      verbose: verboseEnabled,
      project_id: job.projectId || '',
      scope_key: sessionScopeKey,
      working_directory: workingDirectory,
    });

    let cmd, args, stdinData;
    let claudeSystemPromptCleanup = null;
    const boundPort = normalizeBoundPort(runOptions.boundPort);
    // Ensure vault-tool.mjs / companion shell hits THIS server, including a
    // dynamic preview, rather than a remote browser origin or stale :3002.
    const spawnEnv = buildCompanionProviderEnv(process.env, boundPort);
    const spawnOpts = {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: workingDirectory,
      env: spawnEnv,
    };

    if (provider === 'claude') {
      cmd = settings.command || 'claude';
      tracedCommand = cmd;
      spawnOpts.shell = process.platform === 'win32';
      args = [
        '-p',
        '--output-format', 'stream-json',
        '--no-session-persistence',
        // Sandbox flags BEFORE --system-prompt: on Windows (shell: true), a
        // multi-line system prompt mangles later args via cmd.exe tokenisation,
        // causing --dangerously-skip-permissions to be silently dropped.
        ...claudeSandboxArgs(sandboxCfg),
      ];
      if (verboseEnabled) args.push('--verbose');
      if (hasSystemPrompt) {
        const systemPromptDelivery = buildClaudeSystemPromptArgs(normalizedSystemPrompt, chatId);
        args.push(...systemPromptDelivery.args);
        claudeSystemPromptCleanup = systemPromptDelivery.cleanup;
      }
      const m = model || getProviderModel(settings, 'claude');
      if (m) args.push('--model', m);
      stdinData = prompt;

    } else if (provider === 'ghcopilot') {
      cmd = 'gh';
      tracedCommand = 'gh copilot --';
      const existingSession = getProviderSession('ghcopilot', sessionScopeKey);
      let fullPrompt;
      if (existingSession) {
        // Resuming — session already has role context, just send the message
        fullPrompt = prompt;
      } else if (hasSystemPrompt) {
        // First message — embed compact role context (no --system-prompt flag)
        fullPrompt = buildCompactRolePrompt(prompt, normalizedSystemPrompt, agentInfo?.name || 'Assistant');
      } else {
        fullPrompt = prompt;
      }
      // --output-format and -s MUST come before -p; newlines in the prompt
      // break Windows argument parsing if flags follow the prompt text.
      args = ['copilot', '--', '--output-format', 'json', '-s'];
      // ── Sandbox: only auto-approve if profile allows ──
      if (sandboxCfg.ghcopilot.autoApprove) args.push('--yolo');
      // Resume previous session for conversation continuity
      if (existingSession) args.push('--resume', existingSession);
      const m = model || resolveProviderModel(settings, 'ghcopilot', getProviderModelSuggestions('ghcopilot', settings, { claudeCommand: which('claude'), codexSpec: getCodexCommandSpec(settings.codexCommand), cursorSpec: getCursorAgentSpec() }));
      if (m) args.push('--model', m);
      const effort = getProviderEffortForModel(settings, 'ghcopilot', m || resolveProviderEffort(settings, 'ghcopilot'));
      if (effort) args.push('--effort', effort);
      args.push('-p', fullPrompt);
      stdinData = null;

    } else if (provider === 'codex') {
      const spec = getCodexCommandSpec(settings.codexCommand);
      if (!spec) {
        emitProviderError(chatId, provider, 'Codex CLI not installed', { kind: 'provider', code: 'provider_unavailable' });
        job.status = 'failed';
        emitDone(chatId, 'failed');
        return;
      }

      cmd = spec.cmd;
      tracedCommand = spec.displayCommand || spec.cmd;
      spawnOpts.shell = spec.shell;
      const existingSession = getProviderSession('codex', sessionScopeKey);
      const argsPrefix = [...spec.baseArgs, 'exec'];
      if (existingSession) argsPrefix.push('resume', existingSession);
      args = [
        ...argsPrefix,
        '--json',
        ...codexExecArgs(sandboxCfg, {
          webSearchSupported: codexSupportsWebSearchConfig(spec),
          resume: !!existingSession,
        }),
      ];
      const m = model || resolveProviderModel(settings, 'codex', getProviderModelSuggestions('codex', settings, { codexSpec: spec }));
      if (m) args.push('-m', m);
      const effort = resolveProviderEffort(settings, 'codex');
      if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
      args.push('-');
      stdinData = existingSession
        ? buildOperationalFollowupPrompt(prompt)
        : !hasSystemPrompt
            ? prompt
            : buildCompactRolePrompt(prompt, normalizedSystemPrompt, agentInfo?.name || 'Assistant');

    } else if (provider === 'cursor') {
      const cursorSpec = getCursorAgentSpec();
      if (!cursorSpec) {
        emitProviderError(chatId, provider, 'Cursor agent CLI not installed', { kind: 'provider', code: 'provider_unavailable' });
        job.status = 'failed';
        emitDone(chatId, 'failed');
        return;
      }

      cmd = cursorSpec.cmd;
      tracedCommand = cursorSpec.displayCommand;
      spawnOpts.shell = cursorSpec.shell;
      const existingSession = getProviderSession('cursor', sessionScopeKey);
      // cursor-agent: --print enables headless/script mode; stream-json + stream-partial-output
      // streams text deltas as they arrive.  The prompt is delivered via stdin.
      args = [
        ...cursorSpec.baseArgs,
        '--print',
        '--output-format', 'stream-json',
        '--stream-partial-output',
        '--trust',
        ...cursorHeadlessArgs(sandboxCfg),
      ];
      if (existingSession) args.push('--resume', existingSession);
      const m = model || resolveProviderModel(settings, 'cursor', getProviderModelSuggestions('cursor', settings, { claudeCommand: which('claude'), codexSpec: getCodexCommandSpec(settings.codexCommand), cursorSpec }));
      if (m) args.push('--model', m);
      args.push('--workspace', workingDirectory);
      stdinData = existingSession
        ? buildOperationalFollowupPrompt(prompt)
        : !hasSystemPrompt
            ? prompt
            : buildCompactRolePrompt(prompt, normalizedSystemPrompt, agentInfo?.name || 'Assistant');

    } else {
      emitProviderError(chatId, provider, `Unknown provider: ${provider}`, { kind: 'config', code: 'unknown_provider' });
      job.status = 'failed';
      emitDone(chatId, 'failed');
      return;
    }

    let proc;
    try {
      proc = spawn(cmd, args, spawnOpts);
      job.proc = proc;
      logTrace('provider_spawned', {
        turn_id: chatId,
        provider,
        command: cmd,
        display_command: tracedCommand || cmd,
        arg_count: Array.isArray(args) ? args.length : 0,
        child_pid: proc.pid || 0,
        model: model || getProviderModel(settings, provider),
        cwd: spawnOpts.cwd || '',
        shell: !!spawnOpts.shell,
        windows_hide: !!spawnOpts.windowsHide,
      });
    } catch (err) {
      if (claudeSystemPromptCleanup) claudeSystemPromptCleanup();
      job.status = 'failed';
      logTrace('provider_spawn_failed', {
        turn_id: chatId,
        provider,
        command: cmd,
        error: err,
      });
      emitProviderError(chatId, provider, `CLI not found: ${cmd}`, { kind: 'provider', code: 'provider_unavailable' });
      emitDone(chatId, 'failed');
      return;
    }

    if (stdinData) {
      try { proc.stdin.write(stdinData); proc.stdin.end(); } catch {}
    }

    let lineBuffer = '', streamed = false, stderrBuf = '';
    let sawTerminal = false;
    const setSawTerminal = () => { sawTerminal = true; };
    let idleWarningTimer = null;
    let idleKillTimer = null;

    function clearIdleTimers() {
      clearTimeout(idleWarningTimer);
      clearTimeout(idleKillTimer);
      idleWarningTimer = null;
      idleKillTimer = null;
    }
    job.clearIdleTimers = clearIdleTimers;

    function resetIdleTimers() {
      clearIdleTimers();
      if (job.status !== 'running') return;
      job.idleWarningEmitted = false;
      if (runtime.idleWarningMs > 0) {
        idleWarningTimer = setTimeout(() => {
          if (job.status !== 'running' || job.idleWarningEmitted) return;
          job.idleWarningEmitted = true;
          emitStatus(chatId, `No output for ${Math.round(runtime.idleWarningMs / 1000)}s — still waiting on ${provider}.`, {
            provider,
            kind: 'idle_warning',
            code: 'idle_warning',
            timeout_ms: runtime.idleWarningMs,
          });
        }, runtime.idleWarningMs);
        if (typeof idleWarningTimer.unref === 'function') idleWarningTimer.unref();
      }
      if (runtime.idleKillMs > 0) {
        idleKillTimer = setTimeout(() => {
          if (job.status !== 'running') return;
          job.status = 'failed';
          try { proc.kill(); } catch {}
          emitProviderError(chatId, provider, `No output for ${Math.round(runtime.idleKillMs / 1000)}s — request timed out`, {
            kind: 'timeout',
            code: 'idle_timeout',
            timeout_ms: runtime.idleKillMs,
          });
          emitDone(chatId, 'failed', { provider, code: 'idle_timeout', timeout_ms: runtime.idleKillMs });
        }, runtime.idleKillMs);
        if (typeof idleKillTimer.unref === 'function') idleKillTimer.unref();
      }
    }

    proc.stderr.on('data', d => {
      if (job.status === 'cancelled') return;
      const chunk = d.toString('utf8');
      stderrBuf += chunk;
      resetIdleTimers();
      handleStderrChunk(chatId, provider, chunk);
    });
    resetIdleTimers();

    proc.stdout.on('data', data => {
      if (job.status === 'cancelled') return;
      resetIdleTimers();
      lineBuffer += data.toString('utf8');
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        parseLine(line, provider, chatId, streamed, s => { streamed = s; }, verboseEnabled, setSawTerminal);
      }
    });

    proc.on('exit', (code, signal) => {
      logTrace('provider_exit', {
        turn_id: chatId,
        provider,
        child_pid: proc.pid || 0,
        exit_code: code,
        exit_signal: signal || '',
        streamed,
        status_at_exit: job.status,
        done_emitted: !!job.doneEmitted,
      });
    });

    proc.on('close', (code, signal) => {
      if (claudeSystemPromptCleanup) claudeSystemPromptCleanup();
      clearIdleTimers();
      const statusBeforeClose = job.status;
      const doneEmitted = !!job.doneEmitted;
      const stderrChars = stderrBuf.length;
      const bufferedStdoutChars = lineBuffer.length;
      job.proc = null;
      logTrace('provider_closed', {
        turn_id: chatId,
        provider,
        child_pid: proc.pid || 0,
        exit_code: code,
        exit_signal: signal || '',
        streamed,
        status_before_close: statusBeforeClose,
        done_emitted: doneEmitted,
        stderr_chars: stderrChars,
        buffered_stdout_chars: bufferedStdoutChars,
      });
      flushStderrChunk(chatId, provider);
      if (job.status === 'cancelled') {
        pruneJobs();
        return;
      }
      if (job.doneEmitted) {
        pruneJobs();
        return;
      }

      // Flush remaining buffer
      if (lineBuffer.trim()) {
        parseLine(lineBuffer, provider, chatId, streamed, s => { streamed = s; }, verboseEnabled, setSawTerminal);
        lineBuffer = '';
      }

      // Claude in stream-json mode always emits a terminal `result` event
      // before exiting after streaming any output. If we received tokens but
      // exit 0 without one, the response is incomplete (quota hit, killed
      // externally, network drop). Treat as failure rather than silently
      // marking 'completed' — otherwise the UI shows a single opening
      // sentence and then appears to stall, because the bridge already wrote
      // `done` with status:completed.
      const protocolIncomplete = code === 0 && streamed && !sawTerminal && provider === 'claude';

      if (code === 0 && !protocolIncomplete) {
        job.status = 'completed';
      } else {
        job.status = 'failed';
        let errMsg;
        if (protocolIncomplete) {
          errMsg = `${provider} CLI exited without completing the response. The provider may have hit a quota, lost the network, or been killed externally.`;
        } else {
          errMsg = stderrBuf.trim() || `CLI exited with code ${code}. Check authentication or settings.`;
        }
        if (!job.errorEmitted) {
          emitProviderError(chatId, provider, errMsg, {
            exit_code: code,
            ...(protocolIncomplete ? { kind: 'protocol', code: 'protocol_incomplete' } : {}),
          });
        }
      }
      emitDone(chatId, job.status, code === 0 && !protocolIncomplete
        ? {}
        : { exit_code: code, ...(protocolIncomplete ? { code: 'protocol_incomplete' } : {}) });
      pruneJobs();
    });

    proc.on('error', err => {
      clearIdleTimers();
      const statusBeforeError = job.status;
      job.proc = null;
      job.status = 'failed';
      logTrace('provider_error', {
        turn_id: chatId,
        provider,
        child_pid: proc.pid || 0,
        status_before_error: statusBeforeError,
        error: err,
      });
      if (!job.errorEmitted) emitProviderError(chatId, provider, `CLI error: ${err.message}`);
      emitDone(chatId, 'failed');
    });
  }

  function parseLine(line, provider, chatId, streamed, setStreamed, verboseEnabled, setSawTerminal) {
    const markTerminal = typeof setSawTerminal === 'function' ? setSawTerminal : () => {};
    if (provider === 'claude') {
      try {
        const event = JSON.parse(line);
        const etype = event.type || '';
        if (etype === 'assistant') {
          for (const block of (event.message?.content || [])) {
            if (block.type === 'text') { setStreamed(true); emitToken(chatId, block.text); }
            else if (block.type === 'tool_use') {
              const i = block.input || {};
              const detail = i.command || i.file_path || i.path || i.pattern || i.url || i.description || '';
              setStreamed(true);
              if (verboseEnabled) emitToolCall(chatId, block.name, detail, { input: i });
            }
            else if (block.type === 'tool_result') {
              if (verboseEnabled) emitToolResult(chatId, block.name || block.tool_name || 'tool', block.content || block.result || '');
            }
          }
        } else if (etype === 'content_block_delta') {
          const delta = event.delta || {};
          if (delta.type === 'text_delta') { setStreamed(true); emitToken(chatId, delta.text || ''); }
        } else if (etype === 'result') {
          markTerminal();
          if (event.is_error) emitProviderError(chatId, provider, event.result || 'CLI returned an error');
          else if (!streamed) emitToken(chatId, event.result || '');
        }
      } catch {
        if (verboseEnabled) emitStatus(chatId, line, { source: 'stdout', provider, code: 'stdout' });
      }
    } else if (provider === 'ghcopilot') {
      try {
        const event = JSON.parse(line);
        if (event.type === 'assistant.message_delta') {
          const delta = (event.data || {}).deltaContent || '';
          if (delta) { setStreamed(true); emitToken(chatId, delta); }
        } else if (event.type === 'assistant.message' && !streamed) {
          const content = (event.data || {}).content || '';
          if (content) { setStreamed(true); emitToken(chatId, content); }
        } else if (verboseEnabled && (event.type === 'assistant.thought' || event.type === 'assistant.thought_delta') && !streamed) {
          const thought = (event.data || {}).deltaContent || (event.data || {}).content || '';
          if (thought) emitThinking(chatId, thought, { provider });
        } else if (event.type === 'session.error') {
          const d = event.data || {};
          const kind = d.errorType ? `[${d.errorType}] ` : '';
          emitProviderError(chatId, provider, `${kind}${d.message || 'GH Copilot session error'}`, { error_type: d.errorType || '' });
        } else if (event.type === 'result') {
          markTerminal();
          const job = ensureJob(chatId);
          if (event.sessionId) setProviderSession('ghcopilot', event.sessionId, job.scopeKey || buildScopeKey(appId, job.projectId || ''));
          const exitCode = typeof event.exitCode === 'number' ? event.exitCode : 0;
          if (exitCode === 0) {
            job.status = 'completed';
            emitDone(chatId, 'completed', { provider });
          } else {
            job.status = 'failed';
            emitProviderError(chatId, provider, `GH Copilot exited with code ${exitCode}`, {
              exit_code: exitCode,
              kind: 'provider',
              code: 'provider_exit',
            });
            emitDone(chatId, 'failed', { provider, exit_code: exitCode });
          }
        }
      } catch {
        // Non-JSON lines (banners, stats) — ignore silently
      }
    } else if (provider === 'codex') {
      try {
        const event = JSON.parse(line);
        if (event.type === 'thread.started' && event.thread_id) {
          const job = ensureJob(chatId);
          setProviderSession('codex', event.thread_id, job.scopeKey || buildScopeKey(appId, job.projectId || ''));
        } else if (event.type === 'item.started') {
          const item = event.item || {};
          if (verboseEnabled && item.type === 'command_execution' && item.command) {
            emitToolCall(chatId, item.type, item.command, {
              provider,
              command: item.command,
            });
          }
        } else if (event.type === 'item.completed') {
          const item = event.item || {};
          if (item.type === 'agent_message' && item.text) {
            setStreamed(true);
            emitToken(chatId, item.text);
          } else if (item.type === 'error' && item.message) {
            emitProviderError(chatId, provider, item.message);
          } else if (verboseEnabled && (item.type === 'reasoning' || item.type === 'thinking') && item.text) {
            emitThinking(chatId, item.text, { provider });
          } else if (verboseEnabled && item.type === 'command_execution' && (item.command || typeof item.exit_code === 'number' || item.aggregated_output)) {
            emitToolResult(chatId, item.type, formatCodexCommandExecutionResult(item), {
              provider,
              command: item.command || '',
              exit_code: typeof item.exit_code === 'number' ? item.exit_code : undefined,
            });
          } else if (verboseEnabled && (item.type === 'tool_call' || item.type === 'function_call') && (item.name || item.tool_name || item.command)) {
            emitToolCall(chatId, item.name || item.tool_name || 'tool', item.command || item.arguments || item.input || '', { provider });
          } else if (verboseEnabled && item.type === 'tool_result' && (item.output || item.content || item.result)) {
            emitToolResult(chatId, item.name || item.tool_name || 'tool', item.output || item.content || item.result, { provider });
          }
        } else if (event.type === 'agent_message_delta') {
          const delta = event.delta || event.text || event?.data?.delta || '';
          if (delta) {
            setStreamed(true);
            emitToken(chatId, delta);
          }
        } else if (event.type === 'agent_message') {
          const content = event.text || event?.data?.content || '';
          if (content && !streamed) {
            setStreamed(true);
            emitToken(chatId, content);
          }
        } else if (event.type === 'turn.failed') {
          const err = event.error?.message || event.message || 'Codex run failed';
          if (isLikelyMissingCodexThread(err)) {
            const job = ensureJob(chatId);
            clearProviderSession('codex', job.scopeKey || buildScopeKey(appId, job.projectId || ''));
          }
          emitProviderError(chatId, provider, err);
        }
      } catch {
        // Non-JSON lines (banners, stats) — ignore silently
      }
    } else if (provider === 'cursor') {
      // cursor-agent stream-json + --stream-partial-output event protocol:
      //   system         — boot metadata (ignored for token output)
      //   user           — echo of user prompt (ignored)
      //   thinking       — extended reasoning; subtype "delta" carries the text
      //   assistant      — text token; presence of timestamp_ms flags a delta vs
      //                    final assembled message (no timestamp_ms)
      //   tool_call      — tool invocation (verbose only)
      //   result         — terminal event; carries session_id and usage
      try {
        const event = JSON.parse(line);
        if (!event || typeof event.type !== 'string') return;
        const etype = event.type;
        const subtype = typeof event.subtype === 'string' ? event.subtype : '';

        if (etype === 'system' || etype === 'user') {
          // Ignore — system is init metadata; user is the prompt echo.
          return;
        }

        if (etype === 'thinking') {
          if (subtype === 'delta' && typeof event.text === 'string' && event.text) {
            if (verboseEnabled) emitThinking(chatId, event.text, { provider });
          }
          return;
        }

        if (etype === 'assistant') {
          const msg = event.message;
          const content = msg && Array.isArray(msg.content) ? msg.content : [];
          const text = content
            .filter(b => b && b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text)
            .join('');
          const isDelta = typeof event.timestamp_ms === 'number';
          if (isDelta) {
            if (text) { setStreamed(true); emitToken(chatId, text); }
          } else if (text && !streamed) {
            // Final assembled message — emit only when no deltas arrived
            setStreamed(true); emitToken(chatId, text);
          }
          return;
        }

        if (etype === 'tool_call') {
          if (verboseEnabled) {
            const toolObj = event.tool_call && typeof event.tool_call === 'object' ? event.tool_call : {};
            const toolName = Object.keys(toolObj)[0] || 'tool';
            const subtypeLabel = subtype ? `.${subtype}` : '';
            emitToolCall(chatId, `tool_call${subtypeLabel}`, toolName, { provider });
          }
          return;
        }

        if (etype === 'result') {
          markTerminal();
          const job = ensureJob(chatId);
          const sid = typeof event.session_id === 'string' ? event.session_id.trim() : '';
          if (sid) setProviderSession('cursor', sid, job.scopeKey || buildScopeKey(appId, job.projectId || ''));

          if (event.is_error === true || subtype === 'error') {
            const errMsg = typeof event.result === 'string' ? event.result : 'Cursor agent returned an error.';
            emitProviderError(chatId, provider, errMsg);
            job.status = 'failed';
            emitDone(chatId, 'failed', { provider });
          } else {
            if (!streamed && typeof event.result === 'string' && event.result) {
              setStreamed(true); emitToken(chatId, event.result);
            }
            job.status = 'completed';
            emitDone(chatId, 'completed', { provider });
          }
          return;
        }

        // Unknown event — emit as verbose if enabled
        if (verboseEnabled) emitStatus(chatId, line, { source: 'stdout', provider, code: 'stdout' });
      } catch {
        // Non-JSON lines — ignore silently
      }
    }
  }

  function pruneJobs() {
    const ids = Object.keys(jobs);
    if (ids.length > cfg.maxHistoryJobs + 10) {
      for (const id of ids.slice(0, ids.length - cfg.maxHistoryJobs)) delete jobs[id];
    }
  }

  function attachSocketResumeHandler() {
    if (!io || typeof io.on !== 'function') return;
    io.on('connection', socket => {
      if (!socket || typeof socket.on !== 'function' || typeof socket.emit !== 'function') return;
      logTrace('socket_connected', {
        socket_id: socket.id || '',
        transport: socket.conn && socket.conn.transport ? socket.conn.transport.name : '',
        ip: socket.handshake && socket.handshake.address ? socket.handshake.address : '',
        user_agent: socket.handshake && socket.handshake.headers ? String(socket.handshake.headers['user-agent'] || '') : '',
      });
      socket.on('disconnect', reason => {
        logTrace('socket_disconnected', {
          socket_id: socket.id || '',
          reason: String(reason || ''),
          transport: socket.conn && socket.conn.transport ? socket.conn.transport.name : '',
        });
      });
      socket.on('chat_resume', payload => {
        const resume = payload && typeof payload === 'object' && payload.resume ? payload.resume : (payload || {});
        const turnId = typeof resume.turn_id === 'string' ? resume.turn_id.trim() : '';
        const lastSeq = typeof resume.last_seq === 'number' ? resume.last_seq : -1;
        logTrace('socket_resume_requested', {
          socket_id: socket.id || '',
          turn_id: turnId,
          last_seq: lastSeq,
        });
        if (!turnId) {
          logTrace('socket_resume_invalid', {
            socket_id: socket.id || '',
            payload,
          });
          socket.emit('chat_resume_ack', { turn_id: '', status: 'invalid', replayed: 0, last_seq: -1 });
          return;
        }
        replayTurnEvents(socket, turnId, lastSeq);
      });
    });
  }

  if (shouldRecoverInterruptedJobs) recoverInterruptedJobs();
  attachSocketResumeHandler();

  /* ── Request Router ── */

  function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const apiPath = url.pathname.slice(cfg.urlPrefix.length);

    // Trace every /api/chat/* request hit so we can correlate client send attempts
    // with server-side processing (especially mobile turns that fail before turn_created).
    // Skip /trace-event itself to avoid trace-feedback loops.
    if (apiPath !== '/trace-event') {
      logTrace('http_request', {
        ...getRequestClientDetails(req),
        method: String(req.method || ''),
        path: apiPath,
      });
    }

    if (apiPath === '/providers'  && req.method === 'GET')  return sendJson(res, 200, getProviders());
    if (apiPath === '/auth'       && req.method === 'GET')  return sendJson(res, 200, checkAuth(url.searchParams.get('provider') || 'claude'));
    if (apiPath === '/settings'   && req.method === 'GET')  return sendJson(res, 200, loadConfig());
    if (apiPath === '/sandbox'    && req.method === 'GET')  return sendJson(res, 200, { profile: typeof cfg.sandbox === 'string' ? cfg.sandbox : 'custom', config: sandboxCfg });
    if (apiPath === '/agent'      && req.method === 'GET')  {
      const scope = getActiveScopeSettings();
      return sendJson(res, 200, agentInfo
        ? {
            name: agentInfo.name,
            active: true,
            appId,
            stateScopeId: scope.scopeKey,
            projectId: scope.project?.id || '',
            workingDirectory: scope.workingDirectory,
          }
        : {
            name: null,
            active: false,
            appId,
            stateScopeId: scope.scopeKey,
            projectId: scope.project?.id || '',
            workingDirectory: scope.workingDirectory,
          });
    }
    if (apiPath === '/usage'      && req.method === 'GET')  return sendJson(res, 200, getUsageSummary());
    if (apiPath === '/trace-info' && req.method === 'GET')  return sendJson(res, 200, { appId, file: traceFilePath, boot_id: traceBootId });
    if (apiPath === '/trace-log'  && req.method === 'GET') {
      const tail = Math.min(5000, asPositiveInt(url.searchParams.get('tail')) || 0);
      return sendText(res, 200, readTraceLog(tail));
    }
    if (apiPath === '/trace-log'  && req.method === 'DELETE') {
      if (!clearTraceLog()) return sendJson(res, 500, { error: 'Could not clear trace log' });
      logTrace('trace_log_cleared', { source: 'http' });
      return sendJson(res, 200, { status: 'ok', file: traceFilePath });
    }
    if (apiPath === '/trace-event' && req.method === 'POST') {
      readBody(req, 64 * 1024).then(buf => {
        const data = JSON.parse(buf.toString('utf8'));
        logTrace('client_trace', {
          ...getRequestClientDetails(req),
          client_event: String(data.event || 'event'),
          turn_id: typeof data.turn_id === 'string' ? data.turn_id.trim() : '',
          socket_id: typeof data.socket_id === 'string' ? data.socket_id.trim() : '',
          detail: data.detail && typeof data.detail === 'object' ? data.detail : {},
        });
        sendJson(res, 200, { status: 'ok' });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    // ── Static files (chat-widget.js etc.) ──
    if (apiPath.startsWith('/static/') && req.method === 'GET') {
      const safeName = path.basename(apiPath.slice(8));
      const filePath = path.join(__dirname, 'static', safeName);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(safeName);
        const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
        res.end(content);
        return;
      }
    }

    if (apiPath === '/send' && req.method === 'POST') {
      readBody(req, cfg.maxBodySize).then(async buf => {
        const data = JSON.parse(buf.toString('utf8'));
        const message = (data.message || '').trim();
        const requestSettings = {
          ...readStoredConfig(),
          ...(typeof data.projectId === 'string' ? { projectId: data.projectId.trim() } : {}),
        };
        const configuredScope = getActiveScopeSettings(requestSettings);
        const deepWorkCapability = extractDeepWorkCapability(data.app_context);
        let activeScope = configuredScope;
        let companionBridgeRoot = path.join(cfg.workingDirectory, '.smart-notes-companion-log-form-bridge');
        if (deepWorkCapability !== null) {
          if (!deepWorkCapability || typeof cfg.resolveDeepWorkTurn !== 'function') {
            return sendJson(res, 403, { error: 'A valid active Deep Work workspace capability is required.' });
          }
          const resolvedDeepWork = await cfg.resolveDeepWorkTurn(deepWorkCapability);
          if (!resolvedDeepWork?.scopeKey || !resolvedDeepWork?.companionBridgeRoot) {
            return sendJson(res, 403, { error: 'Deep Work capability is invalid or expired; relaunch the workspace.' });
          }
          activeScope = {
            project: null,
            scopeKey: resolvedDeepWork.scopeKey,
            workingDirectory: resolvedDeepWork.workingDirectory || cfg.workingDirectory,
          };
          companionBridgeRoot = resolvedDeepWork.companionBridgeRoot;
        }
        const companionApiTarget = {
          ...resolveCompanionApiTarget({
            boundPort: cfg.boundPort,
            browserOrigin: data.browser_origin,
          }),
          companionBridgeRoot,
        };
        const appContext = rewriteCompanionAppContext(data.app_context, companionApiTarget);

        const provider = data.provider || getProviders().default || 'ghcopilot';
        const auth = checkAuth(provider);
        if (!auth.ok && auth.code !== 'unknown_provider') {
          return sendJson(res, 400, {
            error: auth.error,
            provider: auth.provider || provider,
            kind: auth.kind || 'auth',
            code: auth.code || 'auth_failed',
          });
        }
        const uploadedImages = sanitizeUploadedAttachments(data.images, uploadDir, ALLOWED_IMAGE_EXT);
        // PDF attachments: sanitize paths then extract text server-side so every
        // provider receives the document content through the normal CLI path.
        const sanitizedPdfAttachments = sanitizeUploadedAttachments(data.documents, uploadDir, new Set(['.pdf']));
        const hasSanitizedAttachments = uploadedImages.length > 0 || sanitizedPdfAttachments.length > 0;
        if (!message && !hasSanitizedAttachments) return sendJson(res, 400, { error: 'No message provided' });
        const attachmentOnlyPrompt = hasSanitizedAttachments
          ? `Please review the attached file(s): ${[...uploadedImages, ...sanitizedPdfAttachments].map(file => file.name || path.basename(file.path)).join(', ')}.`
          : '';
        // SN-202: Smart Notes may allocate the durable turn ID before sending so
        // it can persist the reattach pointer before a mobile PWA is frozen or
        // torn down. Accept only UUID-shaped client IDs and never overwrite an
        // existing durable run.
        const requestedTurnId = typeof data.turn_id === 'string' ? data.turn_id.trim() : '';
        if (requestedTurnId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedTurnId)) {
          return sendJson(res, 400, { error: 'Invalid turn_id' });
        }
        if (requestedTurnId && (jobs[requestedTurnId] || loadPersistedJobRecord(requestedTurnId))) {
          return sendJson(res, 409, { error: 'turn_id already exists' });
        }
        const chatId = requestedTurnId || crypto.randomUUID();
        const pdfTextResults = await Promise.all(sanitizedPdfAttachments.map(doc => extractPdfText(doc.path)));
        const supersededTurnIds = cancelRunningTurnsInScope(activeScope.scopeKey);
        logTrace('turn_created', {
          ...getRequestClientDetails(req),
          turn_id: chatId,
          provider,
          model: (data.model || '').trim(),
          history_messages: Array.isArray(data.history) ? data.history.length : 0,
          image_count: uploadedImages.length,
          document_count: sanitizedPdfAttachments.length,
          has_link_content: !!data.link_content,
          has_app_context: !!appContext,
          browser_origin: companionApiTarget.browserOrigin,
          host_api_base_url: companionApiTarget.apiBaseUrl,
          host_api_port: companionApiTarget.port,
          page_context: String(data.page_context || ''),
          project_id: activeScope.project?.id || '',
          scope_key: activeScope.scopeKey,
          working_directory: activeScope.workingDirectory,
          superseded_turn_ids: supersededTurnIds,
        });
        // App-supplied agent instructions override the default system prompt.
        const resolvedSystemPrompt = typeof cfg.systemPrompt === 'function'
          ? cfg.systemPrompt()
          : cfg.systemPrompt;
        let sysText = agentInfo?.instructions || resolvedSystemPrompt;
        if (activeScope.project) {
          sysText += `\n\nSelected project: ${activeScope.project.name}\nProject repo root: ${activeScope.project.repoRoot}`;
          if (activeScope.project.instructions) sysText += `\n${activeScope.project.instructions}`;
        }
        if (appContext) sysText += `\n\n${appContext}`;
        if (data.page_context) sysText += `\n\nThe user is on this page: ${data.page_context}`;

        const parts = [];
        // Put current message FIRST so it stays prominent in the prompt.
        // GH Copilot CLI ignores trailing questions after long history blocks.
        parts.push(message || attachmentOnlyPrompt);
        if (uploadedImages.length) {
          parts.push('', 'Attached images (file paths on disk):');
          for (const img of uploadedImages) parts.push(`- ${img.name || 'image'}: ${img.path}`);
        }
        // PDF text is injected as fenced code blocks so all providers (Claude,
        // Codex, Cursor, GH Copilot) receive the document content and vault/action
        // tools remain available throughout the turn.
        for (let i = 0; i < sanitizedPdfAttachments.length; i++) {
          const doc = sanitizedPdfAttachments[i];
          const text = pdfTextResults[i];
          if (text && text.trim()) {
            parts.push('', `Attached PDF: ${doc.name || 'document.pdf'}`, '```text', text.trim(), '```');
          } else {
            parts.push('', `Attached PDF: ${doc.name || 'document.pdf'} (text could not be extracted from this PDF — it may be encrypted or image-only)`);
          }
        }
        if (data.link_content) parts.push('', 'Content from a linked URL the user shared:', data.link_content);
        // Only embed history when there's no active Copilot session.
        // With --resume, GH Copilot CLI maintains its own conversation memory.
        const hasSession = (provider === 'ghcopilot' || provider === 'codex') && getProviderSession(provider, activeScope.scopeKey);
        const sanitizedHistory = sanitizeConversationHistory(data.history);
        if (sanitizedHistory.length && !hasSession) {
          const recent = sanitizedHistory.slice(-6);
          parts.push('', 'Earlier in this conversation:');
          for (const m of recent) {
            const role = m.role === 'user' ? 'User' : 'Assistant';
            let text = m.content || '';
            if (role === 'Assistant' && text.length > 400) text = text.slice(0, 400) + '…';
            parts.push(`${role}: ${text}`);
          }
        }

        // Include page_context in the message body so all providers receive the
        // note content.  buildCompactRolePrompt (Codex/GH Copilot) only keeps
        // the first paragraph of sysText, so injecting into sysText alone drops
        // the context for every non-Claude provider.
        if (appContext) {
          parts.push('', appContext);
        }
        if (data.page_context) {
          parts.push('', `Current note content:\n${data.page_context}`);
        }

        jobs[chatId] = {
          status: 'running',
          proc: null,
          nextSeq: 0,
          provider,
          model: (data.model || '').trim(),
          projectId: activeScope.project?.id || '',
          scopeKey: activeScope.scopeKey,
          workingDirectory: activeScope.workingDirectory,
          request: {
            message,
            app_context: appContext,
            browser_origin: companionApiTarget.browserOrigin,
            host_api_base_url: companionApiTarget.apiBaseUrl,
            page_context: data.page_context || '',
            images: uploadedImages.map(image => ({ name: image.name, path: image.path })),
            documents: sanitizedPdfAttachments.map(document => ({ name: document.name, path: document.path, mimeType: document.mimeType })),
            provider,
            model: (data.model || '').trim(),
            project_id: activeScope.project?.id || '',
            working_directory: activeScope.workingDirectory,
          },
          doneEmitted: false,
          errorEmitted: false,
          idleWarningEmitted: false,
          stderrRemainder: '',
          record: createJobRecord(chatId, {
            provider,
            model: (data.model || '').trim(),
            project_id: activeScope.project?.id || '',
            scope_key: activeScope.scopeKey,
            request: {
              message,
              app_context: appContext,
              browser_origin: companionApiTarget.browserOrigin,
              host_api_base_url: companionApiTarget.apiBaseUrl,
              page_context: data.page_context || '',
              images: uploadedImages.map(image => ({ name: image.name, path: image.path })),
              documents: sanitizedPdfAttachments.map(document => ({ name: document.name, path: document.path, mimeType: document.mimeType })),
              provider,
              model: (data.model || '').trim(),
              project_id: activeScope.project?.id || '',
              working_directory: activeScope.workingDirectory,
            },
          }),
        };
        savePersistedJobRecord(chatId, jobs[chatId].record);
        recordUsage(provider, (data.model || '').trim());
        setImmediate(() => runChat(chatId, parts.join('\n'), sysText, provider, (data.model || '').trim(), {
          workingDirectory: activeScope.workingDirectory,
          scopeKey: activeScope.scopeKey,
          projectId: activeScope.project?.id || '',
          boundPort: companionApiTarget.port,
        }));
        sendJson(res, 200, { status: 'ok', chat_id: chatId, turn_id: chatId });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    if (apiPath === '/cancel' && req.method === 'POST') {
      readBody(req, 4096).then(buf => {
        const data = JSON.parse(buf.toString('utf8'));
        const turnId = data.cancel || data.turn_id || data.chat_id;
        logTrace('cancel_request_received', {
          ...getRequestClientDetails(req),
          turn_id: turnId || '',
        });
        if (!turnId || !cancelJob(turnId, data.message || 'Request cancelled.')) {
          return sendJson(res, 404, { error: 'Unknown chat_id' });
        }
        sendJson(res, 200, { status: 'ok', chat_id: turnId, turn_id: turnId });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    if (apiPath === '/reset-session' && req.method === 'POST') {
      const activeScope = getActiveScopeSettings();
      clearProviderSessions(activeScope.scopeKey);
      sendJson(res, 200, { status: 'ok', stateScopeId: activeScope.scopeKey, projectId: activeScope.project?.id || '' });
      return;
    }

    if (apiPath === '/upload' && req.method === 'POST') {
      readBody(req, 10 * 1024 * 1024).then(buf => {
        const parts = parseMultipart(buf, req.headers['content-type'] || '');
        if (!parts?.length) return sendJson(res, 400, { error: 'No file provided' });
        const filePart = parts.find(p => p.name === 'file');
        if (!filePart?.filename) return sendJson(res, 400, { error: 'No filename' });
        const ext = path.extname(filePart.filename).toLowerCase();
        if (!ALLOWED_UPLOAD_EXT.has(ext)) return sendJson(res, 400, { error: `Unsupported file type: ${ext}` });
        const safeName = filePart.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ts = new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14);
        const savePath = path.join(uploadDir, `${ts}_${safeName}`);
        fs.writeFileSync(savePath, filePart.data);
        sendJson(res, 200, { path: savePath, name: filePart.filename, mimeType: UPLOAD_MIME_BY_EXT[ext] || 'application/octet-stream' });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    if (apiPath === '/fetch-url' && req.method === 'POST') {
      readBody(req, cfg.maxBodySize).then(async buf => {
        const data = JSON.parse(buf.toString('utf8'));
        const url = (data.url || '').trim();
        if (!url) return sendJson(res, 400, { error: 'No URL provided' });
        if (!url.startsWith('http://') && !url.startsWith('https://')) return sendJson(res, 400, { error: 'URL must start with http:// or https://' });
        const mod = url.startsWith('https') ? require('https') : require('http');
        const text = await new Promise((resolve, reject) => {
          const r = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (cli-chat-widget)' }, timeout: 15000 }, resp => {
            if (resp.statusCode >= 400) return reject(new Error(`HTTP ${resp.statusCode}`));
            const ct = resp.headers['content-type'] || '';
            if (!ct.includes('text') && !ct.includes('json') && !ct.includes('xml')) { resp.destroy(); return reject(new Error(`Non-text content type: ${ct}`)); }
            let body = '';
            resp.setEncoding('utf8');
            resp.on('data', c => { body += c; if (body.length > 200000) resp.destroy(); });
            resp.on('end', () => resolve(body));
          });
          r.on('error', reject);
        });
        let cleaned = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        cleaned = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned.length > cfg.urlFetchMaxChars) cleaned = cleaned.slice(0, cfg.urlFetchMaxChars) + '\n\n[...content truncated...]';
        sendJson(res, 200, { content: cleaned, url });
      }).catch(err => sendJson(res, 500, { error: err.message }));
      return;
    }

    if (apiPath === '/settings' && req.method === 'POST') {
      readBody(req, cfg.maxBodySize).then(buf => {
        const data = JSON.parse(buf.toString('utf8'));
        const updated = saveConfig(data);
        sendJson(res, 200, { status: 'ok', config: updated || data });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    // ── Server-side chat history (persists across devices) ──
    if (apiPath === '/history' && req.method === 'GET') {
      const activeScope = getActiveScopeSettings();
      const includeAllScopes = url.searchParams.get('all_scopes') === '1';
      sendJson(res, 200, {
        messages: loadHistory(activeScope.scopeKey),
        active_turns: listActiveTurnSummaries(activeScope.scopeKey, includeAllScopes),
        stateScopeId: activeScope.scopeKey,
        projectId: activeScope.project?.id || '',
      });
      return;
    }
    if (apiPath === '/history' && req.method === 'POST') {
      readBody(req, cfg.maxBodySize).then(buf => {
        const data = JSON.parse(buf.toString('utf8'));
        const requestSettings = {
          ...readStoredConfig(),
          ...(typeof data.projectId === 'string' ? { projectId: data.projectId.trim() } : {}),
        };
        const activeScope = getActiveScopeSettings(requestSettings);
        saveHistory(data.messages || [], activeScope.scopeKey);
        sendJson(res, 200, { status: 'ok' });
      }).catch(err => sendJson(res, 400, { error: err.message }));
      return;
    }

    if (apiPath === '/sessions' && req.method === 'GET') {
      const activeScope = getActiveScopeSettings();
      sendJson(res, 200, { appId, stateScopeId: activeScope.scopeKey, sessions: listSessionSummaries(cfg.maxHistoryJobs, activeScope.scopeKey) });
      return;
    }

    const sessionMatch = apiPath.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
      const chatId = decodeURIComponent(sessionMatch[1]);
      const activeScope = getActiveScopeSettings();
      const detail = loadSessionDetail(
        chatId,
        activeScope.scopeKey,
        url.searchParams.get('all_scopes') === '1'
      );
      if (!detail) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      sendJson(res, 200, detail);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  /* ── Public API ── */

  return {
    handleRequest,
    getProviders,
    checkAuth,
    getSandboxConfig: () => sandboxCfg,
    getAgent: () => agentInfo,
    getTraceInfo: () => ({ file: traceFilePath, boot_id: traceBootId }),
  };
}

module.exports = {
  createChatModule,
  parseCursorModelsOutput,
  codexSupportsWebSearchConfig,
  pickHighestQualityModel,
  resolveProviderModel,
  resolveProviderEffort,
  getProviderEffortForModel,
  buildClaudeSystemPromptArgs,
  resolveCompanionApiTarget,
  extractDeepWorkCapability,
  rewriteCompanionAppContext,
  buildCompanionProviderEnv,
  writeClaudeSystemPromptFile,
  removeClaudeSystemPromptFile,
  KNOWN_PROVIDER_MODELS,
};

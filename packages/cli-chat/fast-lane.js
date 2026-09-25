/**
 * fast-lane.js — SN-247: warm, no-tools, low-latency Claude provider sessions.
 *
 * The main chat pipeline in index.js (runChat / POST /send) is tightly coupled
 * to the companion's full tool-enabled system prompt, attachments, scope
 * addressing, and per-turn app_context assembly, and its sandbox profile is
 * fixed per createChatModule() instance (not per-call). The fast lane needs the
 * opposite on every axis — no tools, no re-sent system prompt, smallest/fastest
 * model, low effort, its own sandbox profile — so it lives here as its own
 * small, focused module that reuses only sandbox.js's existing 'none' (no
 * tools at all) profile and the same CLI-invocation conventions (stdin prompt
 * delivery, --system-prompt-file for long prompts, Windows shell handling).
 *
 * One resumable session per open Jupyter page (keyed by a hash of the
 * vault-relative page path):
 *   - ensureWarm(pagePath) — warms the session (spawns a priming turn that
 *     carries the system prompt once) off any user-facing request path. Safe
 *     to call multiple times; concurrent callers share one in-flight warm-up.
 *   - sendMessage(pagePath, message) — resumes the warmed session via
 *     `--resume <session-id>` instead of re-sending the system prompt. If
 *     warm-up hasn't started or failed, this still succeeds: it either awaits
 *     the in-flight warm-up or falls back to a cold (system-prompt-bearing)
 *     turn and captures a fresh session id for next time.
 *   - closeSession(pagePath) — torn down when the page closes: kills any
 *     in-flight CLI child process for that page (process-tree kill on
 *     Windows), forgets the resumable session id, and removes the page's
 *     isolated working directory.
 *
 * Session state is a process-global registry on globalThis (same pattern as
 * src/server/jupyter/runtime.ts) so it survives Next.js route-module reloads.
 */

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveSandbox, claudeSandboxArgs } = require('./sandbox');

const REGISTRY_KEY = '__smartNotesFastLaneSessions__';

/** No tools at all — the sandbox.js 'none' profile, unused by any other caller today. */
const FAST_LANE_SANDBOX = resolveSandbox('none');

function turnIdleTimeoutMs() {
  return Math.max(1_000, Number(process.env.SMART_NOTES_FAST_LANE_IDLE_TIMEOUT_MS) || 20_000);
}

function turnAbsoluteTimeoutMs() {
  const idle = turnIdleTimeoutMs();
  return Math.max(idle * 2, Number(process.env.SMART_NOTES_FAST_LANE_ABSOLUTE_TIMEOUT_MS) || 5 * 60_000);
}

/** @deprecated SN-255: alias for the idle/stall budget (tests still read this name). */
const TURN_TIMEOUT_MS = 20_000;
const WARM_PROMPT = 'Ready.';

const SYSTEM_PROMPT = [
  'You are a fast inline assistant for a Jupyter notebook cell in the Smart Notes app.',
  'Answer concisely: prefer one short paragraph or a few lines of code over a long explanation.',
  'You have no tools. You cannot read or write files, run code, browse the web, or access any',
  'notebook, vault, or repository directly. Work only from the text given to you in this message.',
].join(' ');

// Smallest/fastest Claude models first. This is deliberately the OPPOSITE
// ranking of src/lib/ai-sidebar.ts's companion PROVIDER_MODEL_RANK_HINTS
// (opus > sonnet > haiku, highest-quality-first): the fast lane is a distinct,
// lane-scoped policy that must never inherit the companion's provider/model/
// effort choice, so this module does not import from ai-sidebar.ts at all.
const FAST_LANE_MODEL_ORDER = ['haiku', 'sonnet', 'opus'];
const FAST_LANE_PROVIDERS = new Set(['claude', 'ghcopilot', 'codex', 'cursor']);
const FAST_LANE_PROVIDER_DEFAULT_MODELS = {
  claude: 'haiku',
  ghcopilot: 'auto',
  codex: 'gpt-5-mini',
  cursor: 'auto',
};
const DEFAULT_EFFORT = 'low';

function registry() {
  const g = globalThis;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

function toScopeKey(pagePath) {
  return crypto.createHash('sha1').update(String(pagePath || '')).digest('hex').slice(0, 16);
}

function which(cmd) {
  try {
    const r = execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return r.trim().split('\n')[0].trim();
  } catch {
    return null;
  }
}

function resolveClaudeCommand() {
  // Test-only override so unit tests can point the fast lane at a scripted
  // fake "claude" (e.g. `node -e "..."`) instead of spawning the real CLI —
  // mirrors SMART_NOTES_JUPYTER_CMD in src/server/jupyter/runtime.ts.
  const override = process.env.SMART_NOTES_FAST_LANE_CLAUDE_CMD;
  if (override && override.trim()) return override.trim();
  return which('claude') || 'claude';
}

function resolveProviderCommand(provider) {
  if (provider === 'claude') return resolveClaudeCommand();
  const envKey = `SMART_NOTES_FAST_LANE_${provider.toUpperCase()}_CMD`;
  const override = process.env[envKey];
  if (override && override.trim()) return override.trim();
  if (provider === 'ghcopilot') return which('gh') || 'gh';
  if (provider === 'codex') return which('codex') || 'codex';
  if (provider === 'cursor') return which('cursor-agent') || 'cursor-agent';
  return provider;
}

function resolveStateDir() {
  if (process.env.SMART_NOTES_STATE_DIR) return path.resolve(process.env.SMART_NOTES_STATE_DIR);
  if (process.env.CLI_CHAT_RUNTIME_DIR) return path.resolve(process.env.CLI_CHAT_RUNTIME_DIR);
  return path.join(os.homedir(), '.cli-chat', 'dev-workspace', 'smart-notes');
}

function pickSmallestModel(available) {
  const pool = Array.isArray(available) && available.length ? available : FAST_LANE_MODEL_ORDER;
  for (const candidate of FAST_LANE_MODEL_ORDER) {
    const match = pool.find((m) => String(m || '').toLowerCase().includes(candidate));
    if (match) return match;
  }
  return String(pool[0] || 'haiku');
}

/**
 * Lane-scoped provider/model/effort policy. Deliberately does not read
 * settings.defaultProvider / settings.claudeModel / settings.claudeEffort (the
 * companion's stored preferences, resolved by src/lib/ai-sidebar.ts's
 * resolveAiProviderSelection/resolveProviderModel/resolveProviderEffort). The
 * fast lane always resolves its own provider — claude, the only provider
 * expected to meet the <=3s TTFT target (Abuela AB-17/AB-21 pattern: resumed
 * Claude CLI turns ~2.5-3.0s vs. Cursor ~7.5s; SN-247 live TTFT still owner-
 * verified) — plus the smallest model and low effort, with optional per-field
 * overrides living in the SAME flat settings shape under fastLane*-prefixed
 * keys (see loadFastLaneSettings below).
 */
function resolveFastLanePolicy(settings = {}) {
  const requestedProvider = String(settings.fastLaneProvider || '').trim().toLowerCase();
  const provider = FAST_LANE_PROVIDERS.has(requestedProvider) ? requestedProvider : 'claude';
  const configuredModel = String(settings.fastLaneModel || '').trim();
  const model = configuredModel || (provider === 'claude'
    ? pickSmallestModel(settings.fastLaneAvailableModels)
    : FAST_LANE_PROVIDER_DEFAULT_MODELS[provider]);
  const configuredEffort = String(settings.fastLaneEffort || '').trim();
  const effort = configuredEffort || DEFAULT_EFFORT;
  return { provider, model, effort };
}

// ── Settings persistence ────────────────────────────────────────────────────
// Reuses the existing AI provider settings shape (flat object, fastLane*-
// prefixed keys alongside claudeModel/claudeEffort-style fields already in
// src/lib/ai-sidebar.ts's AiProviderSettings) rather than inventing a new
// settings store. This lives in its own file because createChatModule's main
// settings store has no configPath wired in production (see sysdoc §8 AI
// Sidebar / Lessons Learned) — settings.model here has a working built-in
// default (haiku + low effort) so no owner configuration is required.
function settingsPath(stateDir) {
  return path.join(stateDir, 'fast-lane-settings.json');
}
function loadFastLaneSettings(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(stateDir), 'utf8'));
  } catch {
    return {};
  }
}
function saveFastLaneSettings(stateDir, data) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(settingsPath(stateDir), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function updateFastLaneSettings(data = {}, stateDir = resolveStateDir()) {
  const current = loadFastLaneSettings(stateDir);
  if (typeof data.fastLaneProvider === 'string') {
    const provider = data.fastLaneProvider.trim().toLowerCase();
    if (FAST_LANE_PROVIDERS.has(provider)) current.fastLaneProvider = provider;
  }
  if (typeof data.fastLaneModel === 'string') current.fastLaneModel = data.fastLaneModel.trim();
  if (typeof data.fastLaneEffort === 'string') current.fastLaneEffort = data.fastLaneEffort.trim();
  if (!saveFastLaneSettings(stateDir, current)) {
    throw Object.assign(new Error('Could not save fast-lane settings.'), { code: 'FAST_LANE_SETTINGS_WRITE_FAILED' });
  }
  closeAllSessions();
  return { ...current, ...resolveFastLanePolicy(current) };
}

function getFastLaneSettings(stateDir = resolveStateDir()) {
  const stored = loadFastLaneSettings(stateDir);
  const policy = resolveFastLanePolicy(stored);
  return {
    fastLaneProvider: policy.provider,
    fastLaneModel: policy.model,
    fastLaneEffort: policy.effort,
  };
}

// ── Isolated per-page working directory ─────────────────────────────────────
function resolveIsolatedWorkingDirectory(pagePath, stateDir = resolveStateDir()) {
  return path.join(stateDir, 'fast-lane-sessions', toScopeKey(pagePath));
}

function ensureIsolatedWorkingDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Claude CLI argument construction (pure, unit-testable) ─────────────────
function writeSystemPromptFile(dir, prompt) {
  const filePath = path.join(dir, `system-prompt-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(filePath, prompt, 'utf8');
  return filePath;
}

function removeSystemPromptFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // best-effort
  }
}

/**
 * Builds the claude CLI argv for a fast-lane turn. Always: no tools (empty
 * allowedTools via the 'none' sandbox profile => `--tools ''`), stream-json
 * output, the resolved small model + low effort. `resume` (a captured
 * session id) and `systemPromptFile` are mutually exclusive by convention —
 * resumed turns never re-send the system prompt.
 */
function buildFastLaneClaudeArgs({ model, effort, resume, systemPromptFile, partialMessages }) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    ...claudeSandboxArgs(FAST_LANE_SANDBOX),
  ];
  // SN-253: only requested when the caller wants live token deltas. Without
  // it the claude CLI emits whole `assistant` messages, so every existing
  // non-streaming action keeps a byte-identical invocation and parse path.
  if (partialMessages) args.push('--include-partial-messages');
  if (!resume && systemPromptFile) {
    args.push('--system-prompt-file', systemPromptFile);
  }
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (resume) args.push('--resume', resume);
  return args;
}

function buildFastLaneInvocation(session, prompt, includeSystemPrompt, partialMessages = false) {
  const { provider, model, effort } = session.policy;
  const resume = includeSystemPrompt ? null : session.sessionId;
  const rolePrompt = includeSystemPrompt ? `${SYSTEM_PROMPT}\n\n${prompt}` : prompt;
  if (provider === 'claude') {
    const systemPromptFile = includeSystemPrompt
      ? writeSystemPromptFile(session.workingDirectory, SYSTEM_PROMPT)
      : null;
    return {
      cmd: resolveProviderCommand(provider),
      args: buildFastLaneClaudeArgs({ model, effort, resume, systemPromptFile, partialMessages }),
      stdinData: prompt,
      systemPromptFile,
    };
  }
  if (provider === 'ghcopilot') {
    const args = ['copilot', '--', '--output-format', 'json', '-s'];
    if (resume) args.push('--resume', resume);
    if (model) args.push('--model', model);
    if (effort && model !== 'auto') args.push('--effort', effort);
    args.push('-p', rolePrompt);
    return { cmd: resolveProviderCommand(provider), args, stdinData: null, systemPromptFile: null };
  }
  if (provider === 'codex') {
    const args = ['exec'];
    if (resume) args.push('resume', resume);
    args.push('--json');
    if (!resume) args.push('--sandbox', 'read-only', '--skip-git-repo-check');
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
    args.push('-');
    return { cmd: resolveProviderCommand(provider), args, stdinData: rolePrompt, systemPromptFile: null };
  }
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--stream-partial-output',
    '--trust',
  ];
  if (resume) args.push('--resume', resume);
  if (model) args.push('--model', model);
  args.push('--workspace', session.workingDirectory);
  return { cmd: resolveProviderCommand(provider), args, stdinData: rolePrompt, systemPromptFile: null };
}

// ── Stream-JSON line parsing (pure) ─────────────────────────────────────────
function createParseState() {
  return {
    text: [],
    sessionId: null,
    ttftMs: null,
    observedTtftMs: null,
    startedAt: Date.now(),
    isError: false,
    errorMessage: '',
    done: false,
    // SN-253: set once a `text_delta` has been consumed in partial-message
    // mode. Whole `assistant` messages arrive interleaved with the deltas and
    // would double the answer, so once deltas are flowing they own the text.
    sawTextDelta: false,
  };
}

/**
 * Parses one stream-json line from `claude --output-format stream-json
 * --verbose`. The provider session id is captured from the FIRST event that
 * carries one (the `system`/init event arrives before any model output), not
 * only from the terminal `result` event — matching the SN-247 acceptance
 * criterion "provider session id captured from the first stream event".
 */
function parseFastLaneLine(line, state, provider = 'claude', options = {}) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return state;
  }
  if (!event || typeof event.type !== 'string') return state;

  if (provider === 'ghcopilot') {
    if (event.type === 'assistant.message_delta') {
      const text = event.data && event.data.deltaContent;
      if (text) state.text.push(text);
    } else if (event.type === 'assistant.message' && !state.text.length) {
      const text = event.data && event.data.content;
      if (text) state.text.push(text);
    } else if (event.type === 'session.error') {
      state.isError = true;
      state.errorMessage = event.data && event.data.message || 'GitHub Copilot CLI returned an error.';
    } else if (event.type === 'result') {
      state.done = true;
      if (typeof event.sessionId === 'string') state.sessionId = event.sessionId.trim();
      if (typeof event.exitCode === 'number' && event.exitCode !== 0) state.isError = true;
    }
    return state;
  }

  if (provider === 'codex') {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      state.sessionId = event.thread_id.trim();
    } else if (event.type === 'item.completed' && event.item && event.item.type === 'agent_message' && event.item.text) {
      state.text.push(event.item.text);
    } else if ((event.type === 'agent_message_delta' || event.type === 'agent_message') && (event.delta || event.text)) {
      state.text.push(event.delta || event.text);
    } else if (event.type === 'turn.completed') {
      state.done = true;
    } else if (event.type === 'turn.failed') {
      state.done = true;
      state.isError = true;
      state.errorMessage = event.error && event.error.message || event.message || 'Codex CLI returned an error.';
    }
    return state;
  }

  if (provider === 'cursor') {
    if (event.type === 'assistant') {
      const blocks = event.message && Array.isArray(event.message.content) ? event.message.content : [];
      const text = blocks.filter((block) => block && block.type === 'text').map((block) => block.text || '').join('');
      if (text && (typeof event.timestamp_ms === 'number' || !state.text.length)) state.text.push(text);
    } else if (event.type === 'result') {
      state.done = true;
      if (typeof event.session_id === 'string') state.sessionId = event.session_id.trim();
      if (event.is_error === true || event.subtype === 'error') {
        state.isError = true;
        state.errorMessage = typeof event.result === 'string' ? event.result : 'Cursor agent returned an error.';
      } else if (!state.text.length && typeof event.result === 'string') {
        state.text.push(event.result);
      }
    }
    return state;
  }

  if (!state.sessionId && typeof event.session_id === 'string' && event.session_id.trim()) {
    state.sessionId = event.session_id.trim();
  }

  // SN-253: `--include-partial-messages` wraps the raw Anthropic SSE events in
  // `{"type":"stream_event","event":{…}}`. Only consumed when the caller opted
  // into streaming (which is also the only case where the flag is passed), so
  // the non-streaming parse path is unchanged.
  if (options.partialMessages && event.type === 'stream_event') {
    const inner = event.event;
    if (inner && inner.type === 'content_block_delta') {
      const delta = inner.delta || {};
      // Thinking/signature deltas are deliberately ignored: the fast lane's
      // contract is answer text only.
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        if (state.observedTtftMs === null) state.observedTtftMs = Date.now() - state.startedAt;
        state.sawTextDelta = true;
        state.text.push(delta.text);
      }
    }
    return state;
  }

  if (event.type === 'assistant') {
    // Deltas already carry this message's text verbatim; re-pushing the
    // assembled block would duplicate the answer into the cell.
    if (state.sawTextDelta) return state;
    const blocks = event.message && Array.isArray(event.message.content) ? event.message.content : [];
    const text = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    if (text) {
      if (state.observedTtftMs === null) state.observedTtftMs = Date.now() - state.startedAt;
      state.text.push(text);
    }
    return state;
  }

  if (event.type === 'result') {
    state.done = true;
    if (event.is_error) {
      state.isError = true;
      state.errorMessage = typeof event.result === 'string' ? event.result : 'Claude CLI returned an error.';
    } else if (!state.text.length && typeof event.result === 'string' && event.result) {
      state.text.push(event.result);
    }
    // The CLI's own ttft_ms is the authoritative measurement (used for the
    // SN-247 evidence numbers); state.observedTtftMs is only a fallback.
    if (typeof event.ttft_ms === 'number') state.ttftMs = event.ttft_ms;
  }
  return state;
}

// ── Process lifecycle ───────────────────────────────────────────────────────
function killProcessTree(proc) {
  if (!proc || proc.killed || proc.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      // Kill the whole tree so a hung/timed-out fast-lane turn cannot leave an
      // orphaned claude.exe (or its own child processes) running.
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // best-effort
  }
}

function runTurn(session, prompt, { includeSystemPrompt, onText }) {
  return new Promise((resolve, reject) => {
    // SN-253: streaming is opt-in per turn. `onText` receives only newly
    // appended text, so a caller can concatenate deltas and end up with
    // exactly the resolved `text`.
    const streaming = typeof onText === 'function';
    const invocation = buildFastLaneInvocation(session, prompt, includeSystemPrompt, streaming);
    const { cmd, args, stdinData, systemPromptFile } = invocation;

    const state = createParseState();
    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd: session.workingDirectory,
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      removeSystemPromptFile(systemPromptFile);
      reject(error);
      return;
    }

    session.activeProc = proc;
    let settled = false;
    let stdoutBuffer = '';

    // SN-255: kill on idle/stall, not wall-clock alone. Any stdout progress
    // (including stream-json keepalives / partials) resets the idle timer so a
    // slow-but-progressing Write code turn is not aborted mid-flight. An
    // absolute ceiling still bounds a pathological hang that keeps emitting.
    const idleTimeoutMs = turnIdleTimeoutMs();
    const absoluteTimeoutMs = turnAbsoluteTimeoutMs();
    let idleTimer = null;
    const absoluteTimer = setTimeout(() => {
      failTimedOut();
    }, absoluteTimeoutMs);
    absoluteTimer.unref?.();

    function clearTimers() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      clearTimeout(absoluteTimer);
    }

    function failTimedOut() {
      if (settled) return;
      settled = true;
      clearTimers();
      killProcessTree(proc);
      session.activeProc = null;
      removeSystemPromptFile(systemPromptFile);
      reject(Object.assign(new Error('Fast-lane turn timed out'), { code: 'FAST_LANE_TIMEOUT' }));
    }

    function bumpIdleTimer() {
      if (settled) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        failTimedOut();
      }, idleTimeoutMs);
      idleTimer.unref?.();
    }

    bumpIdleTimer();

    function finish(exitCode = 0) {
      if (settled) return;
      settled = true;
      clearTimers();
      session.activeProc = null;
      removeSystemPromptFile(systemPromptFile);
      if (state.sessionId) session.sessionId = state.sessionId;
      if (state.isError) {
        reject(Object.assign(new Error(state.errorMessage || 'Claude CLI returned an error.'), {
          code: 'FAST_LANE_PROVIDER_ERROR',
        }));
        return;
      }
      if (exitCode !== 0) {
        reject(Object.assign(new Error(`${session.policy.provider} CLI exited with code ${exitCode}.`), {
          code: 'FAST_LANE_PROVIDER_ERROR',
        }));
        return;
      }
      if (!state.done && session.policy.provider === 'claude') {
        reject(Object.assign(new Error('Claude CLI exited before completing the turn.'), {
          code: 'FAST_LANE_INCOMPLETE',
        }));
        return;
      }
      resolve({
        text: state.text.join(''),
        sessionId: state.sessionId,
        ttftMs: state.ttftMs ?? state.observedTtftMs,
        durationMs: Date.now() - state.startedAt,
      });
    }

    // Emits whatever the parser appended to state.text since the last call.
    // Provider-agnostic: every provider branch accumulates into the same
    // array, so this works without per-provider streaming code.
    let emittedChunks = 0;
    function flushStreamedText() {
      if (!streaming || state.text.length === emittedChunks) return;
      const pending = state.text.slice(emittedChunks).join('');
      emittedChunks = state.text.length;
      if (!pending) return;
      try {
        onText(pending);
      } catch {
        // A failing consumer must never abort the turn or lose the answer.
      }
    }

    proc.stdout.on('data', (chunk) => {
      bumpIdleTimer();
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) parseFastLaneLine(trimmed, state, session.policy.provider, { partialMessages: streaming });
      }
      flushStreamedText();
    });
    proc.stderr.on('data', () => {
      // Diagnostics only; not surfaced today (no registered diagnostics
      // source for this new lane yet — see AV-189 note in the SN-247 brief).
      bumpIdleTimer();
    });
    proc.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      session.activeProc = null;
      removeSystemPromptFile(systemPromptFile);
      reject(error);
    });
    proc.once('close', (exitCode) => {
      if (stdoutBuffer.trim()) {
        parseFastLaneLine(stdoutBuffer.trim(), state, session.policy.provider, { partialMessages: streaming });
      }
      flushStreamedText();
      finish(typeof exitCode === 'number' ? exitCode : 1);
    });

    proc.stdin.on('error', () => {
      // EPIPE guard: process may exit before the stdin write completes.
    });
    if (stdinData !== null) proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}

function getOrCreateSessionEntry(pagePath) {
  const key = toScopeKey(pagePath);
  const sessions = registry();
  let session = sessions.get(key);
  if (!session) {
    const stateDir = resolveStateDir();
    const workingDirectory = ensureIsolatedWorkingDirectory(resolveIsolatedWorkingDirectory(pagePath, stateDir));
    const settings = loadFastLaneSettings(stateDir);
    session = {
      pagePath,
      key,
      stateDir,
      workingDirectory,
      policy: resolveFastLanePolicy(settings),
      sessionId: null,
      status: 'idle',
      warmPromise: null,
      activeProc: null,
      createdAt: Date.now(),
    };
    sessions.set(key, session);
  }
  return session;
}

/**
 * Warm the fast-lane session for an open Jupyter page: spawns one priming
 * turn (system prompt + WARM_PROMPT), captures the resumable session id, and
 * marks the session ready. Intended to be called when the page opens, off any
 * user-facing request path. Idempotent — concurrent/repeated calls share one
 * in-flight warm-up and return the same settled result once ready.
 */
async function ensureWarm(pagePath) {
  const session = getOrCreateSessionEntry(pagePath);
  if (session.status === 'ready' && session.sessionId) {
    return { status: 'ready', sessionId: session.sessionId };
  }
  if (session.warmPromise) {
    return session.warmPromise;
  }
  session.status = 'warming';
  session.warmPromise = runTurn(session, WARM_PROMPT, { includeSystemPrompt: true })
    .then((result) => {
      session.sessionId = result.sessionId || session.sessionId;
      session.status = session.sessionId ? 'ready' : 'error';
      session.warmPromise = null;
      return { status: session.status, sessionId: session.sessionId, ttftMs: result.ttftMs };
    })
    .catch((error) => {
      session.status = 'error';
      session.warmPromise = null;
      throw error;
    });
  return session.warmPromise;
}

/**
 * Send a real prompt for an open Jupyter page. Resumes the warmed session
 * (`--resume`) whenever one exists; otherwise waits for an in-flight warm-up
 * or falls back to a cold (system-prompt-bearing) turn so the request still
 * succeeds even if it arrives before warm-up started or after it failed.
 *
 * `options.onText(chunk)` (SN-253) opts the turn into live token streaming:
 * it receives only newly appended answer text, and the resolved `text` is
 * still the complete answer, so a non-streaming caller sees no difference.
 */
async function sendMessage(pagePath, message, options = {}) {
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('No message provided'), { code: 'FAST_LANE_EMPTY_MESSAGE' });
  }
  const session = getOrCreateSessionEntry(pagePath);

  if (session.status === 'warming' && session.warmPromise) {
    await session.warmPromise.catch(() => undefined);
  } else if (session.status === 'idle') {
    await ensureWarm(pagePath).catch(() => undefined);
  }

  if (session.activeProc) {
    throw Object.assign(new Error('A fast-lane turn is already in progress for this page.'), {
      code: 'FAST_LANE_BUSY',
    });
  }
  if (options.signal?.aborted) {
    throw Object.assign(new Error('Request aborted'), { code: 'FAST_LANE_ABORTED' });
  }

  const includeSystemPrompt = !session.sessionId;
  const turnPromise = runTurn(session, trimmed, { includeSystemPrompt, onText: options.onText });
  let onAbort;
  if (options.signal) {
    onAbort = () => killProcessTree(session.activeProc);
    options.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const result = await turnPromise;
    session.sessionId = result.sessionId || session.sessionId;
    if (session.sessionId) session.status = 'ready';
    return result;
  } finally {
    if (options.signal && onAbort) options.signal.removeEventListener('abort', onAbort);
  }
}

/** Torn down when the page closes: kills any in-flight turn, forgets the session id. */
function closeSession(pagePath) {
  const key = toScopeKey(pagePath);
  const sessions = registry();
  const session = sessions.get(key);
  if (!session) return { closed: false };
  killProcessTree(session.activeProc);
  session.activeProc = null;
  sessions.delete(key);
  try {
    fs.rmSync(session.workingDirectory, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  return { closed: true };
}

function closeAllSessions() {
  const sessions = registry();
  let closed = 0;
  for (const key of Array.from(sessions.keys())) {
    const session = sessions.get(key);
    killProcessTree(session.activeProc);
    session.activeProc = null;
    try {
      fs.rmSync(session.workingDirectory, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    sessions.delete(key);
    closed += 1;
  }
  return { closed };
}

/** Test hook: clear the in-memory registry between unit tests. */
function __resetForTesting() {
  globalThis[REGISTRY_KEY] = new Map();
}

module.exports = {
  ensureWarm,
  sendMessage,
  closeSession,
  closeAllSessions,
  resolveFastLanePolicy,
  pickSmallestModel,
  loadFastLaneSettings,
  saveFastLaneSettings,
  updateFastLaneSettings,
  getFastLaneSettings,
  resolveIsolatedWorkingDirectory,
  __resetForTesting,
  __testInternals: {
    buildFastLaneClaudeArgs,
    buildFastLaneInvocation,
    parseFastLaneLine,
    createParseState,
    resolveStateDir,
    resolveClaudeCommand,
    resolveProviderCommand,
    toScopeKey,
    getOrCreateSessionEntry,
    registry,
    FAST_LANE_SANDBOX,
    SYSTEM_PROMPT,
    WARM_PROMPT,
    TURN_TIMEOUT_MS,
    turnIdleTimeoutMs,
    turnAbsoluteTimeoutMs,
  },
};

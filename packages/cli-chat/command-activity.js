'use strict';

/**
 * SN-401: normalize the shell commands a provider CLI runs into one bounded
 * `command` turn event, so the Deep Work view can show what Companion typed and
 * what came back. This is observation only: nothing here grants or runs a
 * command. Providers whose stream carries no shell events produce nothing.
 *
 * Event payload: { command_id, command, status: running|completed|failed,
 *                  exit_code?, output?, output_truncated?, provider }
 */

const MAX_COMMAND_CHARS = 4000;
const MAX_OUTPUT_CHARS = 16000;
const SHELL_TOOL_NAMES = new Set(['Bash', 'PowerShell']);

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Keep the tail: the end of command output is where results and errors are. */
function boundedOutput(text) {
  if (typeof text !== 'string' || !text) return {};
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return {};
  if (trimmed.length <= MAX_OUTPUT_CHARS) return { output: trimmed };
  return { output: trimmed.slice(trimmed.length - MAX_OUTPUT_CHARS), output_truncated: true };
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part.text === 'string' ? part.text : typeof part === 'string' ? part : ''))
    .filter(Boolean)
    .join('\n');
}

function runningEvent(provider, id, command) {
  if (!id || typeof command !== 'string' || !command.trim()) return null;
  return { command_id: String(id).slice(0, 200), command: clip(command, MAX_COMMAND_CHARS), status: 'running', provider };
}

function createCommandTracker(provider) {
  // id -> command text, only for calls we recognized as shell commands.
  const open = new Map();

  function finish(id, { output, exitCode, failed }) {
    if (!id || !open.has(id)) return null;
    const command = open.get(id);
    open.delete(id);
    const event = {
      command_id: String(id).slice(0, 200),
      command,
      status: failed || (typeof exitCode === 'number' && exitCode !== 0) ? 'failed' : 'completed',
      provider,
      ...boundedOutput(output),
    };
    if (typeof exitCode === 'number') event.exit_code = exitCode;
    return event;
  }

  function start(id, command) {
    const event = runningEvent(provider, id, command);
    if (event) open.set(event.command_id, event.command);
    return event;
  }

  /** Claude stream-json: Bash/PowerShell tool_use in assistant, tool_result in user. */
  function fromClaude(event) {
    const out = [];
    const blocks = Array.isArray(event?.message?.content) ? event.message.content : [];
    if (event?.type === 'assistant') {
      for (const block of blocks) {
        if (block?.type === 'tool_use' && SHELL_TOOL_NAMES.has(block.name)) {
          const started = start(block.id, block.input?.command);
          if (started) out.push(started);
        }
      }
    } else if (event?.type === 'user') {
      for (const block of blocks) {
        if (block?.type === 'tool_result') {
          const done = finish(block.tool_use_id, { output: textFromContent(block.content), failed: block.is_error === true });
          if (done) out.push(done);
        }
      }
    }
    return out;
  }

  /** Codex --json: command_execution items. */
  function fromCodex(event) {
    const item = event?.item;
    if (!item || item.type !== 'command_execution') return [];
    if (event.type === 'item.started') {
      const started = start(item.id, item.command);
      return started ? [started] : [];
    }
    if (event.type === 'item.completed') {
      if (!open.has(String(item.id))) start(item.id, item.command);
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : textFromContent(item.output);
      const done = finish(String(item.id), {
        output,
        exitCode: typeof item.exit_code === 'number' ? item.exit_code : undefined,
        failed: item.status === 'failed',
      });
      return done ? [done] : [];
    }
    return [];
  }

  /** Cursor stream-json: tool_call started/completed carrying shellToolCall. */
  function fromCursor(event) {
    if (event?.type !== 'tool_call') return [];
    const shell = event.tool_call?.shellToolCall;
    if (!shell || typeof shell !== 'object') return [];
    const id = event.call_id;
    if (event.subtype === 'started') {
      const started = start(id, shell.args?.command);
      return started ? [started] : [];
    }
    if (event.subtype === 'completed') {
      if (!open.has(String(id))) start(id, shell.args?.command || shell.result?.success?.command);
      const result = shell.result || {};
      const success = result.success && typeof result.success === 'object' ? result.success : null;
      const failure = !success ? (result.failure || result.error || result.rejected || null) : null;
      const source = success || (failure && typeof failure === 'object' ? failure : {});
      const output = [source.stdout, source.stderr, source.output, source.interleavedOutput, typeof failure === 'string' ? failure : source.message]
        .filter((part) => typeof part === 'string' && part.trim())
        .join('\n');
      const exitCode = typeof source.exitCode === 'number' ? source.exitCode : typeof source.exit_code === 'number' ? source.exit_code : undefined;
      const done = finish(String(id), { output, exitCode, failed: Boolean(failure) });
      return done ? [done] : [];
    }
    return [];
  }

  /** Commands still open when the turn ends never got a result. */
  function drain() {
    const out = [];
    for (const [id, command] of open) out.push({ command_id: id, command, status: 'failed', provider, output: 'No result before the turn ended.' });
    open.clear();
    return out;
  }

  return {
    observe(event) {
      if (provider === 'claude') return fromClaude(event);
      if (provider === 'codex') return fromCodex(event);
      if (provider === 'cursor') return fromCursor(event);
      return [];
    },
    drain,
  };
}

module.exports = { createCommandTracker, MAX_COMMAND_CHARS, MAX_OUTPUT_CHARS };

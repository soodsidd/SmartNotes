#!/usr/bin/env node
/**
 * Test fixture for SN-247 fast-lane tests — a minimal fake "claude" CLI.
 *
 * Understands just enough of `claude -p --output-format stream-json --verbose
 * ...` to exercise packages/cli-chat/fast-lane.js's spawn/parse/session logic
 * end-to-end without spawning the real CLI (no network access, no API cost,
 * fully deterministic). Invoked via tests/fixtures/fake-claude.cmd, pointed at
 * by SMART_NOTES_FAST_LANE_CLAUDE_CMD in test setup.
 *
 * Behavior toggles via env var (set by the test, not by argv, so they survive
 * the Windows shell/cmd.exe re-tokenization the real integration is exercising):
 *   FAKE_CLAUDE_HANG=1            never exits — for timeout/kill tests
 *   FAKE_CLAUDE_SLOW_PROGRESS=1   emits keepalives for >20s wall clock, then finishes
 *   FAKE_CLAUDE_SPAWN_ERROR=1     exits non-zero immediately, no output
 *   FAKE_CLAUDE_ERROR=1           emits a terminal is_error result event
 *   FAKE_CLAUDE_NO_SESSION=1      omits session_id from every event
 */
'use strict';
const crypto = require('crypto');

function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    const timer = setTimeout(() => resolve(data), 2000);
    timer.unref?.();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);

  if (process.env.FAKE_CLAUDE_HANG === '1') {
    // A bare `await new Promise(() => {})` does NOT keep Node's event loop
    // alive by itself (an unresolved promise registers no libuv handle) — the
    // process would exit almost immediately, defeating this fixture's whole
    // purpose. A ref'd interval is a real keep-alive handle, so the process
    // genuinely hangs until the parent kills it (which is exactly what the
    // fast-lane timeout/close tests need to exercise).
    setInterval(() => {}, 1 << 30);
    return;
  }

  if (process.env.FAKE_CLAUDE_SPAWN_ERROR === '1') {
    process.stderr.write('fake claude: forced spawn error\n');
    process.exitCode = 1;
    return;
  }

  const resumeId = getArgValue(args, '--resume');
  const sessionId = process.env.FAKE_CLAUDE_NO_SESSION === '1' ? undefined : resumeId || crypto.randomUUID();
  const prompt = (await readStdin()).trim();

  const initEvent = { type: 'system', subtype: 'init', tools: [], model: getArgValue(args, '--model') || 'unknown' };
  if (sessionId) initEvent.session_id = sessionId;
  process.stdout.write(JSON.stringify(initEvent) + '\n');

  if (process.env.FAKE_CLAUDE_ERROR === '1') {
    const resultEvent = { type: 'result', is_error: true, result: 'fake provider error', ttft_ms: 5 };
    if (sessionId) resultEvent.session_id = sessionId;
    process.stdout.write(JSON.stringify(resultEvent) + '\n');
    return;
  }

  // SN-255: keep emitting stream-json progress past the old 20s absolute
  // timeout so idle-reset behavior can be proven end to end.
  if (process.env.FAKE_CLAUDE_SLOW_PROGRESS === '1') {
    const replyText = `slow:${prompt}`;
    // Emit progress often enough to reset a 2s idle budget while wall-clock
    // still exceeds that budget several times over (SN-255).
    for (let i = 0; i < 5; i += 1) {
      await sleep(1500);
      const keepalive = {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: i === 4 ? replyText : '.' },
        },
      };
      if (sessionId) keepalive.session_id = sessionId;
      process.stdout.write(JSON.stringify(keepalive) + '\n');
    }
    const assistantEvent = { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } };
    if (sessionId) assistantEvent.session_id = sessionId;
    process.stdout.write(JSON.stringify(assistantEvent) + '\n');
    const resultEvent = { type: 'result', is_error: false, result: replyText, ttft_ms: 42 };
    if (sessionId) resultEvent.session_id = sessionId;
    process.stdout.write(JSON.stringify(resultEvent) + '\n');
    return;
  }

  const replyText = `echo:${prompt}`;

  // SN-253: when the caller opted into partial messages, emit the answer as
  // token deltas FIRST and still follow with the assembled assistant message,
  // exactly as the real CLI does. This is the shape that would double the
  // answer if fast-lane.js re-pushed the assistant block after its own deltas.
  if (args.includes('--include-partial-messages')) {
    const chunks = replyText.match(/.{1,4}/g) || [];
    for (const chunk of chunks) {
      const deltaEvent = {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } },
      };
      if (sessionId) deltaEvent.session_id = sessionId;
      process.stdout.write(JSON.stringify(deltaEvent) + '\n');
      // Yield so the parent can flush between chunks (SN-253 multi-delta invariant).
      await sleep(5);
    }
  }

  const assistantEvent = { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } };
  if (sessionId) assistantEvent.session_id = sessionId;
  process.stdout.write(JSON.stringify(assistantEvent) + '\n');

  const resultEvent = { type: 'result', is_error: false, result: replyText, ttft_ms: 42 };
  if (sessionId) resultEvent.session_id = sessionId;
  process.stdout.write(JSON.stringify(resultEvent) + '\n');
}

main();

/**
 * SN-401: Companion shell commands are normalized into bounded `command`
 * events per provider. Observation only.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCommandTracker, MAX_OUTPUT_CHARS } = require("../packages/cli-chat/command-activity");

describe("SN-401 createCommandTracker", () => {
  it("pairs Claude Bash tool_use with its tool_result and ignores non-shell tools", () => {
    const tracker = createCommandTracker("claude");
    const started = tracker.observe({
      type: "assistant",
      message: { content: [
        { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls -la" } },
        { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "x" } },
      ] },
    });
    expect(started).toEqual([{ command_id: "toolu_1", command: "ls -la", status: "running", provider: "claude" }]);
    const done = tracker.observe({
      type: "user",
      message: { content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "a\nb\n" }] },
        { type: "tool_result", tool_use_id: "toolu_2", content: "file body" },
      ] },
    });
    expect(done).toEqual([{ command_id: "toolu_1", command: "ls -la", status: "completed", provider: "claude", output: "a\nb" }]);
  });

  it("marks a Claude tool_result error as failed", () => {
    const tracker = createCommandTracker("claude");
    tracker.observe({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "PowerShell", input: { command: "Get-Item nope" } }] } });
    const [done] = tracker.observe({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "not found", is_error: true }] } });
    expect(done).toMatchObject({ status: "failed", output: "not found" });
  });

  it("maps Codex command_execution start/complete with exit code", () => {
    const tracker = createCommandTracker("codex");
    expect(tracker.observe({ type: "item.started", item: { id: "item_3", type: "command_execution", command: "python -V" } }))
      .toEqual([{ command_id: "item_3", command: "python -V", status: "running", provider: "codex" }]);
    expect(tracker.observe({
      type: "item.completed",
      item: { id: "item_3", type: "command_execution", command: "python -V", aggregated_output: "Python 3.12\n", exit_code: 0 },
    })).toEqual([{ command_id: "item_3", command: "python -V", status: "completed", provider: "codex", output: "Python 3.12", exit_code: 0 }]);
    const [failed] = tracker.observe({
      type: "item.completed",
      item: { id: "item_4", type: "command_execution", command: "false", aggregated_output: "", exit_code: 1 },
    });
    expect(failed).toMatchObject({ command_id: "item_4", status: "failed", exit_code: 1 });
    expect(tracker.observe({ type: "item.completed", item: { id: "m", type: "agent_message", text: "hi" } })).toEqual([]);
  });

  it("maps Cursor shellToolCall start/complete and ignores other tool calls", () => {
    const tracker = createCommandTracker("cursor");
    expect(tracker.observe({ type: "tool_call", subtype: "started", call_id: "c1", tool_call: { readToolCall: { args: { path: "a" } } } })).toEqual([]);
    expect(tracker.observe({ type: "tool_call", subtype: "started", call_id: "c2", tool_call: { shellToolCall: { args: { command: "dir" } } } }))
      .toEqual([{ command_id: "c2", command: "dir", status: "running", provider: "cursor" }]);
    const [done] = tracker.observe({
      type: "tool_call",
      subtype: "completed",
      call_id: "c2",
      tool_call: { shellToolCall: { args: { command: "dir" }, result: { success: { exitCode: 0, stdout: "file.txt\n", stderr: "" } } } },
    });
    expect(done).toEqual({ command_id: "c2", command: "dir", status: "completed", provider: "cursor", output: "file.txt", exit_code: 0 });
    tracker.observe({ type: "tool_call", subtype: "started", call_id: "c3", tool_call: { shellToolCall: { args: { command: "rm x" } } } });
    const [rejected] = tracker.observe({
      type: "tool_call", subtype: "completed", call_id: "c3",
      tool_call: { shellToolCall: { args: { command: "rm x" }, result: { rejected: { reason: "denied" } } } },
    });
    expect(rejected).toMatchObject({ command_id: "c3", status: "failed" });
  });

  it("keeps only the output tail and drains unfinished commands as failed", () => {
    const tracker = createCommandTracker("codex");
    tracker.observe({ type: "item.started", item: { id: "big", type: "command_execution", command: "spam" } });
    const [done] = tracker.observe({
      type: "item.completed",
      item: { id: "big", type: "command_execution", command: "spam", aggregated_output: `${"x".repeat(MAX_OUTPUT_CHARS + 50)}END`, exit_code: 0 },
    });
    expect(done.output.length).toBe(MAX_OUTPUT_CHARS);
    expect(done.output.endsWith("END")).toBe(true);
    expect(done.output_truncated).toBe(true);
    tracker.observe({ type: "item.started", item: { id: "hang", type: "command_execution", command: "sleep 99" } });
    expect(tracker.drain()).toEqual([{ command_id: "hang", command: "sleep 99", status: "failed", provider: "codex", output: "No result before the turn ended." }]);
    expect(tracker.drain()).toEqual([]);
  });

  it("produces nothing for providers without shell events", () => {
    expect(createCommandTracker("ghcopilot").observe({ type: "assistant.message", data: {} })).toEqual([]);
  });
});

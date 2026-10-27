# SN-401 live provider probe (2026-10-27)

Real CLI stream-json piped through `packages/cli-chat/command-activity.js`
(`createCommandTracker`), prompt: "Run exactly this one shell command: echo sn401-probe".

- Claude (`claude -p ... --output-format stream-json --verbose --allowedTools Bash`, haiku):
  running `echo sn401-probe` (toolu_...), then completed with output `sn401-probe`.
  Raw shapes: assistant `tool_use` {id, name:"Bash", input.command}; user `tool_result`
  {tool_use_id, content:string, is_error:false}.
- Codex 0.157 (`codex exec --json -m gpt-6-sol`): `item_0` running
  `"C:\Program Files\PowerShell\7\pwsh.exe" -Command 'echo sn401-probe'`, then completed,
  output `sn401-probe`, exit_code 0.
- Cursor: not probed live (account usage limit reached); parser follows the documented
  `tool_call` started/completed `shellToolCall` {args.command, result.success{stdout,stderr,exitCode}}
  shape and is covered by unit tests.

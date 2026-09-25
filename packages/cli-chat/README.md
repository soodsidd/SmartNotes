# @repo/cli-chat

Canonical shared chat backend for this workspace.

It provides:
- `index.js` for direct Node server embedding via `createChatModule(...)`
- `bridge.js` for non-Node hosts that need to forward `/api/chat/*` requests into the canonical backend
- `static/chat-widget.js` as the single shared widget bundle served by every consumer app, including the common settings, mobile, and recent-session manager UI

Current consumers:
- `apps/ai-feedly` embeds `createChatModule(...)` directly
- `apps/tax-prep` embeds `createChatModule(...)` directly
- `apps/resume-repo` keeps its Flask app and bridges same-origin chat requests into this package via `bridge.js`

## ChatConfig contract

`createChatModule(httpServer, io, config)` accepts a single app-owned config object. The shared module does not inspect consumer app files or infer app behavior from the working tree.

```js
const { createChatModule } = require('@repo/cli-chat');

const chat = createChatModule(server, io, {
	workingDirectory: __dirname,
	projects: [
		{ id: 'app', name: 'Current App', repoRoot: __dirname },
	],
	uploadDir: path.join(__dirname, '.chat-runtime'),
	configPath: path.join(__dirname, 'chat-config.json'),
	sandbox: 'full',
	systemPrompt: 'Default assistant instructions',
	agent: {
		name: 'Clear Reader Assistant',
		instructions: 'App-specific instructions loaded by the app itself.',
		sandbox: 'full',
	},
});
```

### Config fields

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `systemPrompt` | `string` | friendly assistant prompt | Fallback instructions when `agent.instructions` is absent. |
| `workingDirectory` | `string` | `process.cwd()` | Process cwd for provider CLIs and relative app-owned paths. |
| `projects` | `Array<{ id: string, name?: string, repoRoot: string, instructions?: string }>` | `null` | Optional project catalog. The widget exposes a project selector in Settings and routes chat cwd/history/session scope through the selected repo root. |
| `uploadDir` | `string` | OS temp dir under `cli_chat_uploads` | Stores uploads, history, and per-turn job logs. |
| `configPath` | `string \| null` | `null` | Optional JSON file used by `/settings`. |
| `urlPrefix` | `string` | `/api/chat` | HTTP mount prefix. |
| `maxBodySize` | `number` | `200 * 1024` | Request body cap for JSON endpoints. |
| `idleWarningMs` | `number` | `30000` | Emits a `status` event when a turn goes idle. |
| `idleKillMs` | `number` | `90000` | Kills a stalled provider process and emits `error` + `done`. |
| `requestTimeout` | `number` | `90000` | Deprecated alias for `idleKillMs`. |
| `maxHistoryJobs` | `number` | `20` | Number of completed job logs kept in memory. |
| `urlFetchMaxChars` | `number` | `8000` | Max cleaned text returned by `/fetch-url`. |
| `verbose` | `boolean` | `true` | Enables normalized `thinking`, `tool_call`, and `tool_result` output when supported. |
| `sandbox` | `string \| object` | `readonly` | Named sandbox profile or custom sandbox override; see `sandbox.js`. |
| `providers` | `object \| null` | `null` | Optional provider override block consumed by the runtime. |
| `agent` | `string \| { name?: string, instructions?: string, sandbox?: string \| object } \| null` | `null` | App-supplied agent override. Strings are treated as inline instructions. Objects can override name, instructions, and sandbox. |

### Agent ownership rules

- The app owns agent discovery.
- The shared module does not auto-read `.cli-chat.md`.
- If an app wants to load `.cli-chat.md`, it reads that file itself and passes the parsed object as `config.agent`.
- If `agent.instructions` is present, it overrides `systemPrompt` for outbound turns.
- If `agent.sandbox` is present, it overrides the top-level `sandbox` for that app.

## Runtime surface

The HTTP router returned by `createChatModule(...)` serves these stable endpoints under `urlPrefix`:

- `GET /providers`
- `GET /auth?provider=<id>`
- `GET /settings`
- `POST /settings`
- `GET /sandbox`
- `GET /agent`
- `GET /usage`
- `POST /send`
- `POST /cancel`
- `POST /reset-session`
- `POST /upload`
- `POST /fetch-url`
- `GET /history`
- `POST /history`
- `GET /sessions`
- `GET /sessions/:turn_id`
- `GET /static/chat-widget.js`

The module also exposes:

- `handleRequest(req, res)`
- `getProviders()`
- `checkAuth(provider)`
- `getSandboxConfig()`
- `getAgent()`

## Validation commands

- `pnpm --dir packages/cli-chat run lint`
- `pnpm --dir packages/cli-chat run test`
- `pnpm --dir packages/cli-chat run test:e2e` with `CLI_CHAT_E2E_TARGET=ai-feedly` or `CLI_CHAT_E2E_TARGET=resume-repo`

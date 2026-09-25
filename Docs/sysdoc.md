# Smart Notes — System Documentation

**Last updated:** 2026-06-04  
**Maintained by:** Developer agents at closeout; reviewed by James (planner) at merge.

This document is written for two audiences: the **owner** (plain English first, so you can orient yourself in any area without reading code) and **developer agents** (technical depth in each section so you can work without guessing). If you are an agent starting a new brief, use the heading outline to find the sections relevant to your work, read those sections fully, and check any "Lessons Learned" subsections before touching that area.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Vault & File Layout](#2-vault--file-layout)
3. [Server & Runtime](#3-server--runtime)
4. [REST API](#4-rest-api)
5. [Data Model & App State](#5-data-model--app-state)
6. [Rich Text Editor](#6-rich-text-editor)
7. [Comment System](#7-comment-system)
8. [AI Sidebar](#8-ai-sidebar)
9. [Capture Flow](#9-capture-flow)
10. [Mobile Layout](#10-mobile-layout)
11. [Theme & Design Tokens](#11-theme--design-tokens)
12. [Testing](#12-testing)
13. [Cross-Cutting Lessons](#13-cross-cutting-lessons)
14. [Ink Notes (Drawing Surface)](#14-ink-notes-drawing-surface)

---

## 1. Product Overview

Smart Notes is a **personal AI research notebook** that runs on your own hardware (a home mini PC) and is accessible from all your devices — desktop, iPhone, and Android tablet — over your local network or Tailscale.

The core idea is simple: your notes are plain Markdown files on disk, not locked in a proprietary database. That means any text editor can read them, any AI agent can edit them, and equations render properly. The app is designed to feel like OneNote but be far more capable: notes stay "alive" because AI can continue, extend, or reorganize them without friction.

**The three things it is built to do:**
1. **Store research notes** that are readable by both humans and AI — with math, tables, task lists, and file attachments all supported natively.
2. **Let you ask AI questions about any note** — the AI sees the Markdown source and can answer, extend, or rewrite directly in the file.
3. **Capture quickly** — paste content from any device and it lands in your Inbox section immediately, ready to organize later.

**Tech stack at a glance:** Next.js 14 (React app), served by a custom Node.js server, using Tiptap as the editor engine. Notes live in a `vault/` folder on disk as plain `.md` files. Port 3002 by default.

---

## 2. Vault & File Layout

**Plain English:** Your notes live in a folder called `vault/` inside the app directory (or wherever `SMART_NOTES_VAULT` points). Inside that folder, the structure mirrors how the app presents it: Notebooks are folders, Sections are subfolders, and Pages are `.md` files.

**Directory structure:**

```
vault/
  Research Notebook/          ← Notebook (a directory)
    Inbox/                    ← Section (a directory; "Inbox" is special)
      my-first-note.md        ← Page (a Markdown file)
    Physics/                  ← Section
      quantum-notes.md
      quantum-notes.assets/   ← Sibling asset directory for images
        diagram.png
      my-sketch.md            ← Ink page (note_type: ink in frontmatter)
      my-sketch.ink.json      ← Ink sidecar (Tldraw scene snapshot)
  Personal Notebook/
    Inbox/
    Projects/
```

**Key rules:**
- The vault root is resolved from `SMART_NOTES_VAULT` env var, then `<cwd>/vault`, then `<cwd>/.e2e-vault` (the last is the E2E test vault). Code: `src/server/vault/config.ts`.
- All path operations go through `resolveVaultPath()` in `src/server/vault/paths.ts`, which validates against directory traversal and enforces `.md` extension for pages.
- Notebook names map directly to directory names (human-readable, spaces preserved). Section names similarly. Page file names are slugified from the title (`fileNameFromTitle()`).
- Page renaming renames the `.md` file and moves the sibling `.assets/` directory atomically.
- All writes use `writeAtomically()` — write to a temp file, then rename — to protect against partial writes.
- The `Inbox` section name is special: the Capture flow auto-creates it if it doesn't exist, and it sorts first in the sidebar.
- On Windows, directory renames fall back to recursive copy + delete if `EPERM` occurs (antivirus holds on contents).

**Frontmatter format:**

Every page file starts with a YAML frontmatter block:

```markdown
---
title: Quantum Notes
created: 2026-05-15T10:00:00.000Z
updated: 2026-05-20T14:30:00.000Z
comments:
  - id: cmt_abc123
    quote: "Planck's constant"
    text: "This needs a numerical example"
    createdAt: 2026-05-20T14:00:00.000Z
    resolvedAt: null
---

# Quantum Notes

Body content here...
```

- `title`, `created`, `updated` are written by the server on every save.
- `note_type` is written at page creation time and never changed thereafter. Omitted for ordinary text pages; set to `ink` for ink (drawing) pages. Controls which surface the shell opens — rich text editor vs. Tldraw canvas.
- `comments` is an array of comment objects; it is omitted from the file when there are no comments. Never manually edit this field — use the comments API.
- Parsing is handled by `src/server/vault/frontmatter.ts` using the `yaml` library.
- A missing or malformed frontmatter block is handled gracefully: pages without frontmatter load fine (title is inferred from filename); malformed frontmatter (unclosed `---`) throws `MALFORMED_FRONTMATTER`.

**Asset attachments:**

Image files pasted or attached to a page are stored in a sibling `.assets/` directory next to the `.md` file. Example: `Physics/quantum-notes.assets/diagram.png`. PDF attachments use the same sibling `.assets/` directory and are persisted in markdown as ordinary links, while the rich-text editor upgrades them to a PDF chip node when rendered. The server serves these at `/vault/<path>` (see server.js), with `.pdf` responses explicitly marked `Content-Type: application/pdf` so they can render inside a native browser iframe preview. AI attachment operations (preview, copy) are supported via `previewAttachment()` and `copyAttachmentToNote()` in `pages.ts`.

**Ink sidecars:**

Ink pages carry a sibling `.ink.json` file (e.g. `my-sketch.md` → `my-sketch.ink.json`) that stores the serialized Tldraw scene snapshot. The sidecar is created on first save and updated on every autosave. It is invisible to the rich-text editor and to AI agents that edit the `.md` body. Lifecycle operations keep the two files in sync: `deletePage` removes the sidecar, `renamePage` moves it alongside the `.md` file. The server functions `readInkScene`, `saveInkScene`, and `deleteInkScene` in `src/server/vault/pages.ts` are the only code that reads or writes `.ink.json` files; all access must go through them.

### Lessons Learned

- **Never skip path validation.** All vault paths must go through `resolveVaultPath()`. Calling `path.join(vaultRoot, userInput)` directly has been done before and created path traversal vulnerabilities. Always use the validated path helpers.
- **Windows EPERM on directory rename.** If you add any code that renames a non-empty directory, use `renameDirectory()` from `pages.ts`, not `fs.rename()` directly. Antivirus and indexing tools on Windows hold handles on directory contents.

---

## 3. Server & Runtime

**Plain English:** The app runs as a single Node.js process that handles both the web UI (Next.js) and a real-time chat API (Socket.IO). When you start it with `npm run dev` or `npm start`, it listens on port 3002. The vault folder it uses is printed to the console at startup.

**Server entry point:** `server.js`

The custom server layers on top of Next.js's standard request handler and adds:

1. **Vault asset serving** — `GET /vault/*` paths are resolved to files in the vault root and served directly (for embedded images). Security: path is validated against vault root before serving.
2. **CLI chat module** — `GET|POST /api/chat/*` and Socket.IO events are routed to `@repo/cli-chat` (the `packages/cli-chat` local package). This powers the floating AI chat bubble.
3. **Socket.IO** — A Socket.IO server is attached to the same HTTP server. The `global._smartNotesIo` reference is set so API routes can emit `file_updated` events for multi-tab sync.

**Ports and configuration:**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3002` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `SMART_NOTES_VAULT` | `<cwd>/vault` | Vault root path |
| `CLI_CHAT_RUNTIME_DIR` | `~/.cli-chat/dev-workspace/smart-notes` | Chat module state and uploads |
| `NODE_ENV` | `development` (`npm run dev`) / `production` (`npm run start:runtime`) | `production` serves pre-built routes; AV runtime uses `start:runtime` |

**Multi-tab sync:** When an AI agent edits a page via the API (specifically via `spliceEditPage()`), the server emits a `file_updated` Socket.IO event with `{ path, content }`. The UI listens on this event and reloads the editor content if the active page matches. This is best-effort: if Socket.IO is unavailable, the client falls back to HTTP reload.

**Dev route:** `GET /_dev/screens` is aliased to `/dev-screens` for the design showcase page (not production functionality).

**The CLI chat module** (`packages/cli-chat`) is a local package that provides an AI chat bridge. It runs in `sandbox: 'editor'` mode, which limits it to reading and editing Markdown files in the vault. Its working directory is set to the app root.

### Lessons Learned

- **`global._smartNotesIo` is intentionally a process global.** The Socket.IO instance is set in `server.js` before Next.js routes initialize, so API route handlers can reach it via `global._smartNotesIo`. This pattern is fragile to tests and serverless environments — don't replicate it. For tests, mock it or ignore the emit.
- **AV runtime uses production mode** via `npm run start:runtime` (`runtime-start.js`). It rebuilds only when sources are newer than `.next/BUILD_ID`, then runs `server.js` with `NODE_ENV=production`. Commit `av-runtime.json`, `start:runtime`, and `runtime-start.js` as one contract — runtime config can drift after branch reverts if only the JSON changes.
- **Production builds on Node 22 + Windows** can fail in webpack WasmHash; `next.config.mjs` forces `output.hashFunction = "sha256"`.
- **`npm run dev` preserves the `.next` cache** across restarts for faster local iteration. Use `npm run dev:fresh` to wipe `.next/` when debugging stale-build issues.

---

## 4. REST API

**Plain English:** The app has a set of HTTP endpoints that the UI calls to read, create, and save notes. If you're writing an AI agent that edits notes, these are the endpoints you use. You don't need to touch the database or files directly — the API handles that.

All routes are Next.js App Router route handlers under `src/app/api/`.

### GET /api/vault

Returns the full notebook tree: all notebooks, their sections, and the page summaries (title, preview, timestamps — but not full body content). Used on app load to populate the sidebar.

**Response:** `{ tree: VaultNotebook[], root: string }`

### GET /api/page?path=\<vault-relative-path\>

Returns the full page document including body content and metadata.

**Response:** `{ page: ApiPageDocument }` — includes `body`, `metadata`, `notebookName`, `sectionName`, plus all summary fields.

### POST /api/page

Creates a new page in a section.

**Body:** `{ sectionPath: string, title?: string }`  
**Response:** `{ page: ApiPageDocument }` (201)

### PUT /api/page

Saves page content. Accepts `content` or `body` (legacy alias) for the Markdown text.

**Body:** `{ path: string, title: string, content: string }`  
**Response:** `{ page: ApiPageDocument }`

### PATCH /api/page

Renames or moves a page.

- Rename: `{ path: string, title: string }` (default action)
- Move: `{ action: "move", path: string, sectionPath: string }`

**Note:** `action: "previewAttachment"`, `"copyAttachment"`, and `"aiSpliceCommit"` are explicitly rejected with `UNSUPPORTED_ACTION` — these were from a legacy shell and are disabled in Smart Notes. AI edits the Markdown directly on disk.

### DELETE /api/page?path=\<path\>

Deletes a page and its sibling `.assets/` directory (and `.ink.json` sidecar if the page is an ink note).

### GET /api/ink?path=\<vault-relative-path\>

Returns the Tldraw scene snapshot for an ink page.

**Response:** `{ scene: TldrawSnapshot | null }` — `null` when no sidecar exists yet (new ink note that has never been saved).

### PUT /api/ink

Persists the Tldraw scene snapshot for an ink page. Called by the `InkCanvas` component on every autosave (1200 ms debounce).

**Body:** `{ path: string, scene: TldrawSnapshot }`  
**Response:** `{ ok: true }`

Route handler: `src/app/api/ink/route.ts`. Client wrapper: `src/lib/api/ink.ts` (`fetchInkScene`, `saveInkScene`).

### GET /api/page/comments?path=\<path\>

Returns the `comments` array from the page frontmatter.

**Response:** `{ comments: StoredComment[] }`

### PUT /api/page/comments

Saves the full comments array back to the page frontmatter. Accepts an optional `pageBody` to avoid clobbering unsaved editor content.

**Body:** `{ path: string, comments: StoredComment[], pageBody?: string }`

### GET /api/notebook, POST /api/notebook, PATCH /api/notebook, DELETE /api/notebook

CRUD for notebooks (directories). See `src/app/api/notebook/route.ts`.

### GET /api/section, POST /api/section, PATCH /api/section, DELETE /api/section

CRUD for sections (subdirectories). See `src/app/api/section/route.ts`.

### POST /api/capture

Captures content to the Inbox or a specific section.

**Body:** `{ destination?: "inbox" | "page", title?: string, content?: string, notebookPath?: string, sectionPath?: string }`

- `destination: "inbox"` (default) — finds or creates an Inbox section and creates the page there.
- `destination: "page"` — requires `sectionPath`; creates the page in that section.

**Error codes:** `VaultError` codes are `PAGE_NOT_FOUND` (404), `SECTION_NOT_FOUND` (404), `NOTEBOOK_NOT_FOUND` (404), `PAGE_EXISTS` (409), `MALFORMED_FRONTMATTER` (400), `INVALID_PATH` (400), `INVALID_TITLE` (400), `ASSET_COLLISION` (409), `UNSUPPORTED_ACTION` (400).

---

## 5. Data Model & App State

**Plain English:** The app has two different ways of managing note data. The real one reads from and saves to files on disk through the API. There's also an older in-memory mock system that was used in early development and is still wired up in some parts of the code. Understanding which one is active matters if you're debugging why changes aren't persisting.

### Two state systems (and why they coexist)

**1. Vault-backed state (the real system)** is used by `notebook-shell-reliable.tsx` — the main shell component. It:
- Loads the tree from `GET /api/vault` on mount.
- Loads page content from `GET /api/page` when a page is selected.
- Saves page content via `PUT /api/page` through the `usePageDraft` hook with 1200ms debounce autosave.
- All CRUD operations go through the REST API, which writes to disk.

**2. In-memory mock state** lives in `src/lib/app-state.tsx` (`AppProvider` + `useApp()`). It initializes from `src/lib/mock-data.ts` and never touches the filesystem. This was the initial prototype shell. It is still imported by some components but is not wired to the main app path in production.

**Rule for agents:** If you are modifying note persistence, CRUD operations, or anything that should survive a page reload — work in the vault-backed system (`notebook-shell-reliable.tsx`, `usePageDraft`, the API routes). Don't touch `app-state.tsx` for production behavior changes.

### The notebook/section/page hierarchy

```
VaultNotebook
  ├── id: string (= vault-relative path, e.g. "Research Notebook")
  ├── path: string
  ├── name: string
  ├── color: string (CSS variable, assigned by position mod 6)
  └── sections: VaultSection[]
        ├── id: string (= vault-relative path, e.g. "Research Notebook/Physics")
        ├── path: string
        ├── name: string
        └── pages: VaultPageSummary[]
              ├── id: string (= vault-relative path to .md file)
              ├── path: string
              ├── title: string
              ├── slug: string
              ├── preview: string (first 180 chars of body, stripped)
              ├── content: string (full body — included in tree response)
              ├── createdAt: string | null
              └── updatedAt: string | null
```

The `id` field on each entity is the vault-relative path. There are no separate opaque IDs. This means: if a notebook or section is renamed, all child paths change too.

Pages can also form a small in-section tree. Each page summary/document carries an optional `parentId`, persisted in page frontmatter as `parent_id`. The UI allows at most two nesting levels: root pages and one child level under a parent. The reliable shell renders these as an indented tree, stores expanded/collapsed state in `localStorage`, and supports both drag-based nesting and explicit indent/outdent actions while keeping the depth cap enforced in the client and API tests.

### usePageDraft (autosave hook)

`src/hooks/use-page-draft.ts` manages the draft lifecycle for the active page:

- **States:** `idle → dirty → saving → saved → idle`
- **Debounce:** 1200ms after the last change before save is triggered.
- **Baseline tracking:** Uses a `baselineRef` to detect dirty state without React re-renders on every keystroke. `latestRef` tracks the current draft content.
- **Flush:** `flush()` immediately saves any pending changes. Called by the shell before navigating away.
- **In-flight deduplication:** If a save is already in-flight and new changes come in, the next save is queued after the in-flight one completes.
- **Race safety:** If a rename changes the path mid-edit, the `selectedPathRef` prevents saving to the old path.

### Lessons Learned

- **`content` vs `body` in the API.** The PUT /api/page route accepts both `content` and `body` for the Markdown text (`content` takes precedence). This was introduced for compatibility when the reliable shell switched from `body` to `content`. New code should use `content`; old code using `body` still works.
- **The tree response includes full page body content.** This was a deliberate performance decision — load everything on first call so page switching is instant. If the vault grows very large (thousands of pages), this becomes a problem. The field is called `content` in `VaultPageSummary` even though the type name suggests it's a summary.

---

## 6. Rich Text Editor

**Plain English:** When you open a page, you see a rich editor — not a raw Markdown editor. You can bold text, add headings, create tables, write equations, and check off task items, all by clicking buttons or using keyboard shortcuts. Under the hood, it stores everything as Markdown — so the file on disk is always plain text.

**Engine:** [Tiptap](https://tiptap.dev/) v3, with the `tiptap-markdown` serializer for round-trip Markdown conversion.

**Component:** `src/components/rich-text-editor.tsx`  
**Extensions config:** `src/lib/rich-text-editor-config.ts`

### Enabled extensions

| Extension | What it does |
|---|---|
| StarterKit | Bold, italic, headings (H1–H3), lists, blockquote, code, horizontal rule |
| TaskList + TaskItem | `- [ ]` checkboxes, nested |
| Table + TableRow + TableCell + TableHeader | Full table editing |
| Link | Clickable links (open-on-click disabled; links open on command+click) |
| Placeholder | Greyed placeholder text when empty |
| Mathematics | KaTeX math rendering. Inline: `$...$`, block: `$$...$$` |
| Markdown (tiptap-markdown) | Markdown ↔ Tiptap JSON serializer |
| FormattingShortcuts | Extra keyboard shortcuts (see below) |
| CommentExtension | Highlight comment anchors via ProseMirror decorations (only loaded when `withComments=true`) |

### Keyboard shortcuts

Standard browser shortcuts apply (Cmd/Ctrl+B for bold, etc.) plus:

| Shortcut | Action |
|---|---|
| Cmd+Alt+1/2/3 | Toggle H1 / H2 / H3 |
| Cmd+Shift+X | Strikethrough |
| Cmd+Shift+7 | Ordered list |
| Cmd+Shift+8 | Bullet list |
| Cmd+Shift+9 | Blockquote |

### Desktop vs mobile editor UI

- **Desktop:** A fixed floating toolbar above the editor. Always visible.
- **Mobile (BubbleMenu):** A contextual toolbar that appears when text is selected. Fewer options to fit the screen.

### Section context

The editor tracks which `## Heading` the cursor is under and exposes it as `EditorSectionContext { heading: string | null, index: number }`. The AI sidebar uses this to scope the AI's context to the current section only (the "section scope" AI mode sends only the current section's Markdown rather than the full note body).

### Markdown round-trip

The `tiptap-markdown` extension is configured with:
- `html: false` — no HTML passthrough
- `tightLists: true` — compact list format
- `bulletListMarker: "-"` — dashes for bullets
- `transformPastedText: true` — pasted Markdown is parsed and rendered
- `transformCopiedText: false` — copying produces Markdown (not HTML)

### Lessons Learned

- **`parseMarkdownToTiptapJson()` creates and destroys a throwaway editor instance.** This is the official Tiptap pattern for server-side or non-DOM parsing. It requires a DOM element, so it only works in browser context. Do not call it in Node.js (e.g., in API routes or tests without `jsdom`).
- **Math extension conflicts with code blocks.** If you add or upgrade extensions, test that `$...$` inside a fenced code block does not trigger math rendering. The `not-prose` class on codeBlock is load-bearing for this.
- **Comment extension is only loaded conditionally.** `createEditorExtensions(placeholder, withComments)` — if `withComments` is `false` (the default), no comment-related ProseMirror plugin is registered. The reliable shell always passes `withComments={true}`; if you create a new editor instance, decide deliberately.

---

## 7. Comment System

**Plain English:** You can select any text in a note, right-click (or long-press on mobile), and add a comment. Comments appear as yellow highlights in the editor. Clicking a highlight shows the comment. Comments are stored in the note file itself — no separate database.

**Key files:**
- `src/lib/comment-types.ts` — `PageComment` type, `generateCommentId()`
- `src/lib/comment-plugin.ts` — ProseMirror plugin that anchors and renders highlights
- `src/components/comment-layer.tsx` — Comment composer, popover, context menu UI
- `src/app/api/page/comments/route.ts` — API endpoints
- `src/server/vault/pages.ts` (`readPageComments`, `savePageComments`) — Storage

### Storage

Comments are stored in the page's YAML frontmatter under the `comments` key:

```yaml
comments:
  - id: cmt_abc123_xyz
    quote: "the selected text verbatim"
    text: "The comment body written by the user"
    createdAt: 2026-05-20T14:00:00.000Z
    resolvedAt: null
```

- `quote` is the verbatim selected text. It is the **only anchor** — there is no character offset stored.
- `resolvedAt` is `null` for active comments, an ISO timestamp for resolved ones.
- The `comments` key is **omitted entirely** from the frontmatter when the array is empty (keeps files clean).
- `savePageComments` accepts an optional `pageBody` argument. When provided, it uses that body instead of what's on disk — this prevents a comment save (triggered after an annotation) from overwriting unsaved editor content.

### Anchoring (ProseMirror plugin)

`comment-plugin.ts` implements a ProseMirror plugin that:
1. On every document render, calls `findQuoteInDoc(doc, comment.quote)` for each active (non-resolved) comment.
2. `findQuoteInDoc` builds a flat char-to-pmPos map across all text nodes, then uses `String.indexOf` to find the quote. This handles quotes spanning multiple text runs (e.g., bold + regular text within a paragraph). It does **not** handle cross-block quotes (spanning two paragraphs) — those are treated as orphaned.
3. Found ranges become `Decoration.inline()` with `class: "comment-mark"` and `data-comment-id`.
4. Orphaned comments (quote not found in current document) produce no decoration but are not deleted — the user resolves them manually.

### Comment lifecycle

1. **Add:** User selects text → context menu → "Add comment" → `CommentComposer` dialog → saves to API.
2. **View:** Click a `comment-mark` decoration → `CommentPopover` appears with the comment text.
3. **Resolve:** User clicks "Resolve" in the popover → `resolvedAt` set to now → highlight disappears.
4. **Delete:** User clicks "Delete" in the popover → comment removed from array.
5. **Persist:** Every add/resolve/delete fires `PUT /api/page/comments` immediately. No debounce.

### Lessons Learned

- **The ProseMirror DecorationSet uses `map()` across transactions to survive edits.** When the document changes, the plugin maps existing decorations through the transaction using `decorations.map(tr.mapping, tr.doc)` before rebuilding from scratch. This is what keeps highlights in the right position as you type around them. If you modify the plugin, do not remove the `map()` call — decorations will jump on every keystroke.
- **Comments stored in frontmatter, not in the Markdown body.** This is intentional so AI agents can freely edit the note body without breaking comment anchors. The anchor is re-found dynamically from the quote text on each render. A consequence: if the quoted text is edited to no longer match, the comment becomes orphaned silently.
- **Quote-based anchoring breaks on non-unique text.** If the same phrase appears twice in a note (e.g., "See note below"), a comment on the second instance will anchor to the first. This is a known limitation. The fix would be to store a character offset in addition to the quote, but that has not been implemented.

---

## 8. AI Sidebar

**Plain English:** Every page has an AI panel on the right side (desktop) or a sheet that slides up (mobile). You type a question, and the AI responds based on your note content. The AI can read your note, suggest additions, or edit it directly. You can choose between different AI providers (Claude, GitHub Copilot, Codex) in settings.

**Key files:**
- `src/lib/ai-sidebar.ts` — Pure functions: request builders, provider resolution, operating context assembly
- `src/components/ai-sidebar.tsx` — The React component (chat UI, message list, input)
- The AI chat is wired into `notebook-shell-reliable.tsx` which calls the functions and manages state

### How a turn works

1. User types a message and submits.
2. The shell calls `buildSmartNotesOperatingContext()` — assembles a block of metadata that tells the AI: what note is open, the vault root path, how to reach it via the API, and what scope is active.
3. `buildAiPageContext()` optionally includes the current section's Markdown if scope is "section".
4. `buildAiTurnRequest()` packages `{ message, history, page_context, app_context, provider, model }`.
5. The request is posted to `/api/chat/turn` (handled by the CLI chat module in `packages/cli-chat`).
6. The response streams back via Socket.IO events and is assembled into the timeline.

### Scope modes

- **Whole note** — no page context is sent (the AI uses its own tool calls or the operating context path to read the file).
- **Section scope** — the Markdown content of the current `## Heading` section is extracted via `getSectionMarkdown()` and sent as `page_context`. Token count shown in the UI (estimated at ~4 chars per token).
- **Page tree** — when the active page has children, the scope control exposes a page-tree mode. In that mode the request includes the active page plus all descendants serialized as an indented Markdown outline, and the scope label reports `Page tree (N pages)` so the user can see how much hierarchy is being sent.

### Operating context (injected into every turn)

`buildSmartNotesOperatingContext()` generates a plaintext block that includes:
- Active note title and vault-relative path
- Absolute path to the Markdown file (for AI agents with filesystem access)
- Page API URL for reading/writing via HTTP
- Current scope label
- Notebook and section names

This context is injected as `app_context` so the AI always knows what note it's working on, even if the user doesn't mention it.

### Provider selection

Providers are resolved via `resolveAiProviderSelection(providers, settings, defaultProviderId)`:
- The list of available providers comes from the server/settings (not hardcoded in the client).
- Per-provider model preferences are stored in settings: `claudeModel`, `ghcopilotModel`, `codexModel`.
- Falls back to `settings.model` if no provider-specific model is set.
- Falls back to the first available provider if the preferred one is not found.

### Timeline format

AI responses are displayed as a timeline of entries, not a flat chat log:
- `{ type: "text" }` — AI response text
- `{ type: "reasoning" }` — Extended thinking / chain-of-thought (collapsed by default)
- `{ type: "verbose", events: AiSidebarTraceEvent[] }` — Tool calls and results (shown in a collapsible)

Builder functions: `appendAiTimelineText()`, `appendAiTimelineReasoning()`, `appendAiTimelineVerboseEvent()`.

### System prompt (user-editable)

A persistent system prompt is injected at the start of every AI session, giving the companion its Smart Notes identity and vault knowledge. It is user-editable from the gear icon → **AI Settings** dialog, in a new "System prompt" section at the bottom of the settings panel.

**How it works end-to-end:**
1. The default prompt ships in `server/agent-settings.js` (`DEFAULT_SYSTEM_PROMPT`). It covers: companion identity, vault structure (Notebook → Section → Page), behavioral rules (edit in place, not paste-in-chat), and SN-33 vault tool workflows (`POST /api/agent/vault`, primary tool names, and example payloads).
2. The user's saved prompt is stored in `<chatRuntimeDir>/agent-settings.json`.
3. `server.js` passes `systemPrompt` as a **function** to `createChatModule` — the function calls `loadAgentSettings()` so it re-reads the file at the start of each new session (no restart needed after edits).
4. `packages/cli-chat/index.js` supports function-typed `systemPrompt`: calls it per turn if it is a function, uses it as a string otherwise.
5. `GET /api/agent-settings` returns `{ systemPrompt, isDefault }`. `POST /api/agent-settings` with `{ systemPrompt }` persists it and returns the saved value.
6. `notebook-shell-reliable.tsx` fetches agent settings on mount alongside providers/chat settings, keeps the prompt in `aiSystemPrompt` state, and passes `persistAiSystemPrompt` as `onSystemPromptSave` to `AiConversation`.
7. `ChatSettingsPanel` renders the textarea only when `onSystemPromptSave` is provided; Save is disabled until the draft differs from the saved value.

**Key files:**
- `server/agent-settings.js` — backend module: default prompt, load/save, HTTP handler
- `server.js` — registers `/api/agent-settings` and passes function-typed `systemPrompt` to `createChatModule`
- `src/components/ai-sidebar.tsx` — `ChatSettingsPanel` system prompt textarea + Save
- `src/components/notebook-shell-reliable.tsx` — fetches, holds, and persists `aiSystemPrompt`

### Lessons Learned

- **Operating context is critical for AI file edits.** The AI needs `absoluteNotePath` to edit the file directly. Without this, agents try to determine the file path themselves and often get it wrong (especially in monorepo setups where the vault is not inside the repo). Always make sure `vaultRoot` is passed to `buildSmartNotesOperatingContext()`.
- **Scope "section" sends Markdown, not Tiptap JSON.** `getSectionMarkdown()` extracts raw Markdown by splitting the whole-note body on `## ` headings. This is a text operation, not a ProseMirror query. It is approximate — deeply nested content under sub-headings is included with the parent `##` section.

---

## 9. Capture Flow

**Plain English:** The Capture button (or the "+" in the mobile tab bar) opens a quick-entry modal where you can paste or type content. It saves immediately to your Inbox — a special section that the app creates automatically if it doesn't exist yet. You can also capture to a specific section if you know where you want it.

**API endpoint:** `POST /api/capture`

**Two destinations:**
- `inbox` (default) — finds the first section named "Inbox" across all notebooks, or creates one in the first notebook. If the vault is empty, creates a "Personal Notebook" first.
- `page` — requires `sectionPath`; creates the page in that specific section.

**Inbox resolution strategy** (`ensureInboxSection()` in `pages.ts`):
1. Walk notebooks alphabetically; use the first section named exactly `"Inbox"`.
2. If none found, create `Inbox` in the first existing notebook.
3. If vault is empty, create `Personal Notebook` first, then add `Inbox`.

The `Inbox` section name is the constant `INBOX_SECTION_NAME = "Inbox"` in `pages.ts`. This string must remain stable — the vault tree sorter uses it to always place Inbox first.

**Capture payload:**

```typescript
{
  destination?: "inbox" | "page",  // default: "inbox"
  title?: string,                   // default: "Untitled capture"
  content?: string,                 // Markdown body (optional)
  notebookPath?: string,            // when destination=inbox, constrains which notebook's Inbox
  sectionPath?: string,             // required when destination=page
}
```

The page is created first (empty), then body content is saved separately. This ensures the page record exists even if a content write fails.

---

## 10. Mobile Layout

**Plain English:** On a phone, the screen is too small to show the sidebar and editor side by side. Instead, you navigate through a stack of screens: first you see your list of Notebooks, tap to see Sections, tap again for Pages, then tap a page to open the editor. A tab bar at the bottom lets you jump between Notes, Capture, Search, and AI.

**Mobile view stack** (managed by `AppState.mobileView`):

```
notebooks → sections → pages → editor
```

Navigation:
- `selectNotebook()` → sets `mobileView: 'sections'`
- `selectSection()` → sets `mobileView: 'pages'`
- `selectPage()` → sets `mobileView: 'editor'`
- `goBack()` → reverses: editor → pages → sections → notebooks

**Mobile tab bar** (`mobileTab`): `'notes' | 'capture' | 'search' | 'ai'`
- `notes` — shows the notebook stack starting from current depth
- `capture` — opens the capture modal
- `search` — opens the search modal
- `ai` — handled by a Sheet component in the editor view (does not change `mobileView`)

**AI on mobile:** The AI panel is rendered as a `Sheet` (bottom drawer) rather than a sidebar panel. `MobileAiSheet` is a separate component from `AiSidebar` but consumes the same state and message format.

**Responsive boundary:** The layout switches between mobile and desktop at the CSS breakpoint defined in the design tokens. The `notebook-shell-reliable.tsx` component renders both layouts and hides/shows them via CSS — there is no JavaScript feature detection.

---

## 11. Theme & Design Tokens

**Plain English:** The app has a light mode and a dark mode, switchable via the settings panel. The colors and sizing are defined as CSS variables in one place, so changing the theme changes everything at once.

**Theme provider:** `src/components/theme-provider.tsx` (wraps `next-themes`).  
**Design tokens:** `src/styles/tokens.css` — CSS custom properties for colors, spacing, and notebook accent colors.  
**Global styles:** `src/app/globals.css`

**Notebook colors** are six CSS variables (`--notebook-color-1` through `--notebook-color-6`), assigned to notebooks by position modulo 6 in `pages.ts`. The same constants are defined in both `src/lib/vault-contract.ts` (client) and `src/server/vault/pages.ts` (server) — keep them in sync if you add or change colors.

**Tailwind CSS v4** is used via PostCSS. Configuration is in `postcss.config.mjs`. The `tailwind-merge` and `clsx` utilities are used throughout via the `cn()` helper in `src/lib/utils.ts`.

**Attachment chips and preview pane:** `src/lib/file-attachment-extension.ts` renders file chips inline inside Tiptap. PDF chips are tagged with `data-file-type="pdf"` and get a dedicated badge treatment in `src/app/globals.css`. `src/components/rich-text-editor.tsx` intercepts clicks on those PDF chips and opens a right-side `Sheet` with a native `<iframe>` preview, rather than navigating away from the editor.

---

## 12. Testing

**Plain English:** The codebase has two kinds of tests: fast unit tests that run in Node.js (for API logic, vault operations, and utilities), and end-to-end (E2E) tests using Playwright that open a real browser and interact with the app.

**Unit tests:** Jest, in `tests/`. Run with `npm test`.

Key test files:
- `tests/vault-pages.test.ts` — CRUD operations via the vault functions
- `tests/vault-frontmatter.test.ts` — Frontmatter parse/serialize round-trips
- `tests/vault-paths.test.ts` — Path validation and sanitization
- `tests/api-page-route.test.ts` — API route handlers (using supertest)
- `tests/api-comments-route.test.ts` — Comments API
- `tests/markdown-roundtrip.test.ts` — Markdown serialization
- `tests/keyboard-shortcuts.test.ts` — Editor shortcut registration

**E2E tests:** Playwright, in `e2e/`. Three projects: `desktop`, `mobile`, `sn3` (legacy).

- `npm run test:e2e:desktop` — Desktop browser
- `npm run test:e2e:mobile` — Mobile viewport
- `npm run test:e2e -- <spec> --project=<project>` — Targeted run

The E2E tests use a `.e2e-vault` directory (resolved automatically by `config.ts` as a fallback) to avoid touching the real vault.

**Jest config:** `jest.config.cjs` uses `ts-jest`. Two environments: `jsdom` (for component tests) and `node` (for API/vault tests). The environment is selected per-file via the `@jest-environment` docblock comment.

### Lessons Learned

- **API route tests use `supertest` against the Next.js handler directly**, not against the running server. This is faster but means Socket.IO side effects (the `global._smartNotesIo` emit in `spliceEditPage`) are not tested by unit tests. If you add Socket.IO-dependent behavior, write an E2E test for it.
- **E2E tests have a `.e2e-vault` auto-resolution.** The vault config checks for `.e2e-vault` as a fallback. If E2E tests are creating unexpected pages in your real vault, check that `.e2e-vault` exists at the project root (the E2E setup should create it).

---

## 13. Cross-Cutting Lessons

These are lessons that apply across multiple areas of the codebase — things that have caused bugs or confusion before and are worth knowing before you start any work.

- **The vault is the source of truth, always.** In-memory state in the UI is derived from the vault on load. If you are tempted to update UI state without going through the API and disk, stop — the next reload will revert your change and leave users confused.

- **Frontmatter is fragile if touched by multiple writers simultaneously.** `savePage()` and `savePageComments()` both read-modify-write the frontmatter. They are not transactional. If an AI agent edits the body and the user resolves a comment at the same moment, one write will overwrite the other. This is an accepted limitation for now. Don't introduce any new read-modify-write patterns on frontmatter without thinking about this.

- **Path IDs are mutable.** Because the `id` of a notebook, section, or page is its vault-relative path, renaming anything invalidates all cached references to it. If you store a page path anywhere (local state, a setting, a bookmark), that path will break on rename. The UI handles this by reloading the tree after mutations.

- **`content` field naming is inconsistent.** The vault tree returns pages with a `content` field (the full Markdown body). The page PUT API also uses `content` for the body. But `VaultPageDocument` (server-side) calls it `body`. These two naming conventions coexist. When in doubt: `content` in API payloads, `body` in internal server types.

- **The app has no authentication.** It is designed to run on a private home network (LAN or Tailscale). Do not add features that assume authentication exists, and do not expose the server to the public internet without adding auth first.

- **Socket.IO multi-tab sync is best-effort.** The `file_updated` event emitted after AI edits is not acknowledged or retried. If a client misses it (e.g., the page isn't open, or Socket.IO drops the event), they'll see stale content until they manually reload. Do not build any feature that requires guaranteed delivery of Socket.IO events.

---

## 14. Ink Notes (Drawing Surface)

**Plain English:** An ink note is a separate note type — a blank drawing canvas rather than a text document. You create one from the "New ink note" option in any section's context menu. Opening an ink note shows a Tldraw drawing surface instead of the rich-text editor. Your drawing is saved automatically as you work. You can always get back to the rest of the app via the overlay toolbar at the top of the canvas. You can toggle a graph-paper style grid background from the toolbar, and the preference persists across sessions. Pasting a screenshot or image into the canvas creates a canvas image object you can annotate with ink on the same surface.

**Design decision (v1):** Ink is note-first, not PDF-first, and not inline ink over flowing rich text. An ink note is its own page with its own file; it is not a layer on top of a text page.

### Component tree

`InkCanvas` (`src/components/ink-canvas.tsx`) is the React component that hosts Tldraw. It is mounted by `notebook-shell-reliable.tsx` in place of the rich-text editor when the open page's `noteType` field is `"ink"`. The note type is determined at page-creation time from the `note_type` frontmatter field and flows through `VaultPageSummary → VaultPage → ApiPageDocument` to the shell. Text notes are unaffected — the routing is purely additive.

Tldraw 5.x is embedded using its default `<Tldraw>` component with `components={{ PageMenu: null, Grid: InkGridLines }}` (or without `Grid` in blank mode). The `Grid` key in the `components` prop is Tldraw's extension point for a custom canvas background component — it receives `{ x, y, z, size }` (camera position, zoom, and document grid size) and is rendered behind all canvas shapes. The canvas container uses `position: relative / absolute inset-0` rather than a flex-stretch approach to guarantee Tldraw receives a concrete bounding box immediately, which is required for its responsive toolbar breakpoint detection to work on mobile.

### Grid background

`InkGridLines` (defined in `ink-canvas.tsx`) is the custom Tldraw `Grid` component. It renders an SVG with two layered SVG patterns:
- Minor grid lines every 5 grid units (`size * z * 5` screen pixels), at 15% opacity.
- Major grid lines every 25 grid units (`size * z * 25` screen pixels), at 28% opacity.

Phase offsets are computed from the camera position: `gxo = ((0.5 + x * z) % majorS + majorS) % majorS`, which keeps the grid anchored to world coordinates as the user pans. The SVG uses `className="tl-grid"` to inherit Tldraw's built-in grid positioning (absolute, full-canvas, pointer-events: none, z-index behind shapes).

The `components` prop object must be stable across re-renders. Two constant objects are defined at module scope: `COMPONENTS_GRID = { PageMenu: null, Grid: InkGridLines }` and `COMPONENTS_BLANK = { PageMenu: null }`. The active one is selected based on `backgroundMode` state and passed to `<Tldraw>`. This avoids re-creating the object on every render, which would cause Tldraw to remount the canvas.

### Persistence model

**Scene persistence:** When an ink note is opened, `InkCanvas` calls `GET /api/ink?path=…`. The response returns `{ scene, backgroundMode }`. The scene snapshot is passed to Tldraw via the `snapshot` prop; `backgroundMode` initialises React state. On every user-originated change to the Tldraw store (`source: "user", scope: "document"`), a 1200 ms debounced save fires `PUT /api/ink` with `{ scene, backgroundMode }`. The sidecar is written atomically by `saveInkScene` in `src/server/vault/pages.ts`.

**Background mode persistence:** `backgroundMode` (`"blank" | "grid"`) is stored in the `inkMeta.backgroundMode` field of the `.ink.json` sidecar. When the toggle button is clicked, `saveNow()` fires an immediate (non-debounced) save to guarantee the preference is persisted even if the user closes the note before any drawing occurs. Tldraw's internal `isGridMode` instance state is also kept in sync via `editor.updateInstanceState({ isGridMode: ... })` so TLDraw renders the correct state.

**Sidecar format (v2):**
```json
{
  "scene": { "document": {...}, "session": {...} },
  "inkMeta": { "backgroundMode": "blank" }
}
```
Migration: old sidecars (pre-SN-28) stored the raw Tldraw snapshot at the top level (identifiable by a `document` key at the root). `parseInkSidecar()` in `pages.ts` detects this and wraps it transparently, defaulting `backgroundMode` to `"blank"`.

**Image paste:** Tldraw handles image paste natively using its built-in `inlineBase64AssetStore`. Pasted screenshots and images are stored as base64 data URLs inside the Tldraw document store and are included verbatim in `editor.getSnapshot()`. This means pasted images persist automatically in the `.ink.json` sidecar and reload correctly on next open — no custom asset handling is required. Ink drawn after pasting appears on top of the image because Tldraw stacks shapes in creation order by default.

### App-chrome overlay

Because Tldraw occupies the full content area, an overlay toolbar is rendered above the canvas (not on top of it — it is in the flex column, not absolutely positioned over Tldraw). The overlay shows: a hamburger button that opens the sidebar, a `PenLine` icon, the note title, a save-status badge, and a `Grid2X2` toggle button that switches between blank and grid background modes. The toggle button shows a highlighted active state (`bg-primary/10 text-primary`) when grid mode is on and has an `aria-pressed` attribute for accessibility.

### Visual differentiation in the sidebar

Ink pages are shown with a `PenLine` icon in indigo (`text-indigo-600` light / `text-indigo-400` dark) and an indigo-tinted title in the page tree. Text pages show a muted `FileText` icon. This lets users distinguish note types at a glance without relying on naming.

### Lessons Learned

- **`overflow: hidden` on the Tldraw wrapper clips absolutely-positioned toolbar elements.** Tldraw has `contain: strict` (which includes paint containment), so adding `overflow: hidden` on the outer wrapper is redundant and harmful. The ink canvas container must not set `overflow: hidden`.
- **Tldraw's responsive toolbar requires a concrete height before first render.** Using `flex-1 min-h-0` alone can produce a momentary `height: 0` during the flex resolution pass, causing Tldraw's ResizeObserver to fire its "small screen" breakpoint and hide the main tool palette. The fix is to wrap Tldraw in `absolute inset-0` inside a `relative flex-1` container so it always has a defined bounding box.
- **The `components` prop to `<Tldraw>` must be referentially stable.** Passing a new object literal on every render causes Tldraw to fully remount the canvas, losing editor state and causing a visible flash. Always define component objects outside the render function or with `useMemo`. This is why `COMPONENTS_GRID` and `COMPONENTS_BLANK` are module-level constants.
- **Grid toggle requires an immediate save, not just a debounced one.** The autosave listener only fires on `source: "user", scope: "document"` changes (shape edits). Toggling the background mode is a preference change that doesn't touch the document, so it won't trigger the debounced autosave. The toggle handler calls `saveNow()` which fires an immediate, non-debounced save.
- **Image assets are stored as base64 in the Tldraw snapshot.** TLDraw uses `inlineBase64AssetStore` by default, meaning pasted images become base64 data URLs embedded in the `document.store` object. This makes the `.ink.json` sidecar larger but self-contained — no separate asset files are needed for ink note images.

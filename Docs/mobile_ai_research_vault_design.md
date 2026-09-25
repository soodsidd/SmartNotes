# Mobile AI Research Vault — Comprehensive Design Document

## 1. Product Summary

The Mobile AI Research Vault is a self-hosted, mobile-first research notebook designed for an AI-agent workflow. It runs on a local mini PC, is accessed from phones and tablets through a private network such as Tailscale, and stores research notes as durable local files rather than trapped chat histories or frozen OneNote pages.

The central goal is to combine four capabilities that are usually separated across tools:

1. Fast mobile capture of text, links, screenshots, pictures, and pasted chatbot output.
2. Technical note rendering, including Markdown and LaTeX-style equations.
3. Stylus/freehand annotation from an Android tablet.
4. AI-agent continuation, where Codex or another agent can reopen, edit, expand, reorganize, and export the notes.

The app is not intended to clone OneNote. OneNote is a very broad canvas notebook. This product is narrower: a living AI-readable research vault with an attached visual annotation layer.

The guiding principle is:

> Text knowledge should remain AI-editable. Visual thinking should remain human-friendly. Exports can combine both later.

## 2. Problem Statement

The user currently performs research in several modes:

- Traditional focused research in OneNote, including clipping, notes, screenshots, handwritten annotations, and categorized sections.
- AI-chatbot research, often from a phone, where the chatbot generates explanations, comparisons, summaries, derivations, and design ideas.
- Local agent workflows, where AI agents such as Codex can edit files on a local machine.
- Tablet-based handwritten/stylus annotation.

The problem is that these modes do not fit together well.

Chatbot conversations are alive while the conversation is open, but become difficult to search, classify, extend, or annotate later. OneNote preserves notes and annotations, but once chatbot output is pasted into OneNote, it becomes mostly inert. It is good for human reading and annotation, but weak as an agent-editable knowledge base.

The desired product should preserve the strengths of both:

- The note should be persistent, organized, searchable, and annotatable.
- The note should remain readable and editable by AI agents.
- The user should be able to continue researching from a note days or weeks later.
- The user should be able to use a phone or Android tablet as the primary interface.
- The user should be able to use the mini PC as the local compute/server environment.

## 3. Target User and Use Cases

### 3.1 Primary User

The primary user is a technical researcher/engineer who uses AI chatbots and local agents for research, design, software development, optics, engineering, Tesla notes, gardening, DIY, and other technical/personal topics. The user frequently works from a phone and wants to reduce dependency on sitting at a desktop PC.

### 3.2 Primary Devices

- iPhone or phone browser for quick capture, reading, search, and AI follow-up.
- Android tablet with stylus for annotation, sketches, and visual markup.
- Mini PC at home for hosting the app, storing notes, running local services, and invoking AI agents.
- Desktop/laptop optionally for advanced maintenance, Git review, or bulk editing.

### 3.3 Core Use Cases

#### Use Case A: Save ChatGPT Research to Living Note

The user has a useful AI conversation. Instead of pasting a frozen note into OneNote, the user opens the Research Vault, creates or opens a topic note, pastes the answer, and saves it. Equations render correctly. Later, the user can ask the app or an agent to continue from that note.

#### Use Case B: Phone Capture

The user finds a useful link, article, image, screenshot, or chatbot output on the phone. The user shares or pastes it into the Research Vault inbox. The app stores the content, creates metadata, and optionally summarizes it.

#### Use Case C: Tablet Annotation

The user opens a research note on an Android tablet. The note text renders on one pane. The annotation canvas opens beside it or over an attached image. The user draws arrows, sketches, highlights, and writes freehand notes using a stylus.

#### Use Case D: Ask AI About Current Note

The user opens a note and asks:

- “Continue this note.”
- “Explain the derivation in section 2.”
- “Challenge this conclusion.”
- “Add a numerical example.”
- “Turn this into a polished LaTeX reference.”
- “Merge this with my previous note on slanted-edge MTF.”

The AI reads the Markdown source and returns an answer. The user can append the answer, rewrite a section, create a linked note, or export.

#### Use Case E: Agent Maintenance

Codex or another local agent can access the vault folder and perform controlled changes:

- Reorganize notes.
- Add indexes.
- Convert notes to LaTeX/PDF.
- Search for related notes.
- Extract action items.
- Create summaries.
- Clean duplicate notes.
- Refactor file structure.

## 4. Product Principles

### 4.1 Files First

The source of truth should be plain files, not an opaque database. Markdown should be the primary note format. Attachments and annotations should live beside the note.

### 4.2 AI-Readable Source

The Markdown file should remain readable and modifiable by AI agents without requiring them to parse a proprietary binary format.

### 4.3 Visual Layer Separate from Text Layer

Freehand drawings, stylus annotations, and canvas objects should be stored separately from the Markdown source. This prevents visual artifacts from corrupting the text source and avoids the problem where AI rewrites text and breaks ink anchors.

### 4.4 Mobile First

The UI should be designed first for phone and tablet. Desktop should be supported but not assumed.

### 4.5 Capture Must Be Frictionless

The app must make it very easy to capture pasted content, images, screenshots, and links. The capture flow should be faster than manually organizing notes perfectly.

### 4.6 Review Before Destructive AI Edits

AI should not silently rewrite important notes. The user should be able to preview diffs or accept/reject changes.

### 4.7 Local and Private by Default

The app is intended to run locally, accessed over Tailscale or LAN. It should not require public internet exposure.

## 5. Recommended Technical Stack

### 5.1 Overall Stack

Recommended first implementation:

- Frontend: React + Next.js, mobile-first PWA
- Backend: Node/Express or FastAPI
- Storage: local file system + SQLite metadata index
- Note format: Markdown with YAML front matter
- Math rendering: KaTeX
- Rich editor: Tiptap or Milkdown
- Annotation canvas: tldraw
- AI integration: local agent bridge to Codex CLI / ChatGPT CLI / OpenAI API
- Access: Tailscale-only plus local authentication
- Versioning: Git repository over vault folder

### 5.2 Why This Stack

React/Next.js makes it straightforward to create a PWA and integrate tldraw, Tiptap, and KaTeX. A local backend is needed for file operations, asset storage, AI command execution, search indexing, and future exports.

The note source should be Markdown because it is portable, readable, diffable, and easy for AI agents to edit. Markdown with LaTeX math is sufficient for most living technical notes.

For math, KaTeX is preferred over MathJax for speed and local app responsiveness. It can render inline and block equations from LaTeX-like syntax.

For annotations, tldraw is recommended because it already supports stylus/freehand drawing, shapes, images, arrows, text, and persistence snapshots.

## 6. Architecture Overview

### 6.1 High-Level Architecture

```text
Phone / Android Tablet Browser
        |
        | Tailscale / LAN HTTPS
        v
Mobile Research Vault PWA
        |
        | REST / WebSocket API
        v
Local Backend on Mini PC
        |
        +--> Markdown Vault Files
        +--> Asset Folders
        +--> Annotation JSON Files
        +--> SQLite Metadata/Search Index
        +--> Git Version History
        +--> AI Agent Bridge
```

### 6.2 Component Responsibilities

#### Frontend

The frontend provides:

- Mobile-first note browser.
- Inbox capture view.
- Markdown editor/viewer.
- Equation rendering.
- tldraw annotation canvas.
- Ask-AI panel.
- Diff/review interface.
- Link/image paste handling.
- PWA installation and offline shell behavior.

#### Backend

The backend provides:

- File read/write APIs.
- Asset upload and retrieval.
- Annotation snapshot save/load.
- Metadata index.
- Search.
- AI-agent invocation.
- Export pipeline.
- Authentication/session handling.
- Git commit/diff integration.

#### Vault

The vault is a folder on disk, ideally inside a Git repository. It contains Markdown notes, metadata, assets, and annotation snapshots.

#### AI Agent Bridge

The AI bridge safely passes selected context to an AI model or local agent and applies changes only after approval.

## 7. Data Model

### 7.1 Folder Layout

Recommended layout:

```text
research-vault/
  inbox/
    2026-04-27-capture-001.md
    2026-04-27-capture-001.assets/
    2026-04-27-capture-001.annotations.json

  optics/
    kohler-illumination.md
    kohler-illumination.assets/
    kohler-illumination.annotations.json

    slanted-edge-mtf.md
    slanted-edge-mtf.assets/
    slanted-edge-mtf.annotations.json

  ai/
    agent-workflows.md
    embeddings-ranking.md

  tesla/
    fsd-notes.md
    charging.md

  gardening/
  diy/
  indexes/
    tag-index.md
    recent-notes.md

  .vault/
    config.json
    search-index.sqlite
    ai-prompts/
    templates/
```

### 7.2 Markdown Note Format

Each note should begin with YAML front matter:

```markdown
---
id: note_20260427_kohler_illumination
title: Kohler Illumination
created: 2026-04-27T09:30:00-07:00
updated: 2026-04-27T09:45:00-07:00
type: research-note
status: living
tags:
  - optics
  - microscopy
  - illumination
aliases:
  - Kohler setup
source:
  kind: ai-chat
  app: ChatGPT
related:
  - slanted-edge-mtf.md
---

# Kohler Illumination

## Summary

...

## Key Equations

The diffraction-limited resolution is approximately:

$$
\Delta x \approx \frac{0.61\lambda}{NA}
$$

## Open Questions

- ...
```

### 7.3 Annotation File Format

The annotation file should be JSON. If using tldraw, store a tldraw snapshot or document/session split.

Example conceptual structure:

```json
{
  "noteId": "note_20260427_kohler_illumination",
  "version": 1,
  "canvasType": "tldraw",
  "document": {},
  "session": {},
  "lastModified": "2026-04-27T09:45:00-07:00"
}
```

The exact tldraw structure should follow the tldraw snapshot APIs.

### 7.4 Assets Folder

Images, screenshots, PDFs, and other pasted files should live in an adjacent `.assets` folder.

Example:

```text
kohler-illumination.assets/
  pasted-image-001.png
  screenshot-led-die.png
  ray-diagram.svg
  source-article.pdf
```

Markdown can reference assets using relative paths:

```markdown
![LED die screenshot](kohler-illumination.assets/screenshot-led-die.png)
```

### 7.5 SQLite Metadata Index

SQLite should not be the source of truth for note content. It should index metadata for performance.

Suggested tables:

```sql
notes(
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  status TEXT,
  type TEXT,
  summary TEXT
);

tags(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

note_tags(
  note_id TEXT,
  tag_id INTEGER,
  PRIMARY KEY(note_id, tag_id)
);

assets(
  id TEXT PRIMARY KEY,
  note_id TEXT,
  path TEXT NOT NULL,
  mime_type TEXT,
  created_at TEXT
);

links(
  id TEXT PRIMARY KEY,
  note_id TEXT,
  url TEXT NOT NULL,
  title TEXT,
  captured_at TEXT
);

ai_runs(
  id TEXT PRIMARY KEY,
  note_id TEXT,
  prompt TEXT,
  model TEXT,
  created_at TEXT,
  status TEXT,
  diff_path TEXT
);
```

## 8. User Interface Design

### 8.1 Main Navigation

The app should have a simple bottom navigation on mobile:

```text
Inbox | Notes | Search | Ask | Settings
```

On tablet, use a two-pane or three-pane layout:

```text
Sidebar / Note List | Note View/Edit | AI / Annotation Panel
```

### 8.2 Phone Mode

Phone mode should focus on:

- Fast capture.
- Reading.
- Search.
- Ask AI.
- Append answer.
- Light editing.

Phone mode should avoid complex canvas interactions.

Primary phone screens:

1. Inbox
2. Note reader
3. Quick capture
4. Ask AI
5. Search results

### 8.3 Tablet Mode

Tablet mode should support:

- Full editing.
- Split view.
- Stylus annotation.
- Image markup.
- Drag/drop style organization if desired.

Primary tablet layouts:

#### Layout A: Note + AI

```text
[ Markdown note / rendered note ]
[ Ask AI panel ]
```

#### Layout B: Note + Canvas

```text
[ Markdown note ]
[ tldraw annotation canvas ]
```

#### Layout C: Image/PDF Annotation

```text
[ selected image or PDF page ]
[ stylus annotation layer ]
```

### 8.4 Capture UX

The capture screen should have a large input area and prominent actions:

```text
Paste text, link, image, or screenshot here

Actions:
- Save to Inbox
- Append to Existing Note
- Create New Note
- Ask AI to Summarize First
- Extract Links
```

The user should be able to paste:

- ChatGPT text.
- Markdown.
- Rich text.
- URLs.
- Images from clipboard.
- Screenshots.
- Plain text notes.
- PDF files if supported later.

### 8.5 Note View Modes

Each note should support three modes:

1. Read mode: rendered Markdown + equations.
2. Edit mode: Markdown or WYSIWYG-ish editing.
3. Annotate mode: attached tldraw canvas.

The app should not require the user to see raw Markdown all the time, but raw Markdown should always be accessible.

## 9. Editor Design

### 9.1 Editor Requirements

The editor must support:

- Headings.
- Lists.
- Code blocks.
- Tables if feasible.
- Links.
- Images.
- Pasted images.
- Inline math.
- Block math.
- Markdown source export.
- Mobile editing.
- Undo/redo.
- Minimal formatting toolbar.

### 9.2 Candidate Editors

#### Option A: Tiptap

Pros:

- Flexible ProseMirror-based editor.
- Rich extension ecosystem.
- Mathematics extension using KaTeX.
- Good for custom product UI.
- Supports paste rules and custom nodes.

Cons:

- Markdown round-trip can be more complex.
- Markdown extension has historically been less central than HTML/JSON document models.
- More custom engineering may be needed.

#### Option B: Milkdown / Crepe

Pros:

- Markdown-first orientation.
- Built on ProseMirror and remark.
- Pleasant WYSIWYG Markdown editing style.
- Potentially faster to build a Markdown-native note editor.

Cons:

- Less flexible than a deeply customized Tiptap setup.
- Need to verify mobile behavior and image upload pipeline during prototyping.

### 9.3 Recommendation

Prototype both quickly, but bias toward:

- Milkdown/Crepe if the main goal is a nice Markdown-native editor.
- Tiptap if the main goal is a highly customized long-term product.

For this product, the recommended first choice is:

> Tiptap if the developer is comfortable handling Markdown serialization; otherwise Milkdown/Crepe for faster Markdown-native progress.

## 10. Math Rendering

### 10.1 Requirements

The app must render equations such as:

```markdown
Inline math: $NA = n\sin\theta$

Block math:

$$
\Delta x \approx \frac{0.61\lambda}{NA}
$$
```

### 10.2 KaTeX

KaTeX should be used for rendering because it is fast and suitable for a local web app. It supports many common LaTeX math functions. It also has an auto-render extension that scans text nodes and renders math delimited by configured syntax.

### 10.3 Error Handling

Math rendering should not break the page if the equation is invalid. Configure KaTeX with `throwOnError: false` where available.

Invalid math should show:

- A visible warning.
- The raw source.
- A tap-to-edit option.

### 10.4 Copy Behavior

Rendered equations should preserve copyable source when possible. If using KaTeX copy-tex extension or equivalent behavior, copying a rendered equation should copy its LaTeX source.

## 11. Stylus and Annotation Design

### 11.1 Annotation Philosophy

The app should not attempt full OneNote-style ink over flowing text in the first version. That creates fragile anchoring problems when Markdown reflows or AI edits the text.

Instead, first implement:

1. Per-note canvas.
2. Image-specific annotation.
3. Optional anchored note cards later.

### 11.2 tldraw Canvas

Each note gets an attached tldraw canvas. The canvas can contain:

- Freehand ink.
- Arrows.
- Shapes.
- Text labels.
- Pasted images.
- Screenshots.
- Diagrams.
- Future custom objects.

The canvas should be saved as a JSON snapshot beside the Markdown note.

### 11.3 Stylus Input

The app should rely on browser Pointer Events and tldraw’s built-in pen/stylus support where possible. The browser event model can distinguish mouse, touch, and pen input and can expose pressure/tilt values depending on device support. tldraw’s draw shape supports pressure-sensitive input from pens/styluses and variable-width strokes.

### 11.4 Palm Rejection

Palm rejection is partly handled by the browser/device and partly by app interaction design. The app should include:

- A pen mode toggle.
- Optional touch-to-pan / pen-to-draw behavior.
- Optional “finger draws” setting.
- Large UI controls to avoid accidental touches.
- Clear separation between scrollable note and canvas.

### 11.5 Annotation Storage

Annotations should not be embedded directly inside Markdown. They should be stored in:

```text
note-name.annotations.json
```

For image-specific annotation, store either:

```text
image-name.annotations.json
```

or include image objects in the note-level tldraw canvas.

### 11.6 Annotation Modes

Version 1 should support:

- Open canvas.
- Draw.
- Erase.
- Select/move.
- Add arrow.
- Add text.
- Paste image.
- Save automatically.

Version 2 may support:

- Highlight rendered text.
- Anchor a sketch to a section heading.
- OCR handwritten notes.
- Convert sketch labels into Markdown.
- Ask AI about image/annotation content.

## 12. Clipboard, Paste, and Link Capture

### 12.1 Paste Handling

The app should support clipboard paste into the capture screen and note editor.

Supported paste types:

- Plain text.
- HTML/rich text.
- Markdown text.
- URLs.
- Images.
- Screenshots.

### 12.2 Image Paste Behavior

When an image is pasted:

1. Save image to the note’s `.assets` folder.
2. Insert Markdown image reference into note, or add image to the tldraw canvas depending on current mode.
3. Generate a stable filename.

Example:

```text
pasted-20260427-093012.png
```

### 12.3 Link Capture Behavior

When a URL is pasted:

1. Detect URL.
2. Create Markdown link.
3. Optionally fetch title/metadata if allowed.
4. Optionally create a link card.

Example Markdown:

```markdown
[Article title](https://example.com)

Captured: 2026-04-27
Notes:
- ...
```

### 12.4 Share Sheet

Long-term, support mobile share targets if feasible:

- Android Web Share Target API for PWA.
- iOS behavior may be more limited and should be tested.

For MVP, paste-based capture is sufficient.

## 13. AI Integration

### 13.1 AI Interaction Model

The AI should work on explicit note context. The user opens a note and asks a question. The app packages:

- Note Markdown.
- Selected section if any.
- Front matter metadata.
- Related note references if selected.
- Optional asset metadata.
- User prompt.

The AI returns one of several response types:

1. Plain answer.
2. Suggested append.
3. Suggested rewrite of selected section.
4. New linked note.
5. Structured patch/diff.
6. Export request.

### 13.2 AI Modes

#### Ask Mode

AI answers without modifying files.

#### Append Mode

AI appends a new section to the current note.

#### Rewrite Mode

AI proposes a replacement for a selected section.

#### New Note Mode

AI creates a new related note and adds a backlink.

#### Maintenance Mode

AI reorganizes, indexes, or refactors multiple notes.

### 13.3 Review Before Apply

All AI edits should be reviewable.

For simple append, the user can tap:

```text
Append to Note
```

For rewrites, show a diff:

```text
Original | Proposed
Accept | Reject | Edit
```

For multi-file changes, use Git diff or a built-in review screen.

### 13.4 AI Bridge Implementation

The backend should expose endpoints such as:

```http
POST /api/ai/ask-note
POST /api/ai/append-note
POST /api/ai/rewrite-section
POST /api/ai/create-linked-note
POST /api/ai/export
```

Internally, it can call:

- OpenAI API.
- ChatGPT CLI if available.
- Codex CLI for file editing tasks.
- Local models later.

### 13.5 Agent Safety

Agents should not have unrestricted write access without a review mechanism. Recommended safeguards:

- Run AI edits on a temporary branch or staging folder.
- Require user approval before applying patches.
- Commit accepted changes to Git.
- Keep logs of prompts and outputs.
- Restrict accessible directories to the vault and app project.

## 14. Search and Retrieval

### 14.1 Basic Search

MVP should include:

- Title search.
- Full-text search over Markdown.
- Tag search.
- Recent notes.
- Inbox.

SQLite FTS5 is a good local option.

### 14.2 Semantic Search

Version 2 should add embeddings:

- Chunk Markdown notes by heading.
- Embed chunks.
- Store vectors in a local vector index or SQLite extension if suitable.
- Provide “related notes.”
- Use semantic retrieval for Ask-AI context.

### 14.3 Search Result UX

Search results should show:

- Note title.
- Section snippet.
- Tags.
- Updated date.
- Quick actions:
  - Open.
  - Ask AI.
  - Append capture here.
  - Add to related notes.

## 15. Export System

### 15.1 Export Targets

The app should eventually export to:

- Markdown bundle.
- Standalone HTML.
- LaTeX.
- PDF.
- OneNote-compatible pasted HTML or manual copy.
- ZIP archive with assets.

### 15.2 HTML Export

Standalone HTML export should include:

- Rendered Markdown.
- Embedded or linked CSS.
- Rendered math using KaTeX or MathJax.
- Relative or embedded images.
- Optional exported canvas as SVG/PNG.

### 15.3 PDF Export

PDF export can be implemented using:

- Browser print-to-PDF.
- Playwright/Puppeteer.
- Pandoc pipeline.
- LaTeX pipeline for formal technical documents.

### 15.4 LaTeX Export

Important mature notes can be converted to LaTeX with:

- Sections.
- Equations.
- Figures.
- References.
- Appendices.

This should be an AI-assisted export, not the live source format.

## 16. Version Control

### 16.1 Git Repository

The vault should be a Git repository.

Each accepted AI edit can create a commit:

```text
git add optics/kohler-illumination.md
git add optics/kohler-illumination.annotations.json
git commit -m "Update Kohler illumination note"
```

### 16.2 Why Git Matters

Git provides:

- Agent edit safety.
- Rollback.
- History.
- Diff review.
- Backup compatibility.
- Future branching workflows.

### 16.3 Commit Strategy

For MVP:

- Auto-save files frequently.
- Manual “snapshot commit” button.
- Auto-commit after accepted AI edits.

For later:

- Background commits every N minutes.
- Branch per major AI maintenance operation.
- Visual change history.

## 17. Security Model

### 17.1 Access

The app should be accessible only over:

- Tailscale.
- LAN.
- Optional localhost.

Avoid public exposure through open ports unless there is a strong reason.

### 17.2 Authentication

Even with Tailscale, add app-level auth:

- Password or passkey.
- Session timeout.
- Optional PIN for mobile.
- Optional hardware key later.

### 17.3 AI Agent Permissions

The AI bridge should enforce:

- Vault-root sandbox.
- No arbitrary shell by default.
- Allowlist for commands.
- Separate modes for read-only and write-capable operations.
- Clear review before file changes.

### 17.4 Secrets

API keys should be stored outside the vault:

```text
~/.config/research-vault/secrets.env
```

Never commit secrets to Git.

### 17.5 Browser Clipboard Permissions

Clipboard access should be user-initiated and handled carefully. The app should not poll the clipboard.

## 18. Performance Requirements

### 18.1 Mobile Performance

The app should load quickly on phones and tablets.

Targets:

- Initial shell load: under 2 seconds on LAN/Tailscale after warm cache.
- Open small note: under 500 ms.
- Open large note: under 2 seconds.
- Canvas load: under 2 seconds for ordinary annotation files.
- Search: under 1 second for typical vault.

### 18.2 Large Notes

Large notes should remain usable. If a note becomes too large, the app can suggest splitting it by heading.

### 18.3 Assets

Images should be stored as files, not base64 blobs inside Markdown. Generate thumbnails for note previews later.

## 19. Offline and Sync Behavior

### 19.1 MVP

MVP can require connection to the mini PC. It does not need full offline editing.

### 19.2 PWA Shell

The app can cache frontend assets so the UI loads even if the backend is momentarily unavailable, but note data requires backend connection.

### 19.3 Future Offline Mode

Future versions could support:

- Local browser cache of recent notes.
- Offline capture queue.
- Sync on reconnect.
- Conflict detection.

This should not be part of MVP unless necessary.

## 20. Roadmap

### Phase 0: Spike / Feasibility

Goal: prove the risky components.

Tasks:

1. Create React/Next.js PWA shell.
2. Test Android tablet stylus in browser.
3. Integrate tldraw and save/load a snapshot.
4. Integrate editor prototype.
5. Render Markdown and equations.
6. Paste image into editor and save to backend.
7. Access over Tailscale from phone/tablet.

Exit criteria:

- Can open app on Android tablet.
- Can paste text and image.
- Can render equation.
- Can draw with stylus.
- Can save and reload note + canvas.

### Phase 1: Core MVP

Goal: usable personal research vault.

Features:

1. Vault folder initialization.
2. Create/open/edit Markdown notes.
3. YAML front matter.
4. Inbox capture.
5. Paste images and links.
6. Render equations.
7. Per-note tldraw canvas.
8. Save/load annotations.
9. Basic full-text search.
10. Ask-AI about current note.
11. Append AI answer to note.
12. Git commit after accepted AI changes.
13. Authentication.

Exit criteria:

- User can conduct real research from phone/tablet.
- Notes are stored as Markdown.
- Annotations persist.
- AI can continue from notes.

### Phase 2: Better AI Workflows

Features:

1. Section selection.
2. Rewrite selected section.
3. Diff review UI.
4. Create linked note.
5. Related note suggestions.
6. AI-generated summaries.
7. AI maintenance tasks.
8. Export to HTML/PDF.

### Phase 3: Advanced Research System

Features:

1. Semantic search.
2. Embeddings.
3. PDF ingestion.
4. OCR/image summarization.
5. OneNote export helper.
6. Markdown-to-LaTeX reference generator.
7. Canvas-to-image export.
8. Voice capture.
9. Offline capture.
10. Topic maps.

## 21. MVP Detailed Functional Requirements

### 21.1 Notes

- User can create a new note.
- User can rename a note.
- User can move a note between folders.
- User can edit Markdown content.
- User can view rendered Markdown.
- User can see equations rendered.
- User can search notes.
- User can delete or archive notes.

### 21.2 Inbox

- User can create quick capture.
- User can paste text.
- User can paste link.
- User can paste image.
- User can later move inbox item to a folder.
- User can ask AI to clean up capture into a research note.

### 21.3 Assets

- Pasted images save to assets folder.
- Assets use stable filenames.
- Images appear in rendered note.
- User can delete unused assets later.

### 21.4 Annotation

- User can open annotation canvas for a note.
- User can draw using stylus.
- User can erase.
- User can add arrow/shape/text.
- Canvas autosaves.
- Canvas reloads correctly.
- User can insert pasted image into canvas.

### 21.5 AI

- User can ask AI about current note.
- User can include whole note or selected section.
- User can append AI output.
- User can create new linked note from AI output.
- User can review before rewrite.
- App logs AI run metadata.

### 21.6 Search

- User can search by title.
- User can search full text.
- User can filter by tag.
- User can open result.

## 22. Non-Functional Requirements

### 22.1 Reliability

- Avoid data loss.
- Autosave text and canvas.
- Keep backup snapshots.
- Use Git commits.

### 22.2 Maintainability

- Simple file structure.
- Avoid premature distributed sync.
- Keep backend API small.
- Write tests for file operations.

### 22.3 Portability

- Notes remain useful even if app dies.
- Markdown files can be opened in VS Code, Obsidian, or any text editor.
- Assets are normal files.
- Annotations are JSON snapshots.

### 22.4 Privacy

- Local-first by default.
- No cloud sync unless explicitly added.
- API keys and AI logs handled carefully.

## 23. API Sketch

### 23.1 Notes

```http
GET /api/notes
POST /api/notes
GET /api/notes/:id
PUT /api/notes/:id
DELETE /api/notes/:id
POST /api/notes/:id/move
```

### 23.2 Assets

```http
POST /api/notes/:id/assets
GET /api/notes/:id/assets/:assetName
DELETE /api/notes/:id/assets/:assetName
```

### 23.3 Annotations

```http
GET /api/notes/:id/annotations
PUT /api/notes/:id/annotations
```

### 23.4 Search

```http
GET /api/search?q=...
GET /api/tags
GET /api/tags/:tag/notes
```

### 23.5 AI

```http
POST /api/ai/ask-note
POST /api/ai/append-note
POST /api/ai/rewrite-section
POST /api/ai/create-linked-note
POST /api/ai/export
```

### 23.6 Git

```http
GET /api/git/status
POST /api/git/commit
GET /api/git/diff
POST /api/git/revert
```

## 24. Suggested Prompt Templates

### 24.1 Ask Note

```text
You are helping maintain a technical research note.

User question:
{{userPrompt}}

Current note:
{{noteMarkdown}}

Answer the question using the note as context. Do not modify the note unless explicitly asked.
```

### 24.2 Append to Note

```text
You are updating a living research note.

User request:
{{userPrompt}}

Current note:
{{noteMarkdown}}

Create a Markdown section to append to the note. Preserve technical detail. Use LaTeX math where helpful. Include open questions and next actions if relevant.
```

### 24.3 Rewrite Section

```text
You are editing one section of a Markdown research note.

User request:
{{userPrompt}}

Full note context:
{{noteMarkdown}}

Selected section to rewrite:
{{selectedSection}}

Return only the replacement Markdown for the selected section. Preserve equations and technical rigor.
```

### 24.4 Create Linked Note

```text
Create a new standalone Markdown research note from the following context.

User request:
{{userPrompt}}

Source note:
{{noteTitle}}
{{noteMarkdown}}

The new note should include YAML front matter, a clear title, summary, technical content, links back to the source note, open questions, and next actions.
```

## 25. Risks and Mitigations

### Risk 1: Building Too Much

Mitigation: Do not clone OneNote. Start with Markdown note + attached tldraw canvas.

### Risk 2: Inline Annotations Break When Text Reflows

Mitigation: Avoid drawing directly over flowing Markdown in MVP. Use side-by-side canvas and image-specific annotations.

### Risk 3: Mobile Editing Feels Bad

Mitigation: Make phone mode capture/read/ask oriented. Put heavy editing and stylus annotation on tablet.

### Risk 4: AI Agents Damage Files

Mitigation: Require diff review and Git commits. Restrict agent write access.

### Risk 5: Markdown WYSIWYG Round-Trip Problems

Mitigation: Prototype Tiptap vs Milkdown early. Keep raw Markdown editing available.

### Risk 6: Math Rendering Edge Cases

Mitigation: Use KaTeX with non-throwing error mode. Store raw LaTeX source. Allow edit-on-tap.

### Risk 7: Search Gets Slow

Mitigation: Use SQLite FTS5 index. Keep file content as source of truth.

## 26. Initial Implementation Plan for Codex

### Step 1: Create App Skeleton

- Create Next.js app.
- Add mobile-first layout.
- Add backend API route layer or separate server.
- Add basic authentication stub.
- Add vault config.

### Step 2: Implement Vault File Operations

- Initialize vault folder.
- Create note.
- Read note.
- Update note.
- List notes.
- Parse front matter.
- Store updated timestamps.

### Step 3: Add Markdown Rendering and Math

- Render Markdown.
- Render inline and block math.
- Add error handling for invalid math.

### Step 4: Add Editor

- Integrate chosen editor.
- Save Markdown.
- Add toolbar.
- Test mobile editing.

### Step 5: Add Paste Capture

- Capture plain text.
- Capture URL.
- Capture image.
- Save image to assets.
- Insert image reference.

### Step 6: Add tldraw Annotation Canvas

- Add per-note annotation tab.
- Save/load snapshot.
- Test stylus.
- Add autosave debounce.

### Step 7: Add Search

- Build SQLite metadata index.
- Add full-text search.
- Add tag filters.

### Step 8: Add AI Ask/Append

- Add Ask panel.
- Send note context to AI.
- Show answer.
- Append answer to note.
- Create Git commit after accepted append.

### Step 9: Add Diff Review

- For rewrites, show before/after.
- Accept/reject changes.
- Commit accepted changes.

### Step 10: Polish Mobile UX

- Add PWA manifest.
- Add responsive tablet layout.
- Add large touch targets.
- Add autosave indicators.
- Add error toasts.

## 27. Recommended MVP Scope

The MVP should include only this:

```text
- Local PWA over Tailscale
- Markdown file vault
- Create/open/edit/search notes
- Paste text, links, images
- Render equations
- Per-note tldraw canvas
- Stylus drawing on Android tablet
- Ask AI about current note
- Append AI answer to note
- Git-backed history
```

Everything else should wait.

## 28. References

- tldraw draw shape and stylus support: https://tldraw.dev/sdk-features/draw-shape
- tldraw persistence: https://tldraw.dev/docs/persistence
- tldraw snapshots: https://tldraw.dev/examples/snapshots
- Tiptap mathematics extension: https://tiptap.dev/docs/editor/extensions/nodes/mathematics
- KaTeX auto-render extension: https://katex.org/docs/autorender.html
- KaTeX supported functions: https://katex.org/docs/supported.html
- MDN Pointer Events: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- Milkdown getting started: https://milkdown.dev/docs/guide/getting-started

## 29. Final Product Definition

The product is:

> A local, mobile-first AI research notebook that stores research as Markdown files, renders equations, captures pasted media and links, attaches stylus annotation canvases, and lets AI agents continue, rewrite, organize, and export the notes over time.

The most important architectural decision is to keep Markdown as the living source of truth and stylus annotations as a separate attached visual layer. This avoids the frozen-note problem of OneNote while preserving the visual annotation workflow that makes OneNote useful.

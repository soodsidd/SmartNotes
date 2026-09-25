# Smart Notes — Product Requirements Document

**Version:** 1.3  
**Date:** 2026-05-23  
**Status:** Active — Working Draft  
**Owner:** Owner  

---

## 1. Product Vision

Smart Notes is a **local-first, cross-platform AI research notebook** — a full replacement for OneNote with deep AI integration.

It solves a specific problem: OneNote preserves notes but makes them inert. An AI agent cannot continue work from a OneNote page without friction, equations don't render, and the content is locked in a proprietary format.

Smart Notes keeps research **alive**. Notes are plain Markdown files — readable by humans, editable by AI agents, renderable with full math, and annotatable with stylus. The AI is not a bolt-on chatbot; it is a first-class collaborator that can read, extend, rewrite, and reorganize notes over time.

**One-sentence definition:**

> A local, cross-platform AI research notebook that stores notes as Markdown, renders equations, supports file attachments, has stylus annotation, and lets AI agents continue, rewrite, organize, and export notes — running on your own hardware, accessible from any device.

---

## 2. Target User

**Primary persona:** A technical researcher and engineer who uses AI tools heavily for research, design, and problem-solving across domains — optics, software, engineering, personal projects. Uses all device types throughout the day. Runs a local mini PC at home as the server.

**Devices — all first-class:**

| Device | Primary use |
|---|---|
| Desktop / laptop | Primary authoring, complex editing, agent operations |
| iPhone | Capture, read, search, ask AI, light edit |
| Android tablet (stylus) | Annotation, canvas, structured editing |
| Mini PC (server) | Hosts the app, runs local AI agents, stores vault |

**Access model:** App runs on the mini PC, accessed from all devices over Tailscale or LAN. Not publicly exposed.

---

## 3. Core Use Cases

### UC-1: Save AI Research to a Living Note
User has a useful AI conversation. Instead of it disappearing, they paste the output into Smart Notes. Equations render. The note stays AI-editable — days later, the user can ask the app to continue from exactly where they left off.

### UC-2: Fast Capture (Any Device)
User finds a link, article, screenshot, or chatbot output on any device. They paste it into the app's capture flow. Content is saved immediately — no manual organization required.

### UC-3: Ask AI About a Note
User opens a note and asks: "Continue this derivation", "Add a numerical example", "Challenge this conclusion." The AI reads the Markdown source and returns an answer. User can append it, rewrite a section, or create a new linked note.

### UC-4: Tablet Annotation
User opens a research note on their Android tablet. They annotate with a stylus — arrows, sketches, highlights, freehand notes — on a canvas attached to the note. The ink layer is stored separately so AI edits to the text never break the annotations.

### UC-5: Agent Maintenance
A local AI agent (Codex, Claude, etc.) can access the vault folder and perform controlled operations: reorganize notes, add indexes, extract action items, create summaries, convert notes to LaTeX/PDF. All changes go through a diff review before being committed.

### UC-6: Desktop Power Authoring
User sits at their desk and writes a long, structured technical document — multi-section, with embedded code, equations, tables, and file attachments. They use the full three-pane layout with the AI rail open, asking for help drafting, calculating, and expanding as they write.

---

## 4. Product Principles

1. **Files first.** Markdown is the source of truth. No opaque database owns the notes. Notes must be openable in any text editor even if the app dies.

2. **AI-readable source.** The Markdown format must remain directly parseable and editable by AI agents without proprietary parsing.

3. **Visual layer separate.** Stylus annotations and canvas objects are stored in a sidecar `.annotations.json` file, never embedded in Markdown. AI can rewrite text without breaking ink.

4. **Cross-platform parity.** Desktop, tablet, and phone are all first-class. The app must be fully functional on each form factor — not a degraded mobile companion. The layout adapts; the capability does not.

5. **Capture is frictionless.** Pasting content — text, images, links, files — must be faster than organizing it. Organization is a later step.

6. **Review before AI edits.** AI should not silently rewrite important notes. User sees a diff and approves before changes are committed.

7. **Local and private by default.** No cloud sync unless explicitly added. API keys and AI logs handled carefully. Vault stays on the user's own hardware.

---

## 5. OneNote Feature Parity Target

This section defines the complete feature set Smart Notes must eventually reach to fully replace OneNote. Items are marked by phase.

### 5.1 Organization
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Notebooks | ✓ | ✓ | 0 |
| Sections | ✓ | ✓ | 0 |
| Pages | ✓ | ✓ | 0 |
| Section Groups (sub-grouping within a notebook) | ✓ | Planned | 3 |
| Subpages (pages nested under pages) | ✓ | Planned | 3 |
| Page templates | ✓ | Planned | 3 |
| Password-protected sections | ✓ | Out of scope | — |

### 5.2 Content
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Rich text (headings, bold, italic, etc.) | ✓ | ✓ | 0 |
| Ordered and unordered lists | ✓ | ✓ | 0 |
| Task/checkbox lists | ✓ | ✓ | 0 |
| Tables | ✓ | ✓ | 0 |
| Inline code + code blocks | ✓ | ✓ | 0 |
| Inline images (paste/embed) | ✓ | ✓ | 0 |
| Math equations (KaTeX) | ✗ | ✓ | 0 |
| Markdown source round-trip | ✗ | ✓ | 0 |
| File attachments (PDF, DOCX, etc.) | ✓ | Planned | 2 |
| Audio recording | ✓ | Planned | 5 |
| Video embedding | ✓ | Planned | 5 |
| Printout (embed rendered PDF of a doc) | ✓ | Out of scope | — |
| OCR on pasted images | ✓ | Planned | 5 |
| Web clip from URL | ✓ | ✓ (Capture screen) | 1 |

### 5.3 Navigation & Discovery
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Full-text search | ✓ | Planned | 3 |
| Tag system | ✓ | ✓ (YAML front matter) | 0 |
| Tag filter UI | ✓ | Planned | 3 |
| Recent pages | ✓ | Planned | 1 |
| Note linking (wikilinks or explicit refs) | ✓ | Planned | 3 |
| Table of contents (auto-generate) | ✓ | Planned | 5 |
| Related notes (semantic) | ✗ | Planned | 5 |

### 5.4 Editing & Formatting
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Undo/redo | ✓ | ✓ | 0 |
| Drag-and-drop images | ✓ | Planned | 2 |
| Paste image from clipboard | ✓ | ✓ | 0 |
| Resizable images | ✓ | Planned | 2 |
| Highlight text (background color) | ✓ | Planned | 2 |
| Text color | ✓ | Planned | 2 |
| Horizontal rule | ✓ | Planned | 2 |
| Collapsible sections | ✓ | Planned | 3 |

### 5.5 Annotation & Drawing
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Freehand ink (stylus) | ✓ | Planned (tldraw) | 4 |
| Shape drawing | ✓ | Planned (tldraw) | 4 |
| Eraser | ✓ | Planned (tldraw) | 4 |
| Ink colors / stroke width | ✓ | Planned (tldraw) | 4 |
| Draw over text content | ✓ | Planned | 4 |
| Palm rejection | ✓ | Planned | 4 |
| Lasso select / move ink | ✓ | Planned (tldraw) | 4 |
| Pressure-sensitive strokes | ✓ | Planned | 4 |
| Convert ink to text (OCR) | ✓ | Out of scope | — |

### 5.6 Export & Integration
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Markdown export | ✗ | ✓ | 0 |
| HTML export | ✓ | Planned | 5 |
| PDF export | ✓ | Planned | 5 |
| LaTeX export | ✗ | Planned | 5 |
| Print | ✓ | Planned | 5 |
| Email a note | ✓ | Out of scope | — |
| Share link | ✗ | Out of scope | — |

### 5.7 AI (Beyond OneNote)
| Feature | OneNote | Smart Notes | Phase |
|---|---|---|---|
| Ask AI about current note | ✗ | Planned | 2 |
| AI append / continue | ✗ | Planned | 2 |
| AI section rewrite with diff review | ✗ | Planned | 2 |
| Agent vault maintenance | ✗ | Planned | 5 |
| Semantic search / related notes | ✗ | Planned | 5 |
| AI-generated summaries | ✗ | Planned | 2 |

---

## 6. Information Architecture

### 6.1 Hierarchy

```
Notebook
  └── Section Group (optional grouping)
        └── Section
              └── Page (.md file)
                    ├── Subpage (.md file, nested)
                    ├── Page.assets/       (images, file attachments)
                    └── Page.annotations.json  (tldraw canvas)
```

Four levels: Notebooks → [Section Groups] → Sections → Pages. The Section Group level is optional — notebooks with few sections don't need it.

### 6.2 Page Metadata (YAML Front Matter)

Every page carries:

```yaml
---
title: Page Title
created: 2026-04-27T09:30:00Z
updated: 2026-04-27T09:45:00Z
tags: [optics, research]
status: living          # living | archived | draft
source:
  kind: ai-chat         # ai-chat | manual | capture | agent
  app: Claude
related:
  - path/to/other-note.md
template: false         # or template name string
---
```

### 6.3 Asset Storage

Images, files, and pasted media live in a folder adjacent to the page file:

```
Page.assets/
  pasted-20260427-093012.png
  screenshot-led-die.png
  reference-paper.pdf
  data.xlsx
```

Markdown references assets via relative paths. Assets are normal files — no database required.

---

## 7. Navigation & Layout Model

The app uses **context-aware responsive navigation** that adapts across breakpoints without degrading capability.

### 7.1 Desktop Layout (1024px+) — Primary Layout

Three-pane layout. All three panes are simultaneously visible and usable.

```
┌──────────────────┬─────────────────────────────┬─────────────────┐
│  Notebook/Section│  Editor / Reader             │  AI Chat Panel  │
│  /Page tree      │                              │  (collapsible)  │
│  (collapsible to │                              │                 │
│   icon rail)     │                              │                 │
│                  │                              │                 │
└──────────────────┴─────────────────────────────┴─────────────────┘
```

- Left rail: Full notebook/section/page tree. Collapsible to a narrow icon strip.
- Center: Tiptap editor with full formatting toolbar above.
- Right rail: AI chat panel. Collapsible. Shows diff review in-place when AI proposes edits.
- Top bar: App name, current note path, search, settings.

### 7.2 Tablet Layout (768px–1023px)

Two-pane by default. Tree and editor visible simultaneously.

```
┌──────────────────┬─────────────────────────────────────────┐
│  Page list       │  Page editor / reader                   │
│  (collapsible)   │                                         │
│                  │                                [AI rail]│
└──────────────────┴─────────────────────────────────────────┘
```

Three-pane when AI rail is open:

```
┌──────────────────┬────────────────────────┬────────────────┐
│  Page list       │  Page editor / reader  │  AI panel      │
└──────────────────┴────────────────────────┴────────────────┘
```

Annotation mode replaces the editor pane with the tldraw canvas.

### 7.3 Phone Navigation (< 768px)

Full-screen stack navigation. One screen at a time.

```
Home (Notebooks list)
  └── Sections list
        └── Pages list
              └── Page view / editor
                    └── AI panel (bottom sheet)
                    └── Annotation canvas (full-screen modal)
```

**Bottom tab bar** (persistent on phone):
- **Notes** — browse notebooks/sections/pages
- **Capture** — fast paste / quick note
- **Search** — full-text + tag search
- **AI** — context-aware AI panel for current note

---

## 8. Screen Inventory

### Screen 1 — Notebooks Home

**Purpose:** Entry point. Shows all notebooks and recent activity.

**Desktop:** Rendered as the tree left rail. Recent pages appear as a "Recents" section at the top of the tree.

**Phone:** Full-screen list.

**Content:**
- App name / logo
- Search bar (top)
- "Recent pages" strip — last 5 accessed pages, tappable
- Notebook list — notebook name, color indicator, page count, last updated
- "New notebook" action

**Actions:**
- Tap/click notebook → opens sections
- Tap/click recent page → opens page directly
- Tap/click search → goes to Search

---

### Screen 2 — Sections List

**Purpose:** Show sections (and optional section groups) within a notebook.

**Desktop:** Left rail shows sections inline under the notebook node.

**Phone:** Full-screen list, back button to notebooks.

**Content:**
- Notebook name (title)
- Section groups (if any) as expandable groups
- Section list — section name, page count, last updated
- "New section" action

**Actions:**
- Tap/click section → opens pages list
- Long press / right-click → rename, delete, move, add to group

---

### Screen 3 — Pages List

**Purpose:** Show pages within a section. Including subpages.

**Desktop:** Left rail shows pages inline. Subpages indented under parent.

**Phone:** Full-screen list, back button to sections.

**Content:**
- Section name (title)
- Page list — page title, last updated, first-line preview
- Subpages indented under their parent
- "New page" FAB (bottom right on phone; + button on desktop)

**Actions:**
- Tap/click page → opens page view
- Long press / right-click → rename, delete, move, create subpage

---

### Screen 4 — Page View / Editor

**Purpose:** Read and edit a note. Primary working screen. Full parity across all devices.

**Layout modes:**
- **Read mode** (default): rendered Markdown + equations, scroll
- **Edit mode**: Tiptap editor, formatting toolbar

**Desktop:**
- Edit mode is the default. No mode toggle required — cursor placement enters edit mode.
- Full formatting toolbar (ribbon style) above editor.
- Autosave indicator in status bar.

**Phone:**
- Read mode default, explicit edit toggle.
- Minimal formatting toolbar docked above keyboard in edit mode.
- Floating actions in read mode: Edit, Ask AI, Annotate.

**Top bar (all devices):**
- Back button / breadcrumb path
- Page title (editable inline)
- Overflow menu: Move, Delete, Export, Copy link, Version history

**Content:**
- Page title (large, editable)
- Last updated timestamp + breadcrumb path
- Rendered Markdown body with KaTeX equations
- Embedded images and file attachment thumbnails
- Inline task checkboxes (interactive)

**Notes:**
- Autosave after 1.2s idle — no manual save button
- iOS input font size ≥ 16px to prevent auto-zoom
- Tapping a rendered equation in read mode shows raw LaTeX source
- File attachments displayed as downloadable chips (filename, size, icon)

---

### Screen 5 — AI Panel

**Purpose:** Ask the AI about the current note. First-class feature.

**Desktop:** Right rail (collapsible). Always accessible while editing.

**Tablet:** Collapsible right rail. Opens as overlay if screen too narrow.

**Phone:** Bottom sheet (slides up ~80% of screen height), triggered by floating AI button or AI tab.

**Content:**
- Context indicator: "Discussing: [Page Title]"
- Conversation thread (multi-turn, persists per page per session)
- Input bar: text field + send
- Context options: "Use whole note", "Use selected text", "Include related notes"

**AI response actions (per response):**
- **Append to note** — adds AI response as a new section at bottom
- **Rewrite section** — triggers diff review flow (Screen 7)
- **Create new note** — creates a linked note from the response
- **Copy** — copies response to clipboard

**AI modes:**
- Ask (default) — AI answers, does not modify note
- Continue — AI suggests next section to append
- Summarize — AI summarizes the note
- Critique — AI challenges the note's conclusions or logic

---

### Screen 6 — Capture

**Purpose:** Fast capture of pasted content from any device — text, links, screenshots, AI output.

**Phone:** Dedicated tab in bottom nav.

**Desktop:** Accessible via keyboard shortcut (Ctrl/Cmd+Shift+V) as a modal or sidebar panel.

**Content:**
- Large paste area ("Paste text, a link, or an image here")
- Auto-detects type: plain text / URL / image / file
- URL: fetches title and preview automatically
- Image: shows thumbnail preview
- File: shows file name and type

**Actions after paste:**
- **Save to Inbox** — saves to special "Inbox" section
- **Append to…** — page picker to append to existing note
- **New note** — creates page from captured content
- **Ask AI first** — summarizes before saving

**Inbox section:** A special section at the root of each notebook. Captured pages can be organized later.

---

### Screen 7 — AI Diff Review

**Purpose:** Review AI-proposed edits before applying.

**Desktop:** Opens as a split panel within the editor pane — current text left, proposed right.

**Phone:** Full-screen modal.

**Content:**
- Header: "Review changes to [Page Title]"
- Before / After diff with colored highlighting (red removed, green added)
- Affected section label

**Actions:**
- **Accept** — applies change, autosaves, triggers Git commit
- **Reject** — discards proposed change
- **Edit before accepting** — opens proposed text in editable field

---

### Screen 8 — Search

**Purpose:** Find any note by title, full text, tag, or content.

**Desktop:** Accessible via search bar top-right or Ctrl/Cmd+K command palette.

**Phone:** Dedicated tab in bottom nav.

**Content:**
- Search input (autofocused)
- Recent searches
- Filter chips: All / By tag / Recent / AI-generated / Attachments

**Results:**
- Note title, section path, matching snippet (highlighted), last updated

**Actions:**
- Click/tap → opens page
- Swipe (phone) / right-click (desktop) → Ask AI about this note

---

### Screen 9 — Annotation Canvas

**Purpose:** Stylus/freehand annotation per note. Tablet-primary; accessible on all devices.

**Trigger:** Annotate button on page view (desktop and phone). Tablet: replaces editor pane.

**Layout:**
- Full-screen (phone) or full editor pane (desktop/tablet) tldraw canvas
- Toolbar: Draw / Erase / Select / Arrow / Text / Image / Undo / Redo / Color / Stroke width
- Close button → returns to page view (changes autosaved)
- "Show note content" toggle → renders note text as faint background layer for drawing over

**Behavior:**
- Canvas is per-note (stored as `.annotations.json`)
- Pen mode / touch mode toggle (palm rejection)
- Stylus uses browser Pointer Events (pressure-sensitive where supported)
- Canvas data never embedded in Markdown

---

### Screen 10 — Settings

**Content:**
- Vault path (currently configured)
- Default notebook for new captures
- AI provider settings (API key, model selection)
- Theme (light / dark / system)
- Keyboard shortcuts reference (desktop)
- About / version

---

## 9. Desktop-Specific Requirements

These apply only at 1024px+ and have no mobile equivalent.

### Keyboard Shortcuts (Required)
| Action | Shortcut |
|---|---|
| New page | Ctrl/Cmd+N |
| New notebook | Ctrl/Cmd+Shift+N |
| Search | Ctrl/Cmd+K or Ctrl/Cmd+F |
| Quick capture | Ctrl/Cmd+Shift+V |
| Toggle AI panel | Ctrl/Cmd+Shift+A |
| Save (manual) | Ctrl/Cmd+S (triggers autosave immediately) |
| Bold | Ctrl/Cmd+B |
| Italic | Ctrl/Cmd+I |
| Undo | Ctrl/Cmd+Z |
| Redo | Ctrl/Cmd+Shift+Z |

### Desktop Toolbar (Full Ribbon)
Full Tiptap formatting ribbon: Heading levels, Bold, Italic, Strikethrough, Code, Code block, Link, Image, Table, Ordered list, Unordered list, Task list, Block quote, Horizontal rule, Highlight, Text color, Alignment, Math block.

### Context Menus
Right-click on tree nodes: rename, delete, move, create subpage, set color.
Right-click on content: standard text edit menu + "Ask AI about selection."

---

## 10. AI Integration Model

### 10.1 Context Sent to AI

Every AI request packages:
- Current page's full Markdown body
- YAML front matter (title, tags, status)
- Selected text or section (if user has selected)
- Related note references (opt-in)
- User's prompt

### 10.2 AI Response Types

| Response type | User action |
|---|---|
| Plain answer | Read, copy, or append to note |
| Append suggestion | One-tap append → autosave → Git commit |
| Section rewrite | Diff review → Accept / Reject / Edit |
| New linked note | Review title/path → Create |
| Maintenance output | Multi-file diff → Accept / Reject |

### 10.3 Ink-Aware AI Actions (Phase 4)

When the user is in drawing mode and makes a lasso selection over ink strokes, the AI sidebar switches to ink-context mode and offers:

| Action | Description |
|---|---|
| Recognize as math | Convert handwritten equation to LaTeX and insert as `$$...$$ ` block |
| Convert to text | Run handwriting recognition, replace strokes with inline text |
| Tidy diagram | Straighten and align geometric shapes in selection |
| Solve for variable | AI solves equation numerically given context from the note |
| Explain in margin | AI writes an annotation block adjacent to the selected ink |

AI proactively interprets selected ink and shows its reading (e.g., "recognized: N = (L/a)·tan θ, confidence 96%") before the user asks. The user can confirm, ask follow-up, or dismiss.

### 10.4 AI Safety

- All file modifications require user approval — no silent writes
- Accepted AI edits trigger an automatic Git commit: `AI: [action] [page title]`
- AI session logs stored in vault metadata
- Agent write access sandboxed to vault root

---

## 11. Editor Requirements

**Framework:** Tiptap (retained)

**Required capabilities:**
- Headings (H1–H3)
- Bold, italic, strikethrough, code (inline)
- Code blocks (fenced, with language)
- Ordered and unordered lists
- Task lists (checkboxes)
- Tables (with row/column add/delete)
- Links
- Inline images (paste or file pick)
- File attachment chips
- Inline math: `$...$`
- Block math: `$$...$$`
- Highlight (background color)
- Text color
- Horizontal rule
- Block quote
- Collapsible sections (Phase 3)
- Undo / redo
- Markdown source round-trip

**Mobile editor requirements:**
- Font size ≥ 16px in all inputs (prevents iOS auto-zoom)
- Formatting toolbar docked above keyboard, not fixed at top of screen
- Minimal toolbar on phone: Bold, Italic, H1/H2, Code, Link, Image only
- Full toolbar on desktop and tablet

**Math rendering:**
- KaTeX (already integrated)
- `throwOnError: false` — invalid math shows raw source with warning
- Tapping/clicking rendered equation reveals raw LaTeX

---

## 12. Styling & Component Framework

**Decision:** Migrate from custom CSS to **Tailwind CSS + shadcn/ui**.

**Rationale:**
- Current `globals.css` has no responsive breakpoints below 768px
- Fixed-pixel grid layout (280px + 1fr + 360px) breaks on phones
- No touch target standards — current buttons are 22–28px; need 44×44px on touch
- Tailwind is mobile-first by design; responsive behavior is built in
- shadcn/ui provides pre-built accessible components covering all required patterns

**Components sourced from shadcn/ui (planned):**
- `Sheet` — AI panel on mobile (bottom sheet)
- `NavigationMenu` — bottom tab bar (phone)
- `Dialog` — diff review modal, rename prompts
- `DropdownMenu` — right-click context menus
- `Popover` — formatting toolbar popovers
- `Toast` — autosave / error notifications
- `Command` — Ctrl+K search palette
- `Separator`, `Badge`, `Tooltip` — general UI

**Tiptap and tldraw are retained as-is.** The migration is a styling/layout migration, not an editor swap.

### 12.1 Design Package & Visual Direction

A rendered design package is located at `Design/Smart Notes.zip`. The tracked design-system reference used for implementation lives in `Docs/design-system/`.

**Selected direction: Direction A — Notebook Classic (light + dark).** This is the confirmed, locked visual identity for Smart Notes.

| Attribute | Value |
|---|---|
| Name | Notebook Classic |
| Background (light) | `#faf8f3` — warm neutral parchment |
| Background (dark) | `#16140f` — deep warm near-black |
| Body typeface | Newsreader (serif) |
| UI typeface | Inter |
| Accent color (light) | `oklch(0.55 0.13 35)` — rust orange-red |
| Accent color (dark) | `oklch(0.72 0.13 40)` — warm amber-rust |
| Character | Closest to a physical notebook; warm and legible; OneNote-adjacent feel without mimicking it |

Both light and dark variants are fully specified. The app ships with both; default follows OS preference. Direction A is the only design direction in scope — do not reference or implement Directions B or C.

### 12.2 Design Token System

The design package defines a complete token system (`design-tokens.jsx`). These become CSS custom properties and Tailwind config entries. All values listed below are for Direction A (light) — dark mode is a token swap, not a separate stylesheet.

**Color tokens:**

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#faf8f3` | `#16140f` | App background |
| `--panel` | `#ffffff` | `#1c1a14` | Cards, editor surface |
| `--rail` | `#f3efe7` | `#110f0b` | Tree + AI rail |
| `--ink` | `#1c1a17` | `#ece7dc` | Primary text |
| `--ink2` | `#5a544c` | `#a8a195` | Secondary text |
| `--ink3` | `#918a7e` | `#6f6a5f` | Muted / meta |
| `--line` | `#e6e0d4` | `#2a261f` | Borders, dividers |
| `--accent` | `oklch(0.55 0.13 35)` | `oklch(0.72 0.13 40)` | Buttons, links, ink lasso |
| `--accent-bg` | `oklch(0.95 0.04 70)` | `oklch(0.32 0.06 45)` | Soft fills, callouts |

Semantic: `living` green `oklch(0.65 0.15 145)`, diff-add green, diff-rem warm red, link blue, highlight warm yellow.

**Type scale:**

| Token | Family | Weight | Size | Use |
|---|---|---|---|---|
| `display.lg` | Newsreader | 600 | 34px / 1.15 | Page title (desktop) |
| `display.md` | Newsreader | 600 | 26px / 1.2 | Mobile title, focused mode |
| `heading` | Newsreader | 600 | 20px / 1.3 | Section headings inside notes |
| `body` | Newsreader | 400 | 16px / 1.72 | Reading text |
| `ui` | Inter | 500 | 13px / 1.45 | Buttons, tree, chips |
| `caption` | Inter | 400 | 11px / 1.4 | Timestamps, meta strips |
| `eyebrow` | Inter | 500 | 10px / 1.4 uppercase | Section labels, group dividers |
| `mono` | JetBrains Mono | 500 | 12px / 1.6 | Paths, keyboard shortcuts, code |
| `hand` | Caveat | 500 | 22px / 1.2 | Stylus / handwriting rendering |

**Spacing:** 4px base unit. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 56px.

**Radius:** xs=3px (chips), sm=6px (buttons), md=8px (cards/inputs), lg=10px (callouts), xl=12px (paper card, sheets), 2xl=16px (modals).

**Motion:** fast 120ms (hover), base 200ms (menus), slow 320ms (sheet/modal). Easing: `cubic-bezier(0.2, 0.7, 0.2, 1)`.

### 12.3 Key Layout Decisions from Design

These are already resolved by the design package and should not be re-opened during implementation:

- **Desktop three-pane proportions:** `252px | 1fr | 360px`. Tree rail 252px; AI sidebar 360px wide.
- **Top bar height:** 44px. Contains: app logo, breadcrumb path (`vault / Notebook / Section / Page.md` in mono), search bar (220px min-width, `⌘K` hint), save indicator chip, avatar.
- **Formatting ribbon height:** ~44px, below the top bar. Items: H1 H2 H3 | B I S | `</>` — Σ | • List 1. List ☐ Task | Table | 🔗 📎.
- **AI sidebar:** header (context label + model indicator) → context strip (token count, related count) → conversation area → mode buttons (Ask | Continue | Summarize | Critique) → input bar (attach + model chip + send).
- **Mobile bottom tabs (4):** Notes (notebook icon), Capture (plus), Search (search), AI (sparkle). Labels always visible. Floating AI FAB (56px, accent color, sparkle icon) persists on page view.
- **Mobile AI:** bottom sheet at ~78% screen height, drag handle, suggested prompt chips, conversation + input.
- **Page metadata strip:** tags as chips, "living" status dot, "updated X ago by AI", word count / reading time.
- **Diff review:** split horizontal (before left, after right) within the editor pane. Header bar: section affected, line count, rationale chip, Accept / Reject / Edit buttons.
- **Quick capture modal:** `⌘⇧V`, 680px wide, auto-detect content type, 4 destination options (Inbox, New note, Append to…, Ask AI first), tag strip at bottom.

---

## 13. Annotation / Drawing Library

**Current plan: tldraw**

tldraw is already referenced in this PRD. It is the right choice for the annotation canvas:
- React-native, well-maintained open source
- Handles shapes, freehand ink, arrows, text, selection, undo/redo, multi-layer
- Excellent stylus support via browser Pointer Events (pressure, tilt)
- Per-shape data model exports cleanly to JSON — storage is predictable
- Has palm rejection primitives (pen-only mode)

**Alternatives considered:**
- **Excalidraw** — hand-drawn aesthetic, good freehand. Less configurable embedding API than tldraw. Good alternative if a sketchpad feel is preferred over a diagramming feel.
- **Fabric.js** — lower-level canvas library. More control, far more code to write. Not recommended unless tldraw proves limiting.
- **Perfect Freehand** (Steve Ruiz) — the freehand stroke algorithm that powers tldraw. Could be used standalone for ink-only if a minimal custom canvas is desired. Low-level; tldraw is the full solution.

**Decision:** tldraw for the full annotation canvas. Revisit only if the embedding model proves incompatible with the per-note canvas architecture.

---

## 14. Performance Requirements

| Metric | Target |
|---|---|
| Initial shell load (warm cache, LAN) | < 2 seconds |
| Open small note (< 5KB) | < 500ms |
| Open large note (< 100KB) | < 2 seconds |
| Canvas load (typical annotation) | < 2 seconds |
| Search response | < 1 second |
| Autosave (after idle) | 1.2s debounce |

Images stored as files in `.assets/`, never as base64 in Markdown.

---

## 15. Non-Functional Requirements

### Reliability
- Autosave all text changes (1.2s debounce)
- Git-backed history — accepted AI edits auto-commit
- No data loss on navigation or crash
- File operations are atomic (write to temp, rename)

### Portability
- Notes are plain `.md` files — openable in VS Code, Obsidian, any text editor
- Assets are normal files
- Annotations are JSON snapshots
- App death does not lock the user out of their data

### Privacy
- Local-first by default — no cloud sync
- Tailscale / LAN access only
- API keys stored outside the vault, never committed to Git

### Accessibility
- Touch targets ≥ 44×44px on all interactive elements
- Sufficient color contrast (WCAG AA)
- Works in both light and dark mode
- Keyboard navigable (desktop)

---

## 16. Feature Roadmap

### Phase 0 — Complete ✓
Core vault working. Tiptap editor, Markdown rendering, KaTeX, autosave, image paste, tree navigation, chat widget docked right rail.

### Phase 1 — Cross-Platform Foundation (Current)
- Tailwind + shadcn/ui migration
- Responsive layout: phone stack nav + bottom tabs, tablet two-pane, desktop three-pane fully responsive
- Fix viewport meta tag, grid reflow, iOS input zoom
- 44px touch targets across all controls
- Keyboard shortcuts (desktop)
- Capture screen / Inbox section
- AI panel as bottom sheet on phone, right rail on desktop

### Phase 2 — Content Richness
- File attachments (upload, embed as chips, download)
- Drag-and-drop images
- Resizable images
- Highlight and text color in editor
- AI ask/append/rewrite endpoints
- Diff review screen
- Git auto-commit after accepted AI edits
- Section selection for AI context

### Phase 3 — Search, Organization & Linking
- SQLite FTS5 full-text search
- Tag filter UI
- Recent notes
- Note wikilinks (`[[Page title]]` syntax → resolves to page path)
- Section groups
- Subpages
- Collapsible sections in editor
- Page templates

### Phase 4 — Annotation Canvas
- tldraw per-note canvas
- Stylus support on Android tablet and iPad
- Palm rejection (pen mode toggle)
- Show note text as faint background layer
- Autosave canvas snapshots

### Phase 5 — Export, Audio & Advanced AI
- HTML export with embedded math
- PDF export (browser print / Pandoc)
- LaTeX export for technical notes
- Audio recording per note
- OCR on pasted images
- Semantic search (embeddings, related notes)
- AI vault maintenance (reorganize, index, summarize)
- Auto-generated table of contents

---

## 17. Out of Scope

The following are explicitly not in scope:

- Real-time multi-user collaboration
- Cloud sync or backup
- Public sharing / publishing
- Native iOS or Android app (PWA only)
- Voice input (Phase 5 only: audio recording, not voice-to-text)
- PDF ingestion / parsing
- Offline editing (PWA shell caches assets; note data requires server connection)
- Password-protected sections
- Email a note
- OneNote/Notion/Obsidian import (considered, not committed)

---

## 18. Open Questions

### Answered by Design Package (do not reopen)

0. ~~**Visual direction**~~ — **Resolved:** Direction A — Notebook Classic, light + dark. Directions B and C are not in scope.

1. ~~**Desktop ribbon vs. floating toolbar**~~ — **Resolved:** Fixed formatting ribbon on desktop. A floating selection toolbar on text selection may coexist.

3. ~~**Bottom tab labels and icons (phone)**~~ — **Resolved:** 4 tabs (Notes, Capture, Search, AI). Stroke icons from the design system (notebook, plus, search, sparkle). Labels always visible.

6. ~~**Annotation entry point**~~ — **Resolved:** "Draw" button in the formatting ribbon enters drawing mode inline; the ribbon swaps to the ink ribbon. No separate mode toggle overlay.

7. ~~**Capture on desktop**~~ — **Resolved:** `⌘⇧V` modal, 680px, centered with scrim.

### Still Open

**2. Section groups** — Does the left tree need section groups in Phase 1, or can it wait until Phase 3? Adds IA and tree-interaction complexity early.

**4. Notebook color system** — The design shows a small colored square (8×8px, rounded) as the notebook identifier in the tree. How many preset colors? Custom picker? Currently 7 suggested in the design token palette.

**5. AI panel conversation history** — Multi-turn conversation resets on page close (per design as shown), or persists per-page in vault metadata? Persistent history adds storage/API cost considerations but is significantly more useful for ongoing work on a note.

---

## Appendix A: Design Package

**Location:** `Docs/design-system/`

**Canonical direction:** `Direction A - Notebook Classic` only.

**Use for UI validation:** check `src/styles/tokens.css` for runtime tokens, this PRD for approved direction and product constraints, and `Docs/design-system/design-tokens.jsx` for the extracted token artboard.

**Files:**
| File | Contents |
|---|---|
| `README.md` | Validation guidance and canonical-source rules |
| `design-tokens.jsx` | Extracted token artboard for the approved Smart Notes direction |

The design package is the **authoritative visual specification** for the app. Where the PRD and the design package conflict, the design package governs — the PRD should be updated, not the design.

---

## Appendix B: Current API Surface

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/vault` | Full notebook/section/page tree |
| GET | `/api/page?path=` | Load page content + metadata |
| PUT | `/api/page?path=` | Save page content + title |
| DELETE | `/api/page?path=` | Delete page + assets |
| POST | `/api/create` | Create notebook / section / page |
| PUT | `/api/section?path=` | Rename section |
| DELETE | `/api/section?path=` | Delete section |
| POST | `/api/assets?path=` | Upload image asset |

AI endpoints (`/api/ai/*`) and search (`/api/search`) are defined in the design but not yet implemented.

---

*PRD v1.3 — Direction A (Notebook Classic, light + dark) confirmed; Directions B and C removed (May 23 2026)*

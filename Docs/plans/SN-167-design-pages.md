# SN-167 — Design pages: render + iterate UI artifacts in the vault

**Status:** implementation plan
**Risk:** medium · **Scope:** vault page type + render pipeline + companion prompt + stylus layer
**Project:** Smart Notes (`proj-mwb81k-mpiqp915`)

---

## Problem / goal

The owner does UI-engineering tweaks in Claude Design, then manually imports the
output into a target repo. The generic output has to be rewritten onto the
project's real components/tokens — that translation is the friction.

Smart Notes already owns every piece needed to close this loop **except one**:

- **Eyes** — `page_render` (`src/server/vault/page-render.ts`) loads a route in
  headless Chromium, composites the page, writes a PNG, and hands back
  `absoluteDiskPath` as a provider-agnostic vision handoff.
- **Hands** — companion vault tools `page_write` / `page_edit` /
  `page_replace_section` patch a page body precisely.
- **Runtime** — durable, resumable companion turns (SN-132).
- **Own-in-place** — portable notebooks (`src/server/vault/notebook-registry.ts`)
  map a vault path prefix to any absolute `rootPath`, so a notebook can point at
  a target project repo and its pages *are* files in that repo. This is the
  shared ground truth between the Smart Notes companion and the Ascent Vector
  harness — no export step.

**The one gap:** a vault page body renders through Tiptap
(`src/components/page-render-view.tsx:50` → `RichTextEditor`), which normalizes
HTML to its editor schema. Arbitrary UI markup + real CSS does **not** survive.
So there is no way to render a real UI artifact in the vault today.

This brief adds a **`note_type: "design"`** page whose body is a self-contained
HTML/CSS UI artifact rendered **raw** (bypassing Tiptap), captured at desktop and
mobile widths, editable by the companion, and annotatable with the stylus. That
turns the existing eyes/hands/runtime/own-in-place machinery into a working
design→iterate→land-as-diff loop.

Non-goal for this brief: live React-component rendering (needs a component-build
harness) and the multi-screen interactive board (separate placeholder brief).

## Key findings (from code)

- **Page-type precedent is strong.** Four `note_type`s already exist
  (`text`/`log`/`ink`/`jupyter`), each mapped in `noteTypeFromMetadata`
  (`src/server/vault/pages.ts:119`) and routed to a dedicated live view in the
  `note_type` switch at `src/components/notebook-shell-reliable.tsx:4069`
  (`LogPageView` / `JupyterNotebookView` / `InkCanvas` / else `EditorPanel`).
  `design` is the same move.
- **Render dispatch is a clean seam.** `src/server/vault/agent-commands.ts`
  dispatches `page.render → renderPageToPng` (`:790`) and
  `log.render → renderLogFormToPng` (`:836`). `renderLogFormToPng` is a near-copy
  of the page renderer pointed at a different route — `renderUiToPng` follows it.
- **Viewport is currently hardcoded** (`page-render.ts:89`,
  `viewport: { width: 1280 }`); trivially parameterized.
- **Ink is view-agnostic overlay + sidecar scene.** The render path already
  composites ink via `readAnnotationsScene` (`src/app/render/page/page.tsx:20`,
  passed to `PageRenderView`); live authoring uses `AnnotationLayer` with
  `flush` / `loadScene` / `exportInkOverlay` (wired around
  `notebook-shell-reliable.tsx:2260`, `:3731`, `:4125`).
- **Default companion prompt** is `DEFAULT_SYSTEM_PROMPT` in
  `server/agent-settings.js:6`; per-page "Recommended operations" are built in
  `src/lib/ai-sidebar.ts` (`:1099`); the tool catalog is
  `VAULT_TOOL_DEFINITIONS` / `formatVaultToolsPrompt` in
  `src/server/vault/agent-tools.ts`.

## Design

### 1. The `design` page type
- Add `"design"` to the `NoteType` union and `noteTypeFromMetadata`
  (`pages.ts`). Creation writes `note_type: "design"` frontmatter (existing
  `note_type !== "text"` write path at `pages.ts:1149`).
- Body = a self-contained HTML document (or fragment + injected token CSS). Same
  `.html` page file + frontmatter; no new storage format.

### 2. Raw render view (the only genuinely new rendering code)
- `src/components/ui-render-view.tsx`: render `bodyHtml` in an **isolated frame**
  (`iframe` with `srcDoc`), **not** `RichTextEditor`. Inject a configurable
  target-project token stylesheet (e.g. `av-theme` / project tokens) into the
  frame `<head>` so the artifact looks like — and ports to — the real app.
- Overlay `AnnotationLayer` (read-only, `previewSidecarJson`) above the frame,
  sized to the rendered frame height, mirroring `PageRenderView`. Emit
  `data-page-render-ready` / a `data-testid="ui-render-root"` for capture.
- `src/app/render/ui/page.tsx`: new route mirroring `src/app/render/log/page.tsx`
  (token-verify → `readPage` → `readAnnotationsScene` → `UiRenderView`).

### 3. Capture with viewport control
- `renderUiToPng` in `page-render.ts` (copy of `renderLogFormToPng`) pointed at
  `/render/ui`, gated on `note_type === "design"`.
- Add `viewportWidth?: number` to `PageRenderOptions`; presets **desktop 1280**,
  **mobile 390**. Set the Chromium viewport width from it instead of the
  hardcoded 1280. Keep the measured-clip capture approach (tldraw repaint makes
  `fullPage`/locator screenshots hang — see SN-122 notes).
- Dispatch case in `agent-commands.ts`; register the tool (name + `rr`-style
  alias) in `agent-tools.ts` so it appears in the catalog and
  `formatVaultToolsPrompt()`.

### 4. Live stylus/draw layer on design pages
- Add a `design` branch to the `note_type` switch
  (`notebook-shell-reliable.tsx:4069`) that renders the live UI frame with an
  **editable** `AnnotationLayer` overlay, wiring the same
  `annotationLayerRef` lifecycle used by text pages
  (`flush` on leave/save, `loadScene` on enter, `exportInkOverlay` for capture,
  save-status plumbing). Ink strokes persist to the page's annotation sidecar and
  are composited into `renderUiToPng` via the shared `readAnnotationsScene` path,
  so annotated screens appear in the PNG.
- Key subtlety: ink is anchored to the frame's fixed viewport height, not text
  reflow — size the drawable region from the rendered frame height
  (`drawableBottom` from the frame, akin to `INK_CAPTURE_VIEWPORT_HEIGHT`).

### 5. Companion system-prompt changes
- `DEFAULT_SYSTEM_PROMPT` (`server/agent-settings.js`): add a **Design pages**
  section — how to create a `note_type: design` page, that the body is raw
  HTML/CSS (edit with `page_write` / `page_edit`, not log-form tools), how to
  render at desktop/mobile via the ui render tool, and that stylus annotations
  from the owner are visible in the render for review.
- `src/lib/ai-sidebar.ts`: when the active page is a design page, surface
  design-page ops in the per-page "Recommended operations" block.
- Custom saved prompts stay unchanged (same policy as SN-145).

### 6. SAFE real-artifact test (acceptance-gating)
- Fixture: `C:/Projects/Safe/docs/design-system/Safe Switchgears Website (offline).html`
  (3.8 MB self-contained concept page with inline `<style>`).
- Test imports it as a `design` page body, runs `/render/ui` + `renderUiToPng` at
  desktop (1280) and mobile (390), and asserts: non-empty PNG, expected
  dimensions per viewport, and that faithful raw markup rendered (a marker only
  present when the raw HTML — not a Tiptap-normalized body — is shown). Add a
  second assertion that a seeded ink scene composites into the capture.
- Follow the repo Playwright harness (`npm run test:e2e:desktop` /
  `:mobile`); keep a unit test for `note_type=design` mapping and the
  `renderUiToPng` viewport param that does not require a live server.

## Files
- `src/server/vault/pages.ts` — `NoteType` + `noteTypeFromMetadata`.
- `src/components/ui-render-view.tsx` — new raw-HTML render view + ink overlay.
- `src/app/render/ui/page.tsx` — new render route.
- `src/server/vault/page-render.ts` — `renderUiToPng` + `viewportWidth`.
- `src/server/vault/agent-commands.ts` — dispatch case.
- `src/server/vault/agent-tools.ts` — tool definition + alias.
- `src/components/notebook-shell-reliable.tsx` — `design` live view + annotation
  lifecycle.
- `server/agent-settings.js` — `DEFAULT_SYSTEM_PROMPT` Design pages section.
- `src/lib/ai-sidebar.ts` — design-page recommended operations.
- `Docs/sysdoc/smart-notes.md` — document the type, route, tool, viewport,
  own-in-place, stylus support.
- Tests: SAFE render e2e + `note_type=design` / viewport unit coverage.

## Acceptance-criteria mapping

| AC | Mechanism |
|----|-----------|
| `note_type=design` end to end | `NoteType` + `noteTypeFromMetadata` + shell view switch |
| Raw HTML renders faithfully | `ui-render-view.tsx` iframe/`srcDoc`, bypasses `RichTextEditor`; token CSS injected |
| Render route + capture + viewport | `/render/ui` + `renderUiToPng` + `viewportWidth` presets; dispatch + tool reg |
| Own-in-place | portable notebook `rootPath` = target repo; `page_write`/`page_edit` round-trip |
| Stylus layer on design pages | editable `AnnotationLayer` in design view; composited via `readAnnotationsScene` |
| Companion knows how to use it | `DEFAULT_SYSTEM_PROMPT` + `ai-sidebar` recommended ops + tool catalog |
| SAFE artifact test | e2e imports the SAFE offline HTML, renders desktop+mobile, asserts faithful PNG + ink |
| Sysdoc | design-page section added |

## Out of scope
- Live React-component rendering against the real component library (needs a
  component-build harness) — the phase-3 escalation if HTML/CSS fidelity proves
  too limiting.
- Multi-screen interactive design board / contact-sheet render — separate
  placeholder brief (Brief 2).
- Realtime / per-stroke model calls.

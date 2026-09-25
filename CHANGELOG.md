# Changelog

## v0.7.0 — 2026-09-03

- **SN-252**: Jupyter inline AI: comment caret chips + append keybinding
- **SN-251**: Jupyter inline AI: Fix action must edit or no-op, not chat
- **SN-250**: Jupyter inline AI: include cell execution outputs in fast-lane context
- **SN-249**: Jupyter inline AI: selection overlay, action chips, and answer placement
- **SN-248**: Jupyter inline AI: cell content and selection bridge round trip
- **SN-247**: Jupyter inline AI: warm low-latency provider session
- **SN-246**: PDF reader: mobile toolbar overflow into ellipsis menu
- **SN-243**: PDF reader: landscape two-page spread view
- **SN-242**: PDF reader: large tap-zone page turning
- **SN-241**: PDF reader: performance mode (full-screen + keep-awake)
- **SN-239**: Jupyter bootstrap profile: pinned LSP deps + auto-configured autocomplete defaults
- **SN-235**: Settings UI for ingest destination allowlist (notebook picker, no env editing)
- **SN-234**: Ingest destination allowlist + catalog GET
- **SN-233**: Mobile: page TOC links fire on touch-down, so scrolling over the contents block navigates
- **SN-232**: Notebook picker organization: filter, key-notes lens, pins, groups, archive
- **SN-231**: Back-to-top chevron still too far from headings; mobile hit target hard to tap
- **SN-230**: Toggle page TOC from the format-bar control
- **SN-229**: Mark key notes with a gem icon in the notebook tree
- **SN-225**: PDF reader night mode (invert page pixels, keep annotations)
- **SN-223**: Companion spreadsheet tools INTERNAL_ERROR on image-heavy workbooks
- **SN-222**: Companion sandbox bridge can create pages (page_create)
- **SN-221**: Exit text editing via Escape and format-toolbar tap
- **SN-220**: Page TOC button with section jump, back-to-top, and ink remap
- **SN-218**: Companion sees PDF highlight text plus comments
- **SN-217**: Companion sees live JupyterLab file, active cell, and caret
- **SN-216**: Draw-mode ink strokes disappear during or after drawing
- **SN-215**: Guided setup: Cloudflare email ingress for Smart Notes
- **SN-214**: Spreadsheet reopen shows blank grid despite vault sidecar having cells
- **SN-212**: Implement Cloudflare email-to-Inbox ingestion
- **SN-209**: Companion can view and edit spreadsheet cells
- **SN-208**: Spreadsheet pages MVP (vault-native Syncfusion workbooks)
- **SN-207**: Syncfusion Community Spreadsheet setup on owner PC
- **SN-205**: Mini-app links can open Smart Notes pages
- **SN-203**: Companion <-> mini-app message channel (bidirectional, cross-page, auto-run)
- **SN-202**: Companion chat reliability upgrades (scope-shared threads, transcript binding, keep, background durability)
- **SN-200**: Companion vault inventory of App pages for reuse
- **SN-199**: Companion can see current PDF page and read just that page
- **SN-198**: PDF outline overlays content; support manual zoom entry
- **SN-197**: PDF reader companion settings unreachable under immersive shell fork
- **SN-194**: PDF reader: PWA re-download and slow reopen after leaving the reader
- **SN-193**: PDF reader: text is not selectable outside highlight mode
- **SN-172**: Remote PWA origin is incorrectly supplied to host-side companion vault tools
- **SN-166**: Expose Smart Notes /api/ingest via public path-scoped ingress (Tailscale Funnel or Cloudflare tunnel)
- **SN-161**: Companion/sidebar resize: smooth drag + over-PDF width control
- **SN-151**: PDF reader: reliable in-app first paint for large mobile PDFs
- **SN-148**: Large PDFs take too long to open; loading state has no progress
- **SN-142**: PDF reader outline/chapter navigation tree
- **SN-140**: Add camera capture option to image insert
- **SN-138**: PDF reader needs document navigation bar and direct page jump
- **SN-136**: PDF annotation and stylus sidecar layer
- **SN-135**: Immersive EmbedPDF attachment reader with remembered place
- **SN-114**: Companion reads page PDFs and Jupyter notebook cells
- **SN-66**: New notebook should not auto-create an Inbox section
- **SN-65**: AI system prompt should include current page content as context; Cursor loses vault tool instructions via prompt truncation
- **SN-64**: Persist notebook open/closed state across sessions and platforms
- **SN-62**: Default AI model and effort tier not set to highest-quality option per provider
- **SN-61**: Codex errors on first turn (web search config) and model picker list is incomplete
- **SN-60**: Print preview renders page heading twice
- **SN-59**: Inline images lack resize and alignment controls in rich text
- **SN-58**: Editor context menu shows redundant Add comment entry
- **SN-57**: PDF chip click opens preview and new tab simultaneously
- **SN-47**: AI companion blocks web search requests
- **SN-46**: AI companion sidebar resize capped too low — allow up to 80% viewport
- **SN-45**: AI provider model list incomplete — query providers instead of hardcoding
- **SN-44**: Notebook tree expands fully when adding new items
- **SN-20**: PDF attachment support — upload, drag-drop, chip, and preview pane

## v0.6.0 — 2026-08-06

- **SN-187**: Generalized focused App shortcut & per-page install (focus mode) for App pages
- **SN-183**: Replace Workout & Nutrition Log with a vault-native mini app
- **SN-182**: Vault-native mini-app runtime and shared companion templates
- **SN-181**: Companion prompt teaches History, historySuggestion, and open-history actions
- **SN-180**: Human-readable Log History tab with live, linkable views
- **SN-174**: Conditional form tabs render the wrong panel after hidden categories shift indexes
- **SN-170**: Log forms ignore JSON Schema defaults and can show uncommitted select values
- **SN-168**: Link and iterate a standalone bundled HTML design file in place
- **SN-167**: Design pages: render + iterate UI artifacts in the vault (note_type=design)
- **SN-163**: Log forms show contextual history suggestions with one-tap copy
- **SN-158**: Block equation editing opens top-of-page dialog instead of in-context editor
- **SN-157**: Child page creation fails silently — INVALID_PARENT rejects section-nested parents
- **SN-156**: Draw mode tablet: finger cannot scroll or zoom page
- **SN-154**: Scale ink annotation stroke weights down 25% across all size presets
- **SN-153**: Draw mode undo regression — toolbar button disabled and keyboard Ctrl+Z unreliable
- **SN-149**: Focused log shortcut: offline-tolerant submit outbox (no wipe on reconnect)
- **SN-147**: Companion queries bounded log data and authors saved history views
- **SN-46**: AI companion sidebar resize capped too low — allow up to 80% viewport

## v0.5.0 — 2026-07-23

- **SN-151**: PDF reader: reliable in-app first paint for large mobile PDFs
- **SN-148**: Large PDFs take too long to open; loading state has no progress
- **SN-145**: Companion get/put log form script, Form render, multi-image fields
- **SN-144**: Vault-native log page: schema, rows, Form|Table tabs
- **SN-139**: Desktop compact density and font scale pass
- **SN-138**: PDF reader needs document navigation bar and direct page jump
- **SN-136**: PDF annotation and stylus sidecar layer
- **SN-135**: Immersive EmbedPDF attachment reader with remembered place
- **SN-134**: Companion composer input lags after live-turn chat upgrade
- **SN-132**: Live companion turn is interrupted when switching pages
- **SN-130**: Add spellcheck toggle for text editor
- **SN-129**: Run embedded Jupyter notebooks from mobile/tablet PWA

## v0.4.0 — 2026-07-13

- **SN-122**: Page render command (rr) — full-res screenshot for companion vision
- **SN-123**: Extend ink canvas below text (OneNote-style page margin)
- **SN-128**: Draw mode touch input broken on mobile PWA (touch-action missing)

## v0.3.1 — 2026-07-09

- **SN-127**: DOCX export fails for pages with Unicode titles (em-dash)
- **SN-126**: Notebook-root page tree rows missing reorder handles and indent/outdent
- **SN-125**: Markdown paste renders garbled — convert AI Markdown to rich text on paste

## v0.3.0 — 2026-07-07

- **SN-120**: Print flow regression — restore direct print; move layout settings to Advanced modal
- **SN-115**: False note-updated-externally warning mid-typing causes content loss on reload
- **SN-114**: Companion reads page PDFs and Jupyter notebook cells
- **SN-113**: Zoom editor workspace with Ctrl/Cmd + scroll
- **SN-112**: Image resize handles no longer appear in page editor
- **SN-111**: Inline equation compose mode should start at caret (Word-style Alt+=)
- **SN-103**: Ingest pipeline foundation: /api/ingest + Reference (.ref.json) model + Inbox
- **SN-102**: Create and manage pages from any tree level
- **SN-101**: Embedded JupyterLab notebook type
- **SN-100**: Make remote notebook creation work from mobile PWA
- **SN-97**: Print layout settings (margins and spacing)
- **SN-96**: Print/PDF shows page title twice
- **SN-95**: Mobile editor left gutter feels absent
- **SN-94**: Editor context menu should bridge native edit actions and comments
- **SN-93**: Mobile editor needs subtle undo and redo controls
- **SN-91**: Vault freshness and sync safety across installed app sessions
- **SN-90**: Right-click context menu on sidebar page: Create new page
- **SN-89**: Sidebar page list does not support drag-to-reorder
- **SN-88**: Polish post-merge reload and collapse regressions
- **SN-87**: Editor left gutter dead zone on mobile — tap misses text content area
- **SN-86**: AI companion: document attachments (text, Markdown, PDF)
- **SN-85**: PWA data-loss: stale app shell, silent write failures, and no manual refresh path
- **SN-84**: Vault API: path canonicalization, structured edit tools, navigation/search, and companion context clarity
- **SN-83**: Create notebook fails silently on duplicate name
- **SN-82**: "Page + parent context" scope omits parent page content and fails silently on remote vault pages
- **SN-81**: Document interchange: DOCX import and export for Google Docs workflow
- **SN-80**: Companion session persistence (opt-in, scope-linked)
- **SN-78**: Collapsible headings with chevron toggle (ink-safe guard)
- **SN-77**: Portable multi-notebook support: open any directory as a Smart Notes notebook
- **SN-75**: Companion mobile fixes, broader scope controls, and insert-today action
- **SN-71**: Vault writes and companion chat do not render KaTeX from $ syntax
- **SN-70**: AI companion misreports vault write success until user reloads
- **SN-69**: AI companion: copy button, larger composer targets, auto-expanding input
- **SN-66**: New notebook should not auto-create an Inbox section
- **SN-65**: AI system prompt should include current page content as context; Cursor loses vault tool instructions via prompt truncation
- **SN-64**: Persist notebook open/closed state across sessions and platforms
- **SN-63**: App cold start is slow — stuck on loading screen; PWA must match ChatGPT launch speed
- **SN-62**: Default AI model and effort tier not set to highest-quality option per provider
- **SN-61**: Codex errors on first turn (web search config) and model picker list is incomplete
- **SN-60**: Print preview renders page heading twice
- **SN-59**: Inline images lack resize and alignment controls in rich text
- **SN-58**: Editor context menu shows redundant Add comment entry
- **SN-57**: PDF chip click opens preview and new tab simultaneously
- **SN-50**: PWA installability: icons, service worker shell, Android install
- **SN-49**: Vault backup: scheduled ZIP snapshots with settings UI and restore
- **SN-47**: AI companion blocks web search requests
- **SN-20**: PDF attachment support — upload, drag-drop, chip, and preview pane
- **SN-12**: Page export: HTML bundle and print rendering

# Smart Notes Design System

## Companion cell wake row (SN-378)

The waiting row in the Companion transcript uses existing `--border`,
`--muted`, `--muted-foreground`, `--foreground`, and `--destructive` colors.
Its muted surface is shown at 45% opacity and its pulse dot at 70% opacity.
It uses the established 11px secondary text, 8px gap and vertical padding,
10px horizontal padding, and the 44px mobile button touch target. The row
restores the SN-377 waiting, resuming, and cancel controls without a new color,
spacing, or typography token.

## Companion quick prompts (SN-374)

The right-side composer dropdown reuses the existing `--border`, `--secondary`,
`--foreground`, `--muted`, and `--ring` colors, plus the existing popover menu
surface. Its trigger uses the established 11px label, 24px desktop control
height, 44px phone touch height, and 132px maximum width.
On the narrow desktop toolbar, the adjacent Computer control keeps its checkbox,
monitor icon, and accessible name while hiding its visible text.
The AI Settings editor uses the existing 8px and 12px spacing, 12px and 14px
text, and 44px phone controls. No new design values were added.

## Editor scientific calculator (SN-364)

The editor scientific calculator is a body-level fixed utility popup (not a
document block and not mounted inside `editor-surface`). It reuses the Ask
Companion popover's `--popover`, `--foreground`, `--muted-foreground`,
`--border`, `--input`, `--background`, `--secondary`, `--accent`,
`--accent-foreground`, and `--ring` colors with the existing `--radius-sm` /
`--radius-md`, `shadow-md`, and `--font-sans` styles. Its 22rem card width,
8px edge gap, 4px/8px/12px spacing, 12px/14px labels, 16px input text, and
44px touch buttons are all documented popover and mobile control values. No
backdrop or blur. No new design values were added.

## Dual left sidebars (SN-324)

The desktop notebook rail and page tree reuse `--rail`, `--border`, `--surface`,
`--foreground`, `--muted-foreground`, `--chart-1` through `--chart-5`, and `--ring`
with one nav label size: every notebook, section, Notebook pages, page, Bibliography,
New section, and Add Page label uses `text-sm` (14px) on its inner label element, with
28px desktop rows. Weight carries hierarchy (notebook medium/semibold when active; section
and page regular/medium when selected; creation actions regular and muted). Never put
text-size or weight utilities on `<button>`: the unlayered global `button { font: inherit }`
overrides them.
The scoped rows retain 44px touch targets on coarse pointers, and mobile rows
retain 44px targets. Sections in the
muted `--rail` pane have slim, deterministic chart-token color tabs; the selected
section uses a rounded `--surface` highlight. Section names retain `--foreground`
when inactive, while the selected section also uses semibold weight. The page pane
uses `--surface` and lists pages for one section or the notebook root. New Section
and Add Page use the existing 11px secondary text scale, normal weight, and
`--muted-foreground` so they read as secondary actions; below xl their touch targets
remain 44px.
The notebook rail is 200px by default
and resizes from 160–320px; the page tree is 260px by default and resizes from
200–440px. Both collapse to the existing `w-11` (44px) strip. The notebook rail
uses the Lucide `Menu` icon for its burger control; the page tree retains
`PanelLeft` / `PanelLeftClose`. Focused resize handles use `--ring`, and
Arrow keys adjust width by 16px. No new color, spacing, or typography tokens.

## Camera session overlay (SN-340 rework 2)

The full-screen in-app camera session (`CameraSessionOverlay`) uses a dark
camera-UI palette (`#000` background, `rgba(0,0,0,0.8)` control bars, white
shutter ring) for the viewfinder area — these are camera-standard values, not
design-system tokens. The only design-system tokens used are `--accent` and
`--accent-foreground` for the **Add N** submit button (enabled state), matching
the established 44px phone touch target (`height: 44px`). Typography is
`0.8125rem` / `font-family: inherit`. No new design tokens were introduced.
## PDF Record panel (SN-335)

The selection menu, Companion Record chip, and floating save confirmation reuse
the inline AI popover's `--popover`, `--foreground`, `--border`, `--input`,
`--background`, `--accent`, `--accent-foreground`, `--destructive`, `--ring`,
`--shadow-popover`, `--radius-sm`, `--radius-md`, `--font-sans`, and
`--z-jupyter-inline-ai` tokens. Its spacing and typography reuse the existing
inline AI popover values (`.5rem`, `.75rem`, `1rem`, `.75rem` labels and
`.8125rem` body); controls use the existing 44px phone touch target. No new
design values were introduced.

## Jupyter mobile remote embed (SN-360)

Mobile/PWA Jupyter restores the height-bearing `jupyter-surface` and frame-host
flex contract without new color, spacing, or typography tokens. Bound-workspace
alerts continue to use `--destructive` text on a 10% `--destructive` tint over
`--border`; Lab chrome remains the embedded JupyterLab UI. No new design values.

## Text selection chrome (SN-349)

The text-page selection toolbar uses the existing `.bubble-toolbar` surface and
`.bubble-btn` controls on desktop and mobile. Highlight and Ask Companion use
the documented `--surface`, `--border`, `--foreground`, `--accent`, and
`--font-sans` tokens; no new color, spacing, or typography values were added.

## Selection font controls (SN-350)

The selection toolbar's family and size selectors reuse the existing font
choices and the toolbar's 26px desktop height and 44px touch height. They use
`--surface`, `--border`, `--foreground`, `--ring`, `--radius-sm`, and
`--font-sans` with the existing 12px toolbar text. The desktop chrome shows
only family, size, Ask Companion, and Highlight; mobile retains the other
selection actions in its scrollable toolbar. No new tokens were added.

## PDF Record area and page (SN-336)

The crop layer, crop rectangle, crop toolbar and Record panel image preview reuse
`--ring` (keyboard focus), `--accent` (crop outline), `--foreground` (35% dimming
outside the crop via `color-mix`), `--border`, `--radius-sm`, `--background` and
`--muted-foreground`. The crop toolbar reuses the Annotate bar classes
(`.pdf-reader__annotate-bar`, `-tool`, `-done`) and its 44px phone targets; the
preview caption uses the existing `.75rem` label size. The `14rem` preview
max-height and `2px` crop outline match existing panel/focus values. No new
design tokens were introduced.

## Editor list markers (SN-317)

Bullet, numbered, and checklist markers live in `.editor-content` CSS (`src/app/globals.css`, mirrored in page-export). No new color, spacing, radius, or typography tokens: list indent stays `1.5em` / task-list `0.25em`, and checked task copy reuses `--muted-foreground` with strikethrough. Marker shapes are standard CSS `list-style-type` values (`disc` / `circle` / `square`; `decimal` / `lower-alpha` / `lower-roman`) so they inherit `--foreground` from surrounding prose.

## Table ribbon and selection stats (SN-278)

Fork photo #16 shows a bordered ribbon card under the format bar. It reuses
`--surface`, `--border`, `--radius-md` (card), `--radius-sm` (tabs and pills),
`--secondary` (hover), `--secondary-foreground` (labels and the stats line),
`--foreground`, `--ring` (focus) and `--font-sans`. Grid mode, Data mode and
Expand table are outlined pills. When pressed they take an `--accent` border
over a 12% `--accent` tint, the same tint used for selected cells. New tokens:
`--table-ribbon-font-size` (retired in SN-308; controls are icon-only),
`--table-ribbon-stats-font-size: 0.6875rem` (the
`Count | Numbers | Sum | Average | Min | Max` line, tabular figures), and
`--editor-table-expanded-max-width: 1200px` (Expand table). Mobile tabs and
pills use the 44px touch target. In Data mode, number cells are right-aligned
with tabular figures.

## Design page editing, A4 guides and PDF export (SN-304)

The design header adds an `A4 guides` toggle (pressed state uses `--surface` with
`--foreground`), a `--muted-foreground` page-count status, a compact `Max pages`
number input (`--input` border, `--background`, `--ring` focus) and an outline
`Export PDF` Button. Editing uses a format toolbar row under the header: lucide
icon-only buttons (bold, italic, underline, lists, link, undo, redo) with
`aria-label`s, `--muted-foreground` icons and `--surface` hover. Page breaks are
2px dashed `--accent` rules with a `Page N` chip in `--surface` /
`--muted-foreground`; the over-limit warning reuses the `--destructive` text on a
5% `--destructive` tint banner. With guides on, the frame is A4 width
(210mm → integer `A4_WIDTH_PX` = 794px, shared with Export PDF) and centered. All controls keep 44px mobile touch targets.
No new tokens.

## Table context menu and icon ribbon (SN-308)

Ribbon controls are icon-only (lucide) with tooltips and `aria-label`s, separated by 1px `--border` dividers. New tokens: `--table-ribbon-button-size: 28px` (desktop icon button) and `--table-ribbon-icon-size: 16px`. Mobile buttons keep the 44px touch target; the mobile stats chip is a pill using `--surface`, `--border`, and `--accent` when expanded. The table context menu reuses the editor context-menu styles; Delete table uses `--destructive` text with a 10% `--destructive` hover tint, matching the comment popover's destructive button.

Table header Sort/Filter tools (SN-355) appear inside the hovered header cell as a `--popover` / `--border` / `--radius-sm` / `--shadow-popover` pill of two `--table-ribbon-button-size` lucide icon buttons (`--muted-foreground`, hover `--secondary`, active sort/filter `--accent`, `--ring` focus, 44px on coarse pointers). The filter menu reuses the same surface with 12px text and `--secondary` for the checked value. No new design values.

Table resize controls (SN-357) are hidden until the pointer reaches a divider or corner, and then show only that affordance: column and row dividers as a 2px `--accent` line (row hit strip 7px, revealed within 4px of a row border); corner handles as an 8px square with a 1px `--accent` border on `--background` and 2px radius, centred in a transparent 20px hit box, revealed within 10px of the corner. No popover surface or shadow. New dimensions: the 2px divider line, 7px row hit strip, and the 20px corner hit box with its 8px visible square.

## Job Inbox App mobile-first ribbon (SN-309)

The Job Inbox App (sandboxed frame, so tokens are mirrored into the template's `:root` from `src/styles/tokens.css`, light + `prefers-color-scheme: dark`) reuses the SN-308 ribbon pattern: icon-only lucide controls with `aria-label` + `title`, `--table-ribbon-button-size` (28px on fine pointers, overridden to the 44px touch target on coarse pointers or <=640px) and `--table-ribbon-icon-size`, groups split by 1px `--border` dividers on a `--surface` / `--radius-md` card. Pressed/expanded controls take a 12% `--accent` tint with `--accent` icon; disabled controls drop to 40% opacity; the filter count badge is an `--accent` / `--accent-foreground` pill at 11px. Inputs use `--input` border, `--background`, `--radius-sm` and `--ring` focus, at 16px on phones to avoid iOS zoom. Status chips reuse the `.chip` pill (11px, 999px radius): `New` gets an `--accent` border over a 12% `--accent` tint, in-progress statuses (Promoted/Applied/Interview/Offer) an `--accent` border and text, and closed statuses stay `--border` / `--secondary-foreground`. Selected rows use an 8% `--accent` tint, the open row a 2px inset `--accent` bar, and hover `--secondary`. Errors use `--destructive` text on a 5% `--destructive` tint with a 30% border. Promote is the only primary (`--accent` / `--accent-foreground`) button. Type sizes are 11/12/13px desktop, 14px phone base, 16px for the title. New layout metrics (no new color tokens): card rows at <=640px, a 420px side-panel column at >=960px, and below 960px the details panel replaces the list.

## Insert table and grid (SN-299)

The Insert table side submenu reuses `--popover`, `--input`, `--background`,
`--foreground`, `--primary`, `--primary-foreground`, `--muted-foreground`, and
`--ring`. The editable grid uses `--border` for its light rules, `--secondary`
for the header row, and `--accent` for the active cell outline in both the main
flow and floating text boxes. `--editor-table-cell-min-width: 4em` and
`--editor-table-cell-min-height: 1.25em` keep empty cells readable without
changing the existing table scroll behavior. Submenu controls use the established
44px mobile target and compact desktop input/button sizing.

SN-361 keeps these tokens and the quiet hover-only resize chrome. Explicitly
resized desktop tables hug their measured width; the main-flow frame grows with
them up to the documented 1200px limit. Wider tables and mobile tables retain
local scrolling. Row dividers drag or double-click to fit, while corner shrink
can continue narrowing columns after rows reach their minimum. No color,
spacing, or typography values were added.

## Floating text boxes (SN-296)

Fork photos #11 and #16 show a faint outlined box on the text page canvas with a
small Move and Delete tab above its top-left corner and a square resize handle
at the bottom-right. The box uses the existing `--surface`, `--border`,
`--foreground`, and `--muted-foreground` tokens. Its tab uses the existing 11px
compact control type and the editor content retains the page typography. No new
color, spacing, or typography token was introduced.

SN-316 adds a width-only handle centred on the right edge. It is an 8×16px tab
with the same `--surface` fill and `--border` outline as the corner handle and an
`ew-resize` cursor. Both resize handles show a `--ring` focus outline. No new
token was introduced.

SN-314 makes the box chrome OneNote-style: the 1px `--border` outline is
transparent at rest and on hover and shows only while the selection is inside the
box (caret, text range or selected image). The corner handle is gone; the
right-edge width tab is the only resize. Height is never fixed: the box hugs its
text and images inside the existing 7px/9px padding. Image containers in a box
are capped at `calc(100% - 0.35rem)`, reusing the existing 0.35rem image margin.
Exported pages draw the box border transparent. No new token was introduced.

SN-314's overflow rework lets explicitly pixel-sized images contribute their full
width to the box's line layout, so text following an image remains inside the
content-fit border. It reuses the same image spacing and border tokens.

SN-318 gives the main editor flow frame (the bordered column) the same
right-edge, width-only affordance. A full-height 12px hit strip carries the same
8×16px `--surface` / `--border` grip. The grip is sticky, so it stays in view on
long pages. Hover and drag draw a 1px `--ring` line along the edge. Keyboard
focus shows the `--ring` outline on the grip. The outline now frames the prose
with equal frame padding on both sides. Its width is the column width plus twice
that inset. The column clamps to 360–1200px; 1200px matches
`--editor-table-expanded-max-width`. The default stays 672px. The handle is
hidden below 768px, read-only and draw mode, and print. SN-321 hides the main
outline and grip until the main editor column receives focus; both remain
visible while the grip has keyboard focus or is being dragged. The printed
frame keeps its existing appearance. No new color, spacing, or typography
token was introduced.

## Shared paper notes (SN-279)

Bibliography, page paper counts, reference controls, and ownership breadcrumbs
reuse `--surface`, `--secondary`, `--border`, `--foreground`, `--muted-foreground`,
`--accent`, `--ring`, standard Button/Input controls, existing tree indent/density,
and 44px mobile touch targets. The inline panel stays in document flow.

## Bibliography v2 tree and paper page (SN-292)

Fork photos #7, #12 and #17. The only new value is `--paper` (light
`oklch(0.62 0.15 50)`, dark `oklch(0.74 0.13 55)`; Tailwind `text-paper`): the
orange paper glyph (Lucide `FileBadge`) on the pinned top-level **Bibliography**
entry, each paper row, and the count control beside pages that reference papers.
The count control uses `--paper` for its icon and number, the existing desktop
tree affordance size, and the existing 44px mobile touch target. Activating it
opens the central Bibliography with a page filter; the filter has a clear action.
Rows reuse the tree page-row height, indent, `--accent` active ring and 13px compact
title; the Bibliography label inherits the 16px "Open workspace" size. Put
text sizes on an inner span: the unlayered global `button { font-size: inherit }`
overrides utilities placed on a `<button>`. The paper page context bar
(**Back to topic** · "Bibliography · shared paper page") is `text-xs`
`--muted-foreground` on `--surface`, left-aligned with the editor toolbar.

## Attach paper dialog (SN-293)

Fork photos #2, #3 and #4. The Insert menu's paper glyph reuses SN-292's
`--paper` token. The dialog uses the existing `Dialog`, `Input`, `Button`,
`--surface`, `--border`, `--foreground`, `--muted-foreground`, `--ring`, and
`--accent` patterns. Its search and filters precede a two-column card grid;
the grid and expanded Create a paper form share one scroll area so the form
follows the cards in document flow. The form button uses the standard primary
Button at intrinsic width. No new design values were introduced.

## Paper chip and inline panel (SN-294)

Fork photos #5 and #6. The rounded chip uses `--accent` for its teal-grey
border, `--secondary` for its fill, and SN-292's `--paper` for the PAPER badge.
The expanded panel uses `--accent` for its left rule, `--surface` for the body,
`--foreground` for the title, `--muted-foreground` for helper and footer text,
and the standard primary and ghost Buttons. Spacing and typography use the
existing Tailwind scale. No new color or metric token was introduced.

## Paper reading shell (SN-281)

Opening a paper's PDF shows three layers: PDF reader | paper notes dock |
Companion overlay. The dock reuses `--surface` (frame), `--rail` (header bar),
`--border`, `--foreground`, `--muted-foreground` (eyebrow), `--ring` (separator
hover/focus line), `--destructive` (save failure), `--desktop-chrome-height`
(header), the standard ghost icon Button, and 44px coarse-pointer targets.
New values: `--z-paper-notes: 320` (above the reader, below the companion rail
so Companion overlays both frames without displacing them) and these
behavioural metrics in `src/lib/paper-reading-shell.ts`: notes default `440px`,
minimum `320px`, PDF minimum `360px`, keyboard resize step `24px`. Below a
`680px` viewport (both minimums) the dock becomes a full-width layer over the
PDF, opened from the reader's Notes toggle and dismissed with Back to PDF.

## Bibliography PDF split and Companion overlay (SN-295)

Fork photos #8 and #9 place the shared **Back to topic** / **Companion** bar
above the PDF controls and the paper editor toolbar. The embedded dock hides
only its duplicate app header and ownership strip; its standard editor toolbar
and page remain intact. The split bar, reader, and notes use existing
`--surface`, `--secondary`, `--border`, `--foreground`, `--ring`, and
`--desktop-chrome-height` tokens. The Companion PDF pill reuses the existing
scope chip and `--accent` dot. On a wide paper split the fixed Companion rail
covers at least the notes width and targets 55% of the viewport, matching #9;
the reader inset continues to depend only on the saved splitter width. No new
color, spacing, or typography token was added.

This folder is the tracked UI reference set for Smart Notes.

**System:** Clarity v1.0 — cool neutral grays, teal accent, all-sans Hanken Grotesk typography.

Canonical references:
- `Design/clarity/design-system/clarity-tokens.css` — canonical token values (source of truth)
- `Design/clarity/design-system/README.md` — design principles and intent
- `styles.css` — Clarity token values mapped to `.dirA` / `.dirA.dark` for artboard previews
- `design-tokens.jsx` documents the approved token system.
- `screens.jsx` contains the approved notebook workflow screens.
- `ink-screen.jsx` is the approved ink exploration reference.
- `multimedia-screen.jsx` is the approved rich-note exploration reference.
- `PRD.md` is the supporting product/design brief captured with the extracted references.

For UI validation briefs, use this folder plus [src/styles/tokens.css](../../src/styles/tokens.css).

## Clarity token mapping (app build)

| Clarity token | shadcn / app variable | Light | Dark |
|---------------|----------------------|-------|------|
| `--bg` | `--background` | `#ffffff` | `#1e1e1e` |
| `--panel` | `--surface` | `#ffffff` | `#1e1e1e` |
| `--rail` | `--rail`, `--sidebar` | `#f7f7f8` | `#171717` |
| `--ink` | `--foreground` | `#0d0d0d` | `#ececec` |
| `--ink3` | `--muted-foreground` | `#8e8ea0` | `#8a8a90` |
| `--line` | `--border`, `--input` | `#e6e6eb` | `#333333` |
| `--accent` | `--accent`, `--primary` | `oklch(0.58 0.09 195)` | `oklch(0.74 0.10 192)` |
| `--link` | editor/chat links | `oklch(0.55 0.10 235)` | `oklch(0.74 0.08 235)` |
| `--highlight` | `mark` highlight | `oklch(0.90 0.18 95)` | same |

Typography: Hanken Grotesk for both `--font-sans` and `--font-serif`; JetBrains Mono for code; Caveat for handwriting.

## Desktop Compact Density Tokens

SN-139 adds desktop-only density metrics in `src/styles/tokens.css` for the three-pane shell at the `xl` breakpoint. Mobile keeps the established editor density values: Small `13px`, Normal `16px`, Large `20px`.

| Token | Value | Use |
|-------|-------|-----|
| `--desktop-editor-density-compact` | `12px` | Desktop Settings → Font size → Small editor prose |
| `--desktop-editor-density-normal` | `15px` | Desktop default editor prose |
| `--desktop-editor-density-comfortable` | `18px` | Desktop Settings → Font size → Large editor prose |
| `--desktop-editor-density-leading` | `1.62` | Desktop editor prose line-height |
| `--desktop-chrome-height` | `48px` | Desktop top chrome height |
| `--desktop-tree-page-row-height` | `30px` | Legacy unified desktop page tree row minimum; SN-324 scoped rail/page lists share 28px rows |
| `--desktop-tree-section-row-height` | `28px` | Desktop notebook and section row minimum |
| `--desktop-tree-affordance-size` | `26px` | Desktop tree overflow/collapse button size |
| `--desktop-tree-indent-step` | `10px` | Desktop nested page indentation step |

## PDF reader chrome (SN-198)

Immersive PDF outline + zoom controls reuse existing Clarity / app tokens only — no new color, spacing, or type values:

| Control | Tokens |
|---------|--------|
| Outline panel / backdrop | `--surface`, `--foreground`, `--border`, `--muted-foreground`, `--secondary`, `--accent`, `--radius-sm` |
| Zoom percent input | Same as page jump: `--input`, `--background`, `--foreground`, `--accent`, `--radius-sm`, `--muted-foreground` |

Zoom input sizing mirrors `.pdf-reader__page-input` (`1rem` text to avoid mobile focus-zoom). Outline is always an overlay drawer; do not introduce an in-flow rail that reflows the document viewport.

## PDF reader night mode (SN-225)

Night mode inverts EmbedPDF page render/tile bitmaps only. Reader chrome (bar, outline, annotate tools) stays on existing Clarity tokens. Annotation/search/selection overlays are not inverted.

| Surface | Value | Why not a chrome token |
|---------|-------|------------------------|
| PDF paper (day) | `#ffffff` | Page bitmap paper, not app chrome; already used by `.pdf-reader__page-frame` |
| PDF paper (night) | `#000000` | Exact invert of day paper while tiles load; not `--background` / `--rail` |
| Page bitmap invert | `filter: invert(1)` on `.pdf-reader__page-bitmap` | Pixel invert of PDFium tiles, scoped so overlays stay true-color |

Night-mode toggle pressed state reuses `--secondary` / `--foreground`, same as Annotate and outline toggles. Do not add a new accent or invert the whole `.pdf-reader` surface.

## Immersive Surface Z-Index Tokens

Immersive surfaces use the shared z-index scale in `src/styles/tokens.css`. Keep portaled controls on the token assigned to their owning surface; do not replace these values with inline numeric `z-index` utilities.

| Token | Value | Use |
|-------|-------|-----|
| `--z-pdf-reader` | `300` | Full-viewport immersive PDF reader |
| `--z-paper-notes` | `320` | Paper reading shell notes dock beside (or, on narrow screens, over) the reader (SN-281) |
| `--z-companion-rail` | `350` | Companion rail or full-screen sheet displayed over the reader |
| `--z-companion-overlay` | `400` | Companion-owned portaled dialogs, dropdowns, selects, and popovers displayed over the reader |
| `--z-jupyter-inline-ai` | `425` | Portaled inline-AI actions, working state, and answers displayed over embedded JupyterLab chrome |

The required ordering is reader < paper notes dock < companion rail/sheet < companion floating controls < Jupyter inline AI. Shared dialogs and menus retain their normal layer; only companion-owned portals opt into the elevated overlay token while the immersive reader is active.

## Notebook tree key-note gem (SN-229)

Key notes reuse existing Clarity / app tokens only — no new color, spacing, or type values.

| Surface | Tokens |
|---------|--------|
| Gem icon | Lucide `Gem`, `size-3` (same as tree type icons), `text-accent` (`--accent`) |
| Page ⋮ menu | Existing dropdown item styles |

The gem sits beside the page title and does not replace the type icon. Do not introduce a dedicated gem color.

## Notebook picker organization (SN-232)

The Open Notebook picker’s organization toolbar, pinned section, group headers, and archived disclosure reuse existing Clarity/app tokens only; no new color, spacing, radius, or typography values were added. The tree sidebar retains its existing navigation density and does not render this organization chrome.

| Surface | Existing tokens/patterns |
|---------|--------------------------|
| Structural filter | App `Input` using `--input`, `--background`, `--foreground`, `--muted-foreground`, and focus `--ring` |
| Key-notes and group-collapse controls | Existing ghost/secondary `Button`; active state uses `--secondary`; gem uses `--accent`; collapse/expand uses existing Lucide chevrons/list icon |
| Pinned section and collapsible group rows | `--border`, `--surface`, `--background`, and `--muted-foreground` inside the existing dialog surface |
| Mobile organization controls | Existing `size-11` / `min-h-11` 44px touch target; filter remains `text-base` to prevent iOS focus zoom |
| Archived disclosure | Existing dialog, border, surface, foreground, muted, accent, and focus-ring tokens |

Notebook and page shortcuts keep the existing Clarity hierarchy and type icons. The normal grouped list is notebook-only; individual group headers and the all-groups control use the same 44px interaction pattern. Groups are restrained operational labels rather than decorative cards, and all organization stays inside the existing picker so it does not turn the tree into a second organizational workspace.


## Companion Jump to latest (SN-285)

Reuses existing tokens only; no new color, spacing, radius, or type values.

| Surface | Existing tokens/patterns |
|---------|--------------------------|
| Jump to latest pill | `Button` `variant="secondary"` `size="sm"` (`--secondary`, `--secondary-foreground`), `border-border`, `rounded-full` as used by companion chips, `shadow-sm`, Lucide `ArrowDown` `size-3.5` |
| Placement | Absolutely centered `bottom-2` inside the transcript wrapper so it never covers the composer |
| Mobile | `min-h-11` 44px touch target, matching other companion mobile controls |

## Shell + Companion chrome touch targets (SN-289)

Reuses existing Clarity tokens only; no new color, spacing, radius, or type values.

| Surface | Existing tokens/patterns |
|---------|--------------------------|
| Frequent shell actions (menu, search, capture, Companion, More) | `size-11` (44px) below `xl`; compact `xl:size-8` on desktop chrome |
| Phone status chip | Existing `--border` / `--surface` / `--muted-foreground` / `--destructive` / `--accent` chip pattern; short text label always visible |
| Infrequent actions | Labeled **More** menu (`DropdownMenu`) — create, export, print, reload/refresh, settings |
| Companion mobile header (settings, close, density, scope, Keep) | `size-11` / `min-h-11` with existing ghost/chip surfaces |

## Quick Capture text-first layout (SN-290)

Quick Capture follows the approved Screen 6 hierarchy: the content area comes first and receives focus, while title and routing fields follow. The current notebook and Inbox or selected section are shown as a text summary before Save. The saved state keeps Open as a separate action.

The dialog reuses `Dialog`, `Textarea`, `Input`, `Button`, and existing select styles. Surfaces and focus use `--background`, `--foreground`, `--muted-foreground`, `--border`, `--input`, and `--ring`. Layout uses the existing `gap-2`, `gap-4`, `sm:grid-cols-2`, `text-base`, and `min-h-[260px]` values from the previous Capture modal. Mobile actions and selects use the established `min-h-11` / `h-11` 44px touch target, and selects use `text-base` until the `sm` breakpoint. No new color, spacing, or typography values were introduced.

## Page rule and grid lines (SN-297)

OneNote-style lines are a CSS background on the editor content frame (`[data-testid=editor-content-frame]`). They are not document content: they never change text layout and are never copied or exported. SN-297 adds these tokens to `src/styles/tokens.css`. They are page-paper values, not app chrome, so they do not reuse `--border` or `--chart-*`.

The SN-326 page title bar uses the existing editor H1 typography (`--font-serif`, 2rem, weight 600), `--foreground` for its editable title, `--border` for its rule, `--muted-foreground` for the date and time, and `--ring` for focus. It uses the documented 8/16px spacing and 12px secondary text scale; no new design values or tokens were added.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--page-line-light-blue` | `oklch(0.86 0.045 230)` | `oklch(0.38 0.045 230)` | Rule Line Color swatch 1 (default) |
| `--page-line-blue` | `oklch(0.78 0.08 250)` | `oklch(0.42 0.08 250)` | Swatch 2 |
| `--page-line-green` | `oklch(0.84 0.07 150)` | `oklch(0.40 0.06 150)` | Swatch 3 |
| `--page-line-lavender` | `oklch(0.85 0.06 305)` | `oklch(0.40 0.06 305)` | Swatch 4 |
| `--page-line-grey` | `oklch(0.84 0.005 260)` | `oklch(0.36 0.005 260)` | Swatch 5 |
| `--page-line-margin` | `oklch(0.70 0.16 25)` | `oklch(0.50 0.14 25)` | Red margin line on the "college ruled with margin" preset |

| Token | Value | Use |
|-------|-------|-----|
| `--page-rule-narrow` / `--page-rule-college` / `--page-rule-wide` | `20px` / `28px` / `36px` | Ruled line pitch (the margin preset uses college) |
| `--page-rule-margin-inset` | `8px` below 768px, `18px` at md+ | Margin line x-offset, kept inside the frame's left padding so it never crosses text |
| `--page-grid-small` / `-medium` / `-large` / `-xlarge` | `12px` / `20px` / `32px` / `48px` | Grid cell size |

Popover chrome (photo #14) reuses existing tokens: the popup uses `--popover`, `--border`, and `shadow-md`. Section labels use `text-xs` with `--muted-foreground`. The selected tile has a 2px `--accent` border, and the selected swatch has a 2px `--accent` ring. Focus rings use `--ring`. The footer switch uses `--accent` (on) or `--secondary` (off). On mobile, the footer toggle row keeps the established `min-h-11` 44px target.


## Ask Companion popover (SN-303)

The owner references are the two photos on the vault page Key docs/ask-ai-companion. The final editor menu row uses the teal Sparkles icon after a divider. Format and Turn into group existing text actions. The shared card uses --popover, --foreground, --secondary-foreground (readable helper/footer copy), --border, --input, --accent, --accent-foreground, --ring, --radius-xs/sm/md and --shadow-popover. It shares --z-jupyter-inline-ai so it sits above the PDF reader. Spacing and typography reuse the documented Tailwind scale (4/8/12/16px spacing; 11/12/13px compact text); mobile textarea text is 16px and buttons retain 44px touch targets. New layout metric: 22rem preferred card width, capped to viewport minus 16px, with viewport-bounded scrolling. Keyboard focus is contained while open; Escape closes and restores focus. Empty target, disabled empty prompt, streaming, long content, provider error/retry and page-navigation interruption are explicit states.

The mobile selection bubble keeps controls on one line with horizontal scrolling and the established 44px touch targets; Ask Companion uses the existing `--accent` color.

SN-362 adds Fast/Slow choice and a rich-text Edit toggle in the same chip row. The pressed choice uses the documented `--accent` for its border and text; spacing, typography, and touch targets remain the SN-303 values. No new design values were added.

SN-363 brings JupyterLab into the same popover: the Lab inline-AI chip row (existing `--popover`, `--border`, `--muted` hover, `text-xs` chip classes) relabels its Ask chip "Ask Companion...", matching the rich-text and PDF menus. Fast/Slow/Edit render with the SN-362 popover styles unchanged. No new design values were added.

## PDF passage actions (SN-334)

The PDF selection menu is one compact row: Highlight, Record, Ask Companion. A tapped highlight's comment dish shows a row with Record and Ask Companion. Each action reuses `.inline-ai-menu-action`, keeping its lucide icon in `--accent` (Highlighter, NotebookPen, Sparkles) and the 44px touch target on coarse pointers and widths below 768px. The floating row and the "Highlighted · Undo" status use the inline AI popover tokens: `--popover`, `--foreground`, `--border`, `--secondary` (hover), `--ring` (focus), `--radius-md`, `--shadow-popover`, `--font-sans`, and `.8125rem` text with `.25rem`/`.5rem`/`.75rem` spacing. The row sizes to `max-content`, wraps only when wider than the viewport minus 16px, opens 8px below the passage (or above it when the reader suggests top), and stays at least 8px inside the viewport edge. No new design values were introduced.

## Tree expand/collapse toggles (SN-392)

Notebook-rail section chevrons, nested page chevrons, and legacy section-header chevrons share one
`TreeToggleButton`. The glyph stays the existing compact Lucide chevron (`size-3` desktop, `size-3.5`
phone) in `--muted-foreground`, turning `--foreground` on hover with a `--background` hover fill and the
standard `--ring` focus ring. The hit box is 20px wide by the documented `--desktop-tree-affordance-size`
(26px) tall on compact desktop, and the established 44px touch target (`size-11`) on phones and coarse
pointers. Leaf rows reserve the same width so titles align. The 20px desktop width is the existing
Tailwind `w-5` spacing step; no new color, type, or spacing tokens were added.

## Generic file attachment chip (SN-393)

Pages accept any file type through Insert -> Attach, paste, and drop. Images and PDFs keep their inline
rendering; every other type becomes the existing `.file-attachment-chip` pill (`--border`, `--secondary`,
999px radius). The generic chip adds a `FILE` badge in `--muted` / `--muted-foreground`, the file name as
the open link (inherits text color), an `EXT · size` meta label in `--muted-foreground` at 0.75rem,
and a `Download` link in the documented `--link` editor-link token. PDF chips are unchanged. No new
color, type, or spacing tokens were added.

## Mobile image selection chrome (SN-391)

Image resize handles keep their existing 10px `--accent` square with a `--background` border, but now
render only on the selected image. On coarse pointers each handle gets an invisible 44px hit area (the
established phone touch target); the visual size is unchanged. The image toolbar reuses `.bubble-toolbar`
(`--surface`, `--border`, 44px touch buttons, horizontal scroll). On touch it is capped to the selected
picture's width and sits 8px inside the picture's top edge when it covers at most half the picture;
desktop keeps the stock 8px gap above. No new color, type, or spacing tokens were added.

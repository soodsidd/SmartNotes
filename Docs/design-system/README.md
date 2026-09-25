# Smart Notes Design System

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
| `--desktop-tree-page-row-height` | `30px` | Desktop page tree row minimum |
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
| `--z-companion-rail` | `350` | Companion rail or full-screen sheet displayed over the reader |
| `--z-companion-overlay` | `400` | Companion-owned portaled dialogs, dropdowns, selects, and popovers displayed over the reader |
| `--z-jupyter-inline-ai` | `425` | Portaled inline-AI actions, working state, and answers displayed over embedded JupyterLab chrome |

The required ordering is reader < companion rail/sheet < companion floating controls < Jupyter inline AI. Shared dialogs and menus retain their normal layer; only companion-owned portals opt into the elevated overlay token while the immersive reader is active.

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


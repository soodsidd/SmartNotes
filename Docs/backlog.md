# Smart Notes — Backlog (retired)

> **This file is retired.** Work items are now tracked in the Ascent Vector `av` CLI
> (project `proj-mwb81k-mpiqp915`). See `Docs/agent-operations.md` for how to query
> and mutate the live backlog.
>
> History preserved below for reference only.

---

## SN-001 · Phase P — Foundation: Archive v0 & Install Design System

**Type:** Story
**Status:** backlog
**Assignee:** Leo
**Risk:** Low
**Est:** 2–3 days

### Description

The current codebase (pre-design-system) needs to be preserved and then cleared so
development can begin against the new PRD and Direction A design specification.
After archival, install Tailwind CSS v4, shadcn/ui, and the Direction A token set so
every subsequent phase has a consistent, working foundation to build on.

### Acceptance Criteria

- [ ] Git tag `archive/v0-original` created on current HEAD and pushed to remote.
- [ ] `src/` emptied; the following survive untouched: `server.js`, `gateway-start.js`,
  `packages/cli-chat/`, `Design/`, `Docs/`, `tsconfig.json`, `package.json`,
  `next.config.mjs`, `playwright.config.ts`, `jest.config.cjs`.
- [ ] Tailwind CSS v4 installed and configured (CSS-first, no `tailwind.config.js`).
- [ ] shadcn/ui initialised; core primitives installed: `Sheet`, `Dialog`,
  `DropdownMenu`, `Tooltip`, `ScrollArea`, `Button`, `Input`, `Separator`.
- [ ] Direction A design tokens defined as CSS custom properties in
  `src/styles/tokens.css` and extended into the Tailwind theme:
  - Background: `#FAF9F7` (light) / `#1A1917` (dark)
  - Surface: `#FFFFFF` (light) / `#252422` (dark)
  - Accent: `#C84B31`
  - Fonts: Newsreader (body/headings), Inter (UI), JetBrains Mono (code), Caveat (ink)
- [ ] Google Fonts loaded via Next.js `next/font/google` (no external stylesheet tags).
- [ ] `<html class="dark">` toggle wired to a React context; light and dark both render
  the correct Direction A background colours.
- [ ] Blank Next.js app shell (`/`) renders without errors in dev and build.
- [ ] `npm run build` exits 0.

### Evidence

- Screenshot of shell in light mode showing Direction A background + a Newsreader heading.
- Screenshot of shell in dark mode.
- `npm run build` output showing 0 errors.

---

## SN-002 · Phase 1 — Interactive Prototype

**Type:** Story
**Status:** backlog
**Assignee:** Leo
**Risk:** Medium
**Est:** 12–15 days
**Depends on:** SN-001

### Description

Build a fully navigable interactive prototype of Smart Notes using the Direction A
design system and the PRD screen definitions. The prototype uses hardcoded mock data —
no file system, no real AI calls, no persistence. Every screen in the design package
must be reachable and styled correctly on desktop (1280px+) and mobile (375px).

### Acceptance Criteria

**1a — Shell & Layout**
- [ ] Desktop: 3-column CSS grid (sidebar 280px | editor 1fr | AI rail 360px);
  sidebar collapses to 36px icon strip via toggle.
- [ ] Mobile: full-width single column; bottom tab bar (Notes · Capture · Search · AI)
  always visible.
- [ ] Responsive breakpoints: 375px phone, 768px tablet (2-pane), 1280px desktop.
- [ ] Light/dark toggle switches Direction A tokens correctly at all breakpoints.
- [ ] Mock data module provides ≥ 3 notebooks, 2 sections each, 3 pages each.

**1b — Navigation Flows**
- [ ] Desktop sidebar tree: expand/collapse notebooks and sections; active page
  highlighted with accent left-bar; hover/focus states per design tokens.
- [ ] Mobile drill-down: Notebooks → Sections → Pages list; each level is a
  full-screen push with back chevron and correct title.
- [ ] Create / rename / delete UI (optimistic, no persistence) on notebooks, sections,
  pages.
- [ ] Notebook color dot picker using Direction A preset accent swatches.

**1c — Editor Surface**
- [ ] Tiptap v2 renders mock page content with Direction A typography:
  Newsreader body, correct line-height, ≥ 16px on mobile.
- [ ] Page title in `display.lg` (desktop) / `display.md` (mobile); modified date in
  `caption` style.
- [ ] Desktop: full formatting ribbon (bold, italic, underline, headings, lists,
  code, quote) with shadcn `Tooltip` on each action.
- [ ] Mobile: no ribbon; contextual mini-toolbar on text selection via Tiptap
  `BubbleMenu`.

**1d — AI Panel**
- [ ] Desktop right rail: mock conversation thread, AI/user message bubbles styled
  per Direction A, "Ask about this page" input field.
- [ ] Mobile: bottom sheet (`Sheet` from shadcn) triggered by AI tab or FAB.
- [ ] Diff review UI: accept / reject buttons on a side-by-side or inline mock diff;
  purely visual with hardcoded mock strings.
- [ ] Ink-aware AI action chip stub: "Explain this" chip appears over a lasso
  selection area (visual only, no logic).

**1e — Overlays & Modals**
- [ ] Quick capture modal: opens on `⌘⇧V` (desktop) and bottom-sheet FAB (mobile);
  680px width on desktop, full-screen on mobile.
- [ ] Search modal (`Dialog`): search input + mock results list, opens on `⌘K`.
- [ ] Settings stub panel: theme toggle visible and functional.

**Cross-cutting**
- [ ] No TypeScript errors (`tsc --noEmit` exits 0).
- [ ] No console errors in Chrome DevTools on desktop or mobile viewport.
- [ ] `npm run build` exits 0.

### Evidence

- Loom or screenshot walkthrough hitting each screen on desktop (1280px) and mobile
  (375px emulated in DevTools).
- `tsc --noEmit` output: 0 errors.
- `npm run build` output: 0 errors.

---

*Last updated: 2026-05-23*

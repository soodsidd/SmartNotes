# SN-334 PDF selection menu walkthrough

**Preview path.** The AV sidecar preview (`POST /api/preview/start`, autoPickPort)
started `node server.js` but was marked failed (known AV-277 port-ownership
check, no `wmic` on this host). As in SN-335, the walkthrough instead ran
through the Playwright harness with an isolated worktree `.e2e-vault` on
non-production port 3218: `e2e/sn-334-pdf-selection-menu.spec.ts`, desktop
(1280 × 720) and phone (430 × 1200, touch). The spec is kept out of release
smoke like the other PDF harnesses. Every step below is an assertion, not just
a screenshot.

| Step | Desktop | Phone |
|------|---------|-------|
| Reader open | [01](desktop-01-open.png) | [01](mobile-01-open.png) |
| Selection → Highlight / Record / Ask Companion row, below the passage, inside the viewport (phone: every action ≥ 44px) | [02](desktop-02-selection-menu.png) | [02](mobile-02-selection-menu.png) |
| Highlight → one type-9 sidecar item with `custom.text` | [03](desktop-03-highlighted.png) | [03](mobile-03-highlighted.png) |
| Same passage → Highlight again → "Already highlighted", still 1 item | [04](desktop-04-already-highlighted.png) | [04](mobile-04-already-highlighted.png) |
| Reopen → highlight still present once | [05](desktop-05-reopened.png) | [05](mobile-05-reopened.png) |
| Tap highlight (phone: finger tap) → Comment/Edit + Record, Ask Companion | [06](desktop-06-highlight-tapped.png) | [06](mobile-06-highlight-tapped.png) |
| Highlight → Ask Companion (Selection target, highlight text) | [07](desktop-07-highlight-ask.png) | [07](mobile-07-highlight-ask.png) |
| Highlight → Record → "Saved in <note>" | [08](desktop-08-highlight-record.png) | [08](mobile-08-highlight-record.png) |
| Selection → Record → saved | [09](desktop-09-selection-record.png) | [09](mobile-09-selection-record.png) |
| Selection → Ask Companion (Selection target) | [10](desktop-10-selection-ask.png) | [10](mobile-10-selection-ask.png) |
| Right-click menu: Highlight, Record, Record options…, Ask Companion... | [11](desktop-11-context-menu.png) | — |
| Context-menu Highlight → Undo from read-mode status (no Annotate) | [12](desktop-12-context-highlighted.png), [13](desktop-13-undo.png) | — |

Desktop also asserts that read-mode Ctrl+C still copies the virtual selection.
The Companion answer stream was not called; these runs verify the target and
passage handed to the popover, not a model response.

**Found and fixed during the walkthrough.** (1) On the phone, the first build
stacked the three actions vertically because the anchor wrapper has zero
width. The row now sizes to `max-content`. (2) A finger tap on an existing
highlight never opened its dish, because read-mode touch is kept away from
EmbedPDF so native pan and pinch keep working. A short single-finger tap now
hit-tests highlight geometry and selects the highlight it lands on.

# SN-294 evidence

- `05-side-by-side.png` and `06-side-by-side.png` place the desktop preview (1440x900) beside fork photos #5 (collapsed chip) and #6 (expanded read-only panel). Source captures: `05-chip.png`, `06-expanded.png`.
- `capture.mjs` drives the isolated fixture from `seed-fixture.mjs` (worktree `.e2e-vault` / `.e2e-state`, paper "deviation" referenced from `General/Precision Engineering/Test` and `General/Metrology/Other reference`). Its in-browser checks, recorded in `console.txt`, all passed (16/16):
  - Edit, then typing, autosaves through a conditional PUT carrying the loaded `sha256:` revision. The canonical paper file holds the edit, and the referring page file stays byte-identical (`06-editing-saved.png`).
  - Collapse restores the plain chip.
  - The second referring page shows the edit on reopen, and Refresh fetches the current canonical body (`06-other-reference-refresh.png`).
  - A stale inline editor gets 409 PAPER_CONFLICT with an alert. The newer paper content and the second referring page stay byte-identical, and autosave does not retry (`06-stale-conflict.png`).
  - After Refresh, a fresh inline edit from the second referring page saves (200), lands in the canonical paper on top of the prior content, shows at the first referring page on reopen, and leaves both referring page files byte-identical (`06-second-reference-saved.png`).
  - Clicking the chip title opens the full paper page (`title-opens-full-paper.png`).
  - Zero page or console errors. The single browser console entry for the deliberate 409 response in the stale-editor step is expected and filtered by an exact `409 (Conflict)` match.
- The first evidence run found a save-safety defect the unit tests could not see: native caret movement (Ctrl+End, arrows past the paper's edges) moved focus from the nested inline editor into the referring page's editor, so inline typing edited the referring page. Entering Edit also wrote the paper, because Tiptap's `setEditable` emits `update` by default. Both are fixed: caret keys are contained, a pointer-less `focusin` guard returns focus to the inline editor, and `setEditable(editing, false)` is used. The final run above is post-fix.
- Preview: sidecar registrations `preview_1791855659415_y91jij` (port 57951) and, after the sidecar's own restart, `preview_1791856876238_qhpsg7` (port 63669) were accepted. Each time the app came up with the isolated vault, then the sidecar marked it `failed` and the port closed (AV-277). Per the pre-approved exception, the evidence ran against a Playwright harness on its own non-production port 58294 (`NODE_ENV=production node server.js`, isolated vault and `SMART_NOTES_STATE_DIR`). The AV sidecar on :8787 was not restarted or killed.
- `compare.py` builds the side-by-side images.

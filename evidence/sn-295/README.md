# SN-295 evidence

- `08-side-by-side.png` and `09-side-by-side.png` place the desktop preview (1440×900) beside fork photos #8 (PDF + notes split) and #9 (Companion overlay). Source captures: `08-split.png`, `09-companion-overlay.png`, plus `09-closed-back-to-split.png`.
- `capture.mjs` drives the isolated fixture from `seed-fixture.mjs` (worktree `.e2e-vault-sn295` / `.e2e-state-sn295`, paper "deviation" with `Catalogue(Final).pdf`). Its in-browser checks, recorded in `console.txt`, all passed (12/12):
  - Top bar reads `Back to topic` · `Companion`.
  - Notes pane shows the desktop editor toolbar (`toolbar-bold`).
  - PDF frame abuts the notes pane; splitter drag stores width and both frames follow it; width survives reload.
  - Companion overlays the notes on the right without moving the PDF; header `Smart Notes AI` / `Discussing · deviation` with `PDF: Catalogue(Final).pdf` context pill; closing restores the plain split.
  - Zero page or console errors (hydration #418/#422 fixed by deferring PDF session restore until after mount).
- Sidecar preview registrations were accepted then marked `failed` with AV-277 port-ownership (`preview_1791859665913_9sktf2` port 54955 and earlier attempts). Per the pre-approved exception, evidence and Inspect use a Playwright harness on its own non-production port (`NODE_ENV=production node server.js`, isolated vault and `SMART_NOTES_STATE_DIR`). The AV sidecar on :8787 was not restarted or killed.
- `compare.py` builds the side-by-side images.

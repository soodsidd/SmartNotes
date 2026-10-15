# SN-316 desktop evidence

- `01-before.png`: 240px box with five lines of wrapped text and a 160px image.
- `02-width-resized-wrapped.png`: after dragging the right-edge width handle to 500px. Text rewraps to three lines and the box height shrinks to fit (stored min-height stays 48).
- `03-image-expanded.png`: the embedded image was dragged to 520px, wider than the box. The box widened to 540px and grew taller so the image is fully inside.
- `console.txt`: the 12 browser checks from `capture.mjs`. All pass, with zero page or console errors. The checks cover a live mid-drag reflow, no stray box after an image drag ends on the canvas, and persistence across reload.
- To reproduce: `node evidence/sn-316/seed-fixture.mjs` writes `.e2e-vault-sn316/`. Then start `node server.js` with `PORT`, `SMART_NOTES_VAULT`, `SMART_NOTES_STATE_DIR` and `SMART_NOTES_NEXT_DIST_DIR=.next-sn316` set, and run `SN316_PREVIEW_URL=<url> node evidence/sn-316/capture.mjs`.

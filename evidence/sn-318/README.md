# SN-318 desktop evidence

- `01-default-672.png`: page opens at the default 672px column. The outline now frames the prose with equal padding (before this change the prose ran 24px past the right border).
- `02-narrowed-432.png`: after dragging the main flow's right-edge handle 240px left. The lead paragraph rewraps from 3 to 4 lines. The image shrinks to the 432px column. The outline height still follows the content.
- `03-widened-960.png`: after widening the column to 960px (keyboard, then drag). The prose rewraps to 2 lines. The floating box (SN-316) stays where it was.
- `console.txt`: 21 browser checks from `capture.mjs`, all PASS, with zero page or console errors. They cover live mid-drag reflow, the `main_flow_width` frontmatter write after drag and after a keyboard burst, and the empty-canvas create zone following the new width. They also check restore on reload and the zoom-aware drag at 1.05×.
- To reproduce: `node evidence/sn-318/seed-fixture.mjs` writes `.e2e-vault-sn318/`. Start `node server.js` with `NODE_ENV=development`, `PORT`, `SMART_NOTES_VAULT`, `SMART_NOTES_STATE_DIR` and `SMART_NOTES_NEXT_DIST_DIR=.next-sn318`. Then run `SN318_PREVIEW_URL=<url> node evidence/sn-318/capture.mjs`.

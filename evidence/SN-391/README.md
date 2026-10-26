# SN-391 mobile image interaction evidence

Spec: `e2e/sn-391-mobile-image-taps.spec.ts` (Playwright `mobile` project: 430px, touch, coarse pointer).
Catalog: `e2e-sn-391-mobile-image-taps`.

- `baseline-matrix.json`: probe results on the original code (pre-fix), from the exploratory run.
- `mobile-image-matrix.json`: probe results with the fixes (all pass).
- `mobile-selected.png`: wide image selected. Handles only on that image; toolbar inside its top edge.
- `mobile-caret-after-dismiss.png`: after tapping the paragraph below a selected image and typing.
- `mobile-after-touch-resize.png`: after a touch drag on the right handle (committed, still selected).

## Issue inventory (exploratory pass)

| # | Issue found on mobile | Probes (baseline fail) | Status |
|---|---|---|---|
| 1 | Resize handles are shown on every image, always. Their `touchstart` is `preventDefault`-ed, so taps on image edges or the gap between two images start a resize instead of placing a caret. | P0, P1, P2, P5, P6a, P7, P9b, P10, P16 | Fixed: handles render only on the selected image; 44px touch hit area on coarse pointers. |
| 2 | Touch resize never ends (TipTap only listens for `mouseup`). The image stays in `data-resize-state="true"` and every later swipe keeps resizing it. | P7 (`resizing: 1`), P12b, P12c (280px became 292px after an unrelated swipe), P13a | Fixed: `touchend`/`touchcancel` end the drag and remove the `touchmove` listener. |
| 3 | A tap just below a final image creates a floating text box instead of a caret after the image, so there is no easy way to type after a last picture. | P6, P6b | Fixed: touch taps within 44px under a block ending in an image put the caret after it. |
| 4 | With an image selected, the phone-wide image toolbar floats over the text line above it and over neighbouring images. A tap aimed at that text or image presses a toolbar button (seen: Align left), so the image stays selected and the next keystroke replaces it. This is the "picture disappeared while typing" symptom. | Event traces (bubble `BUTTON` hit for an intro-text tap and a neighbour-image tap); P8/P16 after fix 1 | Fixed: on touch the toolbar is capped to the picture width and sits inside tall pictures; `shift` keeps it on screen. |
| 5 | After a resize commit or a width/align preset, the image silently deselects (replacing a leaf node maps the NodeSelection to a caret). Once handles show only on the selected image, they would vanish after every drag. | SN-384 desktop/mobile after fix 1; P12d | Fixed: commit and `setImageWidth`/`setImageAlign` re-select the image. Unit test added. |
| 6 | Backspace on a selected image: failed on baseline only as a knock-on of the stuck resize (#2). | P14 | Passes after #2. |

Nothing in scope was deferred.

Known residual (not a suite failure): pictures shorter than about 124px (twice the toolbar height) keep
the toolbar outside, above the picture (width-capped). There it can still cover part of the line
directly above a very short image.

## Test-only artifacts ruled out (not product bugs)

- Typing immediately after a tap: ProseMirror applies touch selections on the async `selectionchange`. The spec now waits for the selection, as a human naturally does.
- A tap during a scroll fling only stops the fling (no click). The spec's synthetic swipes now hold before lifting.
- The `End` key does not move the caret under mobile emulation. The spec taps after the line instead.
- The editor canvas is intentionally wider than a phone (SN-321 main-flow outline), so horizontal swipes pan it. This is existing design and not image-specific.

## Unrelated finding

- `tests/sn-339-image-multi-select.test.ts` (3 tests) fails on the base commit too. It asserts a literal source string (`for (let i = 0; i < supported.length; i++)`) that `rich-text-editor.tsx` no longer contains. This brief does not touch that loop. Needs a follow-up brief (owner approval).

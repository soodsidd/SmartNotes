# SN-366 Playwright discovery findings

Discovery harness: `e2e/sn-366-discovery.spec.ts` (opt-in: `SN366_DISCOVERY=1 SN366_WIDTHS=1280,900 npx playwright test e2e/sn-366-discovery.spec.ts --project=desktop`).
It drives every promote entry point and the paper reading shell, recording observations (no assertions) to `discovery/findings-<width>.json` plus screenshots.
`discovery/pre-fix/` holds the pre-fix captures. The other files in `discovery/` come from runs on the fixed build at 1280px and 900px.

| # | Entry point / surface | Observed (pre-fix) | Status |
|---|---|---|---|
| 1 | Page PDF chip → right-click → **Promote to paper** | Right-click opened the full-screen PDF reader over the context menu (`pre-fix/1280-A1-context-menu.png`). Capture-phase `pointerdown` openers (the shell's annotated-panel document listener and React capture, plus the editor's two) ignored the mouse button. | **Fixed**: only a primary-button press opens the reader. Right-click reaches the chip context menu. |
| 2 | Reader toolbar **Save as paper** (and chip promote with a reader open) | The Promote dialog rendered under the reader (dialog `z-50` < `--z-pdf-reader` 300), so it was invisible and unclickable (`pre-fix/900-A2-dialog.png`). | **Fixed**: the dialog and overlay use the new `--z-reader-dialog` (450). |
| 3 | Promote dialog state | The reset effect depended on `tree`, so any vault refresh (including the one the submit triggers) reset the typed title, the home notebook, the replace option, and `pending`. Typing could be lost, and a double submit was possible mid-request. | **Fixed**: the dialog resets only when it opens for a PDF. |
| 4 | Paper reading shell top bar | Only **Back to topic** · **Companion**. The reader's own close arrow is CSS-hidden in the shell, so there was no way back to the paper notes. | **Fixed**: **Back to paper** leads the bar. It closes the reader after the dock flush and stays on (or opens) the paper. When the PDF came from a referring page, that page is remembered as the paper's topic. |
| 5 | Attach paper → Create → **Choose from this page** | Promote succeeded but gave no feedback. The other two entry points toast. | **Fixed**: same toast ("Paper created from PDF." / "Attached existing paper for this PDF."). |
| 6 | Re-promoting the same vault PDF | Reuses the existing paper. No duplicate paper, and the reference count stays at 1. | Works (no change). |
| 7 | Paper chip placement / replace option | The chip is inserted immediately before the PDF chip. With "Remove the original PDF chip", the PDF chip is replaced in place. | Works (no change). Covered by the e2e. |
| 8 | Back to topic from the shell | Returns to the referring/topic page with scroll restore (the URL is not rewritten; the harness' URL check was a false alarm). | Works (no change). Covered by the e2e. |

Not app issues (harness notes): toasts were sampled 6s after submit, past sonner's 4s duration. On reload the reader session restores from sessionStorage by design, so a harness step that leaves a reader open carries it into the next `goto`.

Regression: `e2e/sn-366-paper-promote-back.spec.ts` covers the promote happy path from the chip context menu (keep chip) and from Save as paper over the reader (replace chip), plus Back to paper and Back to topic, including the paper-chip → full paper → PDF → Back to paper → Back to topic owner flow. Screenshots: `desktop-*.png` in this folder.

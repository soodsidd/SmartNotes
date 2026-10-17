# SN-333 PDF selection walkthrough

The production build ran through the registered SN-333 sidecar preview with an
isolated worktree vault. The PDF was the existing three-page catalogue fixture.
The answer endpoint was intercepted with a deterministic SSE response, so these
screenshots verify the browser selection, request payload, popover, and handoff;
they do not measure an external model response.

## Final visual evidence

- Desktop, 1360 × 900: [selected passage](desktop-selected.png), [right-click menu](desktop-context-menu.png), [free-text answer](desktop-final-answer.png).
- Phone, 430 × 932: [touch double-tap selection](phone-touch-selected.png), [answer](phone-touch-answer.png).

The desktop right-click and phone selection-menu actions both sent
`target: "Selection"` with the exact selected passage. The selected PDF overlay
remained visible after the popover opened. Explain, Summarize, and a free-text
question each used the captured text; Continue in Companion retained it in the
draft. Closing cleared the original overlay, selecting a new passage dismissed
the stale popover while retaining the new range, clipboard copy returned
`Catalogue (Final)`, and the page control advanced from page 1 to 2.

The UI reuses the existing EmbedPDF selection overlay, shared inline AI
popover, `--popover` and `--accent` tokens, and the documented 44px touch target.
The fix adds no color, spacing, or typography value.

Other screenshots in this directory record intermediate states from the same
walkthrough, including the menu hit-testing issue found and corrected on phone.

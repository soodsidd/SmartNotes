# SN-335 PDF Record desktop smoke

**Preview path.** The AV sidecar preview (`POST /api/preview/start`, autoPickPort)
failed twice with `Preview port … is already owned by another process`. The
flagged PID was the preview's own `node server.js` child, so this is the known
AV-277 limitation (the sidecar has no `wmic` on this host). This walkthrough
instead used the Playwright harness, with an isolated worktree `.e2e-vault` and
its own non-production port (3217).

**Setup.** Desktop at 1360 × 900, using the three-page catalogue fixture
attached to a fresh note. The Companion answer stream
(`/api/companion/fast-lane/send/stream`) was intercepted with a deterministic
SSE reply. These screenshots therefore verify the browser flow and the note
written to disk; they do not measure an external model response.

1. **Selection → Record.** A drag selection on page 1 showed the selection menu
   with Ask Companion, Record, and Record options… One tap on Record saved to
   the note containing the PDF, which is the default destination. The panel
   then showed "Saved in <note>" with Open note and Undo
   ([desktop-record-saved.png](desktop-record-saved.png)).
2. **Ask Companion → Explain → Record answer.** The popover showed Explain,
   Summarize, and the Record chip. After the answer arrived, Record answer saved
   the passage, the question, and the answer together
   ([desktop-answer-ready.png](desktop-answer-ready.png),
   [desktop-record-answer-saved.png](desktop-record-answer-saved.png)).
3. **Note on disk.** See [desktop-record-note-2.json](desktop-record-note-2.json).
   Each record contains:
   - the PDF title, `Page 1`, and the PDF path;
   - a `Return to PDF source` link ending in `#page=1`;
   - `Source passage (verbatim)` holding exactly `Catalogue (Final)`;
   - for the answer record, also `Question/action: Explain this text.` and a
     separately labeled `AI answer:`.

**Cosmetic follow-up.** The "Record answer" and "Continue in Companion →" links
render with no gap between them. This was left for review and not changed in
closeout.

# SN-279: Bibliography and shared paper pages

## Contract and screen intent

Papers are ordinary text pages owned by the permanent Bibliography library.
An immutable UUID identifies the object; a reference contains only that UUID.
The parent HTML is the source of truth for membership, so removing its last
chip removes the virtual child row without deleting the paper. Existing ingest
`.ref.json` metadata keeps its existing meaning and is never repurposed.

## Annotated UI specification

Use the notebook sidebar, standard editor, and Clarity references in
`Docs/design-system/` as the visual baseline. Bibliography precedes the notebook
list, including in the mobile sidebar sheet, regardless of open/closed notebooks.
Its disclosure contains search, title/recent sort, referring notebook and page
selects, a labelled creation field, and paper rows with reference counts.
Paper rows open the standard editor. Referring-page rows expand to virtual paper
children with a shared-link icon and no ownership mutation menu.

The text editor offers a labelled paper select and Insert reference action.
Chips expand in document flow into a same-origin, isolated instance of the
existing standard page shell. This intentionally reuses all page capabilities
(including Companion, comments, PDF durability, and annotations) rather than
implementing a second partial editor. The frame carries only a canonical path;
no body is copied into the parent. Ownership/breadcrumb chrome stays outside the
frame. A save handshake precedes collapse/back so failed writes retain the editor.
Recursive references start collapsed; an editor is created only on explicit
expansion, and the save handshake drains nested editors before their parent.

Desktop uses the existing sidebar density and full available editor width.
Mobile uses the existing sidebar sheet, wrapping controls, full-width frame,
44px targets, readable inputs, and no horizontal viewport overflow. Existing
Clarity surface, border, foreground, muted, accent, and ring tokens apply.

## States and accessibility

- Empty: explain canonical ownership and offer New paper.
- Loading: library/paper loading status, disable pending mutations.
- Error/permission failure: visible alert with Retry; preserve pending content.
- Missing reference: unavailable paper message; allow explicit chip removal.
- Populated/long content: wrapping ownership/title text, scrollable editor frame.
- Interrupted save: leave inline editor mounted; display failure and retry.
- Keyboard: labelled native selects/inputs, semantic buttons, visible focus;
  aria-expanded on disclosure/chips and titled iframe, back returns chip focus.

## Checkpoints and evidence

1. Identity/storage, protected ownership, reference indexing, persistence tests.
2. Bibliography navigation, virtual rows, inline editor and save handshake.
3. Targeted bibliography unit and desktop/mobile workflow catalog checks;
   screenshots, build/typecheck, sidecar registered preview and diagnostics.
4. Update sysdoc through AV CLI, persist one stewardship decision, verify
   closeout readiness, commit on assigned branch. Merge destination is only
   `test/bibliography-papers-2026-10-04`; brief remains open for owner testing.

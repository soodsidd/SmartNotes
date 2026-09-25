# Reading App companion package

Vault-native App page for tracking what I'm reading and pulling researched recommendations
out of the Smart Notes companion. Smart Notes core supplies only the generic SN-182 App/data
contracts and the SN-203 companion channel; everything book-specific lives here.

## Install / re-install

```powershell
node packages/books-app/setup/cli.mjs
```

Creates the App page from the maintained `blank-app` template in `Personal Notebook/Books`,
declares the two app-owned tables, imports the Goodreads workbook, and writes the source.
Re-run against an existing page to push source edits without touching row data:

```powershell
node packages/books-app/setup/cli.mjs --page "Personal Notebook/Books/reading.html"
```

Flags: `--sheet`, `--section`, `--title`, `--page`, `--port`.

## Where the data lives

- **Goodreads backlog** — imported into the App source as a static catalog snapshot
  (`/*__BOOKS_CATALOG__*/`). It is history, not live state, so it costs no rows and loads
  instantly. Re-run the installer to refresh it from the spreadsheet.
- **`shelf` table** (app-owned) — one row per book whose status or rating I have changed,
  plus books typed in by hand. Overlays the catalog by key.
- **`picks` table** (app-owned) — companion recommendations with their rich card payload and
  verdict (`new` / `want` / `dismissed`).

App queries are capped at 200 rows per table, which is why the 170-book backlog is a source
snapshot rather than seeded rows.

## Two-way companion round trip (SN-203)

1. **Show recommendations** calls `smartNotesApp.companion.send({ text, payload })`. The text
   is a self-contained research brief; the payload is a trimmed taste profile (loved books
   with my own review text, dislikes, current reads, queue, already-recommended titles) kept
   under the host's 8000-character payload budget.
2. The host injects that as an auto-run companion turn and opens the sidebar.
3. The companion researches, then calls `app_send` with
   `{ type: "recommendations", requestId, items: [...] }`.
4. `smartNotesApp.companion.onMessage` writes the items into `picks` and renders the cards.

`Tell me more` on a card repeats the round trip for one book and returns
`{ type: "detail", key, detail }`. Delivery is ephemeral: the App page must still be open when
the companion answers. Companion text is rendered with `textContent` only — never as HTML.

The app frame's CSP allows `img-src data: blob:` and no network, so there are no cover images;
cards are typographic and all enrichment arrives through the companion channel.

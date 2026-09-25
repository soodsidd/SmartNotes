# smart-notes

Mobile-first AI research vault. **Phase 0 spike** — see
[`Docs/mobile_ai_research_vault_design.md`](Docs/mobile_ai_research_vault_design.md)
for the full product design.

## What's in the spike

- Next.js 14 App Router PWA on port **3002**, registered in the gateway dashboard.
- Markdown-backed vault at `apps/smart-notes/vault/` (gitignored — your research is local-only).
- YAML front matter via `gray-matter`.
- API routes: `GET/POST /api/notes`, `GET/PUT/DELETE /api/notes/[slug]`, `POST /api/capture`.
- Phone-friendly note list, raw-markdown editor, live preview with KaTeX math via
  `react-markdown` + `remark-math` + `rehype-katex`.
- Paste capture on the home screen → drops into `inbox/` as a timestamped note.

## Not yet (Phase 1+)

- Tiptap WYSIWYG editor (markdown round-trip via remark-stringify, deferred).
- tldraw stylus canvas.
- AI Ask/Append integration.
- SQLite FTS5 search index.
- Git auto-commit on save.
- Image paste → `.assets/` folder.
- Auth on top of the gateway proxy.

## Run

The gateway supervises this app — start it from the gateway dashboard, or directly:

```powershell
cd apps/smart-notes
pnpm install   # from repo root, only the first time
pnpm build
pnpm start     # serves on :3002
```

## PWA install notes

- Android install prompts require HTTPS or `localhost`; plain LAN HTTP and most self-signed certificate setups will not trigger Chrome's install UI.
- When the app is served over HTTPS, Chrome on Android should expose `Install app` or `Add to Home screen` from the browser menu and launch Smart Notes in standalone mode.
- The service worker caches the app shell only. Vault and API responses stay network-backed, so offline note editing remains out of scope.

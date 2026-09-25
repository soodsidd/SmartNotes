# Smart Notes

Smart Notes is a local-first research notebook and installable web app. It keeps
notebooks as ordinary files on the host computer while providing rich-text
editing, ink, PDFs, local search, version history, backups, JupyterLab, and an
AI companion interface.

This repository contains the application source only. Notebook data, local
settings, credentials, build output, and recovery artifacts are intentionally
excluded from Git.

## Current capabilities

- Notebook, section, and page organization backed by an on-disk vault.
- Rich-text pages with math, tables, task lists, images, attachments, comments,
  collapsible headings, page TOCs, and text-page ink annotations.
- An immersive PDF reader with search, outlines, remembered position, night
  mode, two-page spreads, highlights, ink, and sidecar-based annotations that
  do not modify the original PDF.
- Local search, page versions and restore, scheduled backups, HTML/DOCX export,
  DOCX import, and print layouts.
- Installable desktop/mobile PWA behavior, camera capture, and Android share
  target ingest.
- Optional JupyterLab pages with a per-page working directory and embedded
  local runtime.
- Vault-native log, design, mini-app, and spreadsheet page types.
- Companion context and editing APIs for notes, PDFs, Jupyter notebooks, logs,
  spreadsheets, and mini-apps.

The implementation reference is
[`Docs/sysdoc/smart-notes.md`](Docs/sysdoc/smart-notes.md). The
[`Docs/PRD.md`](Docs/PRD.md) file records product direction and may include
future work.

## Requirements

- Node.js 20 or newer and npm.
- Windows is the primary development and deployment environment. Most of the
  app is portable, but native folder pickers, Explorer integration, and some
  runtime management are Windows-specific.
- Python 3 plus JupyterLab only if Jupyter pages are needed.
- Appropriate tldraw and Syncfusion licenses for the features and deployment
  context in which they are used.

## Fresh installation

```powershell
git clone https://github.com/soodsidd/SmartNotes.git
cd SmartNotes
npm ci
npm run dev
```

The development server listens on `http://localhost:3002` by default and writes
its development bundle to `.next-dev/`.

For a production build:

```powershell
npm run build
npm start
```

Set `PORT` or `HOST` when the defaults (`3002` and `0.0.0.0`) are not suitable.

## Vault data

The default vault is the repository's `vault/` directory. It is created on
first run and is ignored by Git, so cloning this repository starts with an
empty local vault and never downloads the owner's notebooks.

To keep notebook data elsewhere, set an absolute vault path before starting the
app:

```powershell
$env:SMART_NOTES_VAULT = "D:\Smart Notes Data\vault"
npm start
```

To move an existing installation to another computer, transfer the vault
separately through an approved private channel, then either place it at
`<repo>\vault` or point `SMART_NOTES_VAULT` to it. Do not add the vault to this
repository. Registered external notebook folders and machine-local app settings
also need to be configured on each computer.

## Local configuration and licenses

Create `.env.local` in the repository root for machine-specific build settings:

```dotenv
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=your-tldraw-key
NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY=your-syncfusion-key
```

Both values are optional for installation, but the corresponding SDK features
are subject to their vendors' licensing behavior. The tldraw key is embedded at
build time; after adding or changing it, run `npm run build` again. Syncfusion
is used only by spreadsheet pages.

`.env.local` is ignored by Git. Never commit license keys, ingest tokens, email
tokens, provider credentials, or notebook data.

## Optional JupyterLab profile

Smart Notes can use Jupyter from `PATH`, or a repo-local virtual environment for
a reproducible setup:

```powershell
python -m venv profiles/jupyter/.venv
& .\profiles\jupyter\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\profiles\jupyter\.venv\Scripts\python.exe -m pip install -r profiles/jupyter/requirements.txt
```

See [`profiles/jupyter/README.md`](profiles/jupyter/README.md) for macOS/Linux
commands and external-profile configuration.

## PWA and network use

- Browser installation requires HTTPS or `localhost`.
- The service worker caches the application shell, but the host runtime remains
  the source of truth for notebook reads and writes.
- The full application does not provide a general-purpose authentication layer.
  Keep it on a trusted machine/network or behind an access-controlled private
  tunnel. Public ingest and inbound-email routes have separate token controls;
  do not expose the entire app as a substitute.
- License keys prefixed with `NEXT_PUBLIC_` are present in the client bundle by
  design. Treat them according to the issuing vendor's rules.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the custom Next.js development server |
| `npm run build` | Create the production bundle and service worker |
| `npm start` | Start the app from a normal production bundle |
| `npm run start:stable` | Serve an existing prebuilt bundle |
| `npm test` | Run the Jest test suite serially |
| `npm run test:e2e` | Run the Playwright suite |
| `npm run test:e2e:desktop` | Run desktop Playwright coverage |
| `npm run test:e2e:mobile` | Run mobile Playwright coverage |
| `npm run lint` | Run the Next.js lint task |

## Repository layout

```text
src/app/                  Next.js pages and API routes
src/components/           Notebook, editor, PDF, Jupyter, and page-type UI
src/server/               Vault, ingest, Jupyter, backup, and filesystem logic
server.js                 Custom HTTP/WebSocket server
profiles/jupyter/         Optional managed Jupyter environment
tests/                    Jest coverage
e2e/                      Playwright coverage
Docs/sysdoc/smart-notes.md  Current system documentation
vault/                    Local notebook data (ignored by Git)
```

## Data ownership

Smart Notes is designed so the durable record is readable outside the app:
HTML pages and adjacent sidecar files live in the vault, attachments remain
ordinary files, and PDF annotations do not rewrite source PDFs. Back up the
vault independently of the application repository.

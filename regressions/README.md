# Regression suite

This folder is the version-controlled home for project regressions. The manifest on disk is the source of truth for test definitions; Ascent Vector stores run history only.

## Layout

```
regressions/
  manifest.json    # authoritative catalog
  README.md        # this file
  node/            # optional organizational subdirs
  cli/
  browser/
  python/
```

## Manifest schema

`manifest.json` is versioned JSON with a `tests[]` array. Each entry includes:

- `id` — stable identifier used by `av test run --test=<id>`
- `name` — short human label
- `description` — what the check verifies
- `appType` — one of `node`, `python`, `browser`, `cli`
- `command` — shell command to run in isolation
- `workingDirectory` — optional path relative to the repo root
- `timeoutMs` — per-test timeout (default 120000)
- `enabled` — when false, skipped by default suite runs
- `tags` — optional labels for filtering

## App-type rules

- **node** — npm scripts or shell commands (Vitest, typecheck, build smoke)
- **python** — pytest or venv-aware shell commands
- **browser** — preview health checks or Playwright smoke commands
- **cli** — Ascent Vector `av` subcommands

## Operator commands

```bash
av test init [--project=<project-id>]      # scaffold regressions/ on an existing repo
av test validate [--project=<project-id>]  # schema check without executing tests
av test list [--json] [--project=<id>]     # discover tests from the on-disk manifest
av test run [--all|--test=<id>|--app-type=<type>] [--fail-fast] [--json]
av test history [--project=<id>] [--limit=N] [--json]
```

Edits belong in this repo. Project Settings → Regression Suite is a read-only viewer.

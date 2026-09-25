# Agent Operations — Smart Notes

Reference for operators and developer agents working in this repo.

## Source of truth

- This document is the source of truth for operator workflows in Smart Notes.
- The `av` CLI lives in `C:\Projects\Ascent Vector\scripts\av.mjs` and is
  invoked from that directory via `npm run av -- <command>`.
- The CLI full reference is at `C:\Projects\Ascent Vector\docs\av-cli.md`.
- Never edit persisted state files by hand.

## Project ID

```
proj-mwb81k-mpiqp915
```

Use `--project=proj-mwb81k-mpiqp915` on any `av` command that requires project scope.

## Quickstart

All `av` commands run from `C:\Projects\Ascent Vector`:

```powershell
Set-Location "C:\Projects\Ascent Vector"
npm run av -- <command>
```

## Routine commands

```bash
# Read board state
npm run av -- fleet status
npm run av -- brief list --project=proj-mwb81k-mpiqp915
npm run av -- brief show <SN-N>
npm run av -- review queue

# Add a brief
npm run av -- brief add '<json>' --project=proj-mwb81k-mpiqp915

# Move a brief through the pipeline
npm run av -- brief status <SN-N> in_progress
npm run av -- brief lane <SN-N> in_progress
npm run av -- brief assign <SN-N> <agent-id>
npm run av -- brief status <SN-N> in_review
npm run av -- brief lane <SN-N> reviewer_check
npm run av -- brief review <SN-N> needs_review

# Closeout note after merge
npm run av -- brief comment <SN-N> "Merged after desktop verification."

# Hygiene
npm run av -- fleet reconcile
npm run av -- fleet reconcile --fix
```

## Brief statuses

`backlog` | `selected` | `in_progress` | `blocked` | `in_review` | `qa` | `ready` | `done` | `cancelled`

## PR card lanes

`planned` | `in_progress` | `reviewer_check` | `owner_review` | `rework` | `merged` | `rejected`

## Verification

- Prefer targeted unit tests for narrow changes.
- When E2E is required use the repo Playwright harness:
  `npm run test:e2e:desktop`, `npm run test:e2e:mobile`, or
  `npm run test:e2e -- <spec> --project=<project>`.
- If the E2E harness fails twice for environment reasons, report the exact
  command and error as the blocker.

## Merge and release

- Follow the merge/release checklist in `C:\Projects\Ascent Vector\docs\agent-operations.md`.
- Never force-push the default branch.
- Never delete an unmerged branch without explicit owner approval.
- After each merge, mark the linked brief done/merged and attach a closeout note.

## Gap reports

If the guide or CLI is missing a workflow, file the gap:

```bash
npm run av -- gap report '<description>'
```

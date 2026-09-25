# Project-backed JupyterLab Deep Work

**Status:** product plan; three stories created in backlog  
**Epic:** `epic-gigi1c-mtwbf5bw` — Project-backed JupyterLab Deep Work  
**Risk:** high · **Scope:** Smart Notes JupyterLab workspace + Ascent Vector handoff  
**Project:** Smart Notes (`proj-mwb81k-mpiqp915`)

---

## Product intent

Ascent Vector is the control plane for delegated engineering work: briefs,
agents, worktrees, regression evidence, review, merge, and release. Its Files
surface is useful for inspection and narrow edits, but it is not intended to be
the owner's primary environment for sustained collaboration on critical code.

Smart Notes is the stronger human-AI collaboration surface. Its companion,
inline AI, annotations, rich document views, and embedded JupyterLab allow the
owner to remain inside a problem while discussing, editing, executing, and
observing results. The missing product capability is to point that experience at
the exact project worktree where the engineering work lives.

The initiative therefore expands the existing JupyterLab workspace type into a
project-backed, executable **Deep Work workspace**. It does not create another
IDE inside Ascent Vector and does not copy source files into the Smart Notes
vault.

## Owner decisions captured

- The workspace is for more than code editing. Interactive execution and direct
  observation of results are first-class requirements.
- JupyterLab is the workspace engine. It owns files, terminals, kernels, code
  consoles, notebooks, saves, and rich execution outputs.
- A project or Ascent Vector worktree folder is opened in place as the
  JupyterLab root; files are never imported into or duplicated inside the vault.
- The owner can create `.ipynb` notebooks inside the project folder for
  exploration, testing, visualization, and algorithm development.
- Smart Notes adds a readily accessible workspace toolbar, companion and inline
  AI context, annotations, and richer viewers around the JupyterLab surface.
- Ascent Vector remains responsible for briefs, worktree lifecycle, recorded
  verification, review, merge, and release.
- Default-branch workspaces are read-only by default. The initial editable path
  is an explicit Ascent Vector worktree.
- The desired developer experience should feel familiar to a VS Code user
  through layout, fonts, themes, keyboard behavior, language intelligence, and
  a visible terminal, without attempting VS Code extension compatibility or
  pixel-for-pixel cloning.

## Existing foundation

### Ascent Vector

- Root-bounded project explorer with nested files, search, tabs, previews, and
  Monaco editing.
- Hash-guarded file writes and existing project/worktree/brief identity.
- Git, diff, regression, review, merge, release, runtime, and diagnostics
  control planes.
- Current companion context includes project and brief identity but not the
  active file, editor selection, or live file contents.

### Smart Notes

- Portable notebooks already register external host folders by reference and
  never delete their contents when unregistered.
- Embedded JupyterLab already supplies a file browser, text editors, terminals,
  kernels, notebooks, code consoles, outputs, LSP integration, and persistent
  user layout/settings.
- The same-origin focus bridge already recognizes ordinary JupyterLab file
  editors, captures workspace path/source/selection/caret, and can apply an
  undoable shared-model edit.
- The current runtime is still bound to a note-owned sibling `.jupyter` folder
  and requires its canonical `notebook.ipynb`.
- Inline AI is productized and tested primarily as notebook-cell AI. The full
  companion can identify another focused workspace file but its mutation tools
  intentionally target only the canonical saved notebook.
- Smart Notes annotations and companion history currently use page-adjacent
  sidecars, which must not be scattered through a source repository.

## Target experience

From an Ascent Vector brief, worktree, file, or diff, the owner chooses **Open
in Deep Work**. Smart Notes opens or resumes a workspace bound to the exact
worktree and focuses the requested file and line when supplied.

The owner can then:

1. Browse and edit the complete nested source tree.
2. Open a terminal whose working directory is the workspace root.
3. Run project commands, tests, scripts, and development processes.
4. Attach a source editor to a kernel-backed code console and execute a line or
   selection with rich results.
5. Create and run notebooks anywhere allowed inside the project folder.
6. Use inline AI for quick selection-scoped Explain, Ask, Fix, Rewrite, and
   comment-to-code operations.
7. Use the full companion for architectural discussion and bounded multi-file
   work with the active file, selection, brief, branch, and relevant execution
   context supplied explicitly.
8. Annotate important source or document ranges without adding Smart Notes
   metadata files to the repository.
9. Return to Ascent Vector to inspect the dirty tree and diff, record formal
   verification, review, commit, merge, and release.

Exploratory terminal, console, and notebook runs are part of Deep Work but do
not automatically count as Ascent Vector regression evidence. A deliberate
**Run verification** action may route through the AV catalog when recorded
evidence is required.

## Workspace toolbar

Smart Notes owns a thin responsive toolbar above the embedded JupyterLab frame.
It presents frequent cross-workspace actions without reimplementing Jupyter's
editor or runtime.

Always visible on desktop:

- Back/return navigation.
- Project name, branch/worktree badge, and read-only/editable state.
- Current file plus dirty/saved state.
- Save.
- Contextual Run action.
- Terminal.
- New notebook.
- Companion.

Contextual actions:

- Source file: Run selection, Run file, attach/open console, format, view diff.
- Notebook: Run cell, Run all, interrupt, restart kernel, select kernel.
- Markdown/HTML/PDF: edit/preview/annotate as supported by the selected surface.

Overflow actions:

- Reveal folder or open externally.
- Reload files or JupyterLab.
- Kernel/environment management.
- Theme, font, keybinding, and layout settings.
- Stop the workspace.
- Secondary Git/worktree information.

Mobile keeps the primary Run and Companion paths visible and moves lower-use
actions into the ellipsis. Terminal and New notebook must remain reachable in
one interaction from that menu.

## Developer experience profile

The initial profile builds on Smart Notes' pinned JupyterLab, `jupyterlab-lsp`,
and `python-lsp-server` installation. It should provide:

- Smart Notes-aligned light/dark themes with a compact VS Code-familiar option.
- Configurable code and UI fonts, size, line height, and optional ligatures.
- Line numbers, bracket matching/closing, indentation, wrapping, and familiar
  shortcuts.
- LSP completion, signatures, hover help, diagnostics, definition/reference
  navigation, and rename where the installed language server supports them.
- Explicit format-document/selection commands and an optional format-on-save
  preference.
- A bottom-panel terminal layout and persistent workspace arrangement.

JupyterLab extensions are curated and pinned by Smart Notes. Arbitrary extension
installation is not part of the MVP because extensions execute browser, server,
or kernel code and can destabilize the managed environment. VS Code `.vsix`
extensions are not compatible.

## Architecture and safety boundaries

### Workspace identity

A project workspace record addresses an Ascent Vector project/repository, exact
root path, branch/worktree, optional brief, access mode, and persistent Smart
Notes collaboration session. A workspace record is a capability-scoped pointer,
not a new copy of the project.

### Filesystem safety

- Editable roots must be explicitly registered and validated.
- Traversal and symlink escapes are rejected at every filesystem and runtime
  boundary.
- Excluded dependency, build, secret, and VCS paths are not sent to AI merely
  because they exist beneath the root.
- Main/default branch opens read-only unless the owner explicitly unlocks it.
- External changes from an agent, formatter, terminal, or IDE surface a reload
  or conflict state rather than silently overwriting newer bytes.

### Runtime ownership

- JupyterLab owns terminal, kernel, console, notebook, save, autosave, and
  execution-output lifecycle.
- Smart Notes invokes supported JupyterLab commands through the authenticated
  same-origin bridge and reflects runtime state in its toolbar.
- Terminals run with the host user's privileges. Starting one is an explicit
  owner action; terminal output is not silently injected into AI context.
- Long-running terminals and kernels remain discoverable and stoppable through
  the workspace and JupyterLab Running surfaces.

### Collaboration data

Source annotations and workspace companion state live under Smart Notes app
state, keyed by workspace identity and repository-relative file path. Anchors
include revision/range information so stale annotations can be detected or
relocated. No `.annotations.json` or `.companion.json` files are written beside
source files by default.

### Product ownership boundary

Smart Notes may show branch identity, dirty state, changed-file count, and an AV
deep link. Commit, formal verification, approval, merge, release, deployment,
and worktree cleanup remain Ascent Vector operations.

## Delivery plan: three stories

Three is the minimum safe split. Two stories would combine filesystem/runtime
safety, a substantial responsive UI, and AI/annotation write paths in the same
delivery unit. More than three would fragment the owner-facing workflow and
delay a coherent end-to-end slice.

### SN-256 — Open an AV worktree as an executable JupyterLab workspace

**Goal:** Mount an approved project worktree in place as a resumable JupyterLab
root with terminals, consoles, and freely created notebooks.

**Acceptance sketch:**

1. An explicit worktree folder opens without copying or changing existing files
   and without requiring a pre-existing canonical `notebook.ipynb`.
2. JupyterLab file operations, terminals, kernels, code consoles, and newly
   created notebooks are rooted in that worktree and survive workspace resume.
3. Root validation, symlink containment, editable/read-only policy, external
   change handling, and runtime shutdown are enforced.
4. Existing note-owned Jupyter pages continue to work unchanged.

**Evidence:** targeted runtime/path-validation tests plus manual terminal,
console, notebook-create, persistence, and no-copy verification.  
**Risk:** high.  
**Recommended assignee:** senior developer; Kyle when available in the live
roster. **Reviewer:** planner, with Sarah validating the owner workflow.  
**Budget cap:** 120k tokens, $25, 360 agent minutes, 2 implementation retries.

### SN-257 — Add the Deep Work toolbar and curated developer profile

**Goal:** Make execution and common editing controls immediately accessible and
give JupyterLab a durable VS Code-familiar development experience.

**Acceptance sketch:**

1. A responsive Smart Notes toolbar shows workspace/worktree identity,
   read-only/editable state, current file/save state, Run, Terminal, New
   notebook, Companion, and a context-aware overflow menu.
2. Source-file and notebook actions dispatch the appropriate authenticated
   JupyterLab commands without duplicating kernel or save ownership.
3. A curated profile supplies durable theme, font, layout, completion,
   signatures, diagnostics, formatting, and terminal preferences.
4. Desktop and mobile keep the document primary while preserving one-interaction
   access to execution and terminal controls.

**Evidence:** command-bridge unit tests, responsive component verification, and
manual keyboard/theme/LSP checks against the managed Jupyter profile.  
**Risk:** high.  
**Recommended assignee:** Leo for the shell/UI with a senior developer owning
the Jupyter command bridge. **Reviewer:** planner and Sarah.  
**Budget cap:** 100k tokens, $20, 300 agent minutes, 2 implementation retries.

### SN-258 — Connect workspace AI, annotations, and the AV return path

**Goal:** Turn the executable workspace into a complete owner-companion Deep
Work loop while keeping source and lifecycle authority safe.

**Acceptance sketch:**

1. Inline AI is deliberately supported for ordinary text/code documents and
   applies bounded, undoable edits to the captured live target.
2. The full companion receives explicit brief/worktree, active-file, selection,
   surrounding-source, and owner-approved execution context and can make
   conflict-aware bounded workspace edits.
3. Durable source/document annotations and companion sessions live outside the
   repository and detect stale anchors after file revisions.
4. Return to Ascent Vector preserves the brief/worktree relationship and opens
   the relevant dirty-tree/diff/review surface; AV retains formal lifecycle
   authority.

**Evidence:** focused bridge/context/write-conflict tests, annotation persistence
tests, and an owner walkthrough from AV brief to Deep Work and back.  
**Risk:** high.  
**Recommended assignee:** senior developer; Kyle when available. **Reviewer:**
planner, with Sarah validating the cross-product journey.  
**Budget cap:** 140k tokens, $30, 420 agent minutes, 2 implementation retries.

## E2E recommendation requiring owner approval

The initiative eventually warrants one minimal end-to-end flow because its main
risk is the cross-frame, cross-product contract: open one AV worktree, edit and
execute one Python selection, create one notebook, return to AV, and confirm the
worktree diff. No brief should receive the `--e2e` flag until the owner
explicitly approves that scope.

## Non-goals for the MVP

- Full VS Code feature or extension-marketplace parity.
- Multi-root or arbitrary remote/cloud filesystem mounts.
- Git commit, merge, release, or deployment from Smart Notes.
- Automatically treating exploratory execution as regression evidence.
- Sending terminal history, secrets, dependency trees, or the complete
  repository to an AI provider by default.
- Replacing JupyterLab kernels, terminals, editor models, saves, or output
  rendering with Smart Notes implementations.

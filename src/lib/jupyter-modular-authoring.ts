/**
 * SN-387: modular companion authoring guidance for Jupyter pages.
 *
 * Judgment-only guidance. Nothing here is enforced, checked, or nudged by a
 * tool result, and Smart Notes never scaffolds a layout. It rides in the
 * per-turn operating context (buildSmartNotesOperatingContext) rather than
 * only the default system prompt, because a persisted companion
 * agent-settings.json can fully replace DEFAULT_SYSTEM_PROMPT (sysdoc -> App
 * host channels) and would otherwise starve Jupyter turns of it.
 */

export interface JupyterModularAuthoringTarget {
  /** "page" = a vault Jupyter page's .jupyter folder; "workspace" = a Deep Work disk root. */
  kind: "page" | "workspace";
  /** How Companion writes module files in this turn. */
  writeHint: string;
}

const SHARED_GUIDANCE = [
  "- The notebook is for collaboration, exploration, and calling or inspecting functions. Real logic belongs in ordinary Python modules and directories, so cells do not fill up with long functions and code blocks.",
  "- You decide when to add structure: when the owner asks, when the notebook is getting large or hard to follow, or when the requested scope is too big for cells. Until then a notebook-only page stays notebook-only; do not add structure up front.",
  "- When you extract, move the code out rather than duplicating it: create the module, replace the cell's definitions with imports and calls, and keep cells thin (imports, parameters, calls, plots, inspection).",
  "- Expose small, composable functions that take parameters and return data (not print-only side effects), so the owner can call, interrogate, and play with them from cells.",
  "- Tests are welcome when they help but are never required. No packaging (pyproject, setup files) is needed; only add it if the owner asks.",
  "- Live import: the managed kernel runs IPython autoreload 2 with the folder root (and its src/ directory, if present) on sys.path, so after you edit a module the next cell run uses the new code without a restart. Packages in subdirectories import as usual (from lib import filters).",
  "- If autoreload cannot pick up a change (existing class instances, changed enums or dataclass fields, signatures captured in long-lived state), restart the kernel and re-run the needed cells, or tell the owner that a restart is needed.",
];

export function jupyterModularAuthoringGuidance(target: JupyterModularAuthoringTarget): string[] {
  const scope = target.kind === "page"
    ? "- Put modules and subdirectories inside this page's own .jupyter folder, beside notebook.ipynb."
    : "- Put modules where the repository's existing layout expects them. Never rearrange or rename existing folders; only add new files when needed.";
  return [
    "",
    "Modular notebook authoring (guidance, use your judgment):",
    ...SHARED_GUIDANCE.slice(0, 2),
    scope,
    ...SHARED_GUIDANCE.slice(2),
    target.writeHint,
  ];
}

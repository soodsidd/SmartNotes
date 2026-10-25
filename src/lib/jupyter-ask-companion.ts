import { INLINE_AI_TEXT_LIMIT, type InlineAiContext } from "@/lib/inline-ai";
import type { JupyterFocusSelection, JupyterFocusState } from "@/lib/jupyter-focus";
import { hasJupyterTextSelection } from "@/lib/jupyter-inline-ai";

/**
 * SN-363: Jupyter Lab capture for the shared Ask Companion contract (SN-362).
 * The snippet is the live selection, else the whole active cell (or file
 * window); the bounded five-cell window and the active cell's outputs are the
 * surrounding context. The same InlineAiContext shape as every other surface.
 */
export function jupyterAskCompanionContext(focus: JupyterFocusState): InlineAiContext {
  const content = focus.content;
  const source = content?.activeCellSource ?? "";
  const sourceStart = content?.activeCellSourceStart ?? 0;
  let selected = "";
  if (focus.selection && hasJupyterTextSelection(focus)) {
    const from = Math.min(focus.selection.start.offset, focus.selection.end.offset) - sourceStart;
    const to = Math.max(focus.selection.start.offset, focus.selection.end.offset) - sourceStart;
    selected = source.slice(Math.max(0, from), Math.max(0, to)).trim();
  }
  const cells = (content?.cells ?? []).map((cell) =>
    `# Cell ${cell.index + 1} (${cell.kind})${cell.index === focus.activeCellIndex ? " [active]" : ""}\n${cell.source}`);
  const outputs = (content?.activeCellOutputs ?? []).map((output) => `[${output.kind}] ${output.text}`);
  const surrounding = [
    ...(cells.length ? cells : [source]),
    ...(outputs.length ? [`# Active cell outputs\n${outputs.join("\n")}`] : []),
  ].join("\n\n");
  return {
    surface: "jupyter",
    target: selected ? "Selection" : focus.documentKind === "notebook" ? "Cell" : "File",
    text: (selected || source.trim()).slice(0, INLINE_AI_TEXT_LIMIT),
    pageText: surrounding.trim().slice(0, INLINE_AI_TEXT_LIMIT),
    tableText: "",
  };
}

export interface JupyterAskCompanionEditTarget {
  /** The live focus; its source/model revisions guard the bridge write. */
  focus: JupyterFocusState;
  selection: JupyterFocusSelection;
  mode: "replace" | "insert";
}

const samePosition = (a: JupyterFocusSelection["start"], b: JupyterFocusSelection["start"]) =>
  a.line === b.line && a.column === b.column && a.offset === b.offset;

/**
 * SN-363 Edit, mirroring the rich-text rule: replace the original selection
 * only while it is still live and its text is unchanged; otherwise insert at
 * the live caret of the active cell. Never writes into a different document.
 */
export function jupyterAskCompanionEditTarget(
  captured: JupyterFocusState,
  live: JupyterFocusState | null
): JupyterAskCompanionEditTarget | null {
  if (!live || live.pagePath !== captured.pagePath || !live.workspacePath || live.workspacePath !== captured.workspacePath) return null;
  if (!live.sourceRevision || !Number.isInteger(live.modelRevision)) return null;
  const selectionStillLive = Boolean(
    captured.selection && hasJupyterTextSelection(captured) && live.selection &&
    live.activeCellIndex === captured.activeCellIndex && live.activeCellId === captured.activeCellId &&
    live.sourceRevision === captured.sourceRevision &&
    samePosition(live.selection.start, captured.selection.start) && samePosition(live.selection.end, captured.selection.end)
  );
  if (selectionStillLive) return { focus: live, selection: live.selection!, mode: "replace" };
  if (!live.caret) return null;
  return { focus: live, selection: { start: live.caret, end: live.caret }, mode: "insert" };
}

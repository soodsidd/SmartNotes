export const JUPYTER_FOCUS_MESSAGE_SOURCE = "smart-notes-jupyter-focus";
export const JUPYTER_HOST_MESSAGE_SOURCE = "smart-notes-jupyter-host";
export const JUPYTER_FOCUS_MESSAGE_VERSION = 2;

export const JUPYTER_CONTEXT_MAX_CELLS = 5;
export const JUPYTER_CELL_SOURCE_MAX_BYTES = 12 * 1024;
/** SN-250: raised from 48 KiB to make room for the active cell's bounded execution outputs alongside the existing 5-cell source window. */
export const JUPYTER_CONTEXT_MAX_BYTES = 64 * 1024;
export const JUPYTER_SELECTION_MAX_RECTS = 32;
export const JUPYTER_ANSWER_MAX_BYTES = 48 * 1024;
/** SN-250: at most this many of the active cell's most recent execution outputs are included (errors are always kept). */
export const JUPYTER_OUTPUT_MAX_ITEMS = 3;
/** SN-250: per-output text budget, mirroring the source byte caps above. */
export const JUPYTER_OUTPUT_MAX_BYTES = 2 * 1024;

export type JupyterFocusDocumentKind = "notebook" | "file" | "other";
export type JupyterCellKind = "code" | "markdown" | "raw" | "unknown";

/**
 * Semantic commands accepted by the authenticated Deep Work bridge. The
 * injected frame maps these names onto its pinned JupyterLab command IDs; the
 * host can never ask Lab to execute an arbitrary command string.
 */
export type JupyterDeepWorkCommand =
  | "save"
  | "run-selection"
  | "run-file"
  | "open-console"
  | "format-document"
  | "format-selection"
  | "run-cell"
  | "run-all"
  | "interrupt-kernel"
  | "restart-kernel"
  | "select-kernel"
  | "open-terminal"
  | "new-notebook"
  | "reload-files"
  | "reload-document"
  | "open-settings"
  | "manage-kernels"
  | "focus-file";

export interface JupyterFocusPosition {
  /** Zero-based editor line. */
  line: number;
  /** Zero-based editor column. */
  column: number;
  /** Zero-based character offset within the active editor/cell. */
  offset: number;
}

export interface JupyterFocusSelection {
  start: JupyterFocusPosition;
  end: JupyterFocusPosition;
}

/** Coordinates are relative to the Jupyter iframe's viewport. */
export interface JupyterSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface JupyterCellContent {
  index: number;
  id: string | null;
  kind: JupyterCellKind;
  source: string;
  sourceTruncated: boolean;
}

/** SN-250: one bounded execution-output entry for the active cell (stream text, an error/traceback summary, or a text/plain result). */
export interface JupyterCellOutput {
  kind: string;
  text: string;
  truncated: boolean;
}

export interface JupyterContentSnapshot {
  activeCellSource: string | null;
  /** Absolute character offset represented by activeCellSource[0] (file editors may send a nearby window). */
  activeCellSourceStart?: number;
  activeCellSourceTruncated: boolean;
  /**
   * SN-250: bounded slice of the active cell's latest execution outputs, most
   * recent first with any error/traceback always retained. Optional so older
   * bridge payloads without this field still parse; absent is treated as no
   * outputs captured.
   */
  activeCellOutputs?: JupyterCellOutput[];
  /** True when execution outputs beyond the bounded window were omitted. */
  activeCellOutputsTruncated?: boolean;
  cells: JupyterCellContent[];
  /** True when cells outside the bounded five-cell window were omitted. */
  windowTruncated: boolean;
}

export interface JupyterFocusState {
  /** Smart Notes page that owns the embedded JupyterLab session. */
  pagePath: string;
  /** JupyterLab document path relative to the note's `.jupyter` root. */
  workspacePath: string | null;
  documentKind: JupyterFocusDocumentKind | null;
  /** Live Jupyter document-model dirty state; null when no document owns focus. */
  isDirty: boolean | null;
  /** Zero-based notebook cell index, when the focused document is a notebook. */
  activeCellIndex: number | null;
  /** Stable nbformat/Jupyter cell id, when exposed by JupyterLab. */
  activeCellId: string | null;
  /** Fingerprint of the exact live editor/cell source captured with this focus. */
  sourceRevision?: string | null;
  /** Monotonic shared-model revision, rejecting change-then-revert races. */
  modelRevision?: number | null;
  caret: JupyterFocusPosition | null;
  selection: JupyterFocusSelection | null;
  selectionRects: JupyterSelectionRect[];
  content: JupyterContentSnapshot | null;
}

export interface JupyterContextMenuEvent {
  pagePath: string;
  x: number;
  y: number;
  focus: JupyterFocusState;
}

export interface JupyterApplyAnswerResult {
  pagePath: string;
  requestId: string;
  ok: boolean;
  reason: string | null;
  focus: JupyterFocusState | null;
}

export interface JupyterApplyAnswerMessage {
  source: typeof JUPYTER_HOST_MESSAGE_SOURCE;
  version: typeof JUPYTER_FOCUS_MESSAGE_VERSION;
  kind: "apply-answer";
  requestId: string;
  answer: string;
  target: {
    workspacePath: string;
    activeCellIndex: number | null;
    activeCellId: string | null;
    sourceRevision: string;
    modelRevision: number;
    caret: JupyterFocusPosition | null;
    selection: JupyterFocusSelection | null;
  };
}

export interface JupyterCommandMessage {
  source: typeof JUPYTER_HOST_MESSAGE_SOURCE;
  version: typeof JUPYTER_FOCUS_MESSAGE_VERSION;
  kind: "command";
  requestId: string;
  command: JupyterDeepWorkCommand;
  path?: string;
  line?: number;
}

export interface JupyterCommandResult {
  pagePath: string;
  requestId: string;
  command: JupyterDeepWorkCommand;
  ok: boolean;
  reason: string | null;
  focus: JupyterFocusState | null;
}

export interface JupyterOverlayDismissEvent {
  pagePath: string;
  reason: "scroll";
}

/** SN-252: chord identifiers the injected bridge may report via a `kind: "keybinding"` message. */
export type JupyterInlineAiKeybindingId = "comment-append";

export interface JupyterInlineAiKeybindingEvent {
  pagePath: string;
  binding: JupyterInlineAiKeybindingId;
  focus: JupyterFocusState;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function boundedInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
    ? (value as number)
    : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Jupyter's contents API and Lab shell report paths relative to ServerApp.root_dir.
 * Keep that contract explicit and reject absolute/traversal-shaped bridge input.
 */
export function normalizeJupyterWorkspacePath(value: unknown): string | null {
  const text = boundedText(value, 1024);
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === ".")
  ) {
    return null;
  }
  return normalized;
}

function parsePosition(value: unknown): JupyterFocusPosition | null {
  if (!isRecord(value)) return null;
  const line = boundedInteger(value.line, 10_000_000);
  const column = boundedInteger(value.column, 10_000_000);
  const offset = boundedInteger(value.offset, 100_000_000);
  return line === null || column === null || offset === null ? null : { line, column, offset };
}

function parseSelection(value: unknown): JupyterFocusSelection | null {
  if (!isRecord(value)) return null;
  const start = parsePosition(value.start);
  const end = parsePosition(value.end);
  return start && end ? { start, end } : null;
}

function parseSelectionRect(value: unknown): JupyterSelectionRect | null {
  if (!isRecord(value)) return null;
  const x = boundedNumber(value.x, -1_000_000, 1_000_000);
  const y = boundedNumber(value.y, -1_000_000, 1_000_000);
  const width = boundedNumber(value.width, 0, 1_000_000);
  const height = boundedNumber(value.height, 0, 1_000_000);
  if (x === null || y === null || width === null || height === null) return null;
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
  };
}

function parseSelectionRects(value: unknown): JupyterSelectionRect[] | null {
  if (!Array.isArray(value) || value.length > JUPYTER_SELECTION_MAX_RECTS) return null;
  const rects = value.map(parseSelectionRect);
  return rects.every((rect): rect is JupyterSelectionRect => rect !== null) ? rects : null;
}

function parseCellContent(value: unknown): JupyterCellContent | null {
  if (!isRecord(value)) return null;
  const index = boundedInteger(value.index, 10_000_000);
  if (index === null || typeof value.source !== "string") return null;
  if (utf8ByteLength(value.source) > JUPYTER_CELL_SOURCE_MAX_BYTES) return null;
  const id = value.id === null || value.id === undefined ? null : boundedText(value.id, 200);
  if (value.id !== null && value.id !== undefined && id === null) return null;
  const kind: JupyterCellKind =
    value.kind === "code" || value.kind === "markdown" || value.kind === "raw"
      ? value.kind
      : "unknown";
  if (value.kind !== undefined && value.kind !== "unknown" && kind === "unknown") return null;
  if (typeof value.sourceTruncated !== "boolean") return null;
  return { index, id, kind, source: value.source, sourceTruncated: value.sourceTruncated };
}

/** SN-250: one execution-output entry — kind is a short nbformat output_type label ("stream", "error", "execute_result", "display_data"). */
function parseCellOutput(value: unknown): JupyterCellOutput | null {
  if (!isRecord(value)) return null;
  const kind = boundedText(value.kind, 40);
  if (!kind) return null;
  if (typeof value.text !== "string" || utf8ByteLength(value.text) > JUPYTER_OUTPUT_MAX_BYTES) return null;
  if (typeof value.truncated !== "boolean") return null;
  return { kind, text: value.text, truncated: value.truncated };
}

function parseCellOutputs(value: unknown): JupyterCellOutput[] | null {
  if (!Array.isArray(value) || value.length > JUPYTER_OUTPUT_MAX_ITEMS) return null;
  const outputs = value.map(parseCellOutput);
  return outputs.every((output): output is JupyterCellOutput => output !== null) ? outputs : null;
}

function parseContent(value: unknown, activeCellIndex: number | null): JupyterContentSnapshot | null {
  if (!isRecord(value) || utf8ByteLength(JSON.stringify(value)) > JUPYTER_CONTEXT_MAX_BYTES) return null;
  if (!Array.isArray(value.cells) || value.cells.length > JUPYTER_CONTEXT_MAX_CELLS) return null;
  const cells = value.cells.map(parseCellContent);
  if (!cells.every((cell): cell is JupyterCellContent => cell !== null)) return null;
  if (new Set(cells.map((cell) => cell.index)).size !== cells.length) return null;
  if (value.activeCellSource !== null && typeof value.activeCellSource !== "string") return null;
  if (
    typeof value.activeCellSource === "string" &&
    utf8ByteLength(value.activeCellSource) > JUPYTER_CELL_SOURCE_MAX_BYTES
  ) {
    return null;
  }
  if (typeof value.activeCellSourceTruncated !== "boolean" || typeof value.windowTruncated !== "boolean") {
    return null;
  }
  const activeCellSourceStart = value.activeCellSourceStart === undefined
    ? 0
    : boundedInteger(value.activeCellSourceStart, 100_000_000);
  if (activeCellSourceStart === null) return null;
  // SN-250: absent is a valid, older-payload-compatible "no outputs captured"; present-but-malformed is rejected.
  const activeCellOutputs = value.activeCellOutputs === undefined ? [] : parseCellOutputs(value.activeCellOutputs);
  if (activeCellOutputs === null) return null;
  if (value.activeCellOutputsTruncated !== undefined && typeof value.activeCellOutputsTruncated !== "boolean") {
    return null;
  }
  const activeCellOutputsTruncated = value.activeCellOutputsTruncated === true;
  const activeCell = activeCellIndex === null ? null : cells.find((cell) => cell.index === activeCellIndex);
  if (
    activeCell &&
    (activeCellSourceStart !== 0 ||
      activeCell.source !== value.activeCellSource ||
      activeCell.sourceTruncated !== value.activeCellSourceTruncated)
  ) {
    return null;
  }
  return {
    activeCellSource: value.activeCellSource,
    activeCellSourceStart,
    activeCellSourceTruncated: value.activeCellSourceTruncated,
    activeCellOutputs,
    activeCellOutputsTruncated,
    cells,
    windowTruncated: value.windowTruncated,
  };
}

function parseFocus(value: unknown, pagePath: string): JupyterFocusState | null {
  if (!isRecord(value)) return null;
  const workspacePath = value.workspacePath === null || value.workspacePath === undefined
    ? null
    : normalizeJupyterWorkspacePath(value.workspacePath);
  if (value.workspacePath !== null && value.workspacePath !== undefined && workspacePath === null) return null;

  const documentKind =
    value.documentKind === "notebook" || value.documentKind === "file" || value.documentKind === "other"
      ? value.documentKind
      : null;
  if (value.isDirty !== undefined && value.isDirty !== null && typeof value.isDirty !== "boolean") {
    return null;
  }
  const isDirty = typeof value.isDirty === "boolean" ? value.isDirty : null;
  const activeCellIndex = boundedInteger(value.activeCellIndex, 10_000_000);
  const activeCellId = value.activeCellId === null || value.activeCellId === undefined
    ? null
    : boundedText(value.activeCellId, 200);
  const sourceRevision = value.sourceRevision === null || value.sourceRevision === undefined
    ? null
    : boundedText(value.sourceRevision, 100);
  if (value.sourceRevision !== null && value.sourceRevision !== undefined && sourceRevision === null) return null;
  const modelRevision = value.modelRevision === null || value.modelRevision === undefined
    ? null
    : boundedInteger(value.modelRevision, Number.MAX_SAFE_INTEGER);
  if (value.modelRevision !== null && value.modelRevision !== undefined && modelRevision === null) return null;
  const selectionRects = parseSelectionRects(value.selectionRects ?? []);
  if (selectionRects === null) return null;
  const content = value.content === null || value.content === undefined
    ? null
    : parseContent(value.content, activeCellIndex);
  if (value.content !== null && value.content !== undefined && content === null) return null;

  return {
    pagePath,
    workspacePath,
    documentKind,
    isDirty,
    activeCellIndex,
    activeCellId,
    sourceRevision,
    modelRevision,
    caret: parsePosition(value.caret),
    selection: parseSelection(value.selection),
    selectionRects,
    content,
  };
}

const JUPYTER_DEEP_WORK_COMMANDS = new Set<JupyterDeepWorkCommand>([
  "save",
  "run-selection",
  "run-file",
  "open-console",
  "format-document",
  "format-selection",
  "run-cell",
  "run-all",
  "interrupt-kernel",
  "restart-kernel",
  "select-kernel",
  "open-terminal",
  "new-notebook",
  "reload-files",
  "reload-document",
  "open-settings",
  "manage-kernels",
  "focus-file",
]);

function parseDeepWorkCommand(value: unknown): JupyterDeepWorkCommand | null {
  return typeof value === "string" && JUPYTER_DEEP_WORK_COMMANDS.has(value as JupyterDeepWorkCommand)
    ? value as JupyterDeepWorkCommand
    : null;
}

/** Validate a focus object again at the server boundary. */
export function parseJupyterInlineContext(value: unknown, pagePath: string): JupyterFocusState | null {
  return parseFocus(value, pagePath);
}

/**
 * Validate the narrow postMessage contract before any frame data reaches turn
 * context. The caller separately authenticates event.source and event.origin.
 */
export function parseJupyterFocusMessage(value: unknown, pagePath: string): JupyterFocusState | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "focus"
  ) {
    return null;
  }
  return parseFocus(value.focus, pagePath);
}

export function parseJupyterContextMenuMessage(value: unknown, pagePath: string): JupyterContextMenuEvent | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "contextmenu" ||
    !isRecord(value.contextmenu)
  ) {
    return null;
  }
  const x = boundedNumber(value.contextmenu.x, -1_000_000, 1_000_000);
  const y = boundedNumber(value.contextmenu.y, -1_000_000, 1_000_000);
  const focus = parseFocus(value.focus, pagePath);
  return x === null || y === null || !focus ? null : { pagePath, x, y, focus };
}

export function parseJupyterOverlayDismissMessage(
  value: unknown,
  pagePath: string
): JupyterOverlayDismissEvent | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "dismiss-overlay" ||
    value.reason !== "scroll"
  ) {
    return null;
  }
  return { pagePath, reason: "scroll" };
}

/**
 * SN-252: the injected bridge captures a conflict-free chord (Ctrl/Cmd+Alt+Enter)
 * itself, since the caret lives inside the same-origin iframe, and forwards it
 * with a freshly-computed focus snapshot rather than relying on the last
 * throttled focus report. The host decides whether the caret is actually on a
 * natural-language comment (`findJupyterNaturalLanguageComment`) and no-ops
 * otherwise, so this parser only validates the message shape/authenticity.
 */
export function parseJupyterInlineAiKeybindingMessage(
  value: unknown,
  pagePath: string
): JupyterInlineAiKeybindingEvent | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "keybinding" ||
    !isRecord(value.keybinding)
  ) {
    return null;
  }
  const binding = value.keybinding.binding;
  if (binding !== "comment-append") return null;
  const focus = parseFocus(value.focus, pagePath);
  return focus ? { pagePath, binding, focus } : null;
}

export function parseJupyterApplyAnswerResult(
  value: unknown,
  pagePath: string
): JupyterApplyAnswerResult | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "apply-answer-result" ||
    !isRecord(value.result)
  ) {
    return null;
  }
  const requestId = boundedText(value.result.requestId, 200);
  if (!requestId || typeof value.result.ok !== "boolean") return null;
  const reason = value.result.reason === null || value.result.reason === undefined
    ? null
    : boundedText(value.result.reason, 500);
  if (value.result.reason !== null && value.result.reason !== undefined && reason === null) return null;
  const focus = value.focus === null || value.focus === undefined ? null : parseFocus(value.focus, pagePath);
  if (value.focus !== null && value.focus !== undefined && !focus) return null;
  return { pagePath, requestId, ok: value.result.ok, reason, focus };
}

export function parseJupyterCommandResult(
  value: unknown,
  pagePath: string
): JupyterCommandResult | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== JUPYTER_FOCUS_MESSAGE_SOURCE ||
    value.version !== JUPYTER_FOCUS_MESSAGE_VERSION ||
    value.kind !== "command-result" ||
    !isRecord(value.result)
  ) {
    return null;
  }
  const requestId = boundedText(value.result.requestId, 200);
  const command = parseDeepWorkCommand(value.result.command);
  if (!requestId || !command || typeof value.result.ok !== "boolean") return null;
  const reason = value.result.reason === null || value.result.reason === undefined
    ? null
    : boundedText(value.result.reason, 500);
  if (value.result.reason !== null && value.result.reason !== undefined && reason === null) return null;
  const focus = value.focus === null || value.focus === undefined ? null : parseFocus(value.focus, pagePath);
  if (value.focus !== null && value.focus !== undefined && !focus) return null;
  return { pagePath, requestId, command, ok: value.result.ok, reason, focus };
}

export function createJupyterCommandMessage(
  requestId: string,
  command: JupyterDeepWorkCommand,
  target?: { path?: string; line?: number }
): JupyterCommandMessage | null {
  const safeRequestId = boundedText(requestId, 200);
  if (!safeRequestId || !JUPYTER_DEEP_WORK_COMMANDS.has(command)) return null;
  const message: JupyterCommandMessage = {
    source: JUPYTER_HOST_MESSAGE_SOURCE,
    version: JUPYTER_FOCUS_MESSAGE_VERSION,
    kind: "command",
    requestId: safeRequestId,
    command,
  };
  // SN-270: `reload-document` is path-addressed for the same reason
  // `focus-file` is. The command crosses a frame boundary and is applied
  // asynchronously, so "reload whatever is focused" would reload whichever
  // document happened to win the race. The path travels with the envelope and
  // the bridge re-checks it against the live focus immediately before running.
  if (command === "focus-file" || command === "reload-document") {
    const path = normalizeJupyterWorkspacePath(target?.path);
    if (!path) return null;
    message.path = path;
    if (command === "focus-file" && target?.line !== undefined) {
      if (!Number.isInteger(target.line) || target.line < 1 || target.line > 10_000_000) return null;
      message.line = target.line;
    }
  }
  return message;
}

export function createJupyterApplyAnswerMessage(
  requestId: string,
  answer: string,
  focus: JupyterFocusState,
  selectionOverride?: JupyterFocusSelection
): JupyterApplyAnswerMessage | null {
  const safeRequestId = boundedText(requestId, 200);
  if (!safeRequestId || typeof answer !== "string" || utf8ByteLength(answer) > JUPYTER_ANSWER_MAX_BYTES) {
    return null;
  }
  if (!focus.workspacePath || !focus.sourceRevision || !Number.isInteger(focus.modelRevision)) return null;
  return {
    source: JUPYTER_HOST_MESSAGE_SOURCE,
    version: JUPYTER_FOCUS_MESSAGE_VERSION,
    kind: "apply-answer",
    requestId: safeRequestId,
    answer,
    target: {
      workspacePath: focus.workspacePath,
      activeCellIndex: focus.activeCellIndex,
      activeCellId: focus.activeCellId,
      sourceRevision: focus.sourceRevision,
      modelRevision: focus.modelRevision!,
      caret: focus.caret,
      selection: selectionOverride ?? focus.selection,
    },
  };
}

/** Only focus owned by the currently open Jupyter page may enter a turn. */
export function jupyterFocusForPage(
  focus: JupyterFocusState | null | undefined,
  pagePath: string,
  noteType: string | undefined
): JupyterFocusState | null {
  return noteType === "jupyter" && focus?.pagePath === pagePath ? focus : null;
}

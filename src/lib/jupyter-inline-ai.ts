import type {
  JupyterFocusSelection,
  JupyterFocusState,
} from "@/lib/jupyter-focus";

export type JupyterInlineAiActionId =
  | "explain"
  | "ask"
  | "fix"
  | "rewrite"
  | "comment-to-code"
  | "comment-answer"
  | "comment-to-code-append";

export interface JupyterInlineAiAction {
  id: JupyterInlineAiActionId;
  label: string;
  testId: string;
  disabled?: boolean;
  hint?: string;
}

export interface JupyterNaturalLanguageComment {
  text: string;
  prefix: string;
  indentation: string;
  selection: JupyterFocusSelection;
  /**
   * SN-269: how the owner pointed at the comment. `caret` is the collapsed
   * caret / Alt+Right-click target; `selection` is an active text selection
   * covering the whole comment. The origin decides whether Write code replaces
   * the comment line or preserves it and appends code below.
   */
  origin: JupyterNaturalLanguageCommentOrigin;
}

export type JupyterNaturalLanguageCommentOrigin = "caret" | "selection";

export type JupyterInlineAiAnswerRoute = "overlay" | "notebook";

const FAST_LANE_MODEL_HINTS: Record<string, string[]> = {
  claude: ["haiku", "sonnet", "opus"],
  ghcopilot: ["auto", "mini", "fast"],
  codex: ["mini", "gpt-5", "o3"],
  cursor: ["auto", "composer", "sonnet", "opus"],
};

export function pickJupyterFastLaneModel(providerId: string, models: string[]): string {
  const hints = FAST_LANE_MODEL_HINTS[providerId] ?? [];
  for (const hint of hints) {
    const match = models.find((model) => model.toLowerCase().includes(hint));
    if (match) return match;
  }
  return models[0] ?? "";
}

const STANDARD_ACTIONS: ReadonlyArray<Pick<JupyterInlineAiAction, "id" | "label" | "testId">> = [
  { id: "explain", label: "Explain", testId: "jupyter-inline-explain" },
  { id: "ask", label: "Ask", testId: "jupyter-inline-ask" },
  { id: "fix", label: "Fix", testId: "jupyter-inline-fix" },
  { id: "rewrite", label: "Rewrite", testId: "jupyter-inline-rewrite" },
];

export function hasJupyterTextSelection(focus: JupyterFocusState): boolean {
  const selection = focus.selection;
  return Boolean(selection && selection.start.offset !== selection.end.offset);
}

function cellLineAtOffset(
  focus: JupyterFocusState,
  absoluteOffset: number
): { source: string; line: string; start: number; end: number } | null {
  const source = focus.content?.activeCellSource;
  const sourceStart = focus.content?.activeCellSourceStart ?? 0;
  const localOffset = absoluteOffset - sourceStart;
  if (typeof source !== "string" || localOffset < 0 || localOffset > source.length) return null;

  const localStart = source.lastIndexOf("\n", Math.max(0, localOffset - 1)) + 1;
  const newline = source.indexOf("\n", localOffset);
  const localEnd = newline === -1 ? source.length : newline;
  return {
    source,
    line: source.slice(localStart, localEnd),
    start: sourceStart + localStart,
    end: sourceStart + localEnd,
  };
}

interface ParsedCommentLine {
  indentation: string;
  prefix: string;
  gap: string;
  text: string;
}

/**
 * Parses a plain-language comment line without depending on the notebook
 * language. The common line-comment forms cover Python/R/shell,
 * JavaScript/TypeScript, SQL/Lua, and MATLAB/Julia cells.
 */
function parseNaturalLanguageCommentLine(line: string): ParsedCommentLine | null {
  const match = line.match(/^(\s*)(#|\/\/|--|%|;)(\s*)(.+?)\s*$/);
  if (!match) return null;
  const [, indentation = "", prefix = "", gap = "", body = ""] = match;
  const text = body.trim();
  if (text.length < 3 || !/[A-Za-z]{2}/.test(text)) return null;
  return { indentation, prefix, gap, text };
}

function commentLineSelection(
  line: number,
  bounds: { start: number; end: number }
): JupyterFocusSelection {
  return {
    start: { line, column: 0, offset: bounds.start },
    end: { line, column: bounds.end - bounds.start, offset: bounds.end },
  };
}

/**
 * SN-269: recognises an active selection that covers a natural-language
 * comment. The owner's most obvious gesture — select the comment, then ask for
 * code — used to remove Write code entirely, because comment detection bailed
 * out on any selection. A match requires the selection to stay on one line and
 * to cover the comment's whole body, so partial word selections inside a
 * comment and multi-line selections still read as ordinary code selections.
 */
function findSelectedNaturalLanguageComment(
  focus: JupyterFocusState
): JupyterNaturalLanguageComment | null {
  const selection = focus.selection;
  if (!selection) return null;
  const from = Math.min(selection.start.offset, selection.end.offset);
  const to = Math.max(selection.start.offset, selection.end.offset);

  const current = cellLineAtOffset(focus, from);
  if (!current) return null;
  // A selection running past the line end spans multiple lines: not a comment target.
  if (to > current.end) return null;

  const parsed = parseNaturalLanguageCommentLine(current.line);
  if (!parsed) return null;

  const bodyStart =
    current.start + parsed.indentation.length + parsed.prefix.length + parsed.gap.length;
  const bodyEnd = bodyStart + parsed.text.length;
  // Require the whole comment body: a few selected words inside a comment stay
  // an ordinary code selection (Explain / Ask / Fix / Rewrite only).
  if (from > bodyStart || to < bodyEnd) return null;

  const anchorLine =
    selection.start.offset <= selection.end.offset ? selection.start.line : selection.end.line;
  return {
    text: parsed.text,
    prefix: parsed.prefix,
    indentation: parsed.indentation,
    origin: "selection",
    selection: commentLineSelection(anchorLine, current),
  };
}

/**
 * Finds a plain-language comment the owner is pointing at, either with a
 * collapsed caret / Alt+Right-click target (SN-249, SN-252) or with a
 * selection covering the whole comment (SN-269).
 */
export function findJupyterNaturalLanguageComment(
  focus: JupyterFocusState
): JupyterNaturalLanguageComment | null {
  if (hasJupyterTextSelection(focus)) return findSelectedNaturalLanguageComment(focus);

  const caret = focus.caret;
  if (!caret) return null;
  const current = cellLineAtOffset(focus, caret.offset);
  if (!current) return null;
  const parsed = parseNaturalLanguageCommentLine(current.line);
  if (!parsed) return null;

  return {
    text: parsed.text,
    prefix: parsed.prefix,
    indentation: parsed.indentation,
    origin: "caret",
    selection: commentLineSelection(caret.line, current),
  };
}

/** Shared action-list shape for selection and context-menu invocation. */
export function buildJupyterInlineAiActions(
  focus: JupyterFocusState,
  options: { allowMutations?: boolean } = {}
): JupyterInlineAiAction[] {
  const hasSelection = hasJupyterTextSelection(focus);
  const comment = findJupyterNaturalLanguageComment(focus);
  const allowMutations = options.allowMutations !== false;
  const actions: JupyterInlineAiAction[] = STANDARD_ACTIONS.map((action) => ({
    ...action,
    disabled:
      ((action.id === "fix" || action.id === "rewrite") && !hasSelection) ||
      (!allowMutations && (action.id === "fix" || action.id === "rewrite")),
    hint:
      !allowMutations && (action.id === "fix" || action.id === "rewrite")
        ? "Workspace is read-only"
        : (action.id === "fix" || action.id === "rewrite") && !hasSelection
        ? "Select code first"
        : undefined,
  }));

  if (comment) {
    actions.push({
      id: "comment-to-code",
      label: "Write code",
      testId: "jupyter-inline-comment-to-code",
      disabled: !allowMutations,
      hint: allowMutations ? undefined : "Workspace is read-only",
    });
    // SN-269: a selected comment offers Write code only. Answer comment stays
    // on the caret / Alt+Right-click target, where the owner has not already
    // expressed the "act on exactly this text" intent that a selection carries.
    if (comment.origin === "caret") {
      actions.push({
        id: "comment-answer",
        label: "Answer comment",
        testId: "jupyter-inline-comment-answer",
        disabled: !allowMutations,
        hint: allowMutations ? undefined : "Workspace is read-only",
      });
    }
  }
  return actions;
}

export function jupyterInlineAiAnswerRoute(
  action: JupyterInlineAiActionId
): JupyterInlineAiAnswerRoute {
  return action === "explain" || action === "ask" ? "overlay" : "notebook";
}

/**
 * SN-253/SN-255: actions whose turn is rendered as a live conversation stream
 * in the chip overlay while the model works. Answer comment needs the stream
 * because its reply may be prose; Write code / Fix / Rewrite / append need it
 * so a slow turn shows live text instead of an opaque spinner (SN-255).
 */
export function jupyterInlineAiStreamsToOverlay(action: JupyterInlineAiActionId): boolean {
  return (
    action === "comment-answer" ||
    action === "comment-to-code" ||
    action === "comment-to-code-append" ||
    action === "fix" ||
    action === "rewrite"
  );
}

/**
 * Instructions shared by every notebook-routed action (Fix, Rewrite, and the
 * comment-to-code conversion): the model is editing a live Jupyter cell, not
 * chatting, so a conversational refusal or clarifying question would be
 * written straight into the notebook if it slipped through. `isJupyterInlineAiConversationalProse`
 * is a defensive net for when the model ignores this anyway (SN-251).
 */
const NEVER_CHAT_CLAUSE =
  "You are editing code directly inside a Jupyter cell, not chatting. Output ONLY the resulting code: no Markdown fence, no explanation, no clarifying questions, and no conversational text of any kind.";

export function buildJupyterInlineAiPrompt(
  action: JupyterInlineAiActionId,
  focus: JupyterFocusState,
  question = ""
): string {
  const comment = findJupyterNaturalLanguageComment(focus);
  switch (action) {
    case "explain":
      return "Explain the selected code concisely in plain text. Do not modify or rewrite it.";
    case "ask":
      return `Answer this question about the current Jupyter context concisely in plain text: ${question.trim()}`;
    case "fix": {
      const hint = question.trim();
      const hintClause = hint
        ? ` The owner says what to fix: ${hint}.`
        : " The owner did not describe a symptom; fix whatever is obviously broken in the selection.";
      return (
        `${NEVER_CHAT_CLAUSE}${hintClause}` +
        " If the selection has no clear defect, return the selection exactly as-is, unchanged" +
        " — never ask what the problem is and never reply with prose."
      );
    }
    case "rewrite":
      return (
        `${NEVER_CHAT_CLAUSE} Rewrite the selected code for clarity while preserving its behavior.` +
        " If it is already clear, return the selection exactly as-is, unchanged."
      );
    case "comment-to-code":
    case "comment-to-code-append":
      return `${NEVER_CHAT_CLAUSE} Turn this natural-language cell comment into working code: ${comment?.text ?? ""}`;
    case "comment-answer":
      // SN-254: bias hard toward runnable code. Incomplete vault/runtime context
      // is not a reason to open a clarifying interview — use assumptions, stubs,
      // TODOs, or clearly marked placeholders. Prose is a last resort only when
      // any code answer would be dishonest or impossible; that prose is never
      // written into the cell (SN-253).
      return (
        "A Jupyter cell comment asks for something. The comment line itself stays in the" +
        " notebook exactly as written — never repeat it, never restate it, and never return it.\n\n" +
        "Always attempt runnable code first. Prefer ONLY a fenced code block containing" +
        " working code for this notebook's language. When vault, data, or runtime context is" +
        " incomplete, still write code using reasonable assumptions, stubs, TODOs, or clearly" +
        " marked placeholders — do not open with clarifying questions or an interview.\n" +
        "Reply in plain prose with no code fence ONLY as a last resort when any code answer" +
        " would be dishonest or impossible. Prose is shown to the owner and is never written" +
        " into the notebook.\n\n" +
        `The comment: ${comment?.text ?? ""}`
      );
  }
}

export interface JupyterCommentAnswerCompanionHandoffInput {
  comment: string;
  modelReply: string;
  pagePath: string;
  pageTitle?: string;
}

/**
 * SN-254: prefilled Companion composer payload when Answer comment returns
 * prose/give-up. Bubble stays a disposable turn; Companion owns back-and-forth.
 */
export function buildJupyterCommentAnswerCompanionHandoff(
  input: JupyterCommentAnswerCompanionHandoffInput
): string {
  const focusLabel = input.pageTitle?.trim()
    ? `${input.pageTitle.trim()} (${input.pagePath})`
    : input.pagePath;
  return [
    "Continue this Jupyter inline AI task with fuller context and tools.",
    "",
    `Notebook focus: ${focusLabel}`,
    "",
    "Original cell comment:",
    input.comment.trim() || "(empty)",
    "",
    "Inline AI reply (prose / incomplete):",
    input.modelReply.trim() || "(empty)",
    "",
    "Please continue from here — deepen the answer or produce the code the inline turn could not.",
  ].join("\n");
}

export type JupyterCommentAnswerOutcome =
  | { kind: "code"; code: string }
  | { kind: "prose"; text: string };

/**
 * SN-253: "Answer comment" is the one action whose route is decided by the
 * reply, not the request. Executable answers append below the untouched
 * comment; conversational answers stay in the overlay and are never written
 * into the cell as commented lines.
 */
export function resolveJupyterCommentAnswerOutcome(answer: string): JupyterCommentAnswerOutcome {
  const content = stripJupyterCodeFence(answer).trimEnd();
  if (!content.trim()) return { kind: "prose", text: answer.trim() };
  if (isJupyterInlineAiConversationalProse(content) || !looksLikeJupyterCode(answer)) {
    return { kind: "prose", text: content };
  }
  return { kind: "code", code: content };
}

/** Notebook-routed actions whose successful answer must be executable code, not prose. */
export function jupyterInlineAiExpectsCode(action: JupyterInlineAiActionId): boolean {
  return (
    action === "fix" ||
    action === "rewrite" ||
    action === "comment-to-code" ||
    action === "comment-to-code-append"
  );
}

const CONVERSATIONAL_LEAD_INS: RegExp[] = [
  /^i'?m sorry\b/i,
  /^sorry[,.]/i,
  /^i cannot\b/i,
  /^i can'?t\b/i,
  /^i'?m (not sure|unable)\b/i,
  /^i am (not sure|unable)\b/i,
  /^i don'?t (see|know|have)\b/i,
  /^i do not (see|know|have)\b/i,
  /^could you\b/i,
  /^can you\b/i,
  /^would you\b/i,
  /^what\b/i,
  /^which\b/i,
  /^please (provide|share|clarify|specify|describe|let)\b/i,
  /^it (looks|seems) like\b/i,
  /^i'?d be happy\b/i,
  /^i would be happy\b/i,
  /^let me know\b/i,
  /^without (more|additional)\b/i,
  /^i need (more|additional)\b/i,
  /^unfortunately\b/i,
  /^as an ai\b/i,
  /^to help you\b/i,
  /^in order to help\b/i,
  /^hi[,!]?\s/i,
  /^hello[,!]?\s/i,
  /^sure[,!]/i,
  /^certainly[,!]/i,
  /^no (bug|issue|problem)s? (found|detected|spotted)\b/i,
];

/**
 * Heuristic net for a model that answered a notebook-routed action (Fix,
 * Rewrite, Write code) with conversational prose — a refusal or clarifying
 * question — instead of code. Matches on conversational lead-in phrasing so
 * legitimate code (which essentially never opens with these phrases) is not
 * flagged. SN-251: such a response must never be applied to the cell.
 */
export function isJupyterInlineAiConversationalProse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const firstLine = trimmed.split(/\r?\n/, 1)[0]!.trim();
  return CONVERSATIONAL_LEAD_INS.some((pattern) => pattern.test(firstLine));
}

export function stripJupyterCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return (match?.[1] ?? trimmed).replace(/\s+$/, "");
}

function looksLikeJupyterCode(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;

  // If the model wrapped its answer in a code fence, treat it as code.
  if (/```/.test(text)) return true;

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0] ?? "";

  // Common statement starters.
  if (
    /^(def|class|import|from|return|for|while|if|elif|else|try|except|with|lambda|@)\b/i.test(first)
  ) {
    return true;
  }

  // Assignments like `x = 1`.
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+/.test(first)) return true;

  // Comparisons / arrows / blocks.
  if (/[=<>!]=/.test(first) || /->/.test(first) || /:\s*$/.test(first)) return true;

  // Multi-line: require at least two "code-ish" lines.
  const codeLineCount = lines.filter(
    (l) =>
      /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*.+/.test(l) ||
      /^print\s*\(/i.test(l) ||
      /\breturn\b/i.test(l) ||
      /[;{}[\]]/.test(l)
  ).length;
  return codeLineCount >= 2 && lines.length >= 2;
}

export interface JupyterInlineAiNotebookWrite {
  text: string;
  selection?: JupyterFocusSelection;
}

/**
 * Builds the collapsed insertion that appends `code` on its own line(s)
 * directly below `comment`, at the comment line's end offset. Because start
 * and end are the same position the bridge performs a pure insert inside one
 * shared-model transaction — one Jupyter undo step — and the comment line is
 * never part of the replaced range. Shared by comment-to-code-append (SN-252)
 * and the code branch of comment-answer (SN-253).
 */
function appendCodeBelowComment(
  comment: JupyterNaturalLanguageComment,
  code: string
): JupyterInlineAiNotebookWrite {
  const indented = code
    .split(/\r?\n/)
    .map((line) => (line.length ? `${comment.indentation}${line}` : line))
    .join("\n");
  return {
    text: `\n${indented}`,
    selection: { start: comment.selection.end, end: comment.selection.end },
  };
}

/**
 * Returns the cell write for a notebook-routed action, or `null` when the
 * reply must not be written into the notebook at all. Today only
 * "Answer comment" can return `null` — SN-253: a conversational answer stays
 * in the overlay stream instead of being forced into `# …` lines.
 */
export function formatJupyterInlineAiNotebookAnswer(
  action: JupyterInlineAiActionId,
  answer: string,
  focus: JupyterFocusState
): JupyterInlineAiNotebookWrite | null {
  const comment = findJupyterNaturalLanguageComment(focus);
  if (action === "comment-answer" && comment) {
    const outcome = resolveJupyterCommentAnswerOutcome(answer);
    // SN-253: prose is never applied to the cell, and code is appended below
    // the original comment rather than replacing it.
    if (outcome.kind === "prose") return null;
    return appendCodeBelowComment(comment, outcome.code);
  }
  if (action === "comment-to-code" && comment) {
    // SN-269: a selected comment is the owner's written request, so it is
    // preserved and the generated code is appended below it as one collapsed
    // insert. The caret / Alt+Right-click target keeps SN-249's
    // replace-the-comment-line conversion.
    return comment.origin === "selection"
      ? appendCodeBelowComment(comment, stripJupyterCodeFence(answer))
      : { text: stripJupyterCodeFence(answer), selection: comment.selection };
  }
  if (action === "comment-to-code-append" && comment) {
    // SN-252: unlike comment-to-code (which replaces the comment line), this
    // keeps the comment intact and inserts the generated code as new,
    // comment-indented line(s) immediately below it.
    return appendCodeBelowComment(comment, stripJupyterCodeFence(answer));
  }
  return { text: stripJupyterCodeFence(answer) };
}

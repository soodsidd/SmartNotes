import type { Editor } from "@tiptap/react";
import { inlineAiRelayPrompt, inlineAiTurnProvider } from "@/lib/inline-ai";
import { applyInlineAiEditorAnswer } from "@/lib/inline-ai-edit";
import { applyInlineAiRelayEvent, createInlineAiRelayMirror } from "@/lib/inline-ai-relay";
import { mergeRestoredCompanionMessages } from "@/lib/ai-sidebar";

jest.mock("@/lib/rich-text-editor-config", () => ({
  looksLikeMarkdown: (text: string) => /^\s*([-*] |#)/m.test(text),
  parseMarkdownToTiptapJson: (text: string) => ({ type: "doc", content: [{ type: "parsed", text }] }),
}));

const context = { surface: "text" as const, target: "Selection", text: "the clause", pageText: "Before the clause after", tableText: "row" };

describe("SN-362 Fast/Slow provider routing", () => {
  it("routes Fast through the configured fast provider for one turn and Slow through the sidebar choice", () => {
    const sidebar = { providerId: "codex", model: "sidebar-model" };
    const fast = { providerId: "claude", model: "fast-model" };
    expect(inlineAiTurnProvider("fast", sidebar, fast)).toEqual(fast);
    expect(inlineAiTurnProvider("slow", sidebar, fast)).toEqual(sidebar);
    expect(sidebar).toEqual({ providerId: "codex", model: "sidebar-model" });
    expect(fast).toEqual({ providerId: "claude", model: "fast-model" });
  });
});

describe("SN-362 relay prompt", () => {
  it("leads with the question and sends the selection plus surrounding page context as untrusted data", () => {
    const prompt = inlineAiRelayPrompt("Explain this", context);
    expect(prompt.startsWith("Ask Companion (Selection): Explain this")).toBe(true);
    expect(prompt).toContain('"text":"the clause"');
    expect(prompt).toContain('"pageText":"Before the clause after"');
    expect(prompt).toContain('"tableText":"row"');
    expect(prompt).toContain("untrusted data");
    expect(prompt).not.toContain("Edit mode");
  });
  it("asks for insertable text only in Edit mode", () => {
    expect(inlineAiRelayPrompt("Rewrite", context, { edit: true })).toContain("Reply with only that text");
  });
});

describe("SN-362 popup stream mirror", () => {
  const observer = () => ({ onText: jest.fn(), onDone: jest.fn(), onError: jest.fn() });

  it("mirrors only the shared turn's tokens, skips replays, and completes with the full text", () => {
    const o = observer();
    const mirror = createInlineAiRelayMirror("turn-1", o);
    expect(applyInlineAiRelayEvent(mirror, { turn_id: "other", seq: 0, type: "token", payload: { text: "X" } })).toBe(false);
    applyInlineAiRelayEvent(mirror, { turn_id: "turn-1", seq: 0, type: "token", payload: { text: "Hello" } });
    applyInlineAiRelayEvent(mirror, { turn_id: "turn-1", seq: 0, type: "token", payload: { text: "Hello" } });
    applyInlineAiRelayEvent(mirror, { turn_id: "turn-1", seq: 1, type: "thinking", payload: { text: "hmm" } });
    applyInlineAiRelayEvent(mirror, { turn_id: "turn-1", seq: 2, type: "token", payload: { text: " world" } });
    expect(o.onText.mock.calls.map(([t]) => t)).toEqual(["Hello", "Hello world"]);
    expect(applyInlineAiRelayEvent(mirror, { turn_id: "turn-1", seq: 3, type: "done", payload: { status: "completed" } })).toBe(true);
    expect(o.onDone).toHaveBeenCalledWith("Hello world");
    expect(o.onError).not.toHaveBeenCalled();
  });

  it("reports provider errors and non-completed terminal states", () => {
    const failed = observer();
    expect(applyInlineAiRelayEvent(createInlineAiRelayMirror("t", failed), { turn_id: "t", seq: 0, type: "error", payload: { message: "Auth failed" } })).toBe(true);
    expect(failed.onError).toHaveBeenCalledWith("Auth failed");
    const cancelled = observer();
    applyInlineAiRelayEvent(createInlineAiRelayMirror("t", cancelled), { turn_id: "t", seq: 0, type: "done", payload: { status: "cancelled" } });
    expect(cancelled.onDone).not.toHaveBeenCalled();
    expect(cancelled.onError).toHaveBeenCalledTimes(1);
  });
});

function fakeEditor(selection: { from: number; to: number }, text: string, isEditable = true) {
  const insertText = jest.fn(() => ({}));
  const dispatch = jest.fn();
  const focus = jest.fn();
  const insertContentAt = jest.fn();
  const chain = { focus: () => chain, insertContentAt: (...args: unknown[]) => { insertContentAt(...args); return chain; }, run: () => true };
  const editor = {
    isEditable,
    state: { selection, doc: { textBetween: jest.fn(() => text) }, tr: { insertText } },
    view: { dispatch }, commands: { focus }, chain: () => chain,
  } as unknown as Editor;
  return { editor, insertText, dispatch, insertContentAt };
}

describe("SN-362 Edit insertion", () => {
  it("replaces the live captured selection after Edit finishes", () => {
    const { editor, insertText, dispatch } = fakeEditor({ from: 4, to: 10 }, "phrase");
    expect(applyInlineAiEditorAnswer(editor, " replacement ", { from: 4, to: 10, text: "phrase" })).toBe(true);
    expect(insertText).toHaveBeenCalledWith("replacement", 4, 10);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("inserts at the current caret when the original selection is no longer live", () => {
    const { editor, insertText } = fakeEditor({ from: 20, to: 20 }, "");
    expect(applyInlineAiEditorAnswer(editor, "answer", { from: 4, to: 10, text: "phrase" })).toBe(true);
    expect(insertText).toHaveBeenCalledWith("answer", 20, 20);
  });

  it("does not replace a same-range selection whose text changed", () => {
    const { editor, insertText } = fakeEditor({ from: 4, to: 10 }, "edited");
    applyInlineAiEditorAnswer(editor, "answer", { from: 4, to: 10, text: "phrase" });
    expect(insertText).toHaveBeenCalledWith("answer", 4, 4);
  });

  it("inserts multi-paragraph or markdown answers as parsed blocks", () => {
    const { editor, insertText, insertContentAt } = fakeEditor({ from: 4, to: 10 }, "phrase");
    expect(applyInlineAiEditorAnswer(editor, "First.\n\nSecond.", { from: 4, to: 10, text: "phrase" })).toBe(true);
    expect(insertText).not.toHaveBeenCalled();
    expect(insertContentAt).toHaveBeenCalledWith({ from: 4, to: 10 }, { type: "doc", content: [{ type: "parsed", text: "First.\n\nSecond." }] });
  });

  it("refuses empty answers and read-only editors", () => {
    expect(applyInlineAiEditorAnswer(fakeEditor({ from: 1, to: 1 }, "").editor, "  ", null)).toBe(false);
    expect(applyInlineAiEditorAnswer(fakeEditor({ from: 1, to: 1 }, "", false).editor, "text", null)).toBe(false);
  });
});

describe("SN-362 shared transcript survives a late Keep ON restore", () => {
  it("keeps the relayed turn and prepends stored history without duplicates", () => {
    const stored = [{ id: "u0", content: "old question" }, { id: "a0", content: "old answer" }, { id: "u1", content: "Ask Companion" }];
    const live = [{ id: "u1", content: "Ask Companion" }, { id: "a1", content: "streaming" }];
    expect(mergeRestoredCompanionMessages(stored, live).map((m) => m.id)).toEqual(["u0", "a0", "u1", "a1"]);
    expect(mergeRestoredCompanionMessages([], live)).toEqual(live);
  });
});

/**
 * Unit tests for Chat UI Polish (SN-17).
 * Covers: markdown render path, settings modal, dead chips, paste-to-attach.
 */

import * as fs from "fs";
import * as path from "path";

const SIDEBAR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/ai-sidebar.tsx"),
  "utf8"
);
const NOTEBOOK_SHELL_SRC = fs.readFileSync(
  path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
  "utf8"
);

// ─── Markdown render path ─────────────────────────────────────────────────────

describe("Chat markdown render path", () => {
  it("imports react-markdown, remark-gfm, remark-math, and rehype-katex", () => {
    expect(SIDEBAR_SRC).toContain('import ReactMarkdown from "react-markdown"');
    expect(SIDEBAR_SRC).toContain('import remarkGfm from "remark-gfm"');
    expect(SIDEBAR_SRC).toContain('import remarkMath from "remark-math"');
    expect(SIDEBAR_SRC).toContain('"rehype-katex"');
  });

  it("assistant text entries render via ReactMarkdown with remarkGfm and remarkMath", () => {
    expect(SIDEBAR_SRC).toContain("remarkPlugins={[remarkGfm, remarkMath]}");
    expect(SIDEBAR_SRC).toContain("rehypeKatex");
    expect(SIDEBAR_SRC).toContain("<ReactMarkdown");
  });

  it("user bubbles do NOT use ReactMarkdown — they stay plain whitespace-pre-wrap", () => {
    const userBranchStart = SIDEBAR_SRC.indexOf('{isUser ? (');
    const userBranchEnd = SIDEBAR_SRC.indexOf(") : (", userBranchStart);
    expect(userBranchStart).toBeGreaterThan(-1);
    expect(userBranchEnd).toBeGreaterThan(userBranchStart);

    const userBranch = SIDEBAR_SRC.slice(userBranchStart, userBranchEnd);
    expect(userBranch).not.toContain("ReactMarkdown");
    expect(userBranch).toContain("whitespace-pre-wrap");
  });
});

// ─── Settings modal ───────────────────────────────────────────────────────────

describe("Chat settings modal", () => {
  it("replaces MoreHorizontal with the Settings gear icon", () => {
    expect(SIDEBAR_SRC).not.toContain("MoreHorizontal");
    expect(SIDEBAR_SRC).toContain("Settings");
    expect(SIDEBAR_SRC).toContain('<Settings className="size-3.5"');
  });

  it("opens a Dialog (not a DropdownMenu) for the desktop header settings", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="ai-settings-dialog"');
    expect(SIDEBAR_SRC).toContain("<DialogTitle>AI Settings</DialogTitle>");
  });

  it("renders ChatSettingsPanel inside the dialog", () => {
    expect(SIDEBAR_SRC).toContain("<ChatSettingsPanel");
  });

  it("adds a System prompt section with textarea, reset, and save controls", () => {
    expect(SIDEBAR_SRC).toContain("System prompt");
    expect(SIDEBAR_SRC).toContain('data-testid="ai-system-prompt"');
    expect(SIDEBAR_SRC).toContain('data-testid="ai-system-prompt-save"');
    expect(SIDEBAR_SRC).toContain('data-testid="ai-system-prompt-reset"');
    expect(SIDEBAR_SRC).toContain("defaultSystemPrompt");
    expect(SIDEBAR_SRC).toContain("onSystemPromptSave");
    expect(SIDEBAR_SRC).toContain("sm:max-w-lg");
    expect(SIDEBAR_SRC).toContain("DialogDescription");
  });

  it("settings open state initialises to false", () => {
    expect(SIDEBAR_SRC).toContain("React.useState(false)");
  });

  it("inline DesktopSelectorMenu no longer appears in the toolbar", () => {
    expect(SIDEBAR_SRC).not.toContain("DesktopSelectorMenu");
  });
});

// ─── Font size consistency ────────────────────────────────────────────────────

describe("Chat chip font size", () => {
  it("scope chip uses text-[11px] — consistent with Clarity sidebar chips", () => {
    // The chip row onToggleScope button
    const chipStart = SIDEBAR_SRC.indexOf("SIDEBAR_SCOPE_CHIP_CLASS");
    const chipEnd = SIDEBAR_SRC.indexOf(";", chipStart);
    const chip = SIDEBAR_SRC.slice(chipStart, chipEnd);
    expect(chip).toContain("text-[11px]");
    expect(chip).not.toContain("text-[10px]");
  });

  it("renders the scope control in the desktop AI header and mobile sheet controls", () => {
    expect(SIDEBAR_SRC).toContain('data-testid={mobile ? "mobile-ai-sheet" : "ai-sidebar"}');
    expect(SIDEBAR_SRC).toContain('"ai-scope-control"');
    expect(SIDEBAR_SRC).toContain('"ai-scope-control-mobile"');
    expect(SIDEBAR_SRC).toContain("onScopeChange");
    expect(SIDEBAR_SRC).toContain("{scopeLabel} · {tokenLabel}");
    expect(SIDEBAR_SRC).toContain("function AiScopeControl");
  });
});

// ─── Dead chips removed ───────────────────────────────────────────────────────

describe("Dead context chips", () => {
  it("'2 related' chip is removed from the UI", () => {
    expect(SIDEBAR_SRC).not.toContain("2 related");
  });

  it("'+ context' chip is removed from the UI", () => {
    expect(SIDEBAR_SRC).not.toContain("+ context");
  });
});

describe("Page tree row actions", () => {
  const NOTEBOOK_SHELL_SRC = fs.readFileSync(
    path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("adds indent and outdent actions to the page menu", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("page-indent-");
    expect(NOTEBOOK_SHELL_SRC).toContain("page-outdent-");
    expect(NOTEBOOK_SHELL_SRC).toContain("disabled={!nestingState.canIndent}");
    expect(NOTEBOOK_SHELL_SRC).toContain("disabled={!nestingState.canOutdent}");
    expect(NOTEBOOK_SHELL_SRC).toContain("Indent");
    expect(NOTEBOOK_SHELL_SRC).toContain("Outdent");
  });

  it("wires drag reorder and nesting affordances for notebook-root pages", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("nestingLookup: buildPageNestingActionLookup(flatNodes)");
    expect(NOTEBOOK_SHELL_SRC).toContain("draggedPageSectionPathRef.current = notebook.path");
    expect(NOTEBOOK_SHELL_SRC).toContain("pages: notebook.pages");
  });
});

// ─── Paste-to-attach ─────────────────────────────────────────────────────────

describe("Paste-to-attach", () => {
  it("textarea has an onPaste handler", () => {
    expect(SIDEBAR_SRC).toContain("onPaste=");
  });

  it("file picker accepts images, text, Markdown, HTML, and PDFs", () => {
    expect(SIDEBAR_SRC).toContain('accept={COMPANION_ATTACHMENT_ACCEPT}');
    expect(SIDEBAR_SRC).toContain(".txt,.md,.markdown,.html,.htm,.pdf");
    expect(SIDEBAR_SRC).toContain("text/html");
  });

  it("text, Markdown, and HTML attachments are read client-side", () => {
    expect(SIDEBAR_SRC).toContain("readFileAsText(file)");
    expect(SIDEBAR_SRC).toContain("reader.readAsText(file)");
    expect(SIDEBAR_SRC).toContain("getTextAttachmentKind(file)");
    expect(SIDEBAR_SRC).toContain('return "html"');
  });

  it("onPaste filters for supported clipboard file attachments", () => {
    expect(SIDEBAR_SRC).toContain("event.clipboardData.files");
    expect(SIDEBAR_SRC).toContain("isSupportedCompanionAttachment");
  });

  it("allows attach-only image and PDF sends through the shell submit guard", () => {
    const notebookShellSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(notebookShellSrc).toContain(
      "const hasUploadedAttachment = imageAttachments.length > 0 || pdfAttachments.length > 0;"
    );
    expect(notebookShellSrc).toContain(
      "if (!draft || (!prompt.trim() && !hasUploadedAttachment) || activeTurnIdRef.current)"
    );
  });

  it("keeps companion draft typing out of ReliableNotebookShell state", () => {
    expect(NOTEBOOK_SHELL_SRC).not.toContain("const [aiInput, setAiInput]");
    expect(NOTEBOOK_SHELL_SRC).not.toContain("onInputChange={setAiInput}");
    expect(SIDEBAR_SRC).toContain("const [composerDraft, setComposerDraft] = React.useState(initialComposerDraft)");
    expect(SIDEBAR_SRC).toContain("composerResetKey?: string | number");
    expect(NOTEBOOK_SHELL_SRC).toContain("const aiComposerSnapshotRef = React.useRef<AiComposerSnapshot>");
    expect(SIDEBAR_SRC).toContain("onComposerSnapshot?: (snapshot: AiComposerSnapshot) => void");
    expect(SIDEBAR_SRC).toContain("onSubmit: (prompt: string, attachments?: AiComposerAttachment[]) => void");
  });

  it("persists terminal companion transcripts before clearing live-turn recovery state", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("const pendingTerminalTurnPersistRef = React.useRef");
    expect(NOTEBOOK_SHELL_SRC).toContain(
      "await saveCompanionThread(pending.path, pending.scopeKey, aiMessages);"
    );
    expect(NOTEBOOK_SHELL_SRC).toContain(
      "await clearCompanionActiveTurnPointer(pending.path, pending.scopeKey);"
    );
    expect(NOTEBOOK_SHELL_SRC).toContain("finalizeActiveTurn({ persistTranscript: true });");
    expect(NOTEBOOK_SHELL_SRC).toContain(
      "pendingTerminalTurnPersistRef.current = context;"
    );
  });

  it("Paperclip button is no longer disabled", () => {
    // Old code had a permanently disabled Paperclip button; current code wires onClick.
    const paperclipIdx = SIDEBAR_SRC.indexOf('<Paperclip className="size-3.5"');
    expect(paperclipIdx).toBeGreaterThan(-1);

    // Look at the Button block containing the Paperclip
    const blockStart = SIDEBAR_SRC.lastIndexOf("<Button", paperclipIdx);
    const blockEnd = SIDEBAR_SRC.indexOf("</Button>", blockStart);
    const block = SIDEBAR_SRC.slice(blockStart, blockEnd);

    // Should have onClick (file picker) and NOT have a bare `disabled` keyword
    expect(block).toContain('onClick={() => fileInputRef.current?.click()');
    expect(block).not.toMatch(/\bdisabled\b(?!\s*=)/);
  });

  it("attachment preview strip is present in the render", () => {
    expect(SIDEBAR_SRC).toContain("attachments.length > 0");
    expect(SIDEBAR_SRC).toContain("URL.revokeObjectURL");
    expect(SIDEBAR_SRC).toContain("<FileText");
    expect(SIDEBAR_SRC).toContain("<Code2");
  });

  it("onAttach prop is added to AiConversationProps", () => {
    expect(SIDEBAR_SRC).toContain("onAttach?:");
  });
});

// ─── Active turn composer state (SN-29) ──────────────────────────────────────

describe("Active turn composer state", () => {
  it("accepts isTurnActive and onCancel props on AiConversationProps", () => {
    expect(SIDEBAR_SRC).toContain("isTurnActive?:");
    expect(SIDEBAR_SRC).toContain("onCancel?:");
  });

  it("marks the composer with data-turn-active while a turn runs", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="ai-composer"');
    expect(SIDEBAR_SRC).toContain('data-turn-active={isTurnActive ? "true" : "false"}');
  });

  it("locks the composer and shows Working… while isTurnActive", () => {
    expect(SIDEBAR_SRC).toContain("const composerLocked = Boolean(disabled || isTurnActive || isAttaching)");
    expect(SIDEBAR_SRC).toContain("Working…");
    expect(SIDEBAR_SRC).toContain("Attaching…");
    expect(SIDEBAR_SRC).toContain("disabled={composerLocked}");
  });

  it("swaps the send button for a stop control during an active turn", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="ai-stop-btn"');
    expect(SIDEBAR_SRC).toContain('aria-label="Stop AI response"');
    expect(SIDEBAR_SRC).toContain("<Square className=\"size-3.5 fill-current\" />");
    expect(SIDEBAR_SRC).toContain("onClick={() => onCancel?.()}");
  });

  it("does not submit on Enter while a turn is active", () => {
    const enterGuards = SIDEBAR_SRC.match(/event\.key === "Enter" && !event\.shiftKey && !isTurnActive/g) ?? [];
    expect(enterGuards.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Companion reading polish (SN-39)", () => {
  it("exposes a companion-only density control", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="companion-density-control"');
    expect(SIDEBAR_SRC).toContain("COMPANION_DENSITY_OPTIONS");
    expect(SIDEBAR_SRC).toContain("companion-density-");
  });

  it("renders assistant markdown with table and image component wrappers", () => {
    expect(SIDEBAR_SRC).toContain("CHAT_MARKDOWN_COMPONENTS");
    expect(SIDEBAR_SRC).toContain("chat-prose-table-wrap");
    expect(SIDEBAR_SRC).toContain("components={CHAT_MARKDOWN_COMPONENTS}");
  });

  it("opens the mobile companion fullscreen instead of a partial bottom sheet", () => {
    expect(SIDEBAR_SRC).toContain("data-[side=bottom]:h-[100dvh]");
    expect(SIDEBAR_SRC).toContain("data-[side=bottom]:inset-0");
    expect(SIDEBAR_SRC).not.toContain("h-[78vh]");
    expect(SIDEBAR_SRC).not.toContain("rounded-t-[20px]");
  });
});

describe("Companion composer polish (SN-69)", () => {
  it("adds a discreet per-assistant-message copy control", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="ai-message-copy"');
    expect(SIDEBAR_SRC).toContain("AssistantMessageCopyButton");
    expect(SIDEBAR_SRC).toContain("getAssistantMessageCopyText");
    expect(SIDEBAR_SRC).toContain("copyTextToClipboard");
    expect(SIDEBAR_SRC).toContain("contentRef.current?.innerText");
    expect(SIDEBAR_SRC).toContain('className="group/message flex flex-col items-stretch"');
    expect(SIDEBAR_SRC).toContain("[@media(hover:hover)]:group-hover/message:opacity-100");
  });

  it("auto-expands the composer textarea on desktop and mobile", () => {
    expect(SIDEBAR_SRC).toContain("function ComposerTextarea");
    expect(SIDEBAR_SRC).toContain("useAutoResizeTextarea");
    expect(SIDEBAR_SRC).toContain("COMPOSER_MAX_HEIGHT_DESKTOP");
    expect(SIDEBAR_SRC).toContain("COMPOSER_MAX_HEIGHT_MOBILE");
    expect(SIDEBAR_SRC).toContain('rows={1}');
    expect(SIDEBAR_SRC).not.toContain('<input\n                value={inputValue}');
  });

  it("uses 44px minimum mobile touch targets for composer input and send/stop controls", () => {
    expect(SIDEBAR_SRC).toContain("min-h-11");
    expect(SIDEBAR_SRC).toContain('mobile && "size-11 shrink-0"');
    expect(SIDEBAR_SRC).toContain('data-testid="ai-send-btn"');
    expect(SIDEBAR_SRC).toContain('data-testid="ai-stop-btn"');
  });

  it("scales companion density tokens modestly above baseline in globals.css", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    expect(css).toContain("--chat-prose-size: 18px");
    expect(css).toContain("--chat-prose-size: 16.875px");
    expect(css).toContain("--chat-prose-size: 15.75px");
    expect(css).toContain("--chat-message-gap: 1.40625rem");
  });
});

describe("AI sidebar cancel wiring", () => {
  const NOTEBOOK_SHELL_SRC = fs.readFileSync(
    path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("tracks aiTurnActive state and passes it to desktop and mobile composers", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("const [aiTurnActive, setAiTurnActive]");
    expect(NOTEBOOK_SHELL_SRC).toContain("isTurnActive: aiTurnActive");
    expect(NOTEBOOK_SHELL_SRC).toContain("onCancel: handleAiCancel");
  });

  it("calls /api/chat/cancel from handleAiCancel", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("const handleAiCancel = React.useCallback");
    expect(NOTEBOOK_SHELL_SRC).toContain('fetch("/api/chat/cancel"');
    expect(NOTEBOOK_SHELL_SRC).toContain("JSON.stringify({ cancel: currentTurnId })");
    expect(NOTEBOOK_SHELL_SRC).toContain("aiSubmitGenerationRef.current += 1");
  });

  it("loads and saves the companion system prompt via /api/agent-settings", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain('fetch("/api/agent-settings")');
    expect(NOTEBOOK_SHELL_SRC).toContain("persistAiSystemPrompt");
    expect(NOTEBOOK_SHELL_SRC).toContain("onSystemPromptSave: persistAiSystemPrompt");
    expect(NOTEBOOK_SHELL_SRC).toContain("systemPrompt: aiSystemPrompt");
    expect(NOTEBOOK_SHELL_SRC).toContain("defaultSystemPrompt: aiDefaultSystemPrompt");
    expect(NOTEBOOK_SHELL_SRC).toContain("onScopeChange: setAiScope");
    expect(NOTEBOOK_SHELL_SRC).toContain("scopeOptions: aiScopeOptions");
  });
});

// ─── Companion empty state (SN-70) ───────────────────────────────────────────

describe("Companion empty state copy", () => {
  it("explains disk save vs stale editor and Reload", () => {
    expect(SIDEBAR_SRC).toContain("Vault writes save on disk immediately");
    expect(SIDEBAR_SRC).toContain("Click Reload in the editor to view updates");
    expect(SIDEBAR_SRC).toContain("pre-save draft");
  });
});

describe("Companion mobile settings and composer (SN-75)", () => {
  it("exposes AI settings on mobile with system prompt editor", () => {
    expect(SIDEBAR_SRC).toContain('data-testid="ai-settings-mobile"');
    expect(SIDEBAR_SRC).toContain("function AiSettingsDialog");
    expect(SIDEBAR_SRC).toContain('data-testid="ai-system-prompt"');
    expect(SIDEBAR_SRC).toContain("onSystemPromptSave={onSystemPromptSave}");
  });

  it("keeps the mobile composer textarea on the full input row", () => {
    expect(SIDEBAR_SRC).toContain('{!mobile ? <div className="flex-1" /> : null}');
    expect(SIDEBAR_SRC).toContain('className="shrink-0 rounded-md"');
    expect(SIDEBAR_SRC).toContain("min-h-11 flex-1");
  });
});

describe("Companion Keep conversation toggle (SN-80)", () => {
  it("defines a CompanionKeepToggle control wired to keepConversation props", () => {
    expect(SIDEBAR_SRC).toContain("function CompanionKeepToggle");
    expect(SIDEBAR_SRC).toContain("keepConversation: boolean");
    expect(SIDEBAR_SRC).toContain("onKeepConversationChange: (checked: boolean) => void");
  });

  it("renders the keep toggle on both desktop and mobile surfaces", () => {
    expect(SIDEBAR_SRC).toContain(
      'data-testid={mobile ? "companion-keep-toggle-mobile" : "companion-keep-toggle"}'
    );
    expect(SIDEBAR_SRC).toContain(
      "<CompanionKeepToggle checked={keepConversation} onChange={onKeepConversationChange} />"
    );
    expect(SIDEBAR_SRC).toContain(
      "<CompanionKeepToggle checked={keepConversation} onChange={onKeepConversationChange} mobile />"
    );
  });

  it("uses the documented accent token for the checkbox, not a raw colour", () => {
    expect(SIDEBAR_SRC).toContain('accentColor: "var(--accent)"');
    expect(SIDEBAR_SRC).toContain('aria-label="Keep conversation"');
  });

  it("keeps Keep-off reload persistence volatile and tab-local", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain("writeVolatileCompanionSession(window.sessionStorage");
    expect(NOTEBOOK_SHELL_SRC).not.toContain("writeVolatileCompanionSession(window.localStorage");
    expect(NOTEBOOK_SHELL_SRC).toContain("VOLATILE_COMPANION_SAVE_DELAY_MS");
  });

  it("persists provider changes without waiting for another message", () => {
    const volatilePersistenceStart = NOTEBOOK_SHELL_SRC.indexOf(
      "// Keep OFF: preserve the current tab's visible transcript"
    );
    const durablePersistenceStart = NOTEBOOK_SHELL_SRC.indexOf(
      "// SN-80 — Keep ON: debounced persistence"
    );
    const persistenceEnd = NOTEBOOK_SHELL_SRC.indexOf(
      "React.useEffect(() => {\n    setAiScope",
      durablePersistenceStart
    );
    const volatilePersistence = NOTEBOOK_SHELL_SRC.slice(
      volatilePersistenceStart,
      durablePersistenceStart
    );
    const durablePersistence = NOTEBOOK_SHELL_SRC.slice(
      durablePersistenceStart,
      persistenceEnd
    );

    for (const source of [volatilePersistence, durablePersistence]) {
      expect(source).toContain("aiActiveProviderId");
      expect(source).toContain("aiActiveModel");
      expect(source).toContain("aiActiveEffort");
    }
  });

  it("persists the client-allocated active-turn pointer before sending", () => {
    const submitStart = NOTEBOOK_SHELL_SRC.indexOf(
      "const handleAiSubmit = React.useCallback"
    );
    const submitEnd = NOTEBOOK_SHELL_SRC.indexOf(
      "const handleAiCancel = React.useCallback",
      submitStart
    );
    const submit = NOTEBOOK_SHELL_SRC.slice(submitStart, submitEnd);

    expect(submit.indexOf("await persistCompanionActiveTurn(")).toBeGreaterThan(-1);
    expect(submit.indexOf('fetch("/api/chat/send"')).toBeGreaterThan(
      submit.indexOf("await persistCompanionActiveTurn(")
    );
    expect(submit).toContain("turnId,");
    expect(submit).toContain("keepalive: true");
    expect(submit).toContain("keepalive: canUseKeepaliveBody(turnRequestBody)");
  });

  it("discovers and reconciles active turns across restored scope selection", () => {
    expect(NOTEBOOK_SHELL_SRC).toContain('fetch("/api/chat/history?all_scopes=1"');
    expect(NOTEBOOK_SHELL_SRC).toContain("findCompanionActiveTurn(");
    expect(NOTEBOOK_SHELL_SRC).toContain("setAiScope(targetScope)");
  });
});

describe("Top bar reload controls (AV-209)", () => {
  it("uses one reload button plus a warning indicator for pending refresh state", () => {
    expect(NOTEBOOK_SHELL_SRC).not.toContain('data-testid="refresh-note-btn"');
    expect(NOTEBOOK_SHELL_SRC).toContain('data-testid="reload-btn"');
    expect(NOTEBOOK_SHELL_SRC).toContain('data-testid="reload-status-indicator"');
    expect(NOTEBOOK_SHELL_SRC).toContain("Remote note update available");
  });
});

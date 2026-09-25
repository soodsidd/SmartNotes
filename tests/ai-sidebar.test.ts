import {
  appendAiTimelineReasoning,
  appendAiTimelineText,
  appendAiTimelineVerboseEvent,
  buildAiPageTreeMarkdown,
  buildAiPageContext,
  buildAiParentContextMarkdown,
  buildAiSidebarTraceEvent,
  buildAiTurnRequest,
  buildMessageWithDocumentAttachments,
  buildSmartNotesOperatingContext,
  clampAiSidebarWidth,
  getAiSidebarMaxWidth,
  normalizeCompanionDensity,
  countAiPageTreePages,
  detectImagePaths,
  estimateTokenCount,
  formatLocalDate,
  formatTokenCount,
  getAiScopeLabel,
  getAiScopeOptions,
  getAiScopeTokenLabel,
  getAiProviderModelOptions,
  getProviderModelPickerNote,
  getSectionMarkdown,
  getSectionOffsets,
  isParentContextScopeAvailable,
  normalizeAiScope,
  normalizeAiScopeForAvailability,
  noteHasSections,
  pickHighestQualityModel,
  resolveAiProviderSelection,
  resolveAiScopeParentInfo,
  resolveProviderEffort,
  resolveProviderModel,
  spliceSectionContent,
  getAssistantMessageCopyText,
  copyTextToClipboard,
  buildCompanionScopeKey,
  resolveCompanionThreadAddress,
  resolveSubtreeRootPath,
  isSharedCompanionScope,
  isCompanionThreadDisplayed,
  getAiScopeSharedLabel,
  getAiScopeOptionDescription,
  COMPANION_SHARED_SCOPES,
  capCompanionMessages,
  createEmptyCompanionSidecar,
  getCompanionScopeSession,
  normalizeCompanionSidecar,
  normalizeVolatileCompanionSession,
  readCompanionProviderPreferences,
  readVolatileCompanionSession,
  setCompanionScopeSession,
  withCompanionProviderPreferences,
  writeVolatileCompanionSession,
  COMPANION_MAX_MESSAGES_PER_SCOPE,
  VOLATILE_COMPANION_SESSION_STORAGE_KEY,
  PARENT_PAGE_CONTENT_MAX_CHARS,
  ACTIVE_PAGE_CONTENT_MAX_CHARS,
  DESIGN_PAGE_CONTENT_MAX_CHARS,
  truncateCompanionPageContent,
  type CompanionStoredMessage,
} from "../src/lib/ai-sidebar";
import {
  buildReloadDraftSnapshot,
  getReloadButtonLabel,
  getReloadStatusLabel,
  hasUnsavedLocalDraftChanges,
  shouldBlockPendingPageReload,
} from "../src/lib/page-reload";

// ─── estimateTokenCount ───────────────────────────────────────────────────────

describe("estimateTokenCount", () => {
  it("returns 0 for an empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("returns 0 for a whitespace-only string", () => {
    expect(estimateTokenCount("   \n\t  ")).toBe(0);
  });

  it("returns 1 for exactly 4 characters", () => {
    expect(estimateTokenCount("abcd")).toBe(1);
  });

  it("rounds up — 5 characters → 2 tokens", () => {
    expect(estimateTokenCount("abcde")).toBe(2);
  });

  it("handles a typical paragraph (100 chars → 25 tokens)", () => {
    const text = "a".repeat(100);
    expect(estimateTokenCount(text)).toBe(25);
  });
});

// ─── formatTokenCount ─────────────────────────────────────────────────────────

describe("formatTokenCount", () => {
  it("formats zero as '0 tokens'", () => {
    expect(formatTokenCount(0)).toBe("0 tokens");
  });

  it("formats sub-1000 counts with the word 'tokens'", () => {
    expect(formatTokenCount(999)).toBe("999 tokens");
  });

  it("formats exactly 1000 as '1k tokens'", () => {
    expect(formatTokenCount(1000)).toBe("1k tokens");
  });

  it("formats 1500 as '1.5k tokens'", () => {
    expect(formatTokenCount(1500)).toBe("1.5k tokens");
  });

  it("formats 2000 as '2k tokens' (no trailing .0)", () => {
    expect(formatTokenCount(2000)).toBe("2k tokens");
  });
});

// ─── clampAiSidebarWidth ─────────────────────────────────────────────────────

describe("getAiSidebarMaxWidth", () => {
  it("allows up to 80% of the viewport on wide screens", () => {
    expect(getAiSidebarMaxWidth(1440)).toBe(1152);
  });

  it("uses 80% of the viewport width", () => {
    expect(getAiSidebarMaxWidth(1000)).toBe(800);
  });
});

describe("clampAiSidebarWidth", () => {
  it("clamps widths below the minimum", () => {
    expect(clampAiSidebarWidth(180, 280, 720)).toBe(280);
  });

  it("clamps widths above the maximum", () => {
    expect(clampAiSidebarWidth(1300, 280, 1152)).toBe(1152);
  });

  it("preserves widths already inside the allowed range", () => {
    expect(clampAiSidebarWidth(360, 280, 1152)).toBe(360);
  });
});

describe("normalizeCompanionDensity", () => {
  it("defaults unknown values to normal", () => {
    expect(normalizeCompanionDensity("wide")).toBe("normal");
    expect(normalizeCompanionDensity(null)).toBe("normal");
  });

  it("preserves compact and comfortable presets", () => {
    expect(normalizeCompanionDensity("compact")).toBe("compact");
    expect(normalizeCompanionDensity("comfortable")).toBe("comfortable");
  });
});

// ─── resolveAiProviderSelection ─────────────────────────────────────────────

describe("resolveAiProviderSelection", () => {
  const providers = [
    { id: "claude", name: "Claude", models: ["Sonnet", "Opus"] },
    { id: "codex", name: "Codex", models: ["GPT-5", "GPT-5 mini"] },
  ];

  it("uses the configured default provider and its stored model when available", () => {
    expect(
      resolveAiProviderSelection(
        providers,
        { claudeModel: "Opus", codexModel: "GPT-5 mini" },
        "claude"
      )
    ).toEqual({
      providerId: "claude",
      providerName: "Claude",
      model: "Opus",
    });
  });

  it("falls back to the highest-quality model when no stored preference exists", () => {
    expect(resolveAiProviderSelection(providers, { model: "ignored" }, "missing")).toEqual({
      providerId: "claude",
      providerName: "Claude",
      model: "Opus",
    });
  });

  it("falls back to the highest-quality codex model when no stored preference exists", () => {
    const codexProviders = [{ id: "codex", name: "Codex", models: ["gpt-5-mini", "o3", "gpt-5.5"] }];
    expect(resolveAiProviderSelection(codexProviders, {}, "codex")).toEqual({
      providerId: "codex",
      providerName: "Codex",
      model: "o3",
    });
  });

  it("returns an empty AI selection when no providers are available", () => {
    expect(resolveAiProviderSelection([], {}, undefined)).toEqual({
      providerId: "",
      providerName: "AI",
      model: "",
    });
  });
});

// ─── getAiProviderModelOptions ──────────────────────────────────────────────

describe("getAiProviderModelOptions", () => {
  it("keeps the active model first even when it is not in the provider suggestions", () => {
    expect(getAiProviderModelOptions(["gpt-5-codex", "o3"], "gpt-5.3-codex")).toEqual([
      "gpt-5.3-codex",
      "gpt-5-codex",
      "o3",
    ]);
  });

  it("deduplicates case-insensitively while preserving order", () => {
    expect(getAiProviderModelOptions(["GPT-5-CODEX", "gpt-5-codex", "o3"], "gpt-5-codex")).toEqual([
      "gpt-5-codex",
      "o3",
    ]);
  });
});

describe("provider quality defaults", () => {
  it("picks the highest-quality model for each provider", () => {
    expect(pickHighestQualityModel("codex", ["gpt-5-mini", "o3", "gpt-5.5"])).toBe("o3");
    expect(pickHighestQualityModel("claude", ["haiku", "opus", "sonnet"])).toBe("opus");
    expect(pickHighestQualityModel("cursor", ["auto", "gpt-5.5-high", "gpt-5.5-medium"])).toBe(
      "gpt-5.5-high"
    );
  });

  it("defaults effort to high for effort-capable providers", () => {
    expect(resolveProviderEffort({}, "codex")).toBe("high");
    expect(resolveProviderEffort({}, "claude")).toBe("");
    expect(resolveProviderEffort({ codexEffort: "low" }, "codex")).toBe("low");
  });

  it("uses stored model when present and falls back to quality ranking otherwise", () => {
    expect(resolveProviderModel({}, "codex", ["gpt-5-mini", "o3"])).toBe("o3");
    expect(resolveProviderModel({ codexModel: "gpt-5-mini" }, "codex", ["gpt-5-mini", "o3"])).toBe(
      "gpt-5-mini"
    );
  });

  it("explains when cursor high-tier models are missing from discovery", () => {
    expect(getProviderModelPickerNote("cursor", ["auto", "gpt-5.5-medium"])).toContain(
      "gpt-5.5-high"
    );
    expect(getProviderModelPickerNote("codex", ["o3"])).toBeNull();
  });
});

// ─── buildAiTurnRequest ─────────────────────────────────────────────────────

describe("buildAiTurnRequest", () => {
  it("includes the client-allocated durable turn ID", () => {
    expect(
      buildAiTurnRequest({
        turnId: "123e4567-e89b-42d3-a456-426614174000",
        message: "Keep going",
        history: [],
        pageContext: "# Note",
      })
    ).toMatchObject({
      turn_id: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("includes provider and model when both are set", () => {
    expect(
      buildAiTurnRequest({
        message: "Fix this note",
        history: [{ role: "user", content: "Earlier" }],
        pageContext: "# Note",
        operatingContext: "Smart Notes operating context:\n- Active markdown path: Notebook/Section/note.html",
        providerId: "codex",
        model: "gpt-5-codex",
      })
    ).toEqual({
      message: "Fix this note",
      history: [{ role: "user", content: "Earlier" }],
      page_context: "# Note",
      app_context: "Smart Notes operating context:\n- Active markdown path: Notebook/Section/note.html",
      provider: "codex",
      model: "gpt-5-codex",
    });
  });

  it("sends the browser-visible origin separately from host-side API context", () => {
    expect(
      buildAiTurnRequest({
        message: "Read this note",
        history: [],
        pageContext: "# Note",
        operatingContext: "Smart Notes operating context:",
        browserOrigin: "https://smart-notes.tailnet.example",
      })
    ).toMatchObject({
      app_context: "Smart Notes operating context:",
      browser_origin: "https://smart-notes.tailnet.example",
    });
  });

  it("omits empty provider and model fields", () => {
    expect(
      buildAiTurnRequest({
        message: "Fix this note",
        history: [],
        pageContext: "# Note",
        providerId: "  ",
        model: "",
      })
    ).toEqual({
      message: "Fix this note",
      history: [],
      page_context: "# Note",
    });
  });

  it("includes uploaded image and PDF attachment metadata when present", () => {
    expect(
      buildAiTurnRequest({
        message: "Read these attachments",
        history: [],
        pageContext: "",
        images: [{ name: "scan.png", path: "C:\\uploads\\scan.png" }],
        documents: [{ name: "paper.pdf", path: "C:\\uploads\\paper.pdf", mimeType: "application/pdf" }],
      })
    ).toMatchObject({
      images: [{ name: "scan.png", path: "C:\\uploads\\scan.png" }],
      documents: [{ name: "paper.pdf", path: "C:\\uploads\\paper.pdf", mimeType: "application/pdf" }],
    });
  });
});

describe("buildMessageWithDocumentAttachments", () => {
  it("prepends Markdown files as labelled fenced code above the typed prompt", () => {
    expect(
      buildMessageWithDocumentAttachments("Recover this note.", [
        { name: "mobile-cache.md", kind: "markdown", content: "# Lost note\n\nBody" },
      ])
    ).toBe("Attached Markdown file: mobile-cache.md\n```markdown\n# Lost note\n\nBody\n```\n\nRecover this note.");
  });

  it("prepends HTML files as labelled fenced code above the typed prompt", () => {
    expect(
      buildMessageWithDocumentAttachments("Recover this page.", [
        { name: "vault-page.html", kind: "html", content: "<h1>Lost note</h1><p>Body</p>" },
      ])
    ).toBe(
      "Attached HTML file: vault-page.html\n```html\n<h1>Lost note</h1><p>Body</p>\n```\n\nRecover this page."
    );
  });

  it("uses a longer code fence when attached text contains triple backticks", () => {
    expect(
      buildMessageWithDocumentAttachments("Explain.", [
        { name: "snippet.txt", kind: "text", content: "before\n```ts\ncode\n```\nafter" },
      ])
    ).toContain("````text\nbefore\n```ts\ncode\n```\nafter\n````");
  });
});

describe("AI page context contract", () => {
  it("sends whole-note page content into the CLI payload", () => {
    expect(
      buildAiPageContext({
        scope: "whole",
        pageContent: "<h1>Title</h1><p>Body copy</p>",
        sectionMarkdown: "## Section\n\nThis should not be sent.",
      })
    ).toBe("<h1>Title</h1><p>Body copy</p>");
  });

  it("truncates oversized design HTML so companion chat send stays fetchable (SN-168)", () => {
    const hugeDesign = `<!DOCTYPE html><html><body>${"x".repeat(DESIGN_PAGE_CONTENT_MAX_CHARS + 50_000)}</body></html>`;
    const context = buildAiPageContext({
      scope: "whole",
      pageContent: hugeDesign,
      noteType: "design",
    });
    expect(context.length).toBeLessThan(DESIGN_PAGE_CONTENT_MAX_CHARS + 400);
    expect(context).toContain("page content truncated");
    expect(context).toContain("ui_render");
    expect(context).not.toContain("x".repeat(DESIGN_PAGE_CONTENT_MAX_CHARS + 1));
  });

  it("keeps ordinary notes under the active-page companion budget", () => {
    const hugeNote = "n".repeat(ACTIVE_PAGE_CONTENT_MAX_CHARS + 10_000);
    const context = truncateCompanionPageContent(hugeNote);
    expect(context.length).toBeLessThan(ACTIVE_PAGE_CONTENT_MAX_CHARS + 300);
    expect(context).toContain("page content truncated");
  });

  it("keeps section markdown when the user narrows scope to a section", () => {
    expect(
      buildAiPageContext({
        scope: "section",
        sectionMarkdown: "## Warmup\n\nKeep this context.",
      })
    ).toBe("## Warmup\n\nKeep this context.");
  });

  it("labels whole-note scope as a direct edit instead of a token budget", () => {
    expect(
      getAiScopeTokenLabel({
        scope: "whole",
        sectionMarkdown: "Long note content that should not affect the label.",
      })
    ).toBe("direct edit");
  });

  it("keeps token labels for section-scoped context", () => {
    expect(
      getAiScopeTokenLabel({
        scope: "section",
        sectionMarkdown: "abcd",
      })
    ).toBe("1 tokens");
  });
});

// ─── buildSmartNotesOperatingContext ────────────────────────────────────────

describe("buildSmartNotesOperatingContext", () => {
  it("gives the provider the active note path and API handle", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Strength Training Reference Plan",
      path: "Personal Notebook/Quick Notes/AssetTarget.html",
      vaultRoot: "C:/Vault",
      notebookName: "Personal Notebook",
      notebookPath: "Personal Notebook",
      sectionName: "Quick Notes",
      sectionPath: "Personal Notebook/Quick Notes",
      scopeLabel: "Whole note",
    });

    expect(context).toContain("Smart Notes operating context:");
    expect(context).toContain("Active note title: Strength Training Reference Plan");
    expect(context).toContain("Vault root absolute path: C:/Vault");
    expect(context).toContain("Do not assume the vault is inside the repository");
    expect(context).toContain("vaultRelativePath (canonical API path): Personal Notebook/Quick Notes/AssetTarget.html");
    expect(context).toContain("resolvedDiskPath (absolute, OS-normalized): C:/Vault/Personal Notebook/Quick Notes/AssetTarget.html");
    expect(context).toContain("use the page API, vault tools, or sandboxed vault bridge");
    expect(context).toContain("saved on disk");
    expect(context).toContain("Remote update available");
    expect(context).toContain("page_get");
    expect(context).toContain("jupyter_notebook_context");
    expect(context).toContain("jupyter_cell_create");
    expect(context).toContain("jupyter_cell_edit");
    expect(context).toContain('"cellType": "code"');
    expect(context).toContain("def square(x):\\n    return x**2");
    expect(context).toContain("Jupyter cell tools refresh the active notebook frame automatically");
    expect(context).toContain("page_write response now includes contentHash, updatedAt, and resolvedDiskPath");
    expect(context).toContain("GET /api/page?path=Personal%20Notebook%2FQuick%20Notes%2FAssetTarget.html");
    expect(context).toContain('PUT /api/page with path "Personal Notebook/Quick Notes/AssetTarget.html" and content');
    expect(context).toContain("DELETE /api/page?path=Personal%20Notebook%2FQuick%20Notes%2FAssetTarget.html");
    expect(context).toContain("page_delete");
    expect(context).toContain('node scripts/vault-tool.mjs page_delete --path "Personal Notebook/Quick Notes/AssetTarget.html"');
    expect(context).toContain("node scripts/vault-tool.mjs rr --path \"Personal Notebook/Quick Notes/AssetTarget.html\"");
    expect(context).toContain("absoluteDiskPath");
    expect(context).toContain("Never hardcode localhost:3002");
    expect(context).not.toContain("WebFetch GET http://localhost:3002/api/agent/render");
    expect(context).toContain("Prefer vault tools over raw filesystem edits");
    expect(context).toContain("summarize the planned change and wait for explicit owner confirmation");
    expect(context).toContain("Context scope sent this turn: Whole note");
    expect(context).toContain("Notebook: Personal Notebook (Personal Notebook)");
    expect(context).toContain("Section: Quick Notes (Personal Notebook/Quick Notes)");
  });

  it("pins vault-tool and render guidance to apiBaseUrl instead of localhost:3002", () => {
    const context = buildSmartNotesOperatingContext({
      title: "UI Design",
      path: "+9e4ef171/ui-design.html",
      noteType: "design",
      apiBaseUrl: "http://127.0.0.1:53271",
      resolvedDiskPath: "C:\\Projects\\AI Feedly\\docs\\Key Docs\\ui-design.html",
      portableNotebookRootPath: "C:\\Projects\\AI Feedly\\docs\\Key Docs",
    });

    expect(context).toContain("apiBaseUrl (host-local Smart Notes server): http://127.0.0.1:53271");
    expect(context).toContain("PORT=53271 node scripts/vault-tool.mjs");
    expect(context).toContain("ui_render");
    expect(context).toContain('node scripts/vault-tool.mjs ur --path "+9e4ef171/ui-design.html"');
    expect(context).not.toContain("WebFetch GET http://localhost:3002");
    expect(context).toContain("Do NOT use WebFetch→localhost");
  });

  it("labels a remote browser origin without treating it as the host API", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Remote note",
      path: "Notebook/Section/remote-note.html",
      browserOrigin: "https://smart-notes.tailnet.example",
    });

    expect(context).toContain(
      "browserOrigin (browser-visible only; host tools must not call it): https://smart-notes.tailnet.example"
    );
    expect(context).toContain("apiBaseUrl: supplied by the chat server from this instance's bound port");
    expect(context).not.toContain("POST https://smart-notes.tailnet.example/api/agent/vault");
    expect(context).toContain("use inherited PORT/SMART_NOTES_PORT");
  });

  it("keeps a useful context for an untitled unsaved note", () => {
    const context = buildSmartNotesOperatingContext({
      title: " ",
      path: "",
    });

    expect(context).toContain("Active note title: Untitled note");
    expect(context).toContain("vaultRelativePath (canonical API path): (unsaved)");
    expect(context).toContain("Page API target: unavailable until the note is saved.");
    expect(context).toContain("Context scope sent this turn: Whole note");
  });

  it("injects live reader metadata and requires page-scoped vault PDF tools", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Reading notes",
      path: "Books/AI/deep-learning.html",
      activePdfHref: "/vault/Books/AI/deep-learning.assets/book.pdf",
      activePdfFileName: "Deep Learning Book.pdf",
      activePdfPage: 92,
      activePdfPageCount: 622,
    });

    expect(context).toContain("Active immersive PDF (live reader state; do not rediscover or guess)");
    expect(context).toContain("href: /vault/Books/AI/deep-learning.assets/book.pdf");
    expect(context).toContain("fileName: Deep Learning Book.pdf");
    expect(context).toContain("currentPage: 92");
    expect(context).toContain("pageCount: 622");
    expect(context).toContain("PDF PAGE POLICY (MANDATORY)");
    expect(context).toContain("pdf_read_page");
    expect(context).toContain("pdf_read_pages");
    expect(context).toContain("pdf_page_count");
    expect(context).toContain("Never use bash/shell, direct disk reads, pdftoppm, Computer");
    expect(context).toContain("Never use pdfChunkOffset for a page question");
    expect(context).toContain("Do not ask the owner to paste PDF page text unless");
  });

  it("teaches log reading, correction, suggestions, views, and safe History actions", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Project log",
      path: "Notebook/Section/project-log.html",
      noteType: "log",
    });

    expect(context).toContain("log_form_get");
    expect(context).toContain("log_form_put");
    expect(context).toContain("log_query");
    expect(context).toContain("never directly Write/Edit its .form.json or .log.json sidecars");
    expect(context).toContain("literal absolute request and response paths");
    expect(context).toContain("Do not search for the bridge");
    expect(context).toContain("page_get, page_write, page_create, the five log-form tools, app_send, the four spreadsheet tools");
    expect(context).toContain("do not edit resolvedDiskPath as a fallback");
    expect(context).toContain("History is the human-readable reading surface");
    expect(context).toContain("Table is the correction surface");
    expect(context).toContain("form.views");
    expect(context).toContain("stable live, JSON, and CSV links");
    expect(context).toContain("historySuggestion");
    expect(context).toContain("matchFields");
    expect(context).toContain("copyFields");
    expect(context).toContain("exact top-level schema property ids");
    expect(context).toContain("Suggestions never auto-fill the draft");
    expect(context).toContain("Attachments, ids, timestamps, and date fields are copied only");
    expect(context).toContain('"type": "open-history"');
    expect(context).toContain("validated named view id");
    expect(context).toContain("never add arbitrary URLs, HTML, CSS, callbacks");
    expect(context).toContain('"project"');
    expect(context).toContain('"status"');
    expect(context).toContain('"notes"');
  });

  it("includes math/LaTeX guidance so compact-prompt providers (Codex, Cursor) receive it every turn (SN-71)", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Physics Notes",
      path: "Notebook/Section/physics.html",
    });

    expect(context).toContain("Math: use $...$");
    expect(context).toContain("$$...$$");
    expect(context).toContain("server normalizes to KaTeX math nodes on save");
  });

  it("surfaces real portable resolvedDiskPath and never invents vaultRoot/+id joins (SN-167)", () => {
    const context = buildSmartNotesOperatingContext({
      title: "UI Design",
      path: "+9e4ef171/ui-design.html",
      noteType: "design",
      vaultRoot: "C:/Vault",
      resolvedDiskPath: "C:/Projects/ClearReader/ui-design.html",
      portableNotebookRootPath: "C:/Projects/ClearReader",
      notebookName: "Clear Reader",
      notebookPath: "+9e4ef171",
    });

    expect(context).toContain("resolvedDiskPath (absolute, OS-normalized): C:/Projects/ClearReader/ui-design.html");
    expect(context).toContain("portableNotebookRootPath (own-in-place target repo): C:/Projects/ClearReader");
    expect(context).toContain("PORTABLE (own-in-place) notebook");
    expect(context).not.toContain("C:/Vault/+9e4ef171/ui-design.html");
    expect(context).toContain("First action when locating this file: page_get");
  });
});

// ─── reload safety ───────────────────────────────────────────────────────────

describe("reload safety", () => {
  const savedDraft = {
    path: "Notebook/Section/seed.html",
    title: "Seed",
    content: "Saved body",
  };

  it("detects unsaved local draft changes against the last saved snapshot", () => {
    const snapshot = buildReloadDraftSnapshot(savedDraft);

    expect(hasUnsavedLocalDraftChanges(savedDraft, snapshot)).toBe(false);
    expect(
      hasUnsavedLocalDraftChanges(
        {
          ...savedDraft,
          content: "Unsaved local edit",
        },
        snapshot
      )
    ).toBe(true);
  });

  it("blocks pending external reload for the active page while local edits are unsaved", () => {
    const snapshot = buildReloadDraftSnapshot(savedDraft);

    expect(
      shouldBlockPendingPageReload({
        draft: {
          ...savedDraft,
          content: "Unsaved local edit",
        },
        pendingPath: savedDraft.path,
        lastSavedSnapshot: snapshot,
      })
    ).toBe(true);
  });

  it("does not block pending reload when the draft is clean or for another page", () => {
    const snapshot = buildReloadDraftSnapshot(savedDraft);

    expect(
      shouldBlockPendingPageReload({
        draft: savedDraft,
        pendingPath: savedDraft.path,
        lastSavedSnapshot: snapshot,
      })
    ).toBe(false);

    expect(
      shouldBlockPendingPageReload({
        draft: {
          ...savedDraft,
          content: "Unsaved local edit",
        },
        pendingPath: "Notebook/Section/other.html",
        lastSavedSnapshot: snapshot,
      })
    ).toBe(false);
  });

  it("teaches companions to use bounded Spreadsheet tools instead of the HTML stub (SN-209)", () => {
    const context = buildSmartNotesOperatingContext({
      title: "Budget",
      path: "Notebook/Section/budget.html",
      noteType: "spreadsheet",
    });

    expect(context).toContain("Workbook truth is its Syncfusion JSON sidecar");
    expect(context).toContain("spreadsheet_list_sheets");
    expect(context).toContain("spreadsheet_read_range");
    expect(context).toContain("spreadsheet_write_cells");
    expect(context).toContain("spreadsheet_summarize");
    expect(context).toContain("reads are capped at 2000 cells");
    expect(context).toContain("writes at 500 cells/formulas");
    expect(context).toContain("summaries at 20000 cells");
    expect(context).not.toContain("Page bodies are HTML (Tiptap getHTML)");
    expect(context).not.toContain("Math: use $...$");
  });

  it("blocks a pending reload when an embedded editing surface reports unsaved changes", () => {
    const snapshot = buildReloadDraftSnapshot(savedDraft);

    expect(
      shouldBlockPendingPageReload({
        draft: savedDraft,
        pendingPath: savedDraft.path,
        lastSavedSnapshot: snapshot,
        hasUnsavedSurfaceChanges: true,
      })
    ).toBe(true);
  });
});

describe("getReloadStatusLabel", () => {
  it("prioritizes safety, page, and vault reload messages", () => {
    expect(
      getReloadStatusLabel({
        reloadSafetyMessage: "Reload paused",
        hasPendingPageReload: true,
        hasPendingVaultReload: true,
        saveStateLabel: "Saved",
      })
    ).toBe("Reload paused");

    expect(
      getReloadStatusLabel({
        reloadSafetyMessage: null,
        hasPendingPageReload: true,
        hasPendingVaultReload: true,
        saveStateLabel: "Saved",
      })
    ).toBe("Remote update available");

    expect(
      getReloadStatusLabel({
        reloadSafetyMessage: null,
        hasPendingPageReload: false,
        hasPendingVaultReload: true,
        saveStateLabel: "Saved",
      })
    ).toBe("Vault structure changed");

    expect(
      getReloadStatusLabel({
        reloadSafetyMessage: null,
        hasPendingPageReload: false,
        hasPendingVaultReload: false,
        saveStateLabel: "Saved",
      })
    ).toBe("Saved");
  });
});

describe("getReloadButtonLabel", () => {
  it("describes the highest-priority pending reload action", () => {
    expect(
      getReloadButtonLabel({
        hasPendingPageReload: true,
        hasPendingVaultReload: true,
      })
    ).toBe("Reload latest page changes");

    expect(
      getReloadButtonLabel({
        hasPendingPageReload: false,
        hasPendingVaultReload: true,
      })
    ).toBe("Reload vault structure");

    expect(
      getReloadButtonLabel({
        hasPendingPageReload: false,
        hasPendingVaultReload: false,
      })
    ).toBe("Reload vault");
  });
});

// ─── noteHasSections ─────────────────────────────────────────────────────────

describe("noteHasSections", () => {
  it("returns false for a note with no headings", () => {
    expect(noteHasSections("Just a plain paragraph.")).toBe(false);
  });

  it("returns false when only H1 headings are present", () => {
    expect(noteHasSections("# Title\n\nBody text.")).toBe(false);
  });

  it("returns true when an H2 heading is present", () => {
    expect(noteHasSections("# Title\n\n## Section\n\nBody.")).toBe(true);
  });

  it("returns true for an H2 that appears mid-document", () => {
    const md = "Intro paragraph.\n\nSome content.\n\n## Section heading\n\nMore.";
    expect(noteHasSections(md)).toBe(true);
  });
});

// ─── normalizeAiScope ────────────────────────────────────────────────────────

describe("normalizeAiScope", () => {
  const NOTE_WITH_SECTIONS = "# Title\n\n## Section\n\nBody.";

  it("keeps whole-note scope as whole", () => {
    expect(normalizeAiScope(NOTE_WITH_SECTIONS, "whole")).toBe("whole");
  });

  it("allows section scope only when the note has sections", () => {
    expect(normalizeAiScope(NOTE_WITH_SECTIONS, "section")).toBe("section");
  });

  it("falls back to whole-note scope when headings are unavailable", () => {
    expect(normalizeAiScope("# Title\n\nBody only.", "section")).toBe("whole");
  });

  it("falls back to whole-note scope for nullish markdown", () => {
    expect(normalizeAiScope(null, "section")).toBe("whole");
    expect(normalizeAiScope(undefined, "section")).toBe("whole");
  });
});

// ─── getSectionMarkdown ───────────────────────────────────────────────────────

describe("getSectionMarkdown", () => {
  const NOTE = [
    "# Title",
    "",
    "Intro paragraph.",
    "",
    "## First Section",
    "",
    "Content of first section.",
    "",
    "## Second Section",
    "",
    "Content of second section.",
    "",
    "## Third Section",
    "",
    "Content of third section.",
  ].join("\n");

  it("returns null when the note has no ## headings", () => {
    expect(getSectionMarkdown("No sections here.", 0)).toBeNull();
  });

  it("returns the first heading block at index 0", () => {
    const result = getSectionMarkdown(NOTE, 0);
    expect(result).not.toBeNull();
    expect(result!.heading).toBe("First Section");
    expect(result!.markdown).toContain("Content of first section.");
  });

  it("returns the last heading block when index equals last", () => {
    const result = getSectionMarkdown(NOTE, 2);
    expect(result).not.toBeNull();
    expect(result!.heading).toBe("Third Section");
    expect(result!.markdown).toContain("Content of third section.");
  });

  it("clamps negative indices to the first section", () => {
    const result = getSectionMarkdown(NOTE, -5);
    expect(result!.heading).toBe("First Section");
  });

  it("clamps out-of-range indices to the last section", () => {
    const result = getSectionMarkdown(NOTE, 99);
    expect(result!.heading).toBe("Third Section");
  });

  it("extracts only the content between adjacent headings", () => {
    const result = getSectionMarkdown(NOTE, 1);
    expect(result!.heading).toBe("Second Section");
    // Must not bleed into the third section
    expect(result!.markdown).not.toContain("Content of third section.");
  });

  it("handles CRLF line endings identically to LF", () => {
    const crlf = NOTE.replace(/\n/g, "\r\n");
    const lf   = getSectionMarkdown(NOTE, 0);
    const cr   = getSectionMarkdown(crlf, 0);
    expect(cr!.heading).toBe(lf!.heading);
    expect(cr!.markdown).toBe(lf!.markdown);
  });
});

// ─── getSectionOffsets ────────────────────────────────────────────────────────

describe("getSectionOffsets", () => {
  const NOTE = [
    "# Title",
    "",
    "Intro.",
    "",
    "## Alpha",
    "",
    "Alpha content.",
    "",
    "## Beta",
    "",
    "Beta content.",
  ].join("\n");

  it("returns null when there are no ## headings", () => {
    expect(getSectionOffsets("No sections.", 0)).toBeNull();
  });

  it("returns offsets that capture the full Alpha block", () => {
    const offsets = getSectionOffsets(NOTE, 0);
    expect(offsets).not.toBeNull();
    const slice = NOTE.slice(offsets!.start, offsets!.end);
    expect(slice).toContain("## Alpha");
    expect(slice).toContain("Alpha content.");
    expect(slice).not.toContain("## Beta");
  });

  it("returns offsets that capture only the Beta block at index 1", () => {
    const offsets = getSectionOffsets(NOTE, 1);
    expect(offsets).not.toBeNull();
    const slice = NOTE.slice(offsets!.start, offsets!.end);
    expect(slice).toContain("## Beta");
    expect(slice).toContain("Beta content.");
    expect(slice).not.toContain("## Alpha");
  });
});

// ─── spliceSectionContent ─────────────────────────────────────────────────────

describe("spliceSectionContent", () => {
  const NOTE = [
    "# Title",
    "",
    "Intro.",
    "",
    "## Alpha",
    "",
    "Alpha content.",
    "",
    "## Beta",
    "",
    "Beta content.",
  ].join("\n");

  it("section scope — only the targeted section changes; surrounding content is preserved", () => {
    const offsets = getSectionOffsets(NOTE, 0)!;
    const replacement = "## Alpha\n\nImproved alpha content.";
    const result = spliceSectionContent(NOTE, offsets.start, offsets.end, replacement);

    // The replacement section is present.
    expect(result).toContain("Improved alpha content.");
    // Surrounding sections are untouched.
    expect(result).toContain("Intro.");
    expect(result).toContain("## Beta");
    expect(result).toContain("Beta content.");
    // Old alpha content is gone.
    expect(result).not.toContain("Alpha content.");
  });

  it("whole-note scope — entire body is replaced cleanly", () => {
    const replacement = "# Rewritten\n\nAll new content.";
    const result = spliceSectionContent(NOTE, 0, NOTE.length, replacement);

    expect(result).toBe("# Rewritten\n\nAll new content.");
    expect(result).not.toContain("Alpha");
    expect(result).not.toContain("Beta");
  });
});

// ─── detectImagePaths ────────────────────────────────────────────────────────

describe("detectImagePaths", () => {
  it("returns an empty array when no image paths are present", () => {
    expect(detectImagePaths("No images here.")).toHaveLength(0);
  });

  it("detects a Unix .png path", () => {
    const results = detectImagePaths("Here is the image: /tmp/output.png");
    expect(results).toHaveLength(1);
    expect(results[0]!.fileName).toBe("output.png");
  });

  it("detects a Windows .jpg path", () => {
    const results = detectImagePaths(`Saved to C:\\Users\\user\\output.jpg`);
    expect(results).toHaveLength(1);
    expect(results[0]!.fileName).toBe("output.jpg");
  });

  it("detects .svg and .gif extensions", () => {
    const text = "Generated /tmp/chart.svg and /tmp/anim.gif";
    const results = detectImagePaths(text);
    expect(results.map((r) => r.fileName)).toEqual(
      expect.arrayContaining(["chart.svg", "anim.gif"])
    );
  });

  it("does not detect plain text file paths (.txt, .md)", () => {
    expect(detectImagePaths("See /docs/readme.html and /data/file.txt")).toHaveLength(0);
  });

  it("populates a human-readable description for each detected path", () => {
    const results = detectImagePaths("/tmp/diagram.png");
    expect(results[0]!.description).toMatch(/diagram\.png/);
  });
});

// ─── page_context forwarding — non-Claude providers ──────────────────────────
//
// cli-chat's buildCompactRolePrompt (used by Codex / GH Copilot when there is
// no existing session) takes only the FIRST paragraph of sysText.  page_context
// is appended as a SECOND paragraph, so it is silently dropped for every
// non-Claude provider.
//
// Section-scoped context still needs to ride in the prompt body for compact
// providers, even though whole-note mode is now path-based.

describe("page_context forwarding — non-Claude providers", () => {
  // Inline mirror of buildCompactRolePrompt in packages/cli-chat/index.js.
  function buildCompactRolePrompt(prompt: string, systemPrompt: string) {
    const firstPara = String(systemPrompt || "")
      .split(/\n\s*\n/)[0]
      .replace(/\s+/g, " ")
      .trim();
    return `[Role: Assistant. ${firstPara}] ${prompt}`;
  }

  const PAGE_CONTEXT =
    "## Minimum Workout C\n\nDay C: 2–3 sets per exercise, ~30 min total.";

  it("reproduces bug: compact role prompt drops page_context (second sysText paragraph)", () => {
    const sysText = `You are helpful.\n\nThe user is on this page: ${PAGE_CONTEXT}`;
    const compact = buildCompactRolePrompt("Compact this page.", sysText);
    // page_context is in the second paragraph — compact only includes the first.
    expect(compact).not.toContain("Minimum Workout C");
  });

  it("keeps section context in parts so compact prompt receives it in the user message", () => {
    const parts = ["Compact this page."];
    if (PAGE_CONTEXT) parts.push("", `Current note content:\n${PAGE_CONTEXT}`);
    const compact = buildCompactRolePrompt(parts.join("\n"), "You are helpful.");
    expect(compact).toContain("Minimum Workout C");
    expect(compact).toContain("Day C");
  });

  it("keeps section context in follow-up prompts as well", () => {
    function buildOperationalFollowupPrompt(prompt: string) {
      return `[Reminder: edit files directly.] ${prompt}`;
    }
    const parts = ["Compact this page."];
    if (PAGE_CONTEXT) parts.push("", `Current note content:\n${PAGE_CONTEXT}`);
    const followup = buildOperationalFollowupPrompt(parts.join("\n"));
    expect(followup).toContain("Minimum Workout C");
  });
});

// ─── verbose timeline handling ──────────────────────────────────────────────

describe("AI sidebar verbose timeline handling", () => {
  it("keeps assistant text separated from interspersed verbose activity", () => {
    let timeline = appendAiTimelineText(undefined, "First answer sentence.");
    timeline = appendAiTimelineVerboseEvent(
      timeline,
      buildAiSidebarTraceEvent("tool_call", { name: "shell", detail: "rg workout plan" })!
    );
    timeline = appendAiTimelineText(timeline, " Second answer sentence.");

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ type: "text", text: "First answer sentence." });
    expect(timeline[1]).toMatchObject({ type: "verbose" });
    expect(timeline[2]).toMatchObject({ type: "text", text: " Second answer sentence." });
  });

  it("merges consecutive reasoning chunks into one reasoning entry", () => {
    let timeline = appendAiTimelineReasoning(undefined, "Inspecting note headings.\n");
    timeline = appendAiTimelineReasoning(timeline, "Comparing related sections.");

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: "reasoning",
      text: "Inspecting note headings.\nComparing related sections.",
    });
  });

  it("groups consecutive verbose events into a single block", () => {
    let timeline = appendAiTimelineVerboseEvent(
      undefined,
      buildAiSidebarTraceEvent("tool_call", { name: "shell", detail: "rg workout" })!
    );
    timeline = appendAiTimelineVerboseEvent(
      timeline,
      buildAiSidebarTraceEvent("tool_result", { name: "shell", content: "src/plan.html:1" })!
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ type: "verbose" });
    expect(timeline[0]?.type === "verbose" ? timeline[0].events : []).toHaveLength(2);
  });

  it("builds trace events from chat_event payloads", () => {
    expect(
      buildAiSidebarTraceEvent("thinking", { text: "Reviewing the note structure." })
    ).toMatchObject({
      eventType: "thinking",
      text: "Reviewing the note structure.",
    });

    expect(
      buildAiSidebarTraceEvent("status", { message: "Provider connected." })
    ).toMatchObject({
      eventType: "status",
      text: "Provider connected.",
    });
  });
});

// ─── page_tree scope (SN-24) ──────────────────────────────────────────────────

describe("buildAiPageContext — page_tree scope", () => {
  it("returns empty string for whole-note scope", () => {
    expect(buildAiPageContext({ scope: "whole", pageTreeMarkdown: "# Parent\n\n## Child" })).toBe("");
  });

  it("returns pageTreeMarkdown for page_tree scope", () => {
    const md = "# Parent\n\n## Child";
    expect(buildAiPageContext({ scope: "page_tree", pageTreeMarkdown: md })).toBe(md);
  });

  it("returns empty string for page_tree scope with no markdown", () => {
    expect(buildAiPageContext({ scope: "page_tree" })).toBe("");
  });
});

describe("buildAiPageTreeMarkdown", () => {
  it("serializes the active page plus all descendants as an indented outline", () => {
    expect(
      buildAiPageTreeMarkdown({
        activePage: { path: "parent", title: "Parent", parentId: null },
        pages: [
          { path: "parent", title: "Parent", parentId: null },
          { path: "child-a", title: "Child A", parentId: "parent" },
          { path: "grandchild", title: "Grandchild", parentId: "child-a" },
          { path: "child-b", title: "Child B", parentId: "parent" },
          { path: "other-root", title: "Other Root", parentId: null },
        ],
      })
    ).toBe(["- Parent", "  - Child A", "    - Grandchild", "  - Child B"].join("\n"));
  });

  it("returns an empty string when there is no active page", () => {
    expect(buildAiPageTreeMarkdown({ activePage: null, pages: [] })).toBe("");
  });
});

describe("countAiPageTreePages", () => {
  it("counts the active page and every descendant", () => {
    expect(
      countAiPageTreePages({
        activePage: { path: "parent", title: "Parent", parentId: null },
        pages: [
          { path: "parent", title: "Parent", parentId: null },
          { path: "child-a", title: "Child A", parentId: "parent" },
          { path: "grandchild", title: "Grandchild", parentId: "child-a" },
          { path: "child-b", title: "Child B", parentId: "parent" },
          { path: "other-root", title: "Other Root", parentId: null },
        ],
      })
    ).toBe(4);
  });

  it("returns 0 when there is no active page", () => {
    expect(countAiPageTreePages({ activePage: null, pages: [] })).toBe(0);
  });
});

describe("getAiScopeTokenLabel — page_tree scope", () => {
  it("returns 'direct edit' for whole-note scope", () => {
    expect(getAiScopeTokenLabel({ scope: "whole" })).toBe("direct edit");
  });

  it("returns token count string for page_tree scope", () => {
    const label = getAiScopeTokenLabel({ scope: "page_tree", pageTreeMarkdown: "a".repeat(400) });
    expect(label).toBe("100 tokens");
  });
});

describe("normalizeAiScope — page_tree scope", () => {
  it("preserves page_tree scope unchanged", () => {
    expect(normalizeAiScope("# Title\n\nBody.", "page_tree")).toBe("page_tree");
  });

  it("preserves page_tree scope even when note has no sections", () => {
    expect(normalizeAiScope("No headings here.", "page_tree")).toBe("page_tree");
  });
});

describe("parent_context scope (SN-75)", () => {
  it("builds parent-aware markdown with section and parent page headers", () => {
    const markdown = buildAiParentContextMarkdown({
      pageTitle: "Sprint notes",
      pageContent: "<p>Current body</p>",
      parentInfo: {
        sectionName: "Projects",
        parentPageTitle: "Q2 Planning",
      },
    });

    expect(markdown).toContain("## Section: Projects");
    expect(markdown).toContain("## Parent page: Q2 Planning");
    expect(markdown).toContain("## Current page: Sprint notes");
    expect(markdown).toContain("<p>Current body</p>");
  });

  it("returns parent-aware page context for parent_context scope", () => {
    const parentMarkdown = "# Parent-aware context\n\nBody";
    expect(
      buildAiPageContext({
        scope: "parent_context",
        parentContextMarkdown: parentMarkdown,
      })
    ).toBe(parentMarkdown);
  });

  it("exposes parent context scope when section or parent page exists", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: { path: "child.html", title: "Child", parentId: "parent.html" },
      pages: [{ path: "parent.html", title: "Parent", parentId: null }],
      sectionName: "Work",
    });

    expect(isParentContextScopeAvailable(parentInfo)).toBe(true);
    expect(getAiScopeOptions({
      hasSections: false,
      hasPageChildren: false,
      hasParentContext: true,
    })).toEqual([
      { value: "whole", label: "Whole note" },
      { value: "parent_context", label: "Page + parent context" },
    ]);
  });

  it("labels parent context with parent page title when nested", () => {
    expect(
      getAiScopeLabel({
        scope: "parent_context",
        parentInfo: { parentPageTitle: "Q2 Planning", sectionName: "Work" },
      })
    ).toBe("Page + Q2 Planning");
  });

  it("falls back to whole note when requested scope is unavailable", () => {
    expect(
      normalizeAiScopeForAvailability("parent_context", {
        hasSections: false,
        hasPageChildren: false,
        hasParentContext: false,
      })
    ).toBe("whole");
  });

  it("formats local dates for insert-today actions", () => {
    expect(formatLocalDate(new Date("2026-06-20T12:00:00"))).toMatch(/June 20, 2026/);
  });
});

// ─── SN-82: parent page content + remote vault path normalization ──────────────

describe("parent_context scope — parent page content (SN-82)", () => {
  it("includes parent page body text in the built markdown", () => {
    const markdown = buildAiParentContextMarkdown({
      pageTitle: "Sprint notes",
      pageContent: "<p>Current body</p>",
      parentInfo: {
        sectionName: "Projects",
        parentPageTitle: "Q2 Planning",
        parentPageContent: "<h1>Q2 Planning</h1><p>Goals for Q2.</p>",
      },
    });

    expect(markdown).toContain("## Parent page: Q2 Planning");
    expect(markdown).toContain("<h1>Q2 Planning</h1><p>Goals for Q2.</p>");
    expect(markdown).toContain("## Current page: Sprint notes");
    expect(markdown).toContain("<p>Current body</p>");
  });

  it("omits parent body block when parentPageContent is absent", () => {
    const markdown = buildAiParentContextMarkdown({
      pageTitle: "Sprint notes",
      pageContent: "<p>Current body</p>",
      parentInfo: {
        parentPageTitle: "Q2 Planning",
      },
    });

    expect(markdown).toContain("## Parent page: Q2 Planning");
    expect(markdown).toContain("## Current page: Sprint notes");
    // No truncation note should appear
    expect(markdown).not.toContain("truncated");
  });

  it("truncates parent page content exceeding the character cap", () => {
    const longContent = "x".repeat(PARENT_PAGE_CONTENT_MAX_CHARS + 500);
    const markdown = buildAiParentContextMarkdown({
      pageTitle: "Child",
      pageContent: "<p>Child body</p>",
      parentInfo: {
        parentPageTitle: "Long Parent",
        parentPageContent: longContent,
      },
    });

    expect(markdown).toContain("truncated");
    // Only the cap's worth of content should appear before the truncation note
    expect(markdown).toContain("x".repeat(PARENT_PAGE_CONTENT_MAX_CHARS));
    expect(markdown).not.toContain("x".repeat(PARENT_PAGE_CONTENT_MAX_CHARS + 1));
  });

  it("does not emit a truncation note when content fits within the cap", () => {
    const shortContent = "<p>Short parent body.</p>";
    const markdown = buildAiParentContextMarkdown({
      pageTitle: "Child",
      pageContent: "<p>Child</p>",
      parentInfo: {
        parentPageTitle: "Short Parent",
        parentPageContent: shortContent,
      },
    });

    expect(markdown).toContain(shortContent);
    expect(markdown).not.toContain("truncated");
  });
});

describe("resolveAiScopeParentInfo — content passthrough (SN-82)", () => {
  it("includes parentPageContent from the matching page in allPages", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: { path: "child.html", title: "Child", parentId: "parent.html" },
      pages: [
        {
          path: "parent.html",
          title: "Parent",
          parentId: null,
          content: "<h1>Parent</h1><p>Parent body text.</p>",
        },
      ],
    });

    expect(parentInfo?.parentPageTitle).toBe("Parent");
    expect(parentInfo?.parentPageContent).toBe("<h1>Parent</h1><p>Parent body text.</p>");
  });

  it("sets parentPageContent to undefined when the page has no content", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: { path: "child.html", title: "Child", parentId: "parent.html" },
      pages: [{ path: "parent.html", title: "Parent", parentId: null }],
    });

    expect(parentInfo?.parentPageTitle).toBe("Parent");
    expect(parentInfo?.parentPageContent).toBeUndefined();
  });
});

describe("resolveAiScopeParentInfo — remote vault path normalization (SN-82)", () => {
  const pages = [
    {
      path: "My Notebook/Quick Notes/parent.html",
      title: "Parent Page",
      parentId: null,
      content: "<p>Parent body</p>",
    },
  ];

  it("matches when parentId is a Windows absolute path from another machine", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: {
        path: "My Notebook/Quick Notes/child.html",
        title: "Child",
        parentId: "C:\\Users\\old-machine\\vault\\My Notebook\\Quick Notes\\parent.html",
      },
      pages,
    });

    expect(parentInfo?.parentPageTitle).toBe("Parent Page");
    expect(parentInfo?.parentPageContent).toBe("<p>Parent body</p>");
  });

  it("matches when parentId is a Unix absolute path from another machine", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: {
        path: "My Notebook/Quick Notes/child.html",
        title: "Child",
        parentId: "/home/user/vault/My Notebook/Quick Notes/parent.html",
      },
      pages,
    });

    expect(parentInfo?.parentPageTitle).toBe("Parent Page");
    expect(parentInfo?.parentPageContent).toBe("<p>Parent body</p>");
  });

  it("returns null when no page matches by exact path or suffix", () => {
    const parentInfo = resolveAiScopeParentInfo({
      activePage: {
        path: "My Notebook/Quick Notes/child.html",
        title: "Child",
        parentId: "C:\\other-vault\\completely-different\\parent.html",
      },
      pages,
    });

    expect(parentInfo?.parentPageTitle).toBeUndefined();
  });

  it("prefers exact match over suffix match when both could apply", () => {
    const ambiguousPages = [
      { path: "A/parent.html", title: "Short", parentId: null, content: "short" },
      { path: "long/path/A/parent.html", title: "Long", parentId: null, content: "long" },
    ];
    // Exact match wins
    const parentInfo = resolveAiScopeParentInfo({
      activePage: { path: "child.html", title: "Child", parentId: "A/parent.html" },
      pages: ambiguousPages,
    });
    expect(parentInfo?.parentPageTitle).toBe("Short");
  });
});

describe("getAssistantMessageCopyText (SN-69)", () => {
  it("returns trimmed message content when no timeline text entries exist", () => {
    expect(
      getAssistantMessageCopyText({
        content: "  For decent uniformity, target N ≥ 3.  ",
      })
    ).toBe("For decent uniformity, target N ≥ 3.");
  });

  it("joins timeline text entries with blank lines", () => {
    expect(
      getAssistantMessageCopyText({
        content: "ignored when timeline has text",
        timeline: [
          { id: "a", type: "text", text: "First paragraph.", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "b", type: "reasoning", text: "hidden", createdAt: "2026-01-01T00:00:01.000Z" },
          { id: "c", type: "text", text: "Second paragraph.", createdAt: "2026-01-01T00:00:02.000Z" },
        ],
      })
    ).toBe("First paragraph.\n\nSecond paragraph.");
  });
});

describe("copyTextToClipboard (SN-69)", () => {
  it("returns false for empty text", async () => {
    await expect(copyTextToClipboard("   ")).resolves.toBe(false);
  });
});

// ─── Companion session persistence (SN-80) ─────────────────────────────────────

function makeStoredMessage(id: string, role: "user" | "assistant" = "user"): CompanionStoredMessage {
  return { id, role, content: `message ${id}` };
}

describe("buildCompanionScopeKey (SN-80)", () => {
  it("uses the scope name directly for non-section scopes", () => {
    expect(buildCompanionScopeKey("whole")).toBe("whole");
    expect(buildCompanionScopeKey("page_tree")).toBe("page_tree");
    expect(buildCompanionScopeKey("parent_context")).toBe("parent_context");
  });

  it("appends a normalized section heading for section scope", () => {
    expect(buildCompanionScopeKey("section", "Introduction")).toBe("section:introduction");
    expect(buildCompanionScopeKey("section", "  Mixed CASE  ")).toBe("section:mixed case");
  });

  it("falls back to 'untitled' when the section heading is empty", () => {
    expect(buildCompanionScopeKey("section", "")).toBe("section:untitled");
    expect(buildCompanionScopeKey("section", null)).toBe("section:untitled");
  });

  it("derives distinct keys per section heading so threads do not collide", () => {
    expect(buildCompanionScopeKey("section", "Alpha")).not.toBe(
      buildCompanionScopeKey("section", "Beta")
    );
  });
});

describe("resolveCompanionThreadAddress (SN-202 scope-identity addressing)", () => {
  it("keeps whole/parent_context scopes per-page (not shared)", () => {
    for (const scope of ["whole", "parent_context"] as const) {
      const addr = resolveCompanionThreadAddress({ scope, activePath: "notes/a.html" });
      expect(addr).toEqual({
        storePath: "notes/a.html",
        storeKind: "page",
        scopeKey: scope,
        shared: false,
      });
    }
  });

  it("addresses section scope by the notebook-section grouping so pages share one thread", () => {
    const a = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "book/sec/a.html",
      sectionPath: "book/sec",
    });
    const b = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "book/sec/b.html",
      sectionPath: "book/sec",
    });
    // Two different pages in the same section resolve to the SAME store address.
    expect(a.storePath).toBe("book/sec");
    expect(a.storeKind).toBe("section");
    expect(a.shared).toBe(true);
    expect(a.storePath).toBe(b.storePath);
    expect(a.scopeKey).toBe(b.scopeKey);
  });

  it("gives different sections different threads", () => {
    const one = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "book/one/a.html",
      sectionPath: "book/one",
    });
    const two = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "book/two/a.html",
      sectionPath: "book/two",
    });
    expect(one.storePath).not.toBe(two.storePath);
  });

  it("falls back to a legacy per-page heading thread for unsectioned pages", () => {
    const addr = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "loose.html",
      sectionPath: null,
      sectionHeading: "Intro",
    });
    expect(addr).toEqual({
      storePath: "loose.html",
      storeKind: "page",
      scopeKey: "section:intro",
      shared: false,
    });
  });

  it("addresses page_tree by the topmost subtree root so the whole subtree shares one thread", () => {
    const fromRoot = resolveCompanionThreadAddress({
      scope: "page_tree",
      activePath: "book/root.html",
      subtreeRootPath: "book/root.html",
    });
    const fromChild = resolveCompanionThreadAddress({
      scope: "page_tree",
      activePath: "book/root/child.html",
      subtreeRootPath: "book/root.html",
    });
    expect(fromRoot.storePath).toBe("book/root.html");
    expect(fromChild.storePath).toBe("book/root.html");
    expect(fromChild.scopeKey).toBe("page_tree");
    expect(fromChild.shared).toBe(true);
    // Standing on the root and standing on a descendant share one thread.
    expect(fromRoot.storePath).toBe(fromChild.storePath);
  });

  it("falls back to the active page for page_tree when no subtree root is known", () => {
    const addr = resolveCompanionThreadAddress({
      scope: "page_tree",
      activePath: "solo.html",
    });
    expect(addr.storePath).toBe("solo.html");
    expect(addr.storeKind).toBe("page");
    expect(addr.shared).toBe(false);
  });

  it("normalizes backslash paths and trailing slashes to a stable identity", () => {
    const win = resolveCompanionThreadAddress({
      scope: "section",
      activePath: "book\\sec\\a.html",
      sectionPath: "book\\sec\\",
    });
    expect(win.storePath).toBe("book/sec");
  });

  it("isSharedCompanionScope matches the shared scope set", () => {
    expect(COMPANION_SHARED_SCOPES).toEqual(["section", "page_tree"]);
    expect(isSharedCompanionScope("section")).toBe(true);
    expect(isSharedCompanionScope("page_tree")).toBe(true);
    expect(isSharedCompanionScope("whole")).toBe(false);
    expect(isSharedCompanionScope("parent_context")).toBe(false);
  });
});

describe("resolveSubtreeRootPath (SN-202 page_tree anchor)", () => {
  const pages = [
    { path: "book/root.html", parentId: null },
    { path: "book/root/child.html", parentId: "book/root.html" },
    { path: "book/root/child/grand.html", parentId: "book/root/child.html" },
    { path: "book/other.html", parentId: null },
  ];

  it("returns the page itself when it has no parent", () => {
    expect(resolveSubtreeRootPath("book/root.html", pages)).toBe("book/root.html");
    expect(resolveSubtreeRootPath("book/other.html", pages)).toBe("book/other.html");
  });

  it("walks to the topmost ancestor for any descendant", () => {
    expect(resolveSubtreeRootPath("book/root/child.html", pages)).toBe("book/root.html");
    expect(resolveSubtreeRootPath("book/root/child/grand.html", pages)).toBe("book/root.html");
  });

  it("resolves every page in a subtree to the same shared root", () => {
    const roots = pages
      .filter((p) => p.path.startsWith("book/root"))
      .map((p) => resolveSubtreeRootPath(p.path, pages));
    expect(new Set(roots)).toEqual(new Set(["book/root.html"]));
  });

  it("matches an absolute parentId against a relative page path (remote-vault fallback)", () => {
    const remote = [
      { path: "root.html", parentId: null },
      { path: "child.html", parentId: "/abs/vault/root.html" },
    ];
    expect(resolveSubtreeRootPath("child.html", remote)).toBe("root.html");
  });

  it("is cycle-safe when parentId links form a loop", () => {
    const cyclic = [
      { path: "a.html", parentId: "b.html" },
      { path: "b.html", parentId: "a.html" },
    ];
    expect(() => resolveSubtreeRootPath("a.html", cyclic)).not.toThrow();
  });

  it("falls back to the active page when its parent is missing from the tree", () => {
    const orphan = [{ path: "x.html", parentId: "missing.html" }];
    expect(resolveSubtreeRootPath("x.html", orphan)).toBe("x.html");
  });
});

describe("isCompanionThreadDisplayed (SN-202 transcript-binding guard)", () => {
  it("returns true only when store path and scope key both match the displayed thread", () => {
    const turn = { path: "book/root.html", scopeKey: "page_tree" };
    expect(
      isCompanionThreadDisplayed(turn, { storePath: "book/root.html", scopeKey: "page_tree" })
    ).toBe(true);
  });

  it("blocks a write when the displayed scope differs (wrong-scope guard)", () => {
    const turn = { path: "book/root.html", scopeKey: "page_tree" };
    expect(
      isCompanionThreadDisplayed(turn, { storePath: "book/root.html", scopeKey: "whole" })
    ).toBe(false);
  });

  it("blocks a write when the displayed store path differs (wrong-page guard)", () => {
    const turn = { path: "book/root.html", scopeKey: "page_tree" };
    expect(
      isCompanionThreadDisplayed(turn, { storePath: "book/other.html", scopeKey: "page_tree" })
    ).toBe(false);
  });

  it("allows a shared page_tree turn to keep rendering from any page under the same subtree root", () => {
    // The turn is bound to the subtree ROOT store path, so navigating to a
    // descendant page (which resolves to the same store) still matches.
    const turn = { path: "book/root.html", scopeKey: "page_tree" };
    expect(
      isCompanionThreadDisplayed(turn, { storePath: "book/root.html", scopeKey: "page_tree" })
    ).toBe(true);
  });

  it("normalizes backslash / trailing-slash path variants before comparing", () => {
    const turn = { path: "book/root.html", scopeKey: "whole" };
    expect(
      isCompanionThreadDisplayed(turn, { storePath: "book\\root.html", scopeKey: "whole" })
    ).toBe(true);
  });

  it("returns false when there is no bound turn context", () => {
    expect(isCompanionThreadDisplayed(null, { storePath: "a.html", scopeKey: "whole" })).toBe(false);
    expect(
      isCompanionThreadDisplayed(undefined, { storePath: "a.html", scopeKey: "whole" })
    ).toBe(false);
  });
});

describe("scope selector legibility (SN-202 Problem 1)", () => {
  it("labels section and page_tree scopes as shared chats", () => {
    expect(getAiScopeSharedLabel("section")).toBe("Shared chat");
    expect(getAiScopeSharedLabel("page_tree")).toBe("Shared chat");
  });

  it("does not label per-page scopes as shared", () => {
    expect(getAiScopeSharedLabel("whole")).toBeNull();
    expect(getAiScopeSharedLabel("parent_context")).toBeNull();
  });

  it("describes each scope's sharing behavior for the menu", () => {
    expect(getAiScopeOptionDescription("whole")).toMatch(/this page only/i);
    expect(getAiScopeOptionDescription("section")).toMatch(/shared/i);
    expect(getAiScopeOptionDescription("page_tree")).toMatch(/shared/i);
    expect(getAiScopeOptionDescription("parent_context")).toMatch(/parent/i);
  });
});

describe("capCompanionMessages (SN-80)", () => {
  it("returns the same list when under the cap", () => {
    const messages = [makeStoredMessage("a"), makeStoredMessage("b")];
    expect(capCompanionMessages(messages)).toBe(messages);
  });

  it("keeps only the most recent messages at the cap", () => {
    const messages = Array.from({ length: COMPANION_MAX_MESSAGES_PER_SCOPE + 10 }, (_, index) =>
      makeStoredMessage(`m-${index}`)
    );
    const capped = capCompanionMessages(messages);
    expect(capped).toHaveLength(COMPANION_MAX_MESSAGES_PER_SCOPE);
    expect(capped[0]!.id).toBe("m-10");
    expect(capped.at(-1)!.id).toBe(`m-${COMPANION_MAX_MESSAGES_PER_SCOPE + 9}`);
  });

  it("caps at 50 messages per scope", () => {
    expect(COMPANION_MAX_MESSAGES_PER_SCOPE).toBe(50);
  });
});

describe("normalizeCompanionSidecar (SN-80)", () => {
  it("returns an empty sidecar for non-object input", () => {
    expect(normalizeCompanionSidecar(null)).toEqual({ version: 1, scopes: {} });
    expect(normalizeCompanionSidecar("garbage")).toEqual({ version: 1, scopes: {} });
  });

  it("drops malformed messages and roles", () => {
    const sidecar = normalizeCompanionSidecar({
      scopes: {
        whole: {
          messages: [
            { id: "ok", role: "user", content: "hi" },
            { role: "bogus", content: "drop me" },
            "not an object",
          ],
        },
      },
    });
    expect(sidecar.scopes.whole!.messages).toHaveLength(1);
    expect(sidecar.scopes.whole!.messages[0]!.id).toBe("ok");
  });

  it("caps each scope to the maximum messages on read", () => {
    const sidecar = normalizeCompanionSidecar({
      scopes: {
        whole: {
          messages: Array.from({ length: 60 }, (_, index) => ({
            id: `m-${index}`,
            role: "user",
            content: "x",
          })),
        },
      },
    });
    expect(sidecar.scopes.whole!.messages).toHaveLength(COMPANION_MAX_MESSAGES_PER_SCOPE);
  });

  it("preserves resumeId when present", () => {
    const sidecar = normalizeCompanionSidecar({
      scopes: { whole: { messages: [], resumeId: "abc-123" } },
    });
    expect(sidecar.scopes.whole!.resumeId).toBe("abc-123");
  });

  it("preserves provider preferences when present", () => {
    const sidecar = normalizeCompanionSidecar({
      scopes: {
        whole: {
          messages: [],
          providerId: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      },
    });
    expect(sidecar.scopes.whole).toMatchObject({
      providerId: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    expect(readCompanionProviderPreferences(sidecar.scopes.whole)).toEqual({
      providerId: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });
});

describe("setCompanionScopeSession / getCompanionScopeSession (SN-80)", () => {
  it("adds a scope thread without disturbing other scopes", () => {
    const base = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
      messages: [makeStoredMessage("w1")],
    });
    const next = setCompanionScopeSession(base, "section:intro", {
      messages: [makeStoredMessage("s1")],
    });
    expect(getCompanionScopeSession(next, "whole")!.messages).toHaveLength(1);
    expect(getCompanionScopeSession(next, "section:intro")!.messages).toHaveLength(1);
  });

  it("removes a scope thread when the session is empty", () => {
    const base = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
      messages: [makeStoredMessage("w1")],
    });
    const cleared = setCompanionScopeSession(base, "whole", { messages: [] });
    expect(getCompanionScopeSession(cleared, "whole")).toBeNull();
  });

  it("caps stored messages and stamps updatedAt", () => {
    const next = setCompanionScopeSession(createEmptyCompanionSidecar(), "whole", {
      messages: Array.from({ length: 70 }, (_, index) => makeStoredMessage(`m-${index}`)),
    });
    expect(next.scopes.whole!.messages).toHaveLength(COMPANION_MAX_MESSAGES_PER_SCOPE);
    expect(typeof next.scopes.whole!.updatedAt).toBe("string");
  });

  it("merges provider preferences into a scope session on save", () => {
    const next = setCompanionScopeSession(
      createEmptyCompanionSidecar(),
      "whole",
      withCompanionProviderPreferences(
        { messages: [makeStoredMessage("w1")] },
        { providerId: "codex", model: "gpt-5.6-sol", effort: "high" }
      )
    );
    expect(next.scopes.whole).toMatchObject({
      providerId: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
    expect(readCompanionProviderPreferences(next.scopes.whole)).toEqual({
      providerId: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  it("does not mutate the source sidecar", () => {
    const base = createEmptyCompanionSidecar();
    setCompanionScopeSession(base, "whole", { messages: [makeStoredMessage("w1")] });
    expect(base.scopes).toEqual({});
  });
});

describe("volatile companion reload session (AV-209)", () => {
  function createStorage() {
    const store = new Map<string, string>();
    return {
      getItem: jest.fn((key: string) => store.get(key) ?? null),
      setItem: jest.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn((key: string) => {
        store.delete(key);
      }),
    };
  }

  it("normalizes a tab-local reload session with messages and resume id", () => {
    const session = normalizeVolatileCompanionSession({
      pagePath: "Notebook/Section/page.html",
      scopeKey: "whole",
      resumeId: "resume-1",
      messages: [makeStoredMessage("m1"), { role: "bogus", content: "drop" }],
    });

    expect(session).toEqual({
      pagePath: "Notebook/Section/page.html",
      scopeKey: "whole",
      resumeId: "resume-1",
      messages: [makeStoredMessage("m1")],
    });
  });

  it("writes, reads, and clears only the sessionStorage-backed reload snapshot", () => {
    const storage = createStorage();
    const session = {
      pagePath: "Notebook/Section/page.html",
      scopeKey: "whole",
      resumeId: "resume-1",
      messages: [makeStoredMessage("m1")],
    };

    writeVolatileCompanionSession(storage, session);

    expect(storage.setItem).toHaveBeenCalledWith(
      VOLATILE_COMPANION_SESSION_STORAGE_KEY,
      expect.stringContaining("Notebook/Section/page.html")
    );
    expect(readVolatileCompanionSession(storage)).toEqual(session);

    writeVolatileCompanionSession(storage, null);
    expect(storage.removeItem).toHaveBeenCalledWith(VOLATILE_COMPANION_SESSION_STORAGE_KEY);
  });
});

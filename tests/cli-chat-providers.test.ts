import { parseCursorModelsOutput, getProviderEffortForModel, buildClaudeSystemPromptArgs, removeClaudeSystemPromptFile } from "../packages/cli-chat/index";
import { codexExecArgs, cursorHeadlessArgs, resolveSandbox } from "../packages/cli-chat/sandbox";
import fs from "node:fs";
import path from "node:path";

const CLI_CHAT_SRC = fs.readFileSync(
  path.resolve(__dirname, "../packages/cli-chat/index.js"),
  "utf8"
);

describe("cli-chat operational follow-up reminder", () => {
  it("reinforces disk-vs-editor distinction and page_get verification on follow-up turns", () => {
    expect(CLI_CHAT_SRC).toContain("function buildOperationalFollowupPrompt(prompt)");
    expect(CLI_CHAT_SRC).toContain("Disk-vs-editor:");
    expect(CLI_CHAT_SRC).toContain("stale editor is NOT write failure");
    expect(CLI_CHAT_SRC).toContain("call page_get to confirm content");
    expect(CLI_CHAT_SRC).toContain("click Reload");
  });
});

describe("parseCursorModelsOutput", () => {
  it("parses cursor-agent models output into model ids", () => {
    const output = [
      "Available models",
      "",
      "auto - Auto (current)",
      "gpt-5.5-medium - GPT-5.5 1M",
      "composer-2.5 - Composer 2.5",
    ].join("\n");

    expect(parseCursorModelsOutput(output)).toEqual(["auto", "gpt-5.5-medium", "composer-2.5"]);
  });

  it("returns an empty array for blank output", () => {
    expect(parseCursorModelsOutput("")).toEqual([]);
  });
});

describe("cli-chat sandbox headless behavior", () => {
  it("adds --force for editor headless cursor invocations", () => {
    const sandboxCfg = resolveSandbox("editor");
    expect(cursorHeadlessArgs(sandboxCfg)).toEqual(["--force"]);
  });

  it("does not add --force for readonly cursor invocations", () => {
    const sandboxCfg = resolveSandbox("readonly");
    expect(cursorHeadlessArgs(sandboxCfg)).toEqual([]);
  });

  it("enables codex web search only when the installed CLI advertises support", () => {
    const sandboxCfg = resolveSandbox("editor");
    expect(codexExecArgs(sandboxCfg, { webSearchSupported: true })).toEqual([
      "--sandbox",
      "workspace-write",
      "-c",
      "tools.web_search=live",
    ]);
    expect(codexExecArgs(sandboxCfg, { webSearchSupported: false })).toEqual([
      "--sandbox",
      "workspace-write",
    ]);
  });

  it("omits --sandbox when resuming a codex session", () => {
    const sandboxCfg = resolveSandbox("editor");
    expect(codexExecArgs(sandboxCfg, { resume: true, webSearchSupported: true })).toEqual([
      "-c",
      "tools.web_search=live",
    ]);
    expect(codexExecArgs(sandboxCfg, { resume: true, webSearchSupported: false })).toEqual([]);
  });

  it("passes resume: true into codexExecArgs for codex follow-up turns", () => {
    expect(CLI_CHAT_SRC).toContain("resume: !!existingSession");
  });

  it("keeps Bash and Computer disallowed for Claude editor profile", () => {
    const sandboxCfg = resolveSandbox("editor");
    expect(sandboxCfg.claude.allowedTools).toEqual(
      expect.arrayContaining(["WebSearch", "WebFetch"])
    );
    expect(sandboxCfg.claude.disallowedTools).toEqual(["Bash", "Computer"]);
  });

  it("defaults ghcopilot effort to high except for auto model", () => {
    expect(getProviderEffortForModel({}, "ghcopilot", "gpt-4.1")).toBe("high");
    expect(getProviderEffortForModel({ ghcopilotEffort: "low" }, "ghcopilot", "gpt-4.1")).toBe("low");
    expect(getProviderEffortForModel({}, "ghcopilot", "auto")).toBe("");
  });

  it("delivers Claude system prompts via --system-prompt-file to avoid Windows cmd length limits", () => {
    const longPrompt = "x".repeat(9000);
    const delivery = buildClaudeSystemPromptArgs(longPrompt, "turn-test-1");

    expect(delivery.viaFile).toBe(true);
    expect(delivery.args[0]).toBe("--system-prompt-file");
    expect(fs.existsSync(delivery.args[1])).toBe(true);
    expect(fs.readFileSync(delivery.args[1], "utf8")).toBe(longPrompt);

    delivery.cleanup?.();
    expect(fs.existsSync(delivery.args[1])).toBe(false);
  });

  it("skips Claude system prompt args when prompt is blank", () => {
    const delivery = buildClaudeSystemPromptArgs("   ", "turn-test-2");
    expect(delivery.args).toEqual([]);
    expect(delivery.viaFile).toBe(false);
    removeClaudeSystemPromptFile(null);
  });

});

// ─── SN-86 reviewer: PDF provider gating and CLI path (review fixes) ──────────
//
// Reviewer finding #1: PDF was presented as "supported" to non-Claude providers
// but only a filename caveat was injected — not actual content.
// Reviewer finding #2: Claude+PDF diverted to a direct Anthropic Messages API
// call that bypasses the normal CLI path, stripping vault/action tool access.
//
// Fix: server-side PDF text extraction (pdf-parse v2 PDFParse class) converts
// PDFs to plain text, which is injected as a fenced code block into the prompt
// for ALL providers through the normal CLI path.

describe("PDF text extraction — provider-neutral CLI path (SN-86 review fix)", () => {
  it("uses server-side PDF text extraction rather than base64 document blocks for routing", () => {
    // The old base64/API bypass path is gone: no readFileSync(...base64) on PDFs,
    // no runClaudeApiChat call for Claude, no direct fetch to api.anthropic.com.
    expect(CLI_CHAT_SRC).toContain("extractPdfText");
    expect(CLI_CHAT_SRC).toContain("getPdfParser");
    expect(CLI_CHAT_SRC).not.toContain("runClaudeApiChat");
    expect(CLI_CHAT_SRC).not.toContain("buildClaudeDocumentContentBlocks");
  });

  it("caches PDF parser resolution separately from the cached parser value", () => {
    expect(CLI_CHAT_SRC).toContain("let _pdfParserResolved = false");
    expect(CLI_CHAT_SRC).toContain("if (_pdfParserResolved) return _PdfParser");
    expect(CLI_CHAT_SRC).toContain("_pdfParserResolved = true");
    expect(CLI_CHAT_SRC).toContain("_PdfParser = m.PDFParse || null");
  });

  it("no longer hard-gates PDFs to the direct Anthropic Messages API for Claude", () => {
    // The bypass in runChat that called runClaudeApiChat for Claude+PDF must be gone.
    expect(CLI_CHAT_SRC).not.toContain("provider === 'claude' && pdfDocuments.length > 0");
    expect(CLI_CHAT_SRC).not.toContain("void runClaudeApiChat");
  });

  it("injects PDF content as a fenced code block in the prompt for all providers", () => {
    // The extracted text is added with the Attached PDF label so all CLIs see it.
    expect(CLI_CHAT_SRC).toContain("Attached PDF:");
    expect(CLI_CHAT_SRC).toContain("sanitizedPdfAttachments");
    expect(CLI_CHAT_SRC).toContain("pdfTextResults");
  });

  it("gracefully falls back when text extraction fails (encrypted or image-only PDF)", () => {
    expect(CLI_CHAT_SRC).toContain("text could not be extracted from this PDF");
  });

  it("allows image-only /send requests after uploaded image sanitization", () => {
    const imageSanitizeIndex = CLI_CHAT_SRC.indexOf(
      "const uploadedImages = sanitizeUploadedAttachments(data.images"
    );
    const attachmentGuardIndex = CLI_CHAT_SRC.indexOf("if (!message && !hasSanitizedAttachments)");

    expect(imageSanitizeIndex).toBeGreaterThan(-1);
    expect(attachmentGuardIndex).toBeGreaterThan(imageSanitizeIndex);
    expect(CLI_CHAT_SRC).toContain(
      "const hasSanitizedAttachments = uploadedImages.length > 0 || sanitizedPdfAttachments.length > 0"
    );
  });

  it("allows PDF-only /send requests and gives the CLI an attachment-derived prompt", () => {
    const pdfSanitizeIndex = CLI_CHAT_SRC.indexOf(
      "const sanitizedPdfAttachments = sanitizeUploadedAttachments(data.documents"
    );
    const attachmentPromptIndex = CLI_CHAT_SRC.indexOf("const attachmentOnlyPrompt = hasSanitizedAttachments");

    expect(pdfSanitizeIndex).toBeGreaterThan(-1);
    expect(attachmentPromptIndex).toBeGreaterThan(pdfSanitizeIndex);
    expect(CLI_CHAT_SRC).toContain("Please review the attached file(s):");
    expect(CLI_CHAT_SRC).toContain("parts.push(message || attachmentOnlyPrompt)");
  });

  it("resolves the PDFParse class from pdf-parse v2 (data-buffer API contract)", () => {
    // pdf-parse v2 exports PDFParse (class), not a plain function like v1.
    // The extractPdfText helper uses new PDFParse({ data: buffer }).getText().
    // Verify the module exports the expected class in the CJS environment.
    // (Full E2E PDF parsing requires --experimental-vm-modules; verified manually
    //  via `node -e "..."` and confirmed to return "Hello PDF" for a minimal PDF.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse") as { PDFParse: new (opts: unknown) => unknown };
    expect(typeof PDFParse).toBe("function"); // class constructor
  });
});

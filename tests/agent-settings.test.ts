import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const {
  DEFAULT_SYSTEM_PROMPT,
  loadAgentSettings,
  saveAgentSettings,
} = require("../server/agent-settings");

describe("agent-settings", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sn35-agent-settings-"));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("returns the shipped default when no settings file exists", () => {
    const loaded = loadAgentSettings(tempDir);
    expect(loaded.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(loaded.isDefault).toBe(true);
    expect(loaded.defaultSystemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("persists and reloads a custom system prompt", () => {
    const customPrompt = "You are the Smart Notes companion for testing.";
    saveAgentSettings(tempDir, customPrompt);

    const loaded = loadAgentSettings(tempDir);
    expect(loaded.systemPrompt).toBe(customPrompt);
    expect(loaded.isDefault).toBe(false);
  });

  it("rejects empty prompts on save", () => {
    expect(() => saveAgentSettings(tempDir, "   ")).toThrow("systemPrompt is required");
  });

  it("ships Smart Notes identity, vault structure, behavioral rules, and SN-33 vault tools", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Smart Notes companion");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Notebook");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Behavioral rules");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("SN-33");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("/api/agent/vault");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_draft");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("comment_address");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("GET /api/agent/vault");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_create");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_delete");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("jupyter_notebook_context");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("jupyter_cell_create");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("jupyter_cell_edit");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"cellType": "code"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("active Jupyter notebook frame refreshes automatically");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("scripts/vault-tool.mjs");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("NEVER use filesystem delete");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("saved on disk");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("click Reload");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_get");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("pre-reload page_context");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("log_form_get");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("log_form_put");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("log_form_asset_put");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("log_form_render");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("never base64 in .log.json rows");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("per-entry image field as the first control");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("empty log HTML stub");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never directly Write/Edit a log page's .form.json or .log.json sidecars");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("literal absolute request and response paths");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never search for the bridge, inspect its README");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("app_inventory_list, app_inventory_get");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("do not substitute a direct resolvedDiskPath edit");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("use the Read/Write/Edit tools directly on resolvedDiskPath");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("History is the human-readable reading surface");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Table is the correction surface");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("form.views");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("stable live, JSON, and CSV links");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("historySuggestion");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("matchFields");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("copyFields");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("exact top-level schema property ids");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("never auto-fills the draft");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Attachments, ids, timestamps, and date fields are opt-in");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"type": "open-history"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("validated named view id");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("never supply arbitrary URLs, HTML, CSS, callbacks");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"project"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"status"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"notes"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("pdf_read_page");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("pdf_read_pages");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("pdf_page_count");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never use shell/bash, direct disk reads, pdftoppm, Computer");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Never ask the user to paste PDF page text unless");
  });

  it("registers app_send and tells shell-less companions how to invoke it (SN-203)", () => {
    const registeredTools = DEFAULT_SYSTEM_PROMPT.slice(
      DEFAULT_SYSTEM_PROMPT.indexOf("**Registered tools (prefer these names)**"),
      DEFAULT_SYSTEM_PROMPT.indexOf("**Examples**")
    );
    expect(registeredTools).toContain("app_send");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Bridge request example: { "tool": "app_send"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("an open App surface, including another browser tab");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("navigating away in the same tab unmounts that frame");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("including on a non-focused page");
  });

  it("documents shell-less App create and update bridge requests (SN-271)", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Blank App create example: { "tool": "app_create_from_template"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Then use the returned vault-relative path for an update, for example: { "tool": "app_update"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("rejected or unsafe arguments return the server's vault error");
  });

  it("registers the SN-209 spreadsheet tools and documents the bridge invocation", () => {
    const registeredTools = DEFAULT_SYSTEM_PROMPT.slice(
      DEFAULT_SYSTEM_PROMPT.indexOf("**Registered tools (prefer these names)**"),
      DEFAULT_SYSTEM_PROMPT.indexOf("**Examples**")
    );
    for (const tool of [
      "spreadsheet_list_sheets",
      "spreadsheet_read_range",
      "spreadsheet_write_cells",
      "spreadsheet_summarize",
    ]) {
      expect(registeredTools).toContain(tool);
    }
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Bridge request example: { "tool": "spreadsheet_write_cells"');
    // The sandboxed-bridge allowlist sentence must include the spreadsheet tools.
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      "app_send, spreadsheet_list_sheets, spreadsheet_read_range, spreadsheet_write_cells, spreadsheet_summarize"
    );
  });

  it("documents vault-tool visual render and warns against hardcoded localhost:3002", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("never hardcode localhost:3002");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("absoluteDiskPath");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("ui_render");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("vault-tool.mjs");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("do not rely on WebFetch→localhost for renders");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("GET http://localhost:3002/api/agent/render?path=");
  });

  it("includes Math / LaTeX section listing all four write commands (SN-71)", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Math / LaTeX");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("$...$");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("$$...$$");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_write");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_create");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_append");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("page_prepend");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("$E=mc^2$");
  });
});

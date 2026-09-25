import { buildSmartNotesOperatingContext } from "@/lib/ai-sidebar";
import { formatVaultToolsPrompt, getVaultToolDefinition } from "@/server/vault/agent-tools";

// CommonJS settings module is intentionally shared with the sidecar runtime.
const { DEFAULT_SYSTEM_PROMPT } = require("../server/agent-settings") as { DEFAULT_SYSTEM_PROMPT: string };

describe("global companion App authoring guidance", () => {
  it("registers validated template discovery/create/update/query tools", () => {
    expect(getVaultToolDefinition("app_template_list")?.group).toBe("app");
    expect(getVaultToolDefinition("app_template_get")?.parameters.templateId.required).toBe(true);
    expect(getVaultToolDefinition("app_inventory_list")?.description).toContain("Size-bounded");
    expect(getVaultToolDefinition("app_inventory_get")?.parameters.path.required).toBe(true);
    expect(getVaultToolDefinition("app_create_from_template")?.parameters.sourcePath.description).toContain("Action Checklist");
    expect(getVaultToolDefinition("app_update")?.description).toContain("without replacing attached table data");
    expect(getVaultToolDefinition("app_query")?.description).toContain("bounded general table contract");
    const prompt = formatVaultToolsPrompt();
    expect(prompt).toContain("Blank App, Action Checklist, Design Page, or Custom Log App");
    expect(prompt).toContain("app_inventory_list");
    expect(prompt).toContain("app_inventory_get");
    expect(prompt).toContain("app_query");
  });

  it("injects catalog guidance regardless of active page and App-specific safety when active", () => {
    const textContext = buildSmartNotesOperatingContext({ title: "Note", path: "Notebook/Section/note.html", noteType: "text" });
    expect(textContext).toContain("call app_inventory_list first");
    expect(textContext).toContain("app_template_list/app_template_get");
    const appContext = buildSmartNotesOperatingContext({ title: "App", path: "Notebook/Section/app.html", noteType: "app" });
    expect(appContext).toContain("Develop → Preview/Data/Source is owner-controlled");
    expect(appContext).toContain("Never directly edit .app.json");
    expect(appContext).toContain("app_inventory_list and app_inventory_get");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("one maintained catalog");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("app_inventory_list");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Before creating a similar App from a blank template");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Action Checklist");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("app_create_from_template");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("app_query");
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Blank App create example: { "tool": "app_create_from_template"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('for an update, for example: { "tool": "app_update"');
    expect(DEFAULT_SYSTEM_PROMPT).toContain("no direct vault, Smart Notes DOM, cookie, storage, or network access");
  });
});

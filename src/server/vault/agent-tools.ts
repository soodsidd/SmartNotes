import { executeVaultCommand, listVaultCommands, type VaultCommandRequest } from "./agent-commands";
import { toErrorResponse } from "./errors";

export interface VaultToolDefinition {
  name: string;
  description: string;
  group: VaultCommandRequest["group"];
  action: string;
  parameters: Record<string, { type: string; required?: boolean; description: string }>;
}

export const VAULT_TOOL_DEFINITIONS: VaultToolDefinition[] = [
  {
    name: "app_template_list",
    description: "List the single maintained, versioned App template catalog available in every companion context.",
    group: "app",
    action: "template_list",
    parameters: {},
  },
  {
    name: "app_template_get",
    description: "Read one validated maintained App template, including its source and explicit data attachments.",
    group: "app",
    action: "template_get",
    parameters: {
      templateId: { type: "string", required: true, description: "Catalog template id." },
    },
  },
  {
    name: "app_inventory_list",
    description:
      "List existing vault App pages (note_type=app) with path, title, template lineage when recorded, short source summary, and attachment metadata. Size-bounded; never injects full source of all apps.",
    group: "app",
    action: "inventory_list",
    parameters: {
      limit: { type: "number", description: "Max apps to return (default 50, max 100)." },
      offset: { type: "number", description: "Skip this many apps for paging (default 0)." },
    },
  },
  {
    name: "app_inventory_get",
    description:
      "Fetch one vault App page for reuse/adapt: bounded source plus attachment/manifest metadata (no table rows). Prefer this over inventing a parallel App from a blank template.",
    group: "app",
    action: "inventory_get",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative App page path." },
      maxSourceChars: {
        type: "number",
        description: "Max source characters to return (default 8192, max 32768). Truncation is flagged.",
      },
    },
  },
  {
    name: "app_query",
    description: "Query one declared App table through the bounded general table contract without exposing frame credentials or filesystem paths.",
    group: "app",
    action: "query",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative App page path." },
      tableId: { type: "string", required: true, description: "Declared App manifest table id." },
      query: { type: "object", description: "Optional bounded { where, limit } query; limit is 1-200." },
    },
  },
  {
    name: "app_create_from_template",
    description: "Create a maintained App or Design page template. Action Checklist requires sourcePath for an ordinary note; Custom Log App may attach an existing Log via logPath.",
    group: "app",
    action: "create",
    parameters: {
      sectionPath: { type: "string", required: true, description: "Vault-relative destination section path." },
      templateId: { type: "string", required: true, description: "Catalog id: blank-app, action-checklist, design-page, or custom-log-app." },
      title: { type: "string", description: "Optional page title." },
      sourcePath: { type: "string", description: "Required ordinary note path for Action Checklist seeding." },
      logPath: { type: "string", description: "Optional existing note_type=log page attachment for Custom Log App." },
    },
  },
  {
    name: "app_update",
    description: "Update App source and optionally its validated attachment manifest without replacing attached table data.",
    group: "app",
    action: "update",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative App page path." },
      source: { type: "string", description: "Replacement self-contained HTML/CSS/JS source." },
      title: { type: "string", description: "Optional page title." },
      templateId: { type: "string", description: "Optional maintained template source to apply." },
      manifest: { type: "object", description: "Optional complete versioned attachment manifest." },
    },
  },
  {
    name: "app_send",
    description:
      "Deliver a structured message to a RUNNING mini-app instance (SN-203). Reaches any currently-open instance of the target App page — including one the owner has open on a different notebook page than the focused one. Delivery is ephemeral and best-effort: the app receives it through smartNotesApp.companion.onMessage(...); if the target app is not currently running the call returns a clear 'app not running' result and nothing is queued or replayed.",
    group: "app",
    action: "send",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative App page path of the target running app." },
      message: {
        type: "object",
        required: true,
        description:
          "JSON-serializable structured message delivered to the app's companion.onMessage handler. Bounded by the app-frame response size limit.",
      },
    },
  },
  {
    name: "page_create",
    description:
      "Create a page in a section, optionally with initial HTML body. Pass noteType=\"design\" to create a raw HTML/CSS design page (SN-167) whose body is rendered verbatim (bypasses Tiptap normalization) — use this for self-contained UI artifacts.",
    group: "page",
    action: "create",
    parameters: {
      sectionPath: { type: "string", required: true, description: "Vault-relative section path (Notebook/Section)." },
      title: { type: "string", description: "Page title." },
      content: { type: "string", description: "Initial HTML body (raw, unnormalized, for design pages)." },
      noteType: { type: "string", description: 'Page type: "text" (default) or "design" (raw HTML/CSS UI artifact).' },
    },
  },
  {
    name: "page_delete",
    description: "Delete a page and its assets. Use this instead of filesystem delete.",
    group: "page",
    action: "delete",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },
  {
    name: "page_rename",
    description: "Rename a page (updates filename and title).",
    group: "page",
    action: "rename",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      title: { type: "string", required: true, description: "New page title." },
    },
  },
  {
    name: "page_move",
    description: "Move a page to a different section.",
    group: "page",
    action: "move",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      sectionPath: { type: "string", required: true, description: "Destination section path." },
    },
  },
  {
    name: "page_get",
    description: "Read a page including frontmatter and body.",
    group: "page",
    action: "get",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },
  {
    name: "pdf_read_page",
    description:
      "Read bounded extractable text from exactly one 1-based PDF page. Returns explicit errors for missing, out-of-range, or image-only pages and never falls back to whole-document text.",
    group: "pdf",
    action: "read_page",
    parameters: {
      href: {
        type: "string",
        required: true,
        description: "Vault-relative or /vault/... href of the PDF attachment.",
      },
      page: { type: "number", required: true, description: "1-based PDF page number." },
    },
  },
  {
    name: "pdf_read_pages",
    description:
      "Read bounded extractable text from a small inclusive PDF page range. The range is capped at 3 pages, the combined text is capped at maxPdfTextChars, and empty pages are reported explicitly.",
    group: "pdf",
    action: "read_pages",
    parameters: {
      href: {
        type: "string",
        required: true,
        description: "Vault-relative or /vault/... href of the PDF attachment.",
      },
      startPage: { type: "number", required: true, description: "First 1-based PDF page." },
      endPage: { type: "number", required: true, description: "Last 1-based PDF page (inclusive; at most 3 pages total)." },
    },
  },
  {
    name: "pdf_page_count",
    description:
      "Return a vault PDF's page count from document metadata without extracting or returning document text.",
    group: "pdf",
    action: "page_count",
    parameters: {
      href: {
        type: "string",
        required: true,
        description: "Vault-relative or /vault/... href of the PDF attachment.",
      },
    },
  },
  {
    name: "page_draft",
    description: "Return line-annotated body for AI editing before page_write.",
    group: "page",
    action: "draft",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },
  {
    name: "page_write",
    description: "Full body replace; auto-snapshots previous content (SN-34).",
    group: "page",
    action: "write",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      body: { type: "string", required: true, description: "Replacement HTML body." },
      title: { type: "string", description: "Optional title override." },
    },
  },
  {
    name: "page_excerpt",
    description: "Return a plain-text excerpt of the page body.",
    group: "page",
    action: "excerpt",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      maxChars: { type: "number", description: "Max excerpt length (default 500)." },
    },
  },
  {
    name: "page_list",
    description: "List vault pages globally or within one section.",
    group: "page",
    action: "list",
    parameters: {
      sectionPath: { type: "string", description: "Optional section filter." },
    },
  },
  {
    name: "page_append",
    description: "Append text to the end of the page body.",
    group: "page",
    action: "append",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      text: { type: "string", required: true, description: "Text to append." },
    },
  },
  {
    name: "page_prepend",
    description: "Prepend text to the start of the page body.",
    group: "page",
    action: "prepend",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      text: { type: "string", required: true, description: "Text to prepend." },
    },
  },
  {
    name: "page_search",
    description: "Search page titles and bodies across the vault.",
    group: "page",
    action: "search",
    parameters: {
      query: { type: "string", required: true, description: "Case-insensitive search string." },
      limit: { type: "number", description: "Max results (default 20)." },
    },
  },
  {
    name: "page_patch",
    description: "Replace the first occurrence of search text in the page body.",
    group: "page",
    action: "patch",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      search: { type: "string", required: true, description: "Exact text to find." },
      replacement: { type: "string", required: true, description: "Replacement text." },
    },
  },
  {
    name: "page_tag_add",
    description: "Add a tag to page frontmatter.",
    group: "page",
    action: "tag_add",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      tag: { type: "string", required: true, description: "Tag to add." },
    },
  },
  {
    name: "page_tag_remove",
    description: "Remove a tag from page frontmatter.",
    group: "page",
    action: "tag_remove",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      tag: { type: "string", required: true, description: "Tag to remove." },
    },
  },
  {
    name: "page_frontmatter_get",
    description: "Read page frontmatter (all keys or one key).",
    group: "page",
    action: "frontmatter_get",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      key: { type: "string", description: "Optional single key to read." },
    },
  },
  {
    name: "page_frontmatter_set",
    description: "Set a frontmatter key on a page.",
    group: "page",
    action: "frontmatter_set",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      key: { type: "string", required: true, description: "Frontmatter key." },
      value: { type: "string", required: true, description: "Value to set." },
    },
  },
  {
    name: "comment_list",
    description: "List frontmatter comments for a page.",
    group: "comment",
    action: "list",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },
  {
    name: "comment_get",
    description: "Get one comment by id.",
    group: "comment",
    action: "get",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      id: { type: "string", required: true, description: "Comment id." },
    },
  },
  {
    name: "comment_context",
    description: "Return body lines around a comment quote anchor.",
    group: "comment",
    action: "context",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      id: { type: "string", required: true, description: "Comment id." },
      lines: { type: "number", description: "Context lines above/below (default 3)." },
    },
  },
  {
    name: "comment_resolve",
    description: "Mark a comment resolved without editing body text.",
    group: "comment",
    action: "resolve",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      id: { type: "string", required: true, description: "Comment id." },
    },
  },
  {
    name: "comment_delete",
    description: "Remove a comment from frontmatter without editing body text.",
    group: "comment",
    action: "delete",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      id: { type: "string", required: true, description: "Comment id." },
    },
  },
  {
    name: "comment_address",
    description: "Replace quoted anchor text in the body and auto-resolve the comment.",
    group: "comment",
    action: "address",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      id: { type: "string", required: true, description: "Comment id." },
      replacement: { type: "string", required: true, description: "Replacement text for the quote." },
    },
  },
  {
    name: "notebook_create",
    description: "Create a notebook with a default Inbox section.",
    group: "notebook",
    action: "create",
    parameters: {
      name: { type: "string", required: true, description: "Notebook name." },
    },
  },
  {
    name: "notebook_delete",
    description: "Delete a notebook. Pass force=true when non-empty.",
    group: "notebook",
    action: "delete",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative notebook path." },
      force: { type: "boolean", description: "Required when notebook has sections/pages." },
    },
  },
  {
    name: "notebook_rename",
    description: "Rename a notebook.",
    group: "notebook",
    action: "rename",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative notebook path." },
      name: { type: "string", required: true, description: "New notebook name." },
    },
  },
  {
    name: "notebook_list",
    description: "List notebooks in the vault.",
    group: "notebook",
    action: "list",
    parameters: {},
  },
  {
    name: "section_create",
    description: "Create a section in a notebook.",
    group: "section",
    action: "create",
    parameters: {
      notebookPath: { type: "string", required: true, description: "Vault-relative notebook path." },
      name: { type: "string", required: true, description: "Section name." },
    },
  },
  {
    name: "section_delete",
    description: "Delete a section. Pass force=true when it contains pages.",
    group: "section",
    action: "delete",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative section path." },
      force: { type: "boolean", description: "Required when section has pages." },
    },
  },
  {
    name: "section_rename",
    description: "Rename a section.",
    group: "section",
    action: "rename",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative section path." },
      name: { type: "string", required: true, description: "New section name." },
    },
  },
  {
    name: "section_list",
    description: "List sections in a notebook.",
    group: "section",
    action: "list",
    parameters: {
      notebookPath: { type: "string", required: true, description: "Vault-relative notebook path." },
    },
  },
  {
    name: "page_versions",
    description: "List stored page versions (SN-34 bridge).",
    group: "version",
    action: "page_versions",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },
  {
    name: "page_restore",
    description: "Restore a page from a version timestamp/id (SN-34 bridge).",
    group: "version",
    action: "page_restore",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      version: { type: "string", required: true, description: "Version id/timestamp." },
    },
  },

  {
    name: "page_render",
    description:
      "Capture a full-page PNG screenshot of a text page (shell alias `rr`) including ink overlays, math (KaTeX), and images, for vision review. " +
      "Renders the SAVED on-disk page (not unsaved in-editor edits — save first if you need the latest). " +
      "Returns { relativePath, vaultUrl, absoluteVaultUrl, width, height, bytes, warnings } where vaultUrl/absoluteVaultUrl are attachable for vision models. " +
      "In AV preview inspect, POST same-origin to the preview app's /api/agent/vault or run `PORT=<preview-port> node scripts/vault-tool.mjs rr --path \"...\"` from the worktree. " +
      "Missing/broken images do not fail the render; they are reported in `warnings` as { code: \"missing_asset\", detail }.",
    group: "page",
    action: "render",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      scale: { type: "number", description: "Device scale factor (default 2 for retina)." },
      fullPage: { type: "boolean", description: "Capture full scrollable page (default true)." },
      outputName: {
        type: "string",
        description: 'PNG filename in page .assets/ (default "page-render-latest.png").',
      },
    },
  },
  {
    name: "log_form_get",
    description: "Read a log page's JSON Forms script (including historySuggestion, named views, and safe actions), projected fields, and rowCount without rows. Use this instead of page_get for log stubs.",
    group: "log",
    action: "get",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative log page path." },
    },
  },
  {
    name: "log_form_put",
    description: "Validate and replace a log page's JSON Forms script, including historySuggestion, named views, and safe open-history actions; persists .form.json, projects fields into .log.json, and preserves existing rows by field id.",
    group: "log",
    action: "put",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative log page path." },
      form: { type: "object", required: true, description: "JSON Forms { version, schema, uischema, historySuggestion?, views?, actions? } script." },
    },
  },
  {
    name: "log_query",
    description:
      "Run a server-owned bounded query against one log page, or retrieve one named saved view. " +
      "Supports allowlisted filters, selected fields, sorting, date ranges, grouping, and count/sum/average/minimum/maximum aggregates. " +
      "Results are always capped; arbitrary SQL and executable query keys are rejected.",
    group: "log",
    action: "query",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative log page path; this is the complete query scope." },
      query: { type: "object", description: "Bounded declarative query. Omit when retrieving a named view." },
      view: { type: "string", description: "Stable saved-view id. When present, the server uses the validated view query." },
    },
  },
  {
    name: "log_form_render",
    description: "Capture the focused Form UI of a log page as a PNG for vision feedback; unlike page_render, it does not render the empty HTML stub.",
    group: "log",
    action: "render",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative log page path." },
      scale: { type: "number", description: "Device scale factor (default 2)." },
      fullPage: { type: "boolean", description: "Capture the full focused Form UI (default true)." },
      outputName: { type: "string", description: 'PNG filename in page .assets/ (default "log-form-render-latest.png").' },
    },
  },
  {
    name: "ui_render",
    description:
      "Capture a design page (note_type=design) as a PNG for vision review (shell alias `ur`). Renders the SAVED raw HTML/CSS artifact verbatim (bypasses Tiptap) at a chosen viewport so real CSS + media queries apply, and composites any ink annotations. Returns { relativePath, vaultUrl, absoluteVaultUrl, width, height, bytes } where vaultUrl/absoluteVaultUrl are attachable for vision models.",
    group: "design",
    action: "render",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative design page path." },
      viewport: { type: "string", description: 'Named preset "desktop" (1280) or "mobile" (390). Defaults to desktop.' },
      viewportWidth: { type: "number", description: "Explicit viewport width in CSS px (240–4096); overrides the preset." },
      scale: { type: "number", description: "Device scale factor (default 2 for retina)." },
      outputName: { type: "string", description: 'PNG filename in page .assets/ (default "ui-render-<viewport>-latest.png").' },
    },
  },
  {
    name: "log_form_asset_put",
    description: "Place base64 image bytes in this log page's .assets folder and return its /vault/... URL. Store only that URL (or an array of them) in image form values; never base64 in rows.",
    group: "log",
    action: "asset_put",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative log page path." },
      fileName: { type: "string", required: true, description: "Image filename (.png, .jpg, .jpeg, .gif, .webp, or .svg)." },
      dataBase64: { type: "string", required: true, description: "Raw base64 image bytes (a data-URL prefix is also accepted)." },
      overwrite: { type: "boolean", description: "Overwrite the same asset filename instead of choosing a unique name." },
    },
  },

  // ---- SN-209: Spreadsheet cell tools ----

  {
    name: "spreadsheet_list_sheets",
    description:
      "List the worksheets in a Spreadsheet page (note_type=spreadsheet): index, name, used row/column extent, and which sheet is active. Read-only; use this before reading or writing a range.",
    group: "spreadsheet",
    action: "list_sheets",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Spreadsheet page path." },
    },
  },
  {
    name: "spreadsheet_read_range",
    description:
      "Read a bounded A1 cell range from a Spreadsheet page's authoritative workbook JSON. Returns non-empty cells with value and formula. Ranges over 2000 cells are rejected — request a smaller range.",
    group: "spreadsheet",
    action: "read_range",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Spreadsheet page path." },
      range: { type: "string", required: true, description: 'A1 range, e.g. "A1:C10" (a single cell like "B2" is allowed).' },
      sheet: { type: "string", description: "Sheet name or zero-based index. Defaults to the active sheet." },
    },
  },
  {
    name: "spreadsheet_write_cells",
    description:
      "Write up to 500 cells/formulas into a Spreadsheet page's authoritative workbook JSON (Syncfusion vault truth). Each write is { ref, value | formula | clear }. Formulas are stored so Syncfusion recalculates on open; changes persist through normal autosave and an open workbook live-reloads.",
    group: "spreadsheet",
    action: "write_cells",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Spreadsheet page path." },
      writes: {
        type: "array",
        required: true,
        description:
          'Non-empty array of { "ref": "A1", "value": <scalar> } and/or { "ref": "B2", "formula": "=SUM(A1:A10)" } and/or { "ref": "C3", "clear": true } entries. Provide exactly one of value/formula/clear per entry.',
      },
      sheet: { type: "string", description: "Sheet name or zero-based index. Defaults to the active sheet." },
    },
  },
  {
    name: "spreadsheet_summarize",
    description:
      "Summarize a Spreadsheet sheet, an explicit A1 range, or the sheet's active selection: non-empty/numeric/text/formula counts plus sum, min, max, average and a small cell sample. Oversized ranges (over 20000 cells) are rejected with a clear error.",
    group: "spreadsheet",
    action: "summarize",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Spreadsheet page path." },
      sheet: { type: "string", description: "Sheet name or zero-based index. Defaults to the active sheet." },
      range: { type: "string", description: 'Optional A1 range to summarize, e.g. "A1:D20". Defaults to the sheet used range.' },
      selection: { type: "boolean", description: "Summarize the sheet's recorded active selection instead of the whole used range." },
    },
  },

  // ---- SN-84: structured edit tools ----

  {
    name: "page_edit",
    description:
      "Apply multiple find-and-replace patches atomically in a single write. Preferred over calling page_patch repeatedly. Auto-snapshots the page before writing.",
    group: "page",
    action: "edit",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      edits: {
        type: "array",
        required: true,
        description:
          'Array of { "search": "<exact text>", "replacement": "<new text>" } pairs. Each search is matched against the raw HTML body.',
      },
    },
  },
  {
    name: "page_replace_section",
    description:
      "Replace the body content of a named <h2>/<h3> section in the page. Locates the first heading whose text matches `heading`, then replaces everything between it and the next heading (or end of body) with `content`. The heading tag itself is preserved. Auto-snapshots the page before writing.",
    group: "page",
    action: "replace_section",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      heading: {
        type: "string",
        required: true,
        description: "Plain-text heading to target (case-insensitive partial match against h2/h3 content).",
      },
      content: {
        type: "string",
        required: true,
        description: "Replacement HTML to place after the matched heading tag.",
      },
    },
  },

  // ---- SN-84: navigation / search ----

  {
    name: "page_find",
    description:
      "Find pages by title (partial, case-insensitive). Returns path + breadcrumb for each match. Use this when you know a page name but not its exact vault path.",
    group: "page",
    action: "find",
    parameters: {
      query: { type: "string", required: true, description: "Partial page title to search for." },
      limit: { type: "number", description: "Max results (default 10)." },
    },
  },
  {
    name: "vault_tree",
    description:
      "Return the full vault navigation tree (notebooks → sections → pages with title and vault-relative path). Use this to discover what pages exist before referencing a path.",
    group: "vault",
    action: "tree",
    parameters: {},
  },

  // ---- SN-84: AC4 — page_update_body (Tiptap HTML body only) ----

  {
    name: "page_update_body",
    description:
      "Replace the Tiptap HTML body of a page without modifying frontmatter fields (title, tags, comments, etc.). " +
      "Auto-snapshots the previous content before writing. Response includes contentHash, updatedAt, and resolvedDiskPath — " +
      "no follow-up page_get required to confirm the save. Use page_write for a full overwrite that may also update the title.",
    group: "page",
    action: "update_body",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      body: { type: "string", required: true, description: "Replacement Tiptap-compatible HTML body. Frontmatter is not affected." },
    },
  },

  // ---- SN-84: AC4 — page_update_frontmatter ----

  {
    name: "page_update_frontmatter",
    description:
      "Merge one or more YAML frontmatter fields into a page without touching the HTML body. Pass a `fields` object with the key-value pairs to set. Existing keys not in `fields` are preserved.",
    group: "page",
    action: "update_frontmatter",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
      fields: {
        type: "object",
        required: true,
        description: "Key-value pairs to merge into the page frontmatter (e.g. { \"status\": \"draft\", \"tags\": [\"todo\"] }).",
      },
    },
  },

  // ---- SN-84: AC5 — navigation tools ----

  {
    name: "page_siblings",
    description:
      "List the sibling pages in the same section as the given page. Returns path, title, and whether each entry is the current page. Use this to navigate within a section.",
    group: "page",
    action: "siblings",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative path of the reference page." },
    },
  },
  {
    name: "page_parent",
    description:
      "Return the parent page (via parent_id frontmatter) and section/notebook context for the given page. If no parent_id is set, returns the section and notebook paths instead.",
    group: "page",
    action: "parent",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative page path." },
    },
  },

  // ---- SN-114: Jupyter notebook context and safe cell mutation ----

  {
    name: "jupyter_notebook_context",
    description:
      "Read bounded Jupyter notebook cell source, markdown, and recent text outputs for a Jupyter page. Pass index and/or cellId to read exactly one saved cell. Does not execute code or alter the runtime.",
    group: "jupyter",
    action: "context",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Jupyter page path." },
      index: { type: "number", description: "Optional zero-based cell index for a targeted read." },
      cellId: { type: "string", description: "Optional stable nbformat cell id for a targeted read." },
    },
  },
  {
    name: "jupyter_cell_create",
    description:
      "Create a notebook cell in notebook.ipynb for a Jupyter page. Preserves notebook metadata and does not start, stop, or execute kernels.",
    group: "jupyter",
    action: "cell_create",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Jupyter page path." },
      cellType: { type: "string", description: 'Cell type: "code", "markdown", or "raw" (default code).' },
      source: { type: "string", description: "Cell source text." },
      index: { type: "number", description: "Optional insertion index; omitted appends." },
    },
  },
  {
    name: "jupyter_cell_edit",
    description:
      "Edit one saved notebook cell by zero-based index, stable cellId, or both. When both are provided they must still identify the same cell. Existing outputs are preserved unless the cell type changes away from code.",
    group: "jupyter",
    action: "cell_edit",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Jupyter page path." },
      index: { type: "number", description: "Zero-based cell index. Required when cellId is omitted." },
      cellId: { type: "string", description: "Stable nbformat cell id. Required when index is omitted." },
      source: { type: "string", description: "Replacement cell source text." },
      cellType: { type: "string", description: 'Optional new cell type: "code", "markdown", or "raw".' },
    },
  },
  {
    name: "jupyter_cell_delete",
    description:
      "Delete a notebook cell from notebook.ipynb for a Jupyter page. Does not touch other files in the .jupyter folder.",
    group: "jupyter",
    action: "cell_delete",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Jupyter page path." },
      index: { type: "number", required: true, description: "Zero-based cell index." },
    },
  },
  {
    name: "jupyter_cell_reorder",
    description:
      "Move a notebook cell within notebook.ipynb for a Jupyter page while preserving all cell contents and outputs.",
    group: "jupyter",
    action: "cell_reorder",
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative Jupyter page path." },
      fromIndex: { type: "number", required: true, description: "Current zero-based cell index." },
      toIndex: { type: "number", required: true, description: "Destination zero-based cell index." },
    },
  },
];

const TOOL_LOOKUP = new Map(VAULT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const TOOL_ALIASES: Record<string, string> = {
  rr: "page_render",
  ur: "ui_render",
};

export function getVaultToolDefinition(name: string) {
  const resolved = TOOL_ALIASES[name] ?? name;
  return TOOL_LOOKUP.get(resolved) ?? null;
}

export async function executeVaultTool(name: string, args: Record<string, unknown> = {}) {
  const resolvedName = TOOL_ALIASES[name] ?? name;
  const tool = getVaultToolDefinition(resolvedName);
  if (!tool) {
    return {
      ok: false as const,
      error: `Unknown vault tool: ${name}`,
      code: "UNKNOWN_TOOL",
    };
  }

  try {
    const result = await executeVaultCommand({
      group: tool.group,
      action: tool.action,
      args,
    });
    return { ok: true as const, tool: resolvedName, alias: name !== resolvedName ? name : undefined, result };
  } catch (error) {
    const response = toErrorResponse(error);
    return {
      ok: false as const,
      tool: resolvedName,
      alias: name !== resolvedName ? name : undefined,
      error: response.body.error,
      code: response.body.code,
      status: response.status,
    };
  }
}

export function formatVaultToolsPrompt() {
  const catalog = VAULT_TOOL_DEFINITIONS.map((tool) => {
    const params = Object.entries(tool.parameters)
      .map(([key, meta]) => `${key}${meta.required ? "" : "?"}: ${meta.description}`)
      .join("; ");
    return `- ${tool.name} — ${tool.description}${params ? ` (${params})` : ""}`;
  }).join("\n");

  const commands = listVaultCommands();
  const fullCommandList = Object.entries(commands)
    .map(([group, actions]) => `${group}: ${actions.join(", ")}`)
    .join("\n");

  return `## Vault tools (SN-33)
Use POST /api/agent/vault with JSON { "tool": "<name>", "args": { ... } } for structured vault operations.
Prefer vault tools over raw filesystem edits so comments, snapshots, and tree refresh stay consistent.

**Vault PDF rule (mandatory):** For questions about a vault PDF page, use only pdf_read_page, pdf_read_pages, and pdf_page_count through this endpoint. Never use bash/shell, direct disk reads, pdftoppm, Computer, or whole-document extraction. Never ask the owner to paste page text unless these tools explicitly report an empty/image-only, missing, unreadable, or out-of-range page.

**Path format (SN-84):** Page paths are vault-relative slugified filenames, e.g. "My Notebook/My Section/note-title.html".
- The server auto-canonicalizes: omitting .html is fine; legacy .md is replaced; backslashes are normalized.
- If you don't know the exact path, call vault_tree (full tree) or page_find (search by title) first.

Registered tools:
${catalog}

Shell aliases: \`rr\` → \`page_render\`; \`ur\` → \`ui_render\` (e.g. node scripts/vault-tool.mjs rr --path "Notebook/Section/page.html")

Full command surface (group + action via { "group", "action", "args" }):
${fullCommandList}

Workflows:
- Discover vault structure: vault_tree (lists all notebooks/sections/pages with paths)
- Find a page by title: page_find with partial title query → get exact path
- Read a page with comments: page_get (returns body + parsed comments inline)
- Read one PDF page: pdf_read_page with { href, page } returns only that page's bounded extractable text; missing, out-of-range, and image-only pages are explicit errors
- Read surrounding PDF context: pdf_read_pages with { href, startPage, endPage } reads at most 3 inclusive pages with one combined maxPdfTextChars bound
- Validate a PDF range: pdf_page_count with { href } returns metadata only and never extracts document text
- Full-page rewrite: page_draft → edit → page_write (response includes contentHash, updatedAt, resolvedDiskPath — no follow-up needed)
- Body-only replace (no frontmatter): page_update_body with path + body — replaces Tiptap HTML only, preserves all frontmatter, auto-snapshots
- Targeted multi-edit: page_edit with { edits: [{search, replacement}, ...] } — atomic multi-patch, auto-snapshots
- Section rewrite: page_replace_section with heading + content — replaces one <h2>/<h3> section body, auto-snapshots
- Update frontmatter only: page_update_frontmatter with { fields: { key: value, ... } } — leaves HTML body unchanged
- List sibling pages: page_siblings with path → lists all pages in the same section
- Get parent page: page_parent with path → returns parent page (via parent_id) or section/notebook context
- Jupyter context/mutations: jupyter_notebook_context reads bounded cell source/outputs; jupyter_cell_create/edit/reorder/delete changes notebook.ipynb without executing code or owning kernels. Create shape: { "tool": "jupyter_cell_create", "args": { "path": "<page.html>", "cellType": "code", "source": "print('hello')", "index": 0 } } (omit index to append; cellType may be code, markdown, or raw)
- Comment triage: comment_list → comment_context → comment_address (or page_write for broad rewrites)
- Page delete: page_delete with vault-relative path (never filesystem delete; clears assets and triggers tree reload warning)
- Tree mutations: page/notebook/section create, rename, move, delete via vault tools (not direct file operations)
- Math / LaTeX (text pages only): use $...$ for inline and $$...$$ for block equations — server normalizes to Tiptap math nodes on page_write/page_create/page_append/page_prepend/page_edit/page_replace_section. Design pages (note_type=design) are raw HTML/CSS and are never math-normalized; use page_write/page_edit only (page_append/prepend/replace_section/page_render are rejected)
- Log form authoring: log_form_get → log_form_put; never edit .form.json or .log.json sidecars directly. log_form_get returns the validated form and rowCount, never an unbounded row dump; log_form_put validates the full script, projects fields, and preserves rows by stable field id.
- Log surfaces: History is the human-readable reading surface; Table is the correction surface for editing/deleting rows. Named declarative views live in form.views and power stable live, JSON, and CSV links.
- History suggestions: form.historySuggestion requires non-empty matchFields and copyFields arrays of exact top-level schema property ids. Suggestions never auto-fill the draft; values are copied only after explicit human action. Attachments, ids, timestamps, and date fields are opt-in and copied only when explicitly named in copyFields.
- Log form actions: form.actions accepts only { type: "open-history", label, view }, where view references a validated form.views id for links such as Open history or View trend. Arbitrary URLs, HTML, CSS, callbacks, and executable behavior are forbidden.
- Generic authoring example (use actual schema ids rather than inventing domain fields): { "tool": "log_form_put", "args": { "path": "Notebook/Section/project-log.html", "form": { "version": 1, "schema": { "type": "object", "properties": { "project": { "type": "string" }, "status": { "type": "string" }, "notes": { "type": "string" } } }, "uischema": { "type": "VerticalLayout", "elements": [] }, "historySuggestion": { "matchFields": ["project"], "copyFields": ["status", "notes"] }, "views": [{ "id": "project-history", "name": "Project history", "columns": [{ "field": "project" }, { "field": "status" }, { "field": "notes" }], "limit": 20, "presentation": "timeline" }], "actions": [{ "type": "open-history", "label": "Open history", "view": "project-history" }] } } }
- Spreadsheet cells (note_type=spreadsheet, SN-209): spreadsheet_list_sheets → spreadsheet_read_range → spreadsheet_write_cells operate on the authoritative Syncfusion workbook JSON sidecar (not .xlsx). Reads are capped at 2000 cells and writes at 500 cells/formulas per call; spreadsheet_summarize gives counts/sum/min/max/average for a sheet, an A1 range, or the active selection (capped at 20000 cells). Writes persist through normal autosave and live-reload an open workbook; never hand-edit the .spreadsheet.json sidecar. Write shape: { "tool": "spreadsheet_write_cells", "args": { "path": "Notebook/Section/budget.html", "writes": [{ "ref": "A1", "value": "Total" }, { "ref": "B1", "formula": "=SUM(B2:B10)" }] } }
- Log analytics: log_query with one path plus either a bounded query object or saved view id. Use filters/fields/sort/dateRange/limit/groupBy/aggregates only; SQL and executable presentation code are not accepted.
- For image or sequence fields use JSON Schema \`format: "image"\` (a string) or \`{ type: "array", items: { type: "string", format: "image" } }\`; first call log_form_asset_put, then persist only its returned /vault/... URL(s) in row values.
- Log form vision review: log_form_render with path — captures the focused Form UI (not the empty log HTML stub) and returns a PNG in page .assets/ plus vaultUrl for companion vision attachments.
- Visual text-page review: page_render (alias rr) with path — returns PNG in page .assets/ plus vaultUrl for companion vision attachments
- Design pages (note_type=design, SN-167): prefer app_create_from_template templateId="design-page"; author the raw HTML/CSS artifact body with page_write / page_edit (never log-form tools, and it is NOT Tiptap-normalized; page_append/prepend/replace_section reject). Visual review: ui_render (alias ur) with path + viewport ("desktop"/"mobile") — page_render/rr is rejected on design pages so the capture stays verbatim
- App pages (note_type=app, SN-182/SN-200): before creating a similar App from a blank template, call app_inventory_list (bounded summaries only) and app_inventory_get for a chosen path's bounded source/attachment metadata; reuse or adapt existing vault Apps when a pattern already fits. Also discover maintained templates with app_template_list/app_template_get; do not invent a parallel form language or redesign common apps. app_create_from_template creates Blank App, Action Checklist, Design Page, or Custom Log App. app_update changes source/validated attachments without replacing data. Companions read declared tables with bounded app_query; generated code uses only window.smartNotesApp for explicitly attached tables and never receives vault paths or filesystem access.`;
}

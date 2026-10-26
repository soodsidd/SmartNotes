/**
 * File-backed bridge for sandboxed Smart Notes companions.
 *
 * The editor sandbox can Read/Write files in the application workspace but
 * cannot issue HTTP POST requests.  A request written under the bridge
 * directory is forwarded by the local server to the existing vault endpoint,
 * so snapshots, projection, and reload side effects stay server-owned.
 *
 * SN-203/SN-271: the same sandboxed transport also carries App authoring,
 * query, and `app_send` tools. This bridge is the tool INVOCATION transport;
 * all App validation, persistence, and side effects remain owned by
 * POST /api/agent/vault. app_send's own ephemeral socket delivery to the
 * running iframe is a separate layer and never touches log/app data.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

// SN-258 project-workspace operations. The server dispatcher routes these to
// capability-authenticated /api/workspace/* endpoints, never vault tools. A
// Deep Work bridge is bound to exactly this set plus one capability.
const WORKSPACE_TOOLS = new Set([
  "workspace_source_list",
  "workspace_source_read",
  "workspace_source_create",
  "workspace_source_edit",
  "workspace_annotations_get",
  "workspace_annotations_put",
  // SN-359 capability-scoped notebook cell tools (/api/workspace/notebook).
  "workspace_notebook_context",
  "workspace_cell_create",
  "workspace_cell_edit",
  "workspace_cell_reorder",
  "workspace_cell_delete",
  // The sole Deep Work execute tool; still capability-bound to /api/workspace.
  "jupyter_cell_run",
]);

const WORKSPACE_CELL_OPERATIONS = new Map([
  ["workspace_cell_create", "cell_create"],
  ["workspace_cell_edit", "cell_edit"],
  ["workspace_cell_reorder", "cell_reorder"],
  ["workspace_cell_delete", "cell_delete"],
]);

/**
 * Map one workspace_* tool call onto its capability-authenticated
 * /api/workspace/* HTTP request. Returns null for non-workspace tools.
 */
function workspaceToolRequest(tool, args, baseUrl) {
  const input = args && typeof args === "object" ? args : {};
  if (tool === "workspace_source_list" || tool === "workspace_source_read" || tool === "workspace_annotations_get") {
    const route = tool === "workspace_annotations_get" ? "annotations" : "source";
    const query = new URLSearchParams({ workspace: String(input.workspace || "") });
    if (tool === "workspace_source_list") {
      query.set("operation", "list");
      if (input.maxCount !== undefined) query.set("maxCount", String(input.maxCount));
    } else {
      query.set("path", String(input.path || ""));
      if (tool === "workspace_source_read" && input.maxBytes !== undefined) {
        query.set("maxBytes", String(input.maxBytes));
      }
    }
    return { endpoint: `${baseUrl}/api/workspace/${route}?${query}`, method: "GET", body: undefined };
  }
  if (tool === "workspace_source_create" || tool === "workspace_source_edit" || tool === "workspace_annotations_put") {
    return {
      endpoint: `${baseUrl}/api/workspace/${tool === "workspace_annotations_put" ? "annotations" : "source"}`,
      method: tool === "workspace_source_create" ? "POST" : "PUT",
      body: input,
    };
  }
  if (tool === "workspace_notebook_context") {
    const query = new URLSearchParams({
      workspace: String(input.workspace || ""),
      path: String(input.path || ""),
    });
    for (const key of ["index", "cellId", "startIndex"]) {
      if (input[key] !== undefined && input[key] !== null) query.set(key, String(input[key]));
    }
    return { endpoint: `${baseUrl}/api/workspace/notebook?${query}`, method: "GET", body: undefined };
  }
  if (WORKSPACE_CELL_OPERATIONS.has(tool)) {
    return {
      endpoint: `${baseUrl}/api/workspace/notebook`,
      method: "POST",
      body: { ...input, operation: WORKSPACE_CELL_OPERATIONS.get(tool) },
    };
  }
  if (tool === "jupyter_cell_run" && input.workspace) {
    return {
      endpoint: `${baseUrl}/api/workspace/notebook`,
      method: "POST",
      body: { ...input, operation: "cell_run" },
    };
  }
  return null;
}

const ALLOWED_TOOLS = new Set([
  "recipe_list", "recipe_run", "recipe_mark", "notebook_instructions_set",
  "page_get",
  "page_write",
  // Targeted multi-patch for large App/design HTML (and text pages). Same
  // POST /api/agent/vault path as page_write; without this, shell-less
  // companions are forced into full-source rewrites.
  "page_edit",
  // SN-222 shell-less page creation. Forwards to POST /api/agent/vault on the
  // same request/response path as page_write, so server-owned validation, the
  // create confirmation (path / resolvedDiskPath / vaultRelativePath), and the
  // vault-tree side effect all stay on the server.
  "page_create",
  "log_form_get",
  "log_form_put",
  "log_query",
  "log_form_render",
  "log_form_asset_put",
  // SN-271 shell-less App discovery, authoring, and bounded table reads. These
  // use the same POST /api/agent/vault path as page_write; the bridge adds no
  // App-frame network grants or table authority of its own.
  "app_inventory_list",
  "app_inventory_get",
  "app_template_list",
  "app_template_get",
  "app_query",
  "job_inbox_query", "job_inbox_update",
  "app_create_from_template",
  "app_update",
  // SN-203 companion→app delivery tool (see note above).
  "app_send",
  // SN-209 bounded Spreadsheet cell tools (POST /api/agent/vault). The editor
  // sandbox can only reach these write-capable vault tools through this bridge.
  "spreadsheet_list_sheets",
  "spreadsheet_read_range",
  "spreadsheet_write_cells",
  "spreadsheet_summarize",
  // SN-217 focused Jupyter reads/edits. These remain bounded to the canonical
  // notebook.ipynb and preserve the server-owned reload event path.
  "jupyter_notebook_context",
  "jupyter_cell_edit",
  // SN-376 short-await execution on the page's live kernel (blocks <=60s).
  "jupyter_cell_run",
  // SN-387 module files in the page's own .jupyter folder (revision-safe).
  "jupyter_file_read",
  "jupyter_file_write",
  // SN-282 Bibliography paper tools. The PDF download runs on the server, so a
  // network-less sandbox can still attach a paper PDF through this bridge.
  "paper_list",
  "paper_create",
  "paper_create_from_pdf",
  "paper_reference_add",
  "paper_remove",
  "paper_attach_pdf",
  ...WORKSPACE_TOOLS,
]);
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

function responsePathFor(requestsDir, responsesDir, requestPath) {
  const relative = path.relative(requestsDir, requestPath);
  const parsed = path.parse(relative);
  return path.join(responsesDir, parsed.dir, `${parsed.name}.json`);
}

async function writeJsonAtomically(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(temporary, filePath);
}

function errorResponse(requestPath, code, error) {
  return {
    requestPath,
    ok: false,
    code,
    error,
    completedAt: new Date().toISOString(),
  };
}

async function processBridgeRequest({
  requestPath,
  requestsDir,
  responsesDir,
  invokeTool,
  allowedTools = ALLOWED_TOOLS,
  authorizeTool,
}) {
  const responsePath = responsePathFor(requestsDir, responsesDir, requestPath);
  try {
    const stat = await fsp.stat(requestPath);
    if (stat.size > MAX_REQUEST_BYTES) {
      const response = errorResponse(requestPath, "REQUEST_TOO_LARGE", `Request exceeds ${MAX_REQUEST_BYTES} bytes.`);
      await writeJsonAtomically(responsePath, response);
      return response;
    }

    const raw = await fsp.readFile(requestPath, "utf8");
    const request = JSON.parse(raw);
    const tool = typeof request?.tool === "string" ? request.tool.trim() : "";
    const args = request?.args;
    if (!allowedTools.has(tool)) {
      const response = errorResponse(requestPath, "TOOL_NOT_ALLOWED", "Only allowlisted companion vault bridge tools are allowed.");
      await writeJsonAtomically(responsePath, response);
      return response;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      const response = errorResponse(requestPath, "INVALID_INPUT", '"args" must be an object.');
      await writeJsonAtomically(responsePath, response);
      return response;
    }
    if (authorizeTool && !authorizeTool(tool, args)) {
      const response = errorResponse(
        requestPath,
        "WORKSPACE_CAPABILITY_MISMATCH",
        "This Deep Work bridge accepts only its bound workspace capability."
      );
      await writeJsonAtomically(responsePath, response);
      return response;
    }

    const result = await invokeTool(tool, args);
    const response = {
      requestPath,
      ok: result.ok === true,
      status: result.status,
      tool,
      result,
      completedAt: new Date().toISOString(),
    };
    await writeJsonAtomically(responsePath, response);
    return response;
  } catch (error) {
    const response = errorResponse(
      requestPath,
      "BRIDGE_FAILED",
      error instanceof Error ? error.message : String(error)
    );
    await writeJsonAtomically(responsePath, response);
    return response;
  }
}

async function ensureBridgeFiles(rootDir, allowedTools = ALLOWED_TOOLS) {
  const requestsDir = path.join(rootDir, "requests");
  const responsesDir = path.join(rootDir, "responses");
  await Promise.all([fsp.mkdir(requestsDir, { recursive: true }), fsp.mkdir(responsesDir, { recursive: true })]);
  await fsp.writeFile(
    path.join(rootDir, "README.md"),
    "# Smart Notes companion vault bridge\n\n"
      + "Write one JSON request to `requests/<unique-id>.json`, then read `responses/<unique-id>.json`. "
      + `Allowed tools: ${[...allowedTools].sort().join(", ")}. `
      + "The local server performs the actual managed API operation so validation, atomic persistence, and reload side effects remain intact.\n",
    "utf8"
  );
  return { requestsDir, responsesDir };
}

function startCompanionLogFormBridge({
  rootDir,
  invokeTool,
  logger = console,
  allowedTools = ALLOWED_TOOLS,
  authorizeTool,
}) {
  const pending = new Set();
  const completed = new Set();
  let watcher = null;
  let closed = false;
  let directories = null;

  const schedule = (fileName) => {
    if (closed || !directories || typeof fileName !== "string" || !fileName.endsWith(".json")) return;
    const requestPath = path.resolve(directories.requestsDir, fileName);
    if (!requestPath.startsWith(`${directories.requestsDir}${path.sep}`)) return;
    if (pending.has(requestPath) || completed.has(requestPath)) return;
    pending.add(requestPath);
    setTimeout(async () => {
      try {
        const responsePath = responsePathFor(directories.requestsDir, directories.responsesDir, requestPath);
        try {
          await fsp.access(responsePath);
          completed.add(requestPath);
          return;
        } catch {
          // No prior response: process this new request.
        }
        await processBridgeRequest({
          requestPath,
          ...directories,
          invokeTool,
          allowedTools,
          authorizeTool,
        });
        completed.add(requestPath);
      } catch (error) {
        logger.warn?.("[smart-notes] companion vault bridge request failed:", error);
      } finally {
        pending.delete(requestPath);
      }
    }, 40);
  };

  const ready = ensureBridgeFiles(rootDir, allowedTools).then((nextDirectories) => {
    directories = nextDirectories;
    watcher = fs.watch(directories.requestsDir, { persistent: false }, (_event, fileName) => schedule(fileName));
    return { rootDir, ...directories };
  });

  return {
    ready,
    close() {
      closed = true;
      watcher?.close();
    },
  };
}

module.exports = {
  ALLOWED_TOOLS,
  WORKSPACE_TOOLS,
  workspaceToolRequest,
  MAX_REQUEST_BYTES,
  responsePathFor,
  processBridgeRequest,
  startCompanionLogFormBridge,
};

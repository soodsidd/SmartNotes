import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const {
  ALLOWED_TOOLS,
  processBridgeRequest,
  responsePathFor,
  startCompanionLogFormBridge,
} = require("../server/companion-log-form-bridge");

const APP_AUTHORING_TOOLS = [
  "app_inventory_list",
  "app_inventory_get",
  "app_template_list",
  "app_template_get",
  "app_query",
  "app_create_from_template",
  "app_update",
];

async function waitForJson(filePath: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for bridge response: ${filePath}`);
}

describe("companion vault bridge", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sn-log-form-bridge-"));
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("forwards an allowed form put and writes its server response", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "replace-form.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      tool: "log_form_put",
      args: { path: "Notebook/Section/log.html", form: { version: 1 } },
    }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, data: { fields: ["entry"] } });

    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenCalledWith("log_form_put", {
      path: "Notebook/Section/log.html",
      form: { version: 1 },
    });
    expect(response).toMatchObject({ ok: true, tool: "log_form_put" });
    expect(JSON.parse(fs.readFileSync(responsePathFor(requestsDir, responsesDir, requestPath), "utf8"))).toMatchObject({
      ok: true,
      tool: "log_form_put",
      result: { ok: true, data: { fields: ["entry"] } },
    });
  });

  it("forwards the SN-203 app_send tool so an editor-sandbox companion can reach a running app", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "app-send.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      tool: "app_send",
      args: { path: "Notebook/Apps/e2e-app.html", message: { hello: "world" } },
    }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, result: { delivered: 1 } });

    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenCalledWith("app_send", {
      path: "Notebook/Apps/e2e-app.html",
      message: { hello: "world" },
    });
    expect(response).toMatchObject({ ok: true, tool: "app_send" });
  });

  it("forwards every advertised App authoring and query tool through the default bridge allowlist", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const appPath = "Notebook/Apps/daily-focus.html";
    const cases = [
      { tool: "app_inventory_list", args: { limit: 10 } },
      { tool: "app_inventory_get", args: { path: appPath } },
      { tool: "app_template_list", args: {} },
      { tool: "app_template_get", args: { templateId: "blank-app" } },
      { tool: "app_query", args: { path: appPath, tableId: "items", query: { limit: 5 } } },
      { tool: "app_create_from_template", args: { sectionPath: "Notebook/Apps", title: "Daily Focus", templateId: "blank-app" } },
      { tool: "app_update", args: { path: appPath, source: "<main>Updated</main>" } },
    ];
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    expect(APP_AUTHORING_TOOLS.every((tool) => ALLOWED_TOOLS.has(tool))).toBe(true);
    for (const [index, entry] of cases.entries()) {
      const requestPath = path.join(requestsDir, `app-${index}.json`);
      fs.writeFileSync(requestPath, JSON.stringify(entry));
      const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });
      expect(response).toMatchObject({ ok: true, status: 200, tool: entry.tool });
    }
    expect(invokeTool.mock.calls).toEqual(cases.map(({ tool, args }) => [tool, args]));
  });

  it("forwards the SN-209 spreadsheet_write_cells tool so an editor-sandbox companion can edit cells", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "sheet-write.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      tool: "spreadsheet_write_cells",
      args: { path: "Notebook/Section/budget.html", writes: [{ ref: "B1", formula: "=SUM(B2:B10)" }] },
    }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, result: { appliedCount: 1 } });

    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenCalledWith("spreadsheet_write_cells", {
      path: "Notebook/Section/budget.html",
      writes: [{ ref: "B1", formula: "=SUM(B2:B10)" }],
    });
    expect(response).toMatchObject({ ok: true, tool: "spreadsheet_write_cells" });
  });

  it("forwards bounded focused Jupyter reads and edits for shell-less companions", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const readPath = path.join(requestsDir, "jupyter-read.json");
    const editPath = path.join(requestsDir, "jupyter-edit.json");
    const selector = { path: "Notebook/Section/analysis.html", index: 2, cellId: "cell-2" };
    fs.writeFileSync(readPath, JSON.stringify({ tool: "jupyter_notebook_context", args: selector }));
    fs.writeFileSync(editPath, JSON.stringify({
      tool: "jupyter_cell_edit",
      args: { ...selector, source: "a = 7\nb = 11" },
    }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, result: { mutation: { index: 2 } } });

    const read = await processBridgeRequest({ requestPath: readPath, requestsDir, responsesDir, invokeTool });
    const edit = await processBridgeRequest({ requestPath: editPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenNthCalledWith(1, "jupyter_notebook_context", selector);
    expect(invokeTool).toHaveBeenNthCalledWith(2, "jupyter_cell_edit", { ...selector, source: "a = 7\nb = 11" });
    expect(read).toMatchObject({ ok: true, tool: "jupyter_notebook_context" });
    expect(edit).toMatchObject({ ok: true, tool: "jupyter_cell_edit" });
  });

  it("binds a Deep Work bridge to workspace-only tools and one capability", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const capability = `dwc_${"a".repeat(43)}`;
    const allowedTools = new Set([
      "workspace_source_list",
      "workspace_source_read",
      "workspace_source_create",
      "workspace_source_edit",
    ]);
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const cases = [
      { name: "list", tool: "workspace_source_list", args: { workspace: capability, maxCount: 10 } },
      { name: "create", tool: "workspace_source_create", args: { workspace: capability, path: "walkthrough.ipynb", source: "{}" } },
      { name: "wrong-capability", tool: "workspace_source_read", args: { workspace: `dwc_${"b".repeat(43)}`, path: "main.py" } },
      { name: "vault-fallback", tool: "page_get", args: { path: "Vault/LeRobot.jupyter" } },
    ];
    for (const entry of cases) {
      fs.writeFileSync(path.join(requestsDir, `${entry.name}.json`), JSON.stringify(entry));
    }

    const options = {
      requestsDir,
      responsesDir,
      invokeTool,
      allowedTools,
      authorizeTool: (_tool: string, args: Record<string, unknown>) => args.workspace === capability,
    };
    const list = await processBridgeRequest({ requestPath: path.join(requestsDir, "list.json"), ...options });
    const create = await processBridgeRequest({ requestPath: path.join(requestsDir, "create.json"), ...options });
    const wrongCapability = await processBridgeRequest({ requestPath: path.join(requestsDir, "wrong-capability.json"), ...options });
    const vaultFallback = await processBridgeRequest({ requestPath: path.join(requestsDir, "vault-fallback.json"), ...options });

    expect(list).toMatchObject({ ok: true, tool: "workspace_source_list" });
    expect(create).toMatchObject({ ok: true, tool: "workspace_source_create" });
    expect(wrongCapability).toMatchObject({ ok: false, code: "WORKSPACE_CAPABILITY_MISMATCH" });
    expect(vaultFallback).toMatchObject({ ok: false, code: "TOOL_NOT_ALLOWED" });
    expect(invokeTool).toHaveBeenCalledTimes(2);
  });

  it("forwards page_get and page_write while rejecting other page commands", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const writePath = path.join(requestsDir, "write.json");
    const readPath = path.join(requestsDir, "read.json");
    const rejectedPath = path.join(requestsDir, "not-allowed.json");
    fs.writeFileSync(writePath, JSON.stringify({ tool: "page_write", args: { path: "x.html", body: "<p>updated</p>" } }));
    fs.writeFileSync(readPath, JSON.stringify({ tool: "page_get", args: { path: "x.html" } }));
    fs.writeFileSync(rejectedPath, JSON.stringify({ tool: "page_delete", args: { path: "x.html" } }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const write = await processBridgeRequest({ requestPath: writePath, requestsDir, responsesDir, invokeTool });
    const read = await processBridgeRequest({ requestPath: readPath, requestsDir, responsesDir, invokeTool });
    const rejected = await processBridgeRequest({ requestPath: rejectedPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenNthCalledWith(1, "page_write", { path: "x.html", body: "<p>updated</p>" });
    expect(invokeTool).toHaveBeenNthCalledWith(2, "page_get", { path: "x.html" });
    expect(write).toMatchObject({ ok: true, tool: "page_write" });
    expect(read).toMatchObject({ ok: true, tool: "page_get" });
    expect(rejected).toMatchObject({ ok: false, code: "TOOL_NOT_ALLOWED" });
  });

  it("forwards SN-222 page_create with the server create confirmation for shell-less companions", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "page-create.json");
    const args = { sectionPath: "Notebook/Section", title: "New note", content: "<p>hi</p>" };
    fs.writeFileSync(requestPath, JSON.stringify({ tool: "page_create", args }));
    const invokeTool = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        page: { path: "Notebook/Section/new-note.html" },
        resolvedDiskPath: "C:/vault/Notebook/Section/new-note.html",
        vaultRelativePath: "Notebook/Section/new-note.html",
      },
    });

    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenCalledWith("page_create", args);
    expect(response).toMatchObject({
      ok: true,
      tool: "page_create",
      result: {
        ok: true,
        data: {
          resolvedDiskPath: "C:/vault/Notebook/Section/new-note.html",
          vaultRelativePath: "Notebook/Section/new-note.html",
        },
      },
    });
    expect(JSON.parse(fs.readFileSync(responsePathFor(requestsDir, responsesDir, requestPath), "utf8"))).toMatchObject({
      ok: true,
      tool: "page_create",
    });
  });

  it("surfaces a rejected page_create as a clear bridge error rather than a silent no-op", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "page-create-bad.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      tool: "page_create",
      args: { sectionPath: "Notebook/Section", title: "Bad", noteType: "ink" },
    }));
    const invokeTool = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      code: "INVALID_INPUT",
      error: 'page_create noteType supports only "text" or "design"; create ink/jupyter/log pages from the UI.',
    });

    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });

    expect(invokeTool).toHaveBeenCalledWith("page_create", {
      sectionPath: "Notebook/Section",
      title: "Bad",
      noteType: "ink",
    });
    expect(response).toMatchObject({ ok: false, tool: "page_create", status: 400 });
    expect(response.result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("forwards the bounded log query tool but still rejects arbitrary commands", async () => {
    const requestsDir = path.join(root, "requests");
    const responsesDir = path.join(root, "responses");
    fs.mkdirSync(requestsDir, { recursive: true });
    const requestPath = path.join(requestsDir, "query.json");
    fs.writeFileSync(requestPath, JSON.stringify({
      tool: "log_query",
      args: { path: "Notebook/Section/log.html", query: { limit: 5 } },
    }));
    const invokeTool = jest.fn().mockResolvedValue({ ok: true, result: { data: { rows: [] } } });
    const response = await processBridgeRequest({ requestPath, requestsDir, responsesDir, invokeTool });
    expect(invokeTool).toHaveBeenCalledWith("log_query", {
      path: "Notebook/Section/log.html",
      query: { limit: 5 },
    });
    expect(response).toMatchObject({ ok: true, tool: "log_query" });
  });

  it("performs a shell-less page_write and page_get through the creating server's dynamic port", async () => {
    let savedBody = "";
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const payload = JSON.parse(raw) as { tool: string; args: Record<string, unknown> };
        requests.push(payload);
        if (request.url !== "/api/agent/vault") {
          response.writeHead(404).end();
          return;
        }
        if (payload.tool === "page_write") savedBody = String(payload.args.body || "");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          ok: true,
          ...(payload.tool === "page_get" ? { body: savedBody } : { path: payload.args.path }),
        }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Dynamic port was not assigned");
    const bridge = startCompanionLogFormBridge({
      rootDir: root,
      async invokeTool(tool: string, args: Record<string, unknown>) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/vault`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool, args }),
        });
        return { ok: response.ok, status: response.status, ...await response.json() };
      },
    });

    try {
      const { requestsDir, responsesDir } = await bridge.ready;
      const pagePath = "+portable/remote-origin-check.html";
      const body = "<p>Written through the shell-less vault bridge.</p>";
      await fs.promises.writeFile(
        path.join(requestsDir, "remote-write.json"),
        JSON.stringify({ tool: "page_write", args: { path: pagePath, body } })
      );
      const write = await waitForJson(path.join(responsesDir, "remote-write.json"));
      await fs.promises.writeFile(
        path.join(requestsDir, "remote-read.json"),
        JSON.stringify({ tool: "page_get", args: { path: pagePath } })
      );
      const read = await waitForJson(path.join(responsesDir, "remote-read.json"));

      expect(write).toMatchObject({ ok: true, tool: "page_write", status: 200 });
      expect(read).toMatchObject({ ok: true, tool: "page_get", result: { body } });
      expect(requests.map((entry) => entry.tool)).toEqual(["page_write", "page_get"]);
    } finally {
      bridge.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("creates and updates a Blank App through POST /api/agent/vault and preserves vault errors verbatim", async () => {
    const requests: Array<{ method?: string; url?: string; tool: string; args: Record<string, unknown> }> = [];
    let appPath = "";
    let appSource = "";
    const vaultError = {
      ok: false,
      code: "INVALID_APP",
      error: "app_update accepts source or templateId, not both.",
    };
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const payload = JSON.parse(raw) as { tool: string; args: Record<string, unknown> };
        requests.push({ method: request.method, url: request.url, ...payload });
        response.setHeader("Content-Type", "application/json");
        if (request.method !== "POST" || request.url !== "/api/agent/vault") {
          response.writeHead(404).end(JSON.stringify({ ok: false, code: "NOT_FOUND", error: "Not found." }));
          return;
        }
        if (payload.tool === "app_create_from_template") {
          appPath = "Notebook/Apps/daily-focus.html";
          appSource = "<main><h1>Blank App</h1></main>";
          response.end(JSON.stringify({ ok: true, path: appPath, source: appSource }));
          return;
        }
        if (payload.tool === "app_update" && payload.args.source !== undefined && payload.args.templateId !== undefined) {
          response.writeHead(400).end(JSON.stringify(vaultError));
          return;
        }
        if (payload.tool === "app_update" && payload.args.path === appPath) {
          appSource = String(payload.args.source || "");
          response.end(JSON.stringify({ ok: true, path: appPath, source: appSource }));
          return;
        }
        response.writeHead(400).end(JSON.stringify({ ok: false, code: "INVALID_INPUT", error: "Unexpected request." }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Dynamic port was not assigned");
    const bridge = startCompanionLogFormBridge({
      rootDir: root,
      async invokeTool(tool: string, args: Record<string, unknown>) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/vault`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool, args }),
        });
        return { ok: response.ok, status: response.status, ...await response.json() };
      },
    });

    try {
      const { requestsDir, responsesDir } = await bridge.ready;
      await fs.promises.writeFile(
        path.join(requestsDir, "app-create.json"),
        JSON.stringify({
          tool: "app_create_from_template",
          args: { sectionPath: "Notebook/Apps", title: "Daily Focus", templateId: "blank-app" },
        })
      );
      const create = await waitForJson(path.join(responsesDir, "app-create.json"));

      const updatedSource = "<main><h1>Daily Focus</h1></main>";
      await fs.promises.writeFile(
        path.join(requestsDir, "app-update.json"),
        JSON.stringify({ tool: "app_update", args: { path: create.result.path, source: updatedSource } })
      );
      const update = await waitForJson(path.join(responsesDir, "app-update.json"));

      await fs.promises.writeFile(
        path.join(requestsDir, "app-update-invalid.json"),
        JSON.stringify({
          tool: "app_update",
          args: { path: appPath, source: updatedSource, templateId: "blank-app" },
        })
      );
      const rejected = await waitForJson(path.join(responsesDir, "app-update-invalid.json"));

      expect(create).toMatchObject({ ok: true, status: 200, tool: "app_create_from_template", result: { path: appPath } });
      expect(update).toMatchObject({ ok: true, status: 200, tool: "app_update", result: { path: appPath, source: updatedSource } });
      expect(appSource).toBe(updatedSource);
      expect(rejected).toMatchObject({ ok: false, status: 400, tool: "app_update", result: vaultError });
      expect(requests.map(({ method, url, tool }) => ({ method, url, tool }))).toEqual([
        { method: "POST", url: "/api/agent/vault", tool: "app_create_from_template" },
        { method: "POST", url: "/api/agent/vault", tool: "app_update" },
        { method: "POST", url: "/api/agent/vault", tool: "app_update" },
      ]);
    } finally {
      bridge.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("SN-222: creates a page shell-lessly through the creating server's dynamic port", async () => {
    const requests: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const payload = JSON.parse(raw) as { tool: string; args: Record<string, unknown> };
        requests.push(payload);
        if (request.url !== "/api/agent/vault" || payload.tool !== "page_create") {
          response.writeHead(404).end();
          return;
        }
        const title = String(payload.args.title || "Untitled page");
        const vaultRelativePath = `${String(payload.args.sectionPath)}/${title.toLowerCase().replace(/\s+/g, "-")}.html`;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          ok: true,
          data: {
            page: { path: vaultRelativePath, title },
            resolvedDiskPath: `C:/vault/${vaultRelativePath}`,
            vaultRelativePath,
          },
          treeChanged: true,
        }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Dynamic port was not assigned");
    const bridge = startCompanionLogFormBridge({
      rootDir: root,
      async invokeTool(tool: string, args: Record<string, unknown>) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/agent/vault`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool, args }),
        });
        return { ok: response.ok, status: response.status, ...await response.json() };
      },
    });

    try {
      const { requestsDir, responsesDir } = await bridge.ready;
      await fs.promises.writeFile(
        path.join(requestsDir, "remote-create.json"),
        JSON.stringify({
          tool: "page_create",
          args: { sectionPath: "Notebook/Section", title: "New note", content: "<p>hi</p>" },
        })
      );
      const create = await waitForJson(path.join(responsesDir, "remote-create.json"));

      expect(create).toMatchObject({
        ok: true,
        tool: "page_create",
        status: 200,
        result: {
          ok: true,
          data: {
            resolvedDiskPath: "C:/vault/Notebook/Section/new-note.html",
            vaultRelativePath: "Notebook/Section/new-note.html",
          },
        },
      });
      expect(requests.map((entry) => entry.tool)).toEqual(["page_create"]);
    } finally {
      bridge.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

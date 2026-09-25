import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const {
  buildCompanionProviderEnv,
  extractDeepWorkCapability,
  resolveCompanionApiTarget,
  rewriteCompanionAppContext,
} = require("../packages/cli-chat/index") as {
  buildCompanionProviderEnv: (env: NodeJS.ProcessEnv, port: number) => NodeJS.ProcessEnv;
  extractDeepWorkCapability: (context: string) => string | null;
  resolveCompanionApiTarget: (input: { boundPort: number; browserOrigin?: string }) => {
    browserOrigin: string;
    port: number;
    apiBaseUrl: string;
  };
  rewriteCompanionAppContext: (
    context: string,
    target: { browserOrigin: string; port: number; apiBaseUrl: string; companionBridgeRoot?: string }
  ) => string;
};

describe("companion host-local vault API target", () => {
  it("keeps a remote browser origin distinct from the loopback API target", () => {
    const target = resolveCompanionApiTarget({
      boundPort: 54321,
      browserOrigin: "https://smart-notes.tailnet.example/app?source=pwa",
    });
    const context = rewriteCompanionAppContext(
      [
        "Smart Notes operating context:",
        "- apiBaseUrl (THIS Smart Notes server): https://smart-notes.tailnet.example",
        "- Vault tools API: POST https://smart-notes.tailnet.example/api/agent/vault",
        "- Shell-less editor sandbox: use .smart-notes-companion-log-form-bridge/requests/<unique-id>.json in the app workspace.",
      ].join("\n"),
      { ...target, companionBridgeRoot: "C:\\Projects\\smart-notes\\.smart-notes-companion-log-form-bridge" }
    );

    expect(target).toEqual({
      browserOrigin: "https://smart-notes.tailnet.example",
      port: 54321,
      apiBaseUrl: "http://127.0.0.1:54321",
    });
    expect(context).toContain("browserOrigin (browser-visible only; never call from host tools)");
    expect(context).toContain("apiBaseUrl (host-local Smart Notes server): http://127.0.0.1:54321");
    expect(context).toContain("POST http://127.0.0.1:54321/api/agent/vault");
    expect(context).toContain("C:\\Projects\\smart-notes\\.smart-notes-companion-log-form-bridge\\requests\\<unique-id>.json");
    expect(context).toContain("use these literal absolute paths");
    expect(context).toContain("do not search, inspect a README, or resolve them against cwd");
    expect(context).not.toContain("use .smart-notes-companion-log-form-bridge/requests/<unique-id>.json");
    expect(context).toContain("otherwise use the shell-less vault bridge");
    expect(context).toContain("the four spreadsheet tools");
    expect(context.match(/https:\/\/smart-notes\.tailnet\.example/g)).toHaveLength(1);
    expect(context).toContain("Do not probe processes, assume port 3002, call browserOrigin");
  });

  it("propagates the dynamic bound port to both provider environment variables", () => {
    const env = buildCompanionProviderEnv({ PORT: "3002", SMART_NOTES_PORT: "3002" }, 54876);
    expect(env.PORT).toBe("54876");
    expect(env.SMART_NOTES_PORT).toBe("54876");
  });

  it("rewrites Deep Work turns to a capability-only bridge without vault fallback guidance", () => {
    const capability = `dwc_${"a".repeat(43)}`;
    const context = [
      "Smart Notes Deep Work operating context:",
      "- Registered workspace root identity: C:\\Projects\\LeRobot",
      `- workspaceCapability: ${capability}`,
      "- Active repository-relative file: main.py",
    ].join("\n");
    const rewritten = rewriteCompanionAppContext(context, {
      browserOrigin: "https://smart-notes.tailnet.example",
      port: 54321,
      apiBaseUrl: "http://127.0.0.1:54321",
      companionBridgeRoot: "C:\\bridge\\deep-work\\bound",
    });

    expect(extractDeepWorkCapability(context)).toBe(capability);
    expect(rewritten).toContain("Host-side Deep Work connection (server-authoritative)");
    expect(rewritten).toContain("accepts only workspace_source_list, workspace_source_read, workspace_source_create");
    expect(rewritten).toContain("Vault page/tree/Jupyter-note tools are outside its authority");
    expect(rewritten).not.toContain("Vault tool shell");
    expect(rewritten).not.toContain("otherwise use the shell-less vault bridge");
  });

  it("performs page_write and page_get through the dynamic loopback target", async () => {
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

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Dynamic port was not assigned");
      const target = resolveCompanionApiTarget({
        boundPort: address.port,
        browserOrigin: "https://smart-notes.tailnet.example",
      });
      const env = buildCompanionProviderEnv(process.env, target.port);
      const toolPath = path.resolve(__dirname, "../scripts/vault-tool.mjs");
      const pagePath = "Notebook/Section/remote-origin-check.html";
      const body = "<p>Written through the host-local API.</p>";

      const write = await execFileAsync(process.execPath, [
        toolPath,
        "--json",
        JSON.stringify({ tool: "page_write", args: { path: pagePath, body } }),
      ], { env });
      const read = await execFileAsync(process.execPath, [
        toolPath,
        "--json",
        JSON.stringify({ tool: "page_get", args: { path: pagePath } }),
      ], { env });

      expect(write.stderr).toBe("");
      expect(read.stderr).toBe("");
      expect(JSON.parse(read.stdout)).toMatchObject({ ok: true, body });
      expect(requests.map((entry) => entry.tool)).toEqual(["page_write", "page_get"]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }, 15_000);
});

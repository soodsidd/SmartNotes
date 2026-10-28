import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSmartNotesOperatingContext } from "@/lib/ai-sidebar";
import { verifiedWorkspaceHostPage } from "@/server/jupyter/workspace-host-page";
import { executeVaultCommand } from "@/server/vault/agent-commands";
import { invalidateVaultTreeCacheForTesting, readPage } from "@/server/vault/pages";

const { createDeepWorkBridgeScope } = require("../server/companion-log-form-bridge");

// SN-404: page-bound Deep Work folders keep their host vault page in scope.

const CAPABILITY = `dwc_${"h".repeat(43)}`;

async function withVault(run: (vaultRoot: string, workspaceRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn404-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn404-state-"));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn404-folder-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  invalidateVaultTreeCacheForTesting();
  try {
    const section = path.join(vaultRoot, "Robots", "Arm");
    await fs.mkdir(section, { recursive: true });
    await fs.writeFile(
      path.join(section, "master-repo.html"),
      [
        "---",
        "title: Master Repo",
        "note_type: jupyter",
        "jupyter_workspace:",
        "  version: 1",
        `  rootPath: ${JSON.stringify(workspaceRoot)}`,
        "  projectName: LeRobot",
        "  requestedAccess: editable",
        "---",
        "",
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(section, "plain.html"),
      "---\ntitle: Plain\nnote_type: text\n---\n<p>plain</p>\n",
      "utf8"
    );
    await run(vaultRoot, workspaceRoot);
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    invalidateVaultTreeCacheForTesting();
    await Promise.all([vaultRoot, stateDir, workspaceRoot].map((dir) =>
      fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    ));
  }
}

describe("SN-404 page_create parentPath", () => {
  it("creates a nested child page in the parent's section", async () => {
    await withVault(async () => {
      const created = await executeVaultCommand({
        group: "page",
        action: "create",
        args: { parentPath: "Robots/Arm/master-repo.html", title: "Data quality", content: "<p>Checks</p>" },
      });
      const child = (created.data as { page: { path: string } }).page;
      expect(child.path.startsWith("Robots/Arm/")).toBe(true);
      const read = await readPage(child.path);
      expect(read.metadata.parent_id).toBe("Robots/Arm/master-repo.html");
      expect(read.body).toContain("Checks");
    });
  });

  it("still requires sectionPath when no parent is given", async () => {
    await withVault(async () => {
      await expect(executeVaultCommand({ group: "page", action: "create", args: { title: "Orphan" } }))
        .rejects.toThrow(/sectionPath/);
    });
  });
});

describe("SN-404 verified workspace host page", () => {
  it("accepts only a Jupyter page bound to the same root", async () => {
    await withVault(async (_vault, workspaceRoot) => {
      await expect(verifiedWorkspaceHostPage("Robots/Arm/master-repo.html", workspaceRoot))
        .resolves.toBe("Robots/Arm/master-repo.html");
      await expect(verifiedWorkspaceHostPage("Robots/Arm/master-repo.html", os.tmpdir())).resolves.toBeNull();
      await expect(verifiedWorkspaceHostPage("Robots/Arm/plain.html", workspaceRoot)).resolves.toBeNull();
      await expect(verifiedWorkspaceHostPage("Robots/Arm/missing.html", workspaceRoot)).resolves.toBeNull();
      await expect(verifiedWorkspaceHostPage(undefined, workspaceRoot)).resolves.toBeNull();
    });
  });
});

describe("SN-404 Deep Work bridge host-page scope", () => {
  // child -> master-repo (host); other has no parent.
  const parents: Record<string, string | null> = {
    "Robots/Arm/child.html": "Robots/Arm/master-repo.html",
    "Robots/Arm/grandchild.html": "Robots/Arm/child.html",
    "Robots/Arm/master-repo.html": null,
    "Robots/Arm/other.html": null,
  };
  function scopeFor(hostPagePath?: string) {
    const invokeTool = jest.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "page_parent") {
        return { ok: true, result: { data: { parentId: parents[String(args.path)] ?? null } } };
      }
      return { ok: true, tool, args };
    });
    return { scope: createDeepWorkBridgeScope({ capability: CAPABILITY, hostPagePath, invokeTool }), invokeTool };
  }

  it("allows page tools only for the host page subtree", async () => {
    const { scope } = scopeFor("Robots/Arm/master-repo.html");
    expect(scope.allowedTools.has("page_create")).toBe(true);
    const ok = (tool: string, args: Record<string, unknown>) =>
      scope.authorizeTool(tool, { workspace: CAPABILITY, ...args });
    await expect(ok("page_create", { parentPath: "Robots/Arm/master-repo.html" })).resolves.toBe(true);
    await expect(ok("page_create", { parentPath: "Robots/Arm/child" })).resolves.toBe(true);
    await expect(ok("page_get", { path: "Robots/Arm/grandchild.html" })).resolves.toBe(true);
    await expect(ok("page_write", { path: "Robots/Arm/other.html" })).resolves.toBe(false);
    await expect(ok("page_create", { sectionPath: "Robots/Arm" })).resolves.toBe(false);
    await expect(ok("page_create", { parentPath: "Robots/Arm/master-repo.html", noteType: "design" })).resolves.toBe(false);
    await expect(ok("page_edit", { path: "Robots/Arm/../Arm/master-repo.html" })).resolves.toBe(false);
    await expect(scope.authorizeTool("page_get", { workspace: "dwc_other", path: "Robots/Arm/master-repo.html" }))
      .resolves.toBe(false);
    await expect(ok("workspace_source_list", {})).resolves.toBe(true);
  });

  it("keeps unbound folders workspace-only", async () => {
    const { scope } = scopeFor(undefined);
    expect(scope.allowedTools.has("page_get")).toBe(false);
    await expect(scope.authorizeTool("page_get", { workspace: CAPABILITY, path: "Robots/Arm/master-repo.html" }))
      .resolves.toBe(false);
  });

  it("strips the capability before forwarding page tools to the vault", async () => {
    const { scope, invokeTool } = scopeFor("Robots/Arm/master-repo.html");
    await scope.invokeTool("page_create", { workspace: CAPABILITY, parentPath: "Robots/Arm/master-repo.html", title: "x" });
    expect(invokeTool).toHaveBeenLastCalledWith("page_create", { parentPath: "Robots/Arm/master-repo.html", title: "x" });
  });
});

describe("SN-404 Deep Work operating context", () => {
  const base = {
    title: "Master Repo",
    path: "Robots/Arm/master-repo.html",
    noteType: "jupyter" as const,
    apiBaseUrl: "http://127.0.0.1:3002",
  };
  const workspace = {
    rootPath: "C:/Projects/LeRobot",
    projectName: "LeRobot",
    requestedAccess: "editable" as const,
    capability: CAPABILITY,
  };

  it("names the host page and child-page tools for a page-bound folder", () => {
    const context = buildSmartNotesOperatingContext({
      ...base,
      projectWorkspace: { ...workspace, hostPage: { path: base.path, title: base.title } },
    });
    expect(context).toContain(`Host Smart Notes page: ${base.path}`);
    expect(context).toContain(`"parentPath": "${base.path}"`);
    expect(context).toContain("do not ask the owner to open the page first");
  });

  it("keeps the no-vault rule for an unbound folder", () => {
    const context = buildSmartNotesOperatingContext({ ...base, projectWorkspace: workspace });
    expect(context).not.toContain("Host Smart Notes page");
    expect(context).toContain("Ignore prior vault-page targets");
  });
});

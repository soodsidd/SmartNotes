import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PATCH } from "@/app/api/page/route";
import { createPage, readPage } from "@/server/vault/pages";
import {
  activeJupyterPageBindingTarget,
  findVaultPageBoundToRoot,
  JUPYTER_PAGE_WORKSPACE_KEY,
  jupyterLabWorkspaceUrl,
  pageWorkspaceFromMetadata,
  pageWorkspaceRecord,
  resolveStickyBootPreference,
  shouldFallbackBoundJupyterWorkspace,
} from "@/lib/jupyter-page-workspace";
import type { DeepWorkDescriptor } from "@/lib/deep-work";
import type { VaultNotebook } from "@/lib/vault-contract";

const pagePath = "AI/Robotic Arm/Master Repo.html";
const workspace: DeepWorkDescriptor = {
  rootPath: "C:\\Projects\\LeRobot",
  projectName: "3D Printing",
  branch: "feature/robot",
  requestedAccess: "editable",
  ownerOpen: true,
};

describe("Jupyter page Deep Work binding (SN-347)", () => {
  it("persists a page-owned request and restores the real folder name without AV identity", async () => {
    const previousVault = process.env.SMART_NOTES_VAULT;
    const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-page-workspace-"));
    process.env.SMART_NOTES_VAULT = vaultRoot;
    try {
      await fs.mkdir(path.join(vaultRoot, "AI", "Robotic Arm"), { recursive: true });
      const page = await createPage({ sectionPath: "AI/Robotic Arm", title: "Master Repo", noteType: "jupyter" });
      const response = await PATCH(new Request("http://localhost/api/page", {
        method: "PATCH",
        body: JSON.stringify({ action: "jupyterWorkspace", path: page.path, workspace }),
      }));
      expect(response.status).toBe(200);
      const stored = await readPage(page.path);
      expect(stored.metadata[JUPYTER_PAGE_WORKSPACE_KEY]).toMatchObject({
        version: 1,
        rootPath: workspace.rootPath,
        requestedAccess: "editable",
      });
      expect(pageWorkspaceFromMetadata(stored.metadata)).toMatchObject({
        rootPath: workspace.rootPath,
        projectName: "LeRobot",
        ownerOpen: true,
      });

      const unlink = await PATCH(new Request("http://localhost/api/page", {
        method: "PATCH",
        body: JSON.stringify({ action: "jupyterWorkspace", path: page.path, workspace: null }),
      }));
      expect(unlink.status).toBe(200);
      expect((await readPage(page.path)).metadata[JUPYTER_PAGE_WORKSPACE_KEY]).toBeUndefined();
    } finally {
      if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT;
      else process.env.SMART_NOTES_VAULT = previousVault;
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("binds only the active vault Jupyter page, preserving its selection", () => {
    const selected = activeJupyterPageBindingTarget({
      pagePath,
      activePagePath: pagePath,
      noteType: "jupyter",
      avLinked: false,
    });
    expect(selected).toBe(pagePath);
    expect(activeJupyterPageBindingTarget({ pagePath, activePagePath: "Other.html", noteType: "jupyter", avLinked: false })).toBeNull();
    expect(activeJupyterPageBindingTarget({ pagePath, activePagePath: pagePath, noteType: "text", avLinked: false })).toBeNull();
    expect(activeJupyterPageBindingTarget({ pagePath, activePagePath: pagePath, noteType: "jupyter", avLinked: true })).toBeNull();
    expect(activeJupyterPageBindingTarget({ pagePath: "deep-work-pending:root", activePagePath: "deep-work-pending:root", noteType: "jupyter", avLinked: false })).toBeNull();
    const shell = require("node:fs").readFileSync(path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"), "utf8") as string;
    const boundOpen = shell.slice(shell.indexOf("const handleOpenWorkspace"), shell.indexOf("const handleOpenWorkspace") + 1800);
    expect(boundOpen).toContain("await setJupyterPageWorkspace(currentPage.path, workspace)");
    expect(boundOpen).not.toContain("setActiveNotebookPath(null)");
    expect(boundOpen).not.toContain("deepWorkDraft(workspace)");
  });

  it("revalidates the stored request and falls back to the page notebook for an invalid root", async () => {
    const restored = pageWorkspaceFromMetadata({ [JUPYTER_PAGE_WORKSPACE_KEY]: pageWorkspaceRecord(workspace) });
    expect(restored).not.toBeNull();
    const missing = Object.assign(new Error("Missing folder"), {
      code: "WORKSPACE_ROOT_MISSING",
      status: 404,
    });
    expect(shouldFallbackBoundJupyterWorkspace(missing)).toBe(true);
    expect(shouldFallbackBoundJupyterWorkspace(Object.assign(new Error("Offline"), { status: 503 }))).toBe(false);
    expect(pageWorkspaceFromMetadata({ [JUPYTER_PAGE_WORKSPACE_KEY]: { ...pageWorkspaceRecord(workspace), projectId: "forged" } })).toBeNull();
  });

  it("uses a stable JupyterLab layout for each page and bound root", () => {
    const original = "/api/jupyter/proxy/session/lab?token=secret";
    const first = jupyterLabWorkspaceUrl(original, pagePath, workspace.rootPath);
    expect(first).toBe(jupyterLabWorkspaceUrl(original, pagePath, workspace.rootPath));
    expect(first).toMatch(/^\/api\/jupyter\/proxy\/session\/lab\/workspaces\/sn-[\w-]+\?token=secret$/);
    expect(jupyterLabWorkspaceUrl(original, "Other.html", workspace.rootPath)).not.toBe(first);
    expect(jupyterLabWorkspaceUrl(original, pagePath, "C:\\Projects\\Other")).not.toBe(first);
    expect(jupyterLabWorkspaceUrl("/proxy/lab/tree/notebook.ipynb?token=secret", pagePath))
      .toContain("/lab/workspaces/sn-");
  });

  it("prefers a vault page that already binds the sticky root over an orphan Deep Work draft", () => {
    const boundRecord = pageWorkspaceRecord(workspace);
    const tree: VaultNotebook[] = [
      {
        id: "ai",
        path: "AI",
        name: "AI",
        color: "#000",
        pages: [],
        sections: [
          {
            id: "arm",
            path: "AI/Robotic Arm",
            name: "Robotic Arm",
            pages: [
              {
                id: "master",
                path: pagePath,
                title: "Master Repo",
                slug: "master-repo",
                createdAt: null,
                updatedAt: null,
                preview: "",
                content: "",
                parentId: null,
                noteType: "jupyter",
                metadata: { [JUPYTER_PAGE_WORKSPACE_KEY]: boundRecord },
              },
              {
                id: "other",
                path: "AI/Robotic Arm/Other.html",
                title: "Other",
                slug: "other",
                createdAt: null,
                updatedAt: null,
                preview: "",
                content: "",
                parentId: null,
                noteType: "text",
                metadata: {},
              },
            ],
          },
        ],
      },
    ];

    expect(findVaultPageBoundToRoot(tree, workspace.rootPath)?.pagePath).toBe(pagePath);
    expect(findVaultPageBoundToRoot(tree, "C:\\Projects\\Other")).toBeNull();
    // Separator / case drift on Windows still matches the bound page.
    expect(findVaultPageBoundToRoot(tree, "C:/projects/lerobot")?.pagePath).toBe(pagePath);

    const sticky = { ...workspace, projectName: "LeRobot" };
    expect(
      resolveStickyBootPreference({
        sticky,
        tree,
        lastPagePath: "AI/Robotic Arm/Other.html",
      })
    ).toEqual({
      kind: "bound-page",
      match: expect.objectContaining({
        pagePath,
        notebookPath: "AI",
        sectionPath: "AI/Robotic Arm",
      }),
    });
    expect(resolveStickyBootPreference({ sticky, tree: [], lastPagePath: null })).toEqual({
      kind: "sticky",
      workspace: sticky,
    });
    expect(resolveStickyBootPreference({ sticky, linkedWorkspace: sticky, tree })).toEqual({ kind: "none" });
    expect(resolveStickyBootPreference({ sticky: null, tree })).toEqual({ kind: "none" });

    const shell = require("node:fs").readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    ) as string;
    expect(shell).toContain("resolveStickyBootPreference({");
    expect(shell).toContain("stickyBootPreference.kind !== \"bound-page\"");
    expect(shell).toContain("dropDeepWorkPendingJupyterFrames");
    const selection = shell.slice(shell.indexOf("const applySelection"), shell.indexOf("const applySelection") + 2400);
    expect(selection).toContain("dropDeepWorkPendingJupyterFrames(current)");
  });
});

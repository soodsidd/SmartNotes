import fs from "node:fs";
import path from "node:path";

describe("jupyter UI controls (SN-101)", () => {
  it("exposes Settings control text and API call for stopping JupyterLab servers", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/app-settings-dialog.tsx"),
      "utf8"
    );

    expect(src).toContain("stopAllJupyterSessions");
    expect(src).toContain("settings-stop-jupyterlab-button");
    expect(src).toContain("Stop JupyterLab servers");
  });

  it("shows the read-only Jupyter profile capability line in Settings → App", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/app-settings-dialog.tsx"),
      "utf8"
    );
    expect(src).toContain("fetchJupyterProfileStatus");
    expect(src).toContain('data-testid="settings-jupyter-profile-status"');
    expect(src).toContain("JupyterLab {jupyterProfile.jupyterLabVersion");
    expect(src).toContain('LSP {jupyterProfile.lspInstalled ? "installed" : "missing"}');
    expect(src).toContain('pylsp {jupyterProfile.pylspReachable ? "reachable" : "unreachable"}');
    expect(src).not.toContain("Install Jupyter profile");

    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/jupyter/profile/route.ts"),
      "utf8"
    );
    expect(route).toContain("await getJupyterProfileStatus()");
    expect(route).not.toContain("refresh: true");
  });

  it("renders Jupyter pages with a distinct tree icon without selected-looking row chrome", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(src).toContain('node.page.noteType === "jupyter"');
    expect(src).toContain("NotebookPen");
    expect(src).toContain("bg-secondary/70");
    expect(src).not.toContain('isJupyterPage && !active && "bg-accent/5 ring-1 ring-inset ring-accent/20"');
  });

  it("renders log pages with a distinct tree icon", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(src).toContain('node.page.noteType === "log"');
    expect(src).toContain("ClipboardList");
    expect(src).toContain('aria-label="Log page"');
  });

  it("exposes page and Jupyter creation from notebook, section, and page levels", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(src).toContain("resolveCreateTargetFromSelection");
    expect(src).toContain("notebook-create-page");
    expect(src).toContain("notebook-create-jupyter");
    expect(src).toContain("section-create-jupyter");
    expect(src).toContain("page-create-child");
    expect(src).toContain("page-create-child-jupyter");
    expect(src).toContain("page-context-create-jupyter");
    expect(src).toContain("interface CreatePageTarget");
    expect(src).toContain("notebookPath: notebook.path");
    expect(src).toContain("sectionPath: null");
  });

  it("distinguishes proxy and mobile browser failures in the embedded Jupyter surface", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/jupyter-notebook-view.tsx"),
      "utf8"
    );

    expect(src).toContain("PROXY_UNAVAILABLE");
    expect(src).toContain("MOBILE_BROWSER_UNSUPPORTED");
    expect(src).toContain("WebSocket support is unavailable");
    expect(src).toContain("The JupyterLab frame could not load through the Smart Notes proxy.");
  });

  it("lets notebook mutations and the owner Reload control remount the active Jupyter frame", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(src).toContain('socket.on("jupyter_notebook_updated", handleJupyterNotebookUpdated)');
    expect(src).toContain("setJupyterReloadNonce((nonce) => nonce + 1)");
    expect(src).toContain('if (currentDraft.noteType === "jupyter")');
    expect(src).toContain('data-testid="reload-btn"');
    expect(src).toContain('key={`${draft.path}:${jupyterReloadNonce}`}');
  });
});

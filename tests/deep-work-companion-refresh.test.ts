import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  canRemountJupyterSurface,
  deepWorkSourceRefreshDecision,
  stickyRootRevalidationDisposition,
} from "@/lib/deep-work-refresh";
import { createJupyterCommandMessage } from "@/lib/jupyter-focus";
import { createWorkspaceSource, writeWorkspaceSource } from "@/server/jupyter/workspace-files";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";

const { JUPYTER_FOCUS_BRIDGE_SOURCE } = require("../server/jupyter-focus-bridge");

const ROOT = "C:\\Projects\\LeRobot";

function refreshInput(overrides: Partial<Parameters<typeof deepWorkSourceRefreshDecision>[0]> = {}) {
  return {
    deepWorkActive: true,
    sessionRootPath: ROOT,
    activeWorkspacePath: "notebooks/walkthrough.ipynb",
    activeDocumentDirty: false as boolean | null,
    event: { rootPath: ROOT, path: "notebooks/walkthrough.ipynb", revision: "sha256:abc" },
    ...overrides,
  };
}

function apiError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}

describe("SN-270 Deep Work root survives a Companion notebook edit", () => {
  describe("in-place refresh decision", () => {
    it("reloads the focused notebook in place when the Companion edits it", () => {
      expect(deepWorkSourceRefreshDecision(refreshInput())).toEqual({
        kind: "reload-document",
        path: "notebooks/walkthrough.ipynb",
      });
    });

    it("tolerates separator and drive-case drift between the event and the live session", () => {
      const decision = deepWorkSourceRefreshDecision(
        refreshInput({
          sessionRootPath: "c:/projects/lerobot/",
          event: { rootPath: "C:\\Projects\\LeRobot", path: "notebooks\\walkthrough.ipynb" },
        })
      );
      expect(decision).toEqual({ kind: "reload-document", path: "notebooks/walkthrough.ipynb" });
    });

    it("never reloads a document with unsaved local cells", () => {
      expect(deepWorkSourceRefreshDecision(refreshInput({ activeDocumentDirty: true }))).toEqual({
        kind: "blocked-dirty",
        path: "notebooks/walkthrough.ipynb",
      });
    });

    it("ignores an unknown dirty state only to the extent of still reloading a clean-reported doc", () => {
      // isDirty is null when no document owns focus; that is already caught by
      // the active-file gate, so a null here must not be treated as dirty.
      expect(deepWorkSourceRefreshDecision(refreshInput({ activeDocumentDirty: null }))).toEqual({
        kind: "reload-document",
        path: "notebooks/walkthrough.ipynb",
      });
    });

    it("ignores writes that belong to a different root, an unfocused file, or an unsafe path", () => {
      expect(
        deepWorkSourceRefreshDecision(
          refreshInput({ event: { rootPath: "C:\\Projects\\Other", path: "notebooks/walkthrough.ipynb" } })
        )
      ).toEqual({ kind: "ignore", reason: "other-workspace" });

      expect(
        deepWorkSourceRefreshDecision(refreshInput({ activeWorkspacePath: "src/main.py" }))
      ).toEqual({ kind: "ignore", reason: "not-active-file" });

      expect(
        deepWorkSourceRefreshDecision(
          refreshInput({ event: { rootPath: ROOT, path: "../outside.ipynb" } })
        )
      ).toEqual({ kind: "ignore", reason: "unsafe-path" });
    });

    it("ignores writes before the workspace session has resolved a root", () => {
      expect(deepWorkSourceRefreshDecision(refreshInput({ sessionRootPath: null }))).toEqual({
        kind: "ignore",
        reason: "session-not-ready",
      });
    });

    it("ignores writes while a vault note - not the Deep Work draft - owns the surface", () => {
      expect(deepWorkSourceRefreshDecision(refreshInput({ deepWorkActive: false }))).toEqual({
        kind: "ignore",
        reason: "no-deep-work",
      });
    });
  });

  describe("remount boundary", () => {
    it("forbids the key/remount refresh for a Deep Work surface and allows it for a vault page", () => {
      // Remounting re-runs the launch effect, which destroys the workspace
      // session, its Companion capability, the active file, and the rooted
      // Jupyter server. A note-owned .jupyter page has none of that to lose.
      expect(canRemountJupyterSurface(true)).toBe(false);
      expect(canRemountJupyterSurface(false)).toBe(true);
    });
  });

  describe("sticky root revalidation is transient-tolerant", () => {
    it("keeps the remembered root through transport and server failures", () => {
      expect(stickyRootRevalidationDisposition(new TypeError("Failed to fetch"))).toBe("keep");
      expect(stickyRootRevalidationDisposition(apiError("INTERNAL_ERROR", 500))).toBe("keep");
      expect(stickyRootRevalidationDisposition(apiError("PROXY_UNAVAILABLE", 502))).toBe("keep");
      expect(stickyRootRevalidationDisposition(apiError("TIMEOUT", 408))).toBe("keep");
      expect(stickyRootRevalidationDisposition(Object.assign(new Error("abort"), { name: "AbortError" }))).toBe("keep");
      expect(stickyRootRevalidationDisposition(undefined)).toBe("keep");
      expect(stickyRootRevalidationDisposition("boom")).toBe("keep");
    });

    it("clears only on a definitive missing or invalid root", () => {
      expect(stickyRootRevalidationDisposition(apiError("WORKSPACE_ROOT_MISSING", 404))).toBe("clear");
      expect(stickyRootRevalidationDisposition(apiError("WORKSPACE_SYMLINK_ESCAPE", 403))).toBe("clear");
      expect(stickyRootRevalidationDisposition(apiError("INVALID_PATH", 400))).toBe("clear");
      // An unrecognised code still counts when the server answered 404/403.
      expect(stickyRootRevalidationDisposition(apiError("WORKSPACE_GONE", 404))).toBe("clear");
    });
  });

  describe("workspace writes announce themselves without leaking the capability", () => {
    let parent: string;
    let root: string;
    let emitted: Array<{ event: string; data: unknown }>;
    const request = () => ({
      rootPath: root,
      projectName: "LeRobot",
      ownerOpen: true,
      requestedAccess: "editable" as const,
    });

    beforeEach(async () => {
      parent = await fs.mkdtemp(path.join(os.tmpdir(), "sn270-"));
      root = path.join(parent, "LeRobot");
      await fs.mkdir(path.join(root, "notebooks"), { recursive: true });
      emitted = [];
      (global as Record<string, unknown>)["_smartNotesIo"] = {
        emit: (event: string, data: unknown) => emitted.push({ event, data }),
      };
    });

    afterEach(async () => {
      delete (global as Record<string, unknown>)["_smartNotesIo"];
      await fs.rm(parent, { recursive: true, force: true });
    });

    it("emits workspace_source_updated for a Companion notebook edit", async () => {
      const notebook = path.join("notebooks", "walkthrough.ipynb");
      const created = await createWorkspaceSource(
        request(),
        notebook,
        JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 })
      );
      const resolved = await resolveProjectWorkspace(request());

      emitted.length = 0;
      const source = await fs.readFile(path.join(root, notebook), "utf8");
      const written = await writeWorkspaceSource(request(), notebook, created.revision, [
        { start: source.indexOf("[]"), end: source.indexOf("[]") + 2, text: "[]" },
      ]);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.event).toBe("workspace_source_updated");
      expect(emitted[0]!.data).toEqual({
        rootPath: resolved.realRoot,
        path: "notebooks/walkthrough.ipynb",
        revision: written.revision,
      });
      // The payload is addressed by root only. A capability must never ride
      // along on a broadcast socket event.
      expect(JSON.stringify(emitted[0]!.data)).not.toContain("dwc_");
      expect(Object.keys(emitted[0]!.data as object).sort()).toEqual(["path", "revision", "rootPath"]);
    });

    it("stays silent when the write is rejected", async () => {
      await expect(
        writeWorkspaceSource(request(), "notebooks/missing.ipynb", `sha256:${"0".repeat(64)}`, [
          { start: 0, end: 0, text: "x" },
        ])
      ).rejects.toBeDefined();
      expect(emitted.filter((entry) => entry.event === "workspace_source_updated")).toHaveLength(0);
    });
  });

  describe("embedded Lab bridge reloads one document and protects unsaved cells", () => {
    it("addresses reload-document to the notebook selected when the event arrived", () => {
      expect(
        createJupyterCommandMessage("reload-1", "reload-document", {
          path: "notebooks\\walkthrough.ipynb",
        })
      ).toEqual(expect.objectContaining({
        command: "reload-document",
        path: "notebooks/walkthrough.ipynb",
      }));
      expect(createJupyterCommandMessage("reload-2", "reload-document")).toBeNull();
    });

    it("maps reload-document to docmanager:reload and guards identity before dirty state", () => {
      expect(JUPYTER_FOCUS_BRIDGE_SOURCE).toContain("'reload-document': ['docmanager:reload']");
      expect(JUPYTER_FOCUS_BRIDGE_SOURCE).toContain("semantic === 'reload-document'");
      const identityGuard = JUPYTER_FOCUS_BRIDGE_SOURCE.indexOf("parts.workspacePath !== focusPath");
      const dirtyGuard = JUPYTER_FOCUS_BRIDGE_SOURCE.indexOf("model && model.dirty");
      expect(identityGuard).toBeGreaterThan(-1);
      expect(dirtyGuard).toBeGreaterThan(identityGuard);
      expect(JUPYTER_FOCUS_BRIDGE_SOURCE).toContain(
        "reason = 'This document has unsaved changes, so it was not reloaded from disk.';"
      );
    });
  });

  describe("shell and view keep the refresh out of the remount path", () => {
    const shell = readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    const view = readFileSync(
      path.resolve(__dirname, "../src/components/jupyter-notebook-view.tsx"),
      "utf8"
    );

    it("subscribes to workspace_source_updated and routes it through the refresh boundary", () => {
      expect(shell).toContain('socket.on("workspace_source_updated", handleWorkspaceSourceUpdated)');
      expect(shell).toContain('socket.off("workspace_source_updated", handleWorkspaceSourceUpdated)');
      expect(shell).toContain("deepWorkSourceRefreshDecision({");
      expect(shell).toContain('if (decision.kind !== "reload-document") return;');
    });

    it("never bumps the remount nonce for a Deep Work surface", () => {
      expect(shell).toContain("canRemountJupyterSurface(");
      // The nonce is still part of the key, so the guard is what keeps a Deep
      // Work root alive. If this key ever stops including the nonce, the guard
      // can be revisited - but not silently.
      expect(shell).toContain("key={`${draft.path}:${jupyterReloadNonce}`}");
    });

    it("passes the in-place reload as a prop, never as part of the view key", () => {
      expect(shell).toContain("externalReload={activeProjectWorkspace ? workspaceDocumentReload : null}");
      expect(shell).not.toContain("workspaceDocumentReload}`}");
      expect(view).toContain(
        'dispatchCommand("reload-document", undefined, { path: externalReload.path })'
      );
      expect(view).toContain("handledExternalReloadRef.current === externalReload.nonce");
    });

    it("keeps the remembered root through a transient revalidation failure", () => {
      expect(shell).toContain('if (stickyRootRevalidationDisposition(error) === "keep") return;');
      // The clear must stay downstream of the disposition check.
      const disposition = shell.indexOf("stickyRootRevalidationDisposition(error)");
      const clear = shell.indexOf("clearStickyDeepWork(window.localStorage)", disposition);
      expect(disposition).toBeGreaterThan(-1);
      expect(clear).toBeGreaterThan(disposition);
    });

    it("drops a queued in-place reload whenever the live Deep Work session ends", () => {
      expect(shell.match(/setWorkspaceDocumentReload\(null\)/g)).toHaveLength(3);
    });
  });
});

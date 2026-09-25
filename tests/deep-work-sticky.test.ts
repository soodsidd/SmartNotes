import * as fs from "fs";
import * as path from "path";

import { deepWorkPendingPath, type DeepWorkDescriptor } from "@/lib/deep-work";
import {
  activeDeepWorkWorkspace,
  clearStickyDeepWork,
  isStickyDeepWorkCandidate,
  parseStickyDeepWorkRecord,
  readStickyDeepWork,
  restorableStickyDeepWork,
  shouldLeaveDeepWorkForVaultSelection,
  stickyDeepWorkRecord,
  writeStickyDeepWork,
  STICKY_DEEP_WORK_STORAGE_KEY,
  STICKY_DEEP_WORK_VERSION,
  type StickyDeepWorkStorage,
} from "@/lib/deep-work-sticky";

function memoryStorage(seed: Record<string, string> = {}): StickyDeepWorkStorage & {
  entries: Record<string, string>;
} {
  const entries: Record<string, string> = { ...seed };
  return {
    entries,
    getItem: (key: string) => (key in entries ? entries[key] : null),
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
    removeItem: (key: string) => {
      delete entries[key];
    },
  };
}

function ownerOpened(overrides: Partial<DeepWorkDescriptor> = {}): DeepWorkDescriptor {
  return {
    rootPath: "C:\\Projects\\LeRobot",
    projectName: "LeRobot",
    branch: "feature/local",
    worktreeLabel: "feature/local",
    requestedAccess: "editable",
    ownerOpen: true,
    ...overrides,
  };
}

function avLinked(overrides: Partial<DeepWorkDescriptor> = {}): DeepWorkDescriptor {
  return {
    rootPath: "C:\\Projects\\worktree",
    projectName: "Smart Notes",
    branch: "av/sn-262",
    requestedAccess: "editable",
    projectId: "project-1",
    repoId: "repo-1",
    workItemId: "SN-262",
    returnUrl: "https://av.example.test/work-items/SN-262",
    ...overrides,
  };
}

describe("SN-262 sticky Deep Work disk workspace", () => {
  describe("eligibility", () => {
    it("treats an owner-opened absolute disk root as sticky", () => {
      expect(isStickyDeepWorkCandidate(ownerOpened())).toBe(true);
      expect(isStickyDeepWorkCandidate(ownerOpened({ rootPath: "/home/owner/lerobot" }))).toBe(true);
    });

    it("never persists AV-linked Deep Work, which is durable in its own URL", () => {
      expect(isStickyDeepWorkCandidate(avLinked())).toBe(false);
      expect(isStickyDeepWorkCandidate(avLinked({ ownerOpen: true }))).toBe(false);
      expect(isStickyDeepWorkCandidate(ownerOpened({ workItemId: "SN-262" }))).toBe(false);
      expect(
        isStickyDeepWorkCandidate(ownerOpened({ returnUrl: "https://av.example.test/x" }))
      ).toBe(false);
    });

    it("rejects roots that are relative, empty, over-length, or control-char bearing", () => {
      expect(isStickyDeepWorkCandidate(ownerOpened({ rootPath: "..\\LeRobot" }))).toBe(false);
      expect(isStickyDeepWorkCandidate(ownerOpened({ rootPath: "   " }))).toBe(false);
      expect(isStickyDeepWorkCandidate(ownerOpened({ rootPath: `C:\\${"a".repeat(4096)}` }))).toBe(
        false
      );
      expect(
        isStickyDeepWorkCandidate(ownerOpened({ rootPath: `C:\\Projects\\Le${String.fromCharCode(7)}Robot` }))
      ).toBe(false);
      expect(isStickyDeepWorkCandidate(null)).toBe(false);
    });
  });

  describe("persist", () => {
    it("records the root plus the access/unlock choice needed to reopen it", () => {
      const record = stickyDeepWorkRecord(
        ownerOpened({ requestedAccess: "editable", branch: "main", defaultBranchEditConfirmed: true }),
        1_700_000_000_000
      );
      expect(record).toEqual({
        version: STICKY_DEEP_WORK_VERSION,
        rootPath: "C:\\Projects\\LeRobot",
        projectName: "LeRobot",
        branch: "main",
        worktreeLabel: "feature/local",
        requestedAccess: "editable",
        defaultBranchEditConfirmed: true,
        savedAt: 1_700_000_000_000,
      });
    });

    it("writes an owner-opened root and replaces it when a different folder is opened", () => {
      const storage = memoryStorage();
      writeStickyDeepWork(storage, ownerOpened(), 1);
      expect(readStickyDeepWork(storage)).toMatchObject({ rootPath: "C:\\Projects\\LeRobot" });

      writeStickyDeepWork(storage, ownerOpened({ rootPath: "C:\\Projects\\Other", projectName: "Other" }), 2);
      expect(readStickyDeepWork(storage)).toMatchObject({
        rootPath: "C:\\Projects\\Other",
        projectName: "Other",
      });
    });

    it("ignores an AV-linked launch instead of erasing the remembered disk root", () => {
      const storage = memoryStorage();
      writeStickyDeepWork(storage, ownerOpened(), 1);
      expect(writeStickyDeepWork(storage, avLinked(), 2)).toBeNull();
      expect(readStickyDeepWork(storage)).toMatchObject({ rootPath: "C:\\Projects\\LeRobot" });
    });

    it("clears on an explicit null and survives a storage that throws", () => {
      const storage = memoryStorage();
      writeStickyDeepWork(storage, ownerOpened(), 1);
      writeStickyDeepWork(storage, null);
      expect(storage.entries[STICKY_DEEP_WORK_STORAGE_KEY]).toBeUndefined();

      const hostile: StickyDeepWorkStorage = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      expect(() => writeStickyDeepWork(hostile, ownerOpened())).not.toThrow();
      expect(readStickyDeepWork(hostile)).toBeNull();
      expect(() => clearStickyDeepWork(hostile)).not.toThrow();
    });
  });

  describe("restore", () => {
    it("round-trips a stored root back into an owner-open descriptor", () => {
      const storage = memoryStorage();
      writeStickyDeepWork(
        storage,
        ownerOpened({ requestedAccess: "read-only", defaultBranchEditConfirmed: true })
      );
      expect(readStickyDeepWork(storage)).toEqual({
        rootPath: "C:\\Projects\\LeRobot",
        projectName: "LeRobot",
        branch: "feature/local",
        worktreeLabel: "feature/local",
        requestedAccess: "read-only",
        ownerOpen: true,
        defaultBranchEditConfirmed: true,
      });
    });

    it("refuses to restore AV identity or a return target from storage", () => {
      expect(
        parseStickyDeepWorkRecord({
          version: STICKY_DEEP_WORK_VERSION,
          rootPath: "C:\\Projects\\LeRobot",
          projectName: "LeRobot",
          requestedAccess: "editable",
          workItemId: "SN-262",
        })
      ).toBeNull();
      expect(
        parseStickyDeepWorkRecord({
          version: STICKY_DEEP_WORK_VERSION,
          rootPath: "C:\\Projects\\LeRobot",
          projectName: "LeRobot",
          requestedAccess: "editable",
          returnUrl: "https://av.example.test/x",
        })
      ).toBeNull();
    });

    it("drops an unreadable, mis-versioned, or invalid entry without crashing", () => {
      const corrupt = memoryStorage({ [STICKY_DEEP_WORK_STORAGE_KEY]: "{not json" });
      expect(readStickyDeepWork(corrupt)).toBeNull();
      expect(corrupt.entries[STICKY_DEEP_WORK_STORAGE_KEY]).toBeUndefined();

      const oldVersion = memoryStorage({
        [STICKY_DEEP_WORK_STORAGE_KEY]: JSON.stringify({
          version: STICKY_DEEP_WORK_VERSION + 1,
          rootPath: "C:\\Projects\\LeRobot",
          projectName: "LeRobot",
          requestedAccess: "editable",
        }),
      });
      expect(readStickyDeepWork(oldVersion)).toBeNull();
      expect(oldVersion.entries[STICKY_DEEP_WORK_STORAGE_KEY]).toBeUndefined();

      const relativeRoot = memoryStorage({
        [STICKY_DEEP_WORK_STORAGE_KEY]: JSON.stringify({
          version: STICKY_DEEP_WORK_VERSION,
          rootPath: "..\\escape",
          projectName: "escape",
          requestedAccess: "editable",
        }),
      });
      expect(readStickyDeepWork(relativeRoot)).toBeNull();
      expect(relativeRoot.entries[STICKY_DEEP_WORK_STORAGE_KEY]).toBeUndefined();

      const badAccess = memoryStorage({
        [STICKY_DEEP_WORK_STORAGE_KEY]: JSON.stringify({
          version: STICKY_DEEP_WORK_VERSION,
          rootPath: "C:\\Projects\\LeRobot",
          projectName: "LeRobot",
          requestedAccess: "write-everything",
        }),
      });
      expect(readStickyDeepWork(badAccess)).toBeNull();

      expect(readStickyDeepWork(memoryStorage())).toBeNull();
      expect(readStickyDeepWork(null)).toBeNull();
      expect(parseStickyDeepWorkRecord(["nope"])).toBeNull();
    });

    it("lets a URL-linked AV launch win over the remembered disk root", () => {
      const sticky = ownerOpened();
      expect(restorableStickyDeepWork({ linkedWorkspace: null, sticky })).toBe(sticky);
      expect(restorableStickyDeepWork({ linkedWorkspace: avLinked(), sticky })).toBeNull();
      expect(restorableStickyDeepWork({ sticky: null })).toBeNull();
      expect(restorableStickyDeepWork({ sticky: avLinked() })).toBeNull();
    });
  });

  describe("explicit vault Jupyter selection", () => {
    const workspace = ownerOpened();

    it("owns the Jupyter surface while its own pending draft is active", () => {
      expect(activeDeepWorkWorkspace(workspace, deepWorkPendingPath(workspace))).toBe(workspace);
    });

    it("yields to an explicitly selected vault .jupyter page", () => {
      expect(activeDeepWorkWorkspace(workspace, "AI/Robotic Arm/master-repo.jupyter")).toBeNull();
      expect(activeDeepWorkWorkspace(workspace, null)).toBeNull();
      expect(activeDeepWorkWorkspace(null, deepWorkPendingPath(workspace))).toBeNull();
    });

    it("does not match a different sticky root's pending draft", () => {
      const other = ownerOpened({ rootPath: "C:\\Projects\\Other", projectName: "Other" });
      expect(activeDeepWorkWorkspace(workspace, deepWorkPendingPath(other))).toBeNull();
    });

    it("leaves the live Deep Work workspace when any vault page is selected", () => {
      expect(shouldLeaveDeepWorkForVaultSelection(workspace, "Home improvement/Shopping list.html")).toBe(
        true
      );
      expect(shouldLeaveDeepWorkForVaultSelection(workspace, "AI/Robotic Arm/master-repo.jupyter")).toBe(
        true
      );
      expect(shouldLeaveDeepWorkForVaultSelection(workspace, null)).toBe(false);
      expect(shouldLeaveDeepWorkForVaultSelection(null, "Home improvement/Shopping list.html")).toBe(
        false
      );
    });
  });

  describe("reliable shell wiring", () => {
    const SHELL_SOURCE = fs.readFileSync(
      path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    it("seeds the opened workspace from sticky state at mount so no vault page is selected first", () => {
      expect(SHELL_SOURCE).toContain("restorableStickyDeepWork({");
      expect(SHELL_SOURCE).toContain(
        "sticky: typeof window === \"undefined\" ? null : readStickyDeepWork(window.localStorage),"
      );
      expect(SHELL_SOURCE).toMatch(
        /React\.useState<DeepWorkDescriptor \| null>\(\s*restoredStickyWorkspace\s*\)/
      );
    });

    it("persists the root on a successful open and re-validates a restored root", () => {
      expect(SHELL_SOURCE).toContain("writeStickyDeepWork(window.localStorage, workspace);");
      expect(SHELL_SOURCE).toContain("await fetchJupyterWorkspaceSessionStatus({");
      expect(SHELL_SOURCE).toContain("clearStickyDeepWork(window.localStorage);");
    });

    it("keeps the sticky root when Back to notes leaves the workspace", () => {
      const leave = SHELL_SOURCE.slice(
        SHELL_SOURCE.indexOf("const handleLeaveOpenedWorkspace"),
        SHELL_SOURCE.indexOf("const handleLeaveOpenedWorkspace") + 900
      );
      expect(leave).toContain("setOpenedWorkspace(null)");
      expect(leave).not.toContain("StickyDeepWork");
    });

    it("disarms the live workspace without clearing sticky storage when a vault page is selected", () => {
      const selection = SHELL_SOURCE.slice(
        SHELL_SOURCE.indexOf("const applySelection"),
        SHELL_SOURCE.indexOf("const applySelection") + 1300
      );
      expect(selection).toContain("shouldLeaveDeepWorkForVaultSelection(projectWorkspaceRef.current, nextPath)");
      expect(selection).toContain("setOpenedWorkspace(null)");
      expect(selection).toContain("projectWorkspaceRef.current = null");
      expect(selection).not.toContain("clearStickyDeepWork");
    });

    it("keeps Deep Work on vault refresh only while its own draft remains active", () => {
      const payload = SHELL_SOURCE.slice(
        SHELL_SOURCE.indexOf("const applyVaultPayload"),
        SHELL_SOURCE.indexOf("const applyVaultPayload") + 4200
      );
      expect(payload).toContain("activeDeepWorkWorkspace(");
      expect(payload).toContain("projectWorkspaceRef.current,");
      expect(payload).toContain("draftRef.current?.path");
    });

    it("gates the Jupyter surface and companion binding on the active Deep Work draft", () => {
      expect(SHELL_SOURCE).toContain("activeDeepWorkWorkspace(projectWorkspace, draft?.path ?? null)");
      expect(SHELL_SOURCE).toContain("workspace={activeProjectWorkspace ? {");
      expect(SHELL_SOURCE).toContain("projectWorkspace: activeProjectWorkspace ? {");
    });

    it("seeds the saved snapshot and clears pending reload when applying a Deep Work draft", () => {
      expect(SHELL_SOURCE).toContain("lastSavedSnapshotRef.current = snapshotDraft(workspaceDraft)");
      expect(SHELL_SOURCE).toContain("setPendingVaultReload(null)");
      expect(SHELL_SOURCE).toContain(
        "if (nextDraft && typeof window !== \"undefined\" && !nextDraft.path.startsWith(\"deep-work-\"))"
      );
    });
  });
});

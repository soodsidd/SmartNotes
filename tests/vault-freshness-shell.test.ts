/**
 * @jest-environment node
 */

import fs from "node:fs";
import path from "node:path";

describe("vault freshness shell wiring (SN-91)", () => {
  const shellSrc = fs.readFileSync(
    path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("revalidates the SSR vault payload from the live server on mount and resume", () => {
    // SN-205 threads an optional `?page=` deep-link `preferred` selection through
    // the same mount/resume revalidation (undefined when no deep-link is present).
    expect(shellSrc).toContain("await loadTree(preferred, { skipCache: true }).catch(() => undefined);");
    expect(shellSrc).toContain("await loadTree(preferred, { coldStart: true, skipCache: true });");
    expect(shellSrc).toContain('window.addEventListener("focus", handleResume)');
    expect(shellSrc).toContain('document.addEventListener("visibilitychange", handleResume)');
    expect(shellSrc).toContain("void refreshVaultTreeFromLive();");
  });

  it("auto-refreshes vault structure updates only when local edits are safe", () => {
    expect(shellSrc).toContain("const canAutoRefreshVaultTree = React.useCallback(() => {");
    expect(shellSrc).toContain("if (savingRef.current || timerRef.current) {");
    expect(shellSrc).toContain("return !hasUnsavedLocalDraftChanges(draftRef.current, lastSavedSnapshotRef.current);");
    expect(shellSrc).toContain('socket.on("vault_updated", handleVaultUpdated)');
    expect(shellSrc).toContain("void refreshVaultTreeFromLive();");
    expect(shellSrc).toContain("setPendingVaultReload({ detectedAt: Date.now() });");
  });

  it("ignores self-originated page update events but cancels pending autosave for external updates", () => {
    const handleFileUpdatedBlock = shellSrc.match(
      /const handleFileUpdated = \(event: FileUpdatedEvent\) => \{[\s\S]*?void checkActivePageForExternalUpdate\("file"\);[\s\S]*?\};/
    )?.[0];

    expect(handleFileUpdatedBlock).toBeTruthy();
    const originGuardIndex = handleFileUpdatedBlock?.indexOf("event.originClientId === syncOriginIdRef.current") ?? -1;
    const clearTimerIndex = handleFileUpdatedBlock?.indexOf("window.clearTimeout(timerRef.current)") ?? -1;
    expect(shellSrc).toContain("originSocketId: socketRef.current?.id");
    expect(shellSrc).toContain("originClientId: syncOriginIdRef.current ?? undefined");
    expect(shellSrc).toContain("event.originClientId === syncOriginIdRef.current");
    expect(shellSrc).toContain("event.originSocketId === socketRef.current?.id");
    expect(shellSrc).toContain("const detectionDraft = currentDraft;");
    expect(shellSrc).toContain("if (isPageReloadPending(latestPage, detectionDraft))");
    expect(clearTimerIndex).toBeGreaterThan(originGuardIndex);
  });

  it("sends page save and restore origins to the server so Socket.IO can exclude the sender", () => {
    expect(shellSrc).toContain("function createSyncOriginId()");
    expect(shellSrc).toContain("originSocketId?: string;");
    expect(shellSrc).toContain("originClientId?: string;");
    expect(shellSrc).toContain("await restorePageVersion(parentPagePath, versionId, {");
  });

  it("shows compact live sync state next to the existing save/write warning state", () => {
    expect(shellSrc).toContain('data-testid="sync-state-indicator"');
    expect(shellSrc).toContain('"Connected / Idle"');
    expect(shellSrc).toContain('data-testid="connection-lost-indicator"');
    expect(shellSrc).toContain('data-testid="save-status"');
  });

  it("refreshes the active Jupyter frame when notebook cell tools update notebook.ipynb", () => {
    expect(shellSrc).toContain('socket.on("jupyter_notebook_updated", handleJupyterNotebookUpdated)');
    expect(shellSrc).toContain('current.noteType !== "jupyter"');
    expect(shellSrc).toContain("setJupyterReloadNonce((nonce) => nonce + 1)");
    expect(shellSrc).toContain('key={`${draft.path}:${jupyterReloadNonce}`}');
  });

  it("marks externally changed log forms for reload and remounts their Form view", () => {
    expect(shellSrc).toContain('event.kind === "log_form" && current.noteType === "log"');
    expect(shellSrc).toContain("pendingPageReloadRef.current = pendingLogFormReload");
    expect(shellSrc).toContain("setPendingPageReload(pendingLogFormReload)");
    expect(shellSrc).toContain('currentDraft.noteType === "log" &&');
    expect(shellSrc).toContain("pendingPageReloadRef.current?.page.path === currentDraft.path");
    expect(shellSrc).toContain("pendingPageReloadRef.current = null");
    expect(shellSrc).toContain("setLogReloadNonce((nonce) => nonce + 1)");
    expect(shellSrc).toContain('key={`${draft.path}:${logReloadNonce}`}');
  });
});

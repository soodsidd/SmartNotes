import fs from "node:fs";
import path from "node:path";

const componentSource = fs.readFileSync(path.join(process.cwd(), "src/components/app-page-view.tsx"), "utf8");
const shellSource = fs.readFileSync(path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"), "utf8");
const focusedRouteSource = fs.readFileSync(path.join(process.cwd(), "src/app/app/page.tsx"), "utf8");
const focusedShellSource = fs.readFileSync(path.join(process.cwd(), "src/components/focused-app-shell.tsx"), "utf8");

describe("owner-controlled App Develop workspace contract", () => {
  it("keeps Develop and runtime recovery controls in host chrome outside the iframe", () => {
    expect(componentSource.indexOf('data-testid="app-develop"')).toBeLessThan(componentSource.indexOf('data-testid="app-page-frame"'));
    expect(componentSource).toContain('data-testid="app-develop"');
    expect(componentSource).toContain('>Stop</Button>');
    expect(componentSource).toContain('>Reload</Button>');
    expect(componentSource).toContain('{enabled ? "Disable" : "Enable"}');
    expect(componentSource).toContain("Recover and reload");
    expect(componentSource).toContain("App runtime became unresponsive and was stopped");
    expect(componentSource).toContain("if (document.hidden) return;");
    expect(componentSource).toContain('document.addEventListener("visibilitychange"');
    expect(componentSource).toContain('sandbox="allow-scripts"');
    expect(componentSource).not.toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it("owns Preview, Data, and Source tabs with keyboard and touch access", () => {
    expect(componentSource).toContain('{ id: "preview", label: "Preview"');
    expect(componentSource).toContain('{ id: "data", label: "Data"');
    expect(componentSource).toContain('{ id: "source", label: "Source"');
    expect(componentSource).toContain('role="tablist"');
    expect(componentSource).toContain('tabIndex={tab === id ? 0 : -1}');
    expect(componentSource).toContain('"ArrowLeft", "ArrowRight", "Home", "End"');
    expect(componentSource).toContain("min-h-11");
    expect(componentSource).toContain("xl:min-h-8");
  });

  it("uses explicit Source Save/Reload, keeps runtime reload separate, and blocks stale external overwrite", () => {
    expect(componentSource).toContain("const [source, setSource]");
    expect(componentSource).toContain("const [savedSource, setSavedSource]");
    expect(componentSource).toContain("const [runtimeSource, setRuntimeSource]");
    expect(componentSource).toContain("saveAppSource(pagePath, title, source)");
    expect(componentSource).toContain("Discard unsaved Source edits and reload from the vault?");
    expect(componentSource).toContain("Choose Update from server or Keep local before saving source.");
    expect(componentSource).toContain("Source and app data are saved separately");
    expect(componentSource).toContain("setRuntimeSource(resolved.bootstrap.page.body)");
    expect(componentSource).toContain("await refreshBootstrap()");
    expect(componentSource).toContain("cryptoObject?.getRandomValues");
    expect(componentSource).toContain("useRef(new AppFrameHostLimiterScope())");
    expect(componentSource).toContain("limiterScopeRef.current.forFrame(pagePath, nonce)");
    expect(componentSource).toContain("boundedRpcResponse(response)");
    expect(componentSource).toContain("supportsAppNavigationGuard(window)");
    expect(componentSource).toContain('data-testid="app-navigation-guard-required"');
    expect(componentSource).toContain('data-testid="app-bootstrap-required"');
    expect(componentSource.indexOf('data-testid="app-bootstrap-required"')).toBeLessThan(componentSource.indexOf('data-testid="app-page-frame"'));
    expect(componentSource).toContain("App enabled with a fresh session");
    expect(componentSource).toContain("dataGenerationRef.current !== dataGeneration");
  });

  it("reuses shared LogDocument table primitives plus existing export and vault-backup contracts", () => {
    expect(componentSource).toContain("table.schema.fields");
    expect(componentSource).toContain("Save correction");
    expect(componentSource).toContain("Export JSON");
    expect(componentSource).toContain("runVaultBackupNow");
    expect(componentSource).toContain("Attached Log data (shared, not copied)");
    expect(componentSource).toContain("runOwnerAppDataMutation");
    expect(componentSource).toContain("fetchAppDataSnapshot");
    expect(componentSource).toContain('sessionToken: bootstrap.sessionToken');
  });

  it("owns durable acceptance, validation, retry, and pending-state visibility outside the iframe", () => {
    expect(componentSource).toContain("validateAppTableAcceptance(table, message.values)");
    expect(componentSource.indexOf("validateAppTableAcceptance(table, message.values)")).toBeLessThan(componentSource.indexOf("acceptAppMutation(window.localStorage"));
    expect(componentSource).toContain("flushAppMutationOutbox");
    expect(componentSource).toContain('code === "APP_RPC_UNAUTHORIZED"');
    expect(componentSource).toContain("refreshBootstrap()");
    expect(componentSource).toContain("outboxFlushRef");
    expect(componentSource).toContain("5000");
    expect(componentSource).toContain('data-testid="app-pending-mutations"');
    expect(componentSource).toContain("upsertAppMutation(window.localStorage");
    expect(componentSource).toContain("mergeAppSnapshotWithOutbox");
    expect(componentSource).toContain('data-testid="app-data-local-recovery"');
  });

  it("requires an explicit source choice while local App data is pending", () => {
    expect(componentSource).toContain('data-testid="app-source-conflict"');
    expect(componentSource).toContain("Update from server");
    expect(componentSource).toContain("Keep local");
    expect(componentSource).toContain("Pending local data is retained");
    expect(componentSource).toContain("setSavedSource(page.body)");
    expect(componentSource).not.toContain("setRuntimeSource(page.body);\n      setExternalSource(null);\n      setStatus(pendingMutations");
  });

  it("restores a bounded device package on offline or timed-out bootstrap and exposes sync state", () => {
    expect(componentSource).toContain("resolveMiniAppBootstrap(pagePath");
    expect(componentSource).toContain("MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS");
    expect(componentSource).toContain('data-testid="app-package-status"');
    expect(componentSource).toContain('data-state={syncMode}');
    expect(componentSource).toContain('"Local"');
    expect(componentSource).toContain('"Syncing"');
    expect(componentSource).toContain('"Synced"');
    expect(componentSource).toContain('window.addEventListener("online"');
    expect(componentSource).toContain("queryMiniAppPackage(packageRef.current");
    expect(componentSource).toContain("Accepted entries remain available offline.");
  });

  it("offers the same accessible Keep offline control in notebook and chromeless focus headers", () => {
    expect(componentSource).toContain('data-testid="app-keep-offline"');
    expect(componentSource).toContain("aria-pressed={keptOffline}");
    expect(componentSource.indexOf('data-testid="app-keep-offline"')).toBeLessThan(componentSource.indexOf("{chromeless ? ("));
    expect(componentSource).toContain('variant={keptOffline ? "secondary" : "outline"}');
  });
});

describe("notebook and focused/mobile App surfaces", () => {
  it("routes note_type=app to AppPageView and isolates source from generic autosave", () => {
    expect(shellSource).toContain('draft.noteType === "app"');
    expect(shellSource).toContain("<AppPageView");
    expect(shellSource).toContain('if (currentDraft.noteType === "app") return true;');
    expect(shellSource).toContain("reloadRequestNonce={appReloadRequestNonce}");
    expect(shellSource).toContain("AppPageView handles source/data events");
  });

  it("validates the focused path as note_type=app and reuses the same responsive AppPageView", () => {
    expect(focusedRouteSource).toContain('page.metadata.note_type !== "app"');
    expect(focusedRouteSource).toContain("<FocusedAppShell");
    expect(focusedShellSource).toContain("h-[100dvh]");
    expect(focusedShellSource).toContain("<AppPageView");
    // Bridge (SN-187): the notebook App view links the focused shell via the
    // shared helper rather than a hand-built URL.
    expect(componentSource).toContain("focusedAppUrl(pagePath)");
    expect(componentSource).toContain('data-testid="app-open-focused"');
    expect(componentSource).toContain(">Open focused app</a>");
  });

  it("pins an installable per-page App manifest for the focused start_url (SN-187)", () => {
    // generateMetadata links /api/page/app/manifest so a home-screen shortcut
    // launches straight into this App page, not the vault root.
    expect(focusedRouteSource).toContain("export async function generateMetadata");
    expect(focusedRouteSource).toContain("manifest: appManifestUrl(page.path)");
  });

  it("renders the focused App shell chrome-free (SN-187): no Develop toggle, tabs, or bridge", () => {
    // The focus surface passes `chromeless`, so developer controls are gated out.
    expect(focusedShellSource).toContain("chromeless");
    expect(componentSource).toContain("const developerActive = develop && !chromeless;");
    // Develop/Data/Source workspace only renders when developer chrome is active.
    expect(componentSource).toContain("{developerActive && tab === \"data\" ?");
    expect(componentSource).toContain("{developerActive ? <nav");
    // Install + back affordances replace developer chrome in focus mode.
    expect(focusedShellSource).toContain('data-testid="app-install"');
    expect(focusedShellSource).toContain('data-testid="app-focused-back"');
    // Sandbox authority is unchanged in focus mode.
    expect(componentSource).toContain('sandbox="allow-scripts"');
    expect(componentSource).not.toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it("reuses the SN-183 App draft outbox in focus mode without a new local-first store", () => {
    // Focus mode renders the same AppPageView, which reads/writes the single
    // page-scoped App mutation outbox; the shell introduces no new store.
    expect(componentSource).toContain("readAppMutationOutbox(window.localStorage)");
    expect(componentSource).toContain("flushAppMutationOutbox");
    expect(focusedShellSource).not.toContain("localStorage");
    expect(focusedShellSource).not.toContain("focused-log-local-state");
  });
});

describe("SN-205 openPage host navigation contract", () => {
  it("AppPageView handles the open-page request and replies over rpc-result", () => {
    expect(componentSource).toContain("onOpenPage?:");
    expect(componentSource).toContain('message.kind === "open-page"');
    expect(componentSource).toContain("onOpenPageRef.current");
    // The reply rides the existing bounded rpc-result reply + limiter.finish path.
    expect(componentSource).toContain('kind: "rpc-result"');
    expect(componentSource).toContain("limiter.finish(message.requestId)");
  });

  it("the notebook shell validates against the tree and reuses the openPage leave/save flow", () => {
    expect(shellSource).toContain("const handleAppOpenPage");
    expect(shellSource).toContain("normalizeVaultRelativePagePath(pagePath)");
    expect(shellSource).toContain("findExistingPagePath");
    expect(shellSource).toContain("resolveTreeExpandPathsForPage(currentTree, canonical)");
    expect(shellSource).toContain("mergeTreeExpandState(");
    expect(shellSource).toContain("setExpandedNotebooks(expanded.notebooks)");
    expect(shellSource).toContain("setExpandedSections(expanded.sections)");
    expect(shellSource).toContain("setExpandedPages(expanded.pages)");
    expect(shellSource).toContain("next.delete(notebookPath)");
    expect(shellSource).toContain("await openPage(canonical)");
    expect(shellSource).toContain("onOpenPage={handleAppOpenPage}");
    // Deep-link honored on first hydration so a focused app can land the notebook.
    expect(shellSource).toContain('searchParams?.get("page")');
  });

  it("the focused App shell exits focus mode and deep-links into the notebook", () => {
    expect(focusedShellSource).toContain("const handleOpenPage");
    expect(focusedShellSource).toContain("normalizeVaultRelativePagePath(target)");
    expect(focusedShellSource).toContain("await fetchPage(normalized)");
    expect(focusedShellSource).toContain('window.location.assign(`/?page=${encodeURIComponent(normalized)}`)');
    expect(focusedShellSource).toContain("onOpenPage={handleOpenPage}");
  });
});

describe("SN-203 companion<->app channel contract", () => {
  it("AppPageView injects a companion turn via onCompanionSend, structurally separate from data rpc", () => {
    expect(componentSource).toContain("onCompanionSend?:");
    expect(componentSource).toContain('message.kind === "companion-send"');
    expect(componentSource).toContain("onCompanionSendRef.current");
    // Structural separation: companion-send is injected through onCompanionSend and
    // returns from its own branch — it never reaches runAppRpc / acceptAppMutation,
    // so a reply can never land in app/log data.
    expect(componentSource).toContain("onCompanionSendRef.current!({ text: message.text, payload: message.payload })");
    const sendBranch = componentSource.slice(
      componentSource.indexOf('message.kind === "open-page" || message.kind === "companion-send"'),
      componentSource.indexOf('if (message.kind === "accept" || message.kind === "upsert")')
    );
    expect(sendBranch).not.toContain("runAppRpc");
    expect(sendBranch).not.toContain("acceptAppMutation");
  });

  it("AppPageView delivers host->app messages into a live frame only, ephemerally", () => {
    expect(componentSource).toContain('socket.on("companion_app_deliver"');
    expect(componentSource).toContain("buildCompanionDeliverMessage(nonceRef.current");
    expect(componentSource).toContain('socket.emit("companion_app_deliver_ack"');
    // No durable app-side queue: delivery only posts to a currently mounted frame.
    expect(componentSource).toContain("const frameWindow = iframeRef.current?.contentWindow;");
    expect(componentSource).not.toContain("companion_app_deliver_queue");
  });

  it("the shell injects an auto-run turn reusing the kept-session turn lifecycle", () => {
    expect(shellSource).toContain("const handleAppCompanionSend");
    expect(shellSource).toContain("buildCompanionAppMessagePrompt({ text, payload, appTitle: current.title })");
    expect(shellSource).toContain("await handleAiSubmit(prompt)");
    expect(shellSource).toContain("onCompanionSend={handleAppCompanionSend}");
  });

  it("app_send is registered as a scoped companion tool routed to the socket coordinator", () => {
    const toolSource = fs.readFileSync(path.join(process.cwd(), "src/server/vault/agent-tools.ts"), "utf8");
    const commandSource = fs.readFileSync(path.join(process.cwd(), "src/server/vault/agent-commands.ts"), "utf8");
    const serverSource = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
    expect(toolSource).toContain('name: "app_send"');
    expect(toolSource).toContain('action: "send"');
    expect(commandSource).toContain("deliverCompanionAppMessage(args.path, args.message)");
    expect(serverSource).toContain("createCompanionAppChannel({ io })");
    expect(serverSource).toContain("_smartNotesCompanionAppChannel");
  });
});

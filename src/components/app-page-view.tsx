"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { io } from "socket.io-client";
import {
  AlertTriangle, Check, Code2, Database, Download, Eye, HardDrive, Menu, Pin, Play, Plus, Power,
  RotateCw, Save, Square, SquareArrowOutUpRight, Trash2, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  APP_FRAME_MAX_RESPONSE_BYTES,
  APP_FRAME_MAX_HEIGHT,
  AppFrameHostLimiterScope,
  buildAppSrcDoc,
  buildCompanionDeliverMessage,
  isAppFrameRequestKind,
  parseAppFrameMessage,
  type AppFrameRpcResponse,
} from "@/lib/app-frame";
import {
  fetchAppBootstrap, fetchAppDataSnapshot, focusedAppUrl, reloadAppSource, runAppRpc,
  runOwnerAppDataMutation, saveAppSource, setAppEnabled,
  type AppBootstrapResponse,
} from "@/lib/api/app";
import { runVaultBackupNow } from "@/lib/api/backup";
import { validateAppTableAcceptance, type AppTableSnapshot } from "@/lib/app-contract";
import {
  APP_MUTATION_OUTBOX_STORAGE_KEY,
  acceptAppMutation, acceptAppMutationWithUpsert, flushAppMutationOutbox, mergeAppQueryRowsWithOutbox, mergeAppSnapshotWithOutbox, readAppMutationOutbox,
  upsertAppMutation,
  type PendingAppMutation,
} from "@/lib/app-mutation-outbox";
import {
  MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS,
  queryMiniAppPackage,
  readMiniAppPackage,
  resolveMiniAppBootstrap,
  setMiniAppPackagePinned,
  writeMiniAppPackage,
  type MiniAppPackage,
} from "@/lib/mini-app-package-cache";

const CodeMirrorEditor = dynamic(
  () => import("@/components/code-mirror-editor").then((module) => module.CodeMirrorEditor),
  { ssr: false }
);

type DevelopTab = "preview" | "data" | "source";
type AppSyncMode = "local" | "syncing" | "synced";

export interface AppPageViewProps {
  pagePath: string;
  title: string;
  bodyHtml: string;
  onOpenSidebar?: () => void;
  reloadRequestNonce?: number;
  /**
   * Chrome-free focus mode (SN-187): hides the developer header controls
   * (Develop toggle, Data/Source tabs, Stop/Reload/Enable, Focus bridge) and
   * renders only the running app plus save/sync status. The App still uses the
   * same page-scoped SN-183 draft outbox, so accepted entries survive reload
   * from an installed home-screen icon. Sandbox authority is unchanged.
   */
  chromeless?: boolean;
  /** Focus-mode header leading slot (e.g. a back-to-notebook link). */
  leading?: React.ReactNode;
  /** Focus-mode header trailing slot (e.g. an Add-to-Home-screen button). */
  trailing?: React.ReactNode;
  /**
   * SN-205: host handler for `smartNotesApp.openPage(pagePath)`. Validates the
   * target against the vault tree and performs host navigation, resolving
   * `{ ok: true }` on accepted navigation or `{ ok: false, error }` when rejected.
   * When omitted, openPage returns a bounded "not available here" error.
   */
  onOpenPage?: (pagePath: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * SN-203: host handler for `smartNotesApp.companion.send({ text, payload })`.
   * Injects a main-companion turn carrying the text + payload as context and
   * auto-runs it, resolving once the turn is accepted. When omitted, the call
   * returns a bounded "companion is not available here" error.
   */
  onCompanionSend?: (input: { text: string; payload: unknown }) => Promise<{ ok: boolean; error?: string }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The App operation failed.";
}

export function createAppFrameNonce(): string {
  const cryptoObject = globalThis.crypto;
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  if (typeof cryptoObject?.getRandomValues === "function") {
    const bytes = cryptoObject.getRandomValues(new Uint32Array(4));
    return Array.from(bytes, (value) => value.toString(36)).join("-");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function supportsAppNavigationGuard(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const navigation = (value as { navigation?: unknown }).navigation;
  return Boolean(navigation && typeof navigation === "object" && typeof (navigation as { addEventListener?: unknown }).addEventListener === "function");
}

function boundedRpcResponse(response: AppFrameRpcResponse): AppFrameRpcResponse {
  try {
    if (new TextEncoder().encode(JSON.stringify(response)).byteLength <= APP_FRAME_MAX_RESPONSE_BYTES) return response;
  } catch {
    // Replace a non-serializable or oversized result with a bounded failure.
  }
  return {
    source: "smart-notes-app-host",
    nonce: response.nonce,
    kind: "rpc-result",
    requestId: response.requestId,
    ok: false,
    error: "App table response exceeded the host limit.",
  };
}

function AppDataView({ bootstrap, onRefresh, pendingCount, outboxError }: {
  bootstrap: AppBootstrapResponse;
  onRefresh: () => Promise<void>;
  pendingCount: number;
  outboxError: string | null;
}) {
  const [tableId, setTableId] = React.useState(bootstrap.tables[0]?.id ?? "");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [jsonText, setJsonText] = React.useState("{}");
  const [status, setStatus] = React.useState<string | null>(null);
  const table = bootstrap.tables.find((candidate) => candidate.id === tableId) ?? bootstrap.tables[0];

  React.useEffect(() => {
    if (!bootstrap.tables.some((candidate) => candidate.id === tableId)) setTableId(bootstrap.tables[0]?.id ?? "");
  }, [bootstrap.tables, tableId]);

  const mutate = async (operation: "add" | "update" | "delete", rowId?: string) => {
    if (!table) return;
    setStatus("Saving…");
    try {
      const values = operation === "delete" ? undefined : JSON.parse(jsonText) as unknown;
      await runOwnerAppDataMutation({
        path: bootstrap.page.path, sessionToken: bootstrap.sessionToken, tableId: table.id,
        operation, ...(rowId ? { rowId } : {}), ...(values !== undefined ? { values } : {}),
      });
      setEditingId(null);
      setJsonText("{}");
      await onRefresh();
      setStatus("Saved");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  const exportTable = () => {
    if (!table) return;
    const blob = new Blob([`${JSON.stringify({ version: table.version, schema: table.schema, rows: table.rows }, null, 2)}\n`], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${table.id}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const backup = async () => {
    setStatus("Backing up vault…");
    try {
      await runVaultBackupNow();
      setStatus("Vault backup completed");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  const exportOutbox = () => {
    const raw = window.localStorage.getItem(APP_MUTATION_OUTBOX_STORAGE_KEY) ?? "";
    const blob = new Blob([raw], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "smart-notes-app-pending-recovery.json";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  if (!table) {
    return <div className="p-6 text-sm text-muted-foreground" data-testid="app-data-empty">This app has no attached tables.</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col [&_button]:min-h-11 xl:[&_button]:min-h-8" data-testid="app-data-view">
      {pendingCount > 0 || outboxError ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2" data-testid="app-data-local-recovery">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Pending local App data</p>
            <p className="text-xs text-muted-foreground">{outboxError ?? `${pendingCount} local change${pendingCount === 1 ? " is" : "s are"} overlaid below and retained until sync completes.`}</p>
          </div>
          <Button size="sm" variant="outline" onClick={exportOutbox}><Download className="size-3.5" />Export recovery JSON</Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="app-data-table">Attached table</label>
        <select id="app-data-table" value={table.id} onChange={(event) => setTableId(event.target.value)} className="min-h-11 rounded-md border border-input bg-background px-2 text-sm xl:min-h-9">
          {bootstrap.tables.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{table.kind === "log" ? "Attached Log data (shared, not copied)" : "App-owned JSON data"}</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportTable}><Download className="size-3.5" />Export JSON</Button>
        <Button size="sm" variant="outline" onClick={() => void backup()}><Save className="size-3.5" />Backup now</Button>
      </div>
      <div className="overflow-auto p-3">
        <table className="w-full border-collapse text-sm" data-testid="app-data-table-grid">
          <thead><tr className="border-b border-border text-left">{table.schema.fields.map((field) => <th key={field.id} className="px-2 py-2 font-medium text-muted-foreground">{field.name}</th>)}<th className="px-2 py-2" /></tr></thead>
          <tbody>{table.rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 align-top">
              {table.schema.fields.map((field) => <td key={field.id} className="px-2 py-2">{typeof row.values[field.id] === "object" ? JSON.stringify(row.values[field.id]) : String(row.values[field.id] ?? "")}</td>)}
              <td className="whitespace-nowrap px-2 py-1 text-right">
                <Button size="sm" variant="ghost" onClick={() => { setEditingId(row.id); setJsonText(JSON.stringify(row.values, null, 2)); }}>Correct</Button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete row" onClick={() => void mutate("delete", row.id)}><Trash2 className="size-3.5 text-destructive" /></Button>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {table.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No records yet.</p> : null}
        <div className="mt-4 rounded-md border border-border bg-surface p-3">
          <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="app-row-json">{editingId ? "Correct complete row values" : "Add row values"} (JSON)</label>
          <textarea id="app-row-json" value={jsonText} onChange={(event) => setJsonText(event.target.value)} className="min-h-28 w-full rounded-md border border-input bg-background p-2 font-mono text-xs" />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={() => void mutate(editingId ? "update" : "add", editingId ?? undefined)}>{editingId ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}{editingId ? "Save correction" : "Add record"}</Button>
            {editingId ? <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setJsonText("{}"); }}>Cancel</Button> : null}
            {status ? <span role="status" className="text-xs text-muted-foreground">{status}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppPageView({ pagePath, title, bodyHtml, onOpenSidebar, reloadRequestNonce = 0, chromeless = false, leading, trailing, onOpenPage, onCompanionSend }: AppPageViewProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  // SN-203/SN-205: keep the host channel callbacks in refs so the message and
  // socket effects never resubscribe when a parent passes fresh closures.
  const onOpenPageRef = React.useRef(onOpenPage);
  onOpenPageRef.current = onOpenPage;
  const onCompanionSendRef = React.useRef(onCompanionSend);
  onCompanionSendRef.current = onCompanionSend;
  const loadCountRef = React.useRef(0);
  const sourceRef = React.useRef(bodyHtml);
  const initialReloadRequestRef = React.useRef(reloadRequestNonce);
  const lastHeartbeatRef = React.useRef(Date.now());
  const limiterScopeRef = React.useRef(new AppFrameHostLimiterScope());
  const activeSessionRef = React.useRef<{ pagePath: string; token: string } | null>(null);
  const bootstrapRequestRef = React.useRef<{ pagePath: string; promise: Promise<AppBootstrapResponse> } | null>(null);
  const bootstrapQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const outboxFlushRef = React.useRef<Promise<void> | null>(null);
  const packageRef = React.useRef<MiniAppPackage | null>(null);
  const currentPagePathRef = React.useRef(pagePath);
  const dataGenerationRef = React.useRef(0);
  const [bootstrap, setBootstrap] = React.useState<AppBootstrapResponse | null>(null);
  const [source, setSource] = React.useState(bodyHtml);
  const [savedSource, setSavedSource] = React.useState(bodyHtml);
  const [runtimeSource, setRuntimeSource] = React.useState(bodyHtml);
  const [develop, setDevelop] = React.useState(false);
  const [tab, setTab] = React.useState<DevelopTab>("preview");
  const [stopped, setStopped] = React.useState(false);
  const [nonce, setNonce] = React.useState(createAppFrameNonce);
  const [frameHeight, setFrameHeight] = React.useState(640);
  const [status, setStatus] = React.useState<string | null>(null);
  const [externalSource, setExternalSource] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [navigationApiAvailable, setNavigationApiAvailable] = React.useState<boolean | null>(null);
  const [pendingMutations, setPendingMutations] = React.useState(0);
  const [outboxError, setOutboxError] = React.useState<string | null>(null);
  const [syncMode, setSyncMode] = React.useState<AppSyncMode>("syncing");
  const [keptOffline, setKeptOffline] = React.useState(false);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const dirty = source !== savedSource;
  const hasProtectedLocalData = pendingMutations > 0 || outboxError !== null;
  // Focus mode (SN-187) never exposes the Develop workspace, so no Data/Source
  // tabs or developer controls render even if `develop` was toggled earlier.
  const developerActive = develop && !chromeless;
  const enabled = bootstrap?.manifest.enabled ?? true;
  const srcDoc = React.useMemo(
    () => buildAppSrcDoc(runtimeSource, nonce, navigationApiAvailable === true),
    [navigationApiAvailable, nonce, runtimeSource]
  );
  currentPagePathRef.current = pagePath;
  sourceRef.current = source;
  // SN-203: the socket delivery handler reads the live nonce so companion-deliver
  // envelopes are addressed to the frame currently mounted.
  const nonceRef = React.useRef(nonce);
  nonceRef.current = nonce;

  const readPendingLocal = React.useCallback((): PendingAppMutation[] | null => {
    try {
      const items = readAppMutationOutbox(window.localStorage);
      setPendingMutations(items.filter((item) => item.pagePath === pagePath).length);
      setOutboxError(null);
      return items;
    } catch (error) {
      const message = errorMessage(error);
      setOutboxError(message);
      setStatus(message);
      return null;
    }
  }, [pagePath]);

  const mergePendingSnapshot = React.useCallback(<T extends { tables: AppTableSnapshot[] },>(snapshot: T): T => {
    const items = readPendingLocal();
    return items ? mergeAppSnapshotWithOutbox(snapshot, items, pagePath) : snapshot;
  }, [pagePath, readPendingLocal]);

  const refreshBootstrap = React.useCallback(async (signal?: AbortSignal) => {
    const pending = bootstrapRequestRef.current;
    if (pending?.pagePath === pagePath) return pending.promise;
    const dataGeneration = ++dataGenerationRef.current;
    const previous = bootstrapQueueRef.current;
    const promise = previous.catch(() => undefined).then(async () => {
      const replacementToken = activeSessionRef.current?.token;
      const next = await fetchAppBootstrap(pagePath, replacementToken, signal);
      activeSessionRef.current = { pagePath: next.page.path, token: next.sessionToken };
      if (currentPagePathRef.current === pagePath) {
        const localNext = mergePendingSnapshot(next);
        setBootstrap((current) => {
          if (!current || dataGenerationRef.current === dataGeneration) return localNext;
          return {
            ...current,
            page: localNext.page,
            sessionToken: localNext.sessionToken,
            sessionExpiresAt: localNext.sessionExpiresAt,
          };
        });
        setSyncMode("synced");
        setBootstrapError(null);
      }
      return next;
    });
    bootstrapQueueRef.current = promise.then(() => undefined, () => undefined);
    bootstrapRequestRef.current = { pagePath, promise };
    try {
      return await promise;
    } finally {
      if (bootstrapRequestRef.current?.promise === promise) bootstrapRequestRef.current = null;
    }
  }, [mergePendingSnapshot, pagePath]);

  const refreshDataSnapshot = React.useCallback(async () => {
    const dataGeneration = ++dataGenerationRef.current;
    const snapshot = await fetchAppDataSnapshot(pagePath);
    if (currentPagePathRef.current !== pagePath || dataGenerationRef.current !== dataGeneration) return;
    const items = readPendingLocal();
    if (!items) return;
    const merged = mergeAppSnapshotWithOutbox(snapshot, items, pagePath);
    setBootstrap((current) => current?.page.path === pagePath ? { ...current, ...merged } : current);
    const stored = items.some((item) => item.pagePath === pagePath)
      ? null
      : await writeMiniAppPackage(snapshot).catch(() => null);
    if (stored && currentPagePathRef.current === pagePath) {
      packageRef.current = stored;
      setKeptOffline(stored.pinned);
    }
  }, [pagePath, readPendingLocal]);

  const flushPendingMutations = React.useCallback(() => {
    if (outboxFlushRef.current) return outboxFlushRef.current;
    const run = async () => {
      if (!bootstrap || !bootstrap.sessionToken || !bootstrap.manifest.enabled) {
        setPendingMutations(readAppMutationOutbox(window.localStorage).filter((item) => item.pagePath === pagePath).length);
        return;
      }
      const sendWithToken = (sessionToken: string) => (item: PendingAppMutation) => runAppRpc({
        path: pagePath, sessionToken, tableId: item.tableId, operation: item.operation, values: item.values,
        clientMutationId: item.mutationId, acceptedAt: item.acceptedAt,
        ...(item.operation === "upsert" ? { upsertKey: item.upsertKey } : {}),
      });
      let result = await flushAppMutationOutbox(window.localStorage, pagePath, sendWithToken(bootstrap.sessionToken)) as { synced: number; pending: number; lastError?: unknown };
      if ((result.lastError as { code?: string } | undefined)?.code === "APP_RPC_UNAUTHORIZED") {
        const renewed = await refreshBootstrap();
        const retry = await flushAppMutationOutbox(window.localStorage, pagePath, sendWithToken(renewed.sessionToken)) as { synced: number; pending: number; lastError?: unknown };
        result = { ...retry, synced: result.synced + retry.synced };
      }
      setPendingMutations(result.pending);
      if (result.lastError !== undefined) {
        setStatus(`Sync paused: ${errorMessage(result.lastError)} Pending local data was retained; Develop → Data remains available.`);
      }
      if (result.synced > 0) {
        await refreshDataSnapshot();
        if (result.lastError === undefined) setStatus(result.pending ? `${result.pending} local change${result.pending === 1 ? "" : "s"} awaiting sync` : "Local App data synced");
      }
    };
    const promise = run().finally(() => { if (outboxFlushRef.current === promise) outboxFlushRef.current = null; });
    outboxFlushRef.current = promise;
    return promise;
  }, [bootstrap, pagePath, refreshBootstrap, refreshDataSnapshot]);

  const reloadRuntime = React.useCallback(async () => {
    setBusy(true);
    try {
      // Renew the host-only server session as well as the frame nonce so Reload
      // recovers cleanly after TTL expiry or server restart.
      setSyncMode("syncing");
      const pendingItems = readPendingLocal();
      const protectLocal = pendingItems === null || pendingItems.some((item) => item.pagePath === pagePath);
      const resolved = await resolveMiniAppBootstrap(pagePath, (signal) => refreshBootstrap(signal), {
        online: navigator.onLine !== false,
        timeoutMs: MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS,
        persistLive: !protectLocal,
      });
      packageRef.current = resolved.package;
      setKeptOffline(resolved.package?.pinned ?? false);
      setBootstrap(mergePendingSnapshot(resolved.bootstrap));
      const sourceConflict = resolved.mode === "synced" && protectLocal
        && resolved.bootstrap.page.body !== sourceRef.current;
      if (sourceConflict) {
        setExternalSource(resolved.bootstrap.page.body);
        setRuntimeSource(savedSource);
      } else {
        setSource(resolved.bootstrap.page.body);
        setSavedSource(resolved.bootstrap.page.body);
        setRuntimeSource(resolved.bootstrap.page.body);
        setExternalSource(null);
      }
      setSyncMode(resolved.mode);
      loadCountRef.current = 0;
      lastHeartbeatRef.current = Date.now();
      setNonce(createAppFrameNonce());
      setStopped(false);
      setStatus(sourceConflict
        ? "App reloaded with local source. Choose Update from server or Keep local; pending data is retained."
        : resolved.mode === "local" ? "App reloaded from this device." : "App reloaded and synced");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [mergePendingSnapshot, pagePath, readPendingLocal, refreshBootstrap, savedSource]);

  React.useEffect(() => {
    setNavigationApiAvailable(supportsAppNavigationGuard(window));
  }, [pagePath]);

  React.useEffect(() => {
    dataGenerationRef.current += 1;
    setBootstrap(null);
    setSource(bodyHtml);
    setSavedSource(bodyHtml);
    setRuntimeSource(bodyHtml);
    setStopped(false);
    setStatus(null);
    setExternalSource(null);
    setBootstrapError(null);
    setSyncMode("syncing");
    packageRef.current = null;
    activeSessionRef.current = null;
    let cancelled = false;
    void (async () => {
      try {
        const pendingItems = readPendingLocal();
        const protectLocal = pendingItems === null || pendingItems.some((item) => item.pagePath === pagePath);
        const packageBeforeLive = protectLocal
          ? await readMiniAppPackage(pagePath, { touch: false }).catch(() => null)
          : null;
        const localSourceBeforeLive = packageBeforeLive?.source ?? bodyHtml;
        const resolved = await resolveMiniAppBootstrap(pagePath, (signal) => refreshBootstrap(signal), {
          online: navigator.onLine !== false,
          timeoutMs: MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS,
          persistLive: !protectLocal,
        });
        if (cancelled || currentPagePathRef.current !== pagePath) return;
        packageRef.current = resolved.package;
        setKeptOffline(resolved.package?.pinned ?? false);
        setBootstrap(mergePendingSnapshot(resolved.bootstrap));
        const sourceConflict = resolved.mode === "synced" && protectLocal
          && resolved.bootstrap.page.body !== localSourceBeforeLive;
        const selectedSource = sourceConflict ? localSourceBeforeLive : resolved.bootstrap.page.body;
        setSource(selectedSource);
        setSavedSource(selectedSource);
        setRuntimeSource(selectedSource);
        setExternalSource(sourceConflict ? resolved.bootstrap.page.body : null);
        setSyncMode(resolved.mode);
        if (sourceConflict && pendingItems !== null) {
          setStatus("Server source changed while local App data is pending. Choose Update from server or Keep local.");
        } else if (resolved.packageError) {
          setStatus(`App opened, but its offline package could not be saved: ${errorMessage(resolved.packageError)}`);
        } else if (resolved.mode === "local") {
          setStatus(navigator.onLine === false
            ? "Opened from this device. Changes will sync when the connection returns."
            : "The live App took too long to respond, so Smart Notes opened the device package.");
        }
      } catch (error) {
        if (cancelled || currentPagePathRef.current !== pagePath) return;
        const message = navigator.onLine === false
          ? "This App is offline and has not been opened successfully on this device yet."
          : `${errorMessage(error)} No device package is available yet.`;
        setBootstrapError(message);
        setStatus(message);
        setSyncMode("local");
      }
    })();
    // bodyHtml is intentionally seeded only when the page identity changes;
    // a remote prop refresh must never replace explicit unsaved Source edits.
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergePendingSnapshot, pagePath, readPendingLocal, refreshBootstrap]);

  React.useEffect(() => {
    if (syncMode !== "local") return;
    let syncing = false;
    const retryLive = async () => {
      if (syncing || navigator.onLine === false || document.hidden) return;
      syncing = true;
      setSyncMode("syncing");
      try {
        const pendingItems = readPendingLocal();
        const protectLocal = pendingItems === null || pendingItems.some((item) => item.pagePath === pagePath);
        const resolved = await resolveMiniAppBootstrap(pagePath, (signal) => refreshBootstrap(signal), {
          online: true,
          timeoutMs: MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS,
          persistLive: !protectLocal,
        });
        packageRef.current = resolved.package;
        setKeptOffline(resolved.package?.pinned ?? false);
        setBootstrap(mergePendingSnapshot(resolved.bootstrap));
        setSyncMode(resolved.mode);
        setBootstrapError(null);
        if (resolved.mode === "synced" && resolved.bootstrap.page.body !== sourceRef.current) {
          setExternalSource(resolved.bootstrap.page.body);
          if (pendingItems !== null) {
            setStatus(protectLocal
              ? "Server source changed while local App data is pending. Choose Update from server or Keep local."
              : "Server source changed. Update from server when ready.");
          }
        } else {
          setStatus(resolved.mode === "synced"
            ? "Live App data is synced. Pending local changes are being sent to the vault."
            : "Still using the device package while Smart Notes waits for the connection.");
        }
      } catch {
        setSyncMode("local");
      } finally {
        syncing = false;
      }
    };
    const onOnline = () => { void retryLive(); };
    const onVisible = () => { if (!document.hidden) void retryLive(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => { void retryLive(); }, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [mergePendingSnapshot, pagePath, readPendingLocal, refreshBootstrap, syncMode]);

  React.useEffect(() => {
    readPendingLocal();
    void flushPendingMutations().catch((error) => setStatus(errorMessage(error)));
    const retry = () => { if (!document.hidden) void flushPendingMutations().catch((error) => setStatus(errorMessage(error))); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    const timer = window.setInterval(() => { if (!document.hidden && navigator.onLine) void flushPendingMutations().catch((error) => setStatus(errorMessage(error))); }, 5000);
    return () => { window.clearInterval(timer); window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", retry); };
  }, [flushPendingMutations, pagePath, readPendingLocal]);

  React.useEffect(() => {
    const socket = io();
    const handleFileUpdated = (event: { path?: string; content?: string; kind?: "app_data" }) => {
      if (event.path !== pagePath) return;
      if (event.kind === "app_data") {
        void refreshDataSnapshot().catch((error) => setStatus(errorMessage(error)));
        return;
      }
      if (typeof event.content === "string" && event.content !== sourceRef.current) {
        setExternalSource(event.content);
        setStatus("App source was updated on the server. Local App data and source remain unchanged until you choose.");
      }
    };
    // SN-203: host→app companion delivery. The server broadcasts a deliver
    // request to every client; only a client with THIS app currently running
    // (a live iframe on the matching page) delivers the message and acks, which
    // is how `app_send` distinguishes a running instance from "app not running".
    // Ephemeral by construction — nothing is queued or replayed.
    const handleCompanionDeliver = (event: { deliveryId?: string; path?: string; message?: unknown }) => {
      if (!event || event.path !== pagePath || typeof event.deliveryId !== "string") return;
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) return;
      const envelope = buildCompanionDeliverMessage(nonceRef.current, event.deliveryId, event.message);
      if (!envelope) return;
      frameWindow.postMessage(envelope, "*");
      socket.emit("companion_app_deliver_ack", { deliveryId: event.deliveryId, path: pagePath });
    };
    socket.on("file_updated", handleFileUpdated);
    socket.on("companion_app_deliver", handleCompanionDeliver);
    return () => {
      socket.off("file_updated", handleFileUpdated);
      socket.off("companion_app_deliver", handleCompanionDeliver);
      socket.disconnect();
    };
  }, [pagePath, refreshDataSnapshot]);

  React.useEffect(() => {
    const limiter = limiterScopeRef.current.forFrame(pagePath, nonce);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseAppFrameMessage(event.data, nonce);
      if (!message) return;
      const limitError = limiter.admit(message);
      if (limitError) {
        if (isAppFrameRequestKind(message.kind)) {
          const response: AppFrameRpcResponse = {
            source: "smart-notes-app-host", nonce, kind: "rpc-result",
            requestId: (message as Extract<typeof message, { requestId: string }>).requestId, ok: false, error: limitError,
          };
          iframeRef.current?.contentWindow?.postMessage(response, "*");
        } else {
          setStatus(limitError);
        }
        return;
      }
      lastHeartbeatRef.current = Date.now();
      if (message.kind === "height") {
        setFrameHeight(Math.min(APP_FRAME_MAX_HEIGHT, Math.max(320, message.height)));
        return;
      }
      if (message.kind === "navigation-attempt") {
        setStatus("Navigation was blocked by the App sandbox");
        return;
      }
      if (message.kind === "runtime-unsupported") {
        setNavigationApiAvailable(false);
        setStatus("App Preview is unavailable because this browser cannot enforce programmatic navigation blocking.");
        return;
      }
      if (message.kind === "heartbeat") return;
      if (outboxError && (message.kind === "rpc" || message.kind === "accept" || message.kind === "upsert")) {
        const response: AppFrameRpcResponse = {
          source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId,
          ok: false, error: outboxError.slice(0, 400),
        };
        iframeRef.current?.contentWindow?.postMessage(response, "*");
        limiter.finish(message.requestId);
        return;
      }
      if (message.kind === "open-page" || message.kind === "companion-send") {
        const respond = (ok: boolean, extra: { data?: unknown; error?: string }) => {
          const response: AppFrameRpcResponse = {
            source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId, ok, ...extra,
          };
          iframeRef.current?.contentWindow?.postMessage(response, "*");
          limiter.finish(message.requestId);
        };
        const handler = message.kind === "open-page" ? onOpenPageRef.current : onCompanionSendRef.current;
        if (!handler) {
          respond(false, {
            error: message.kind === "open-page"
              ? "Opening Smart Notes pages is not available here."
              : "The companion is not available here.",
          });
          return;
        }
        const invocation = message.kind === "open-page"
          ? onOpenPageRef.current!(message.pagePath)
          : onCompanionSendRef.current!({ text: message.text, payload: message.payload });
        void invocation
          .then((result) => {
            if (result?.ok) {
              respond(true, {
                data: message.kind === "open-page" ? { opened: true, pagePath: message.pagePath } : { delivered: true },
              });
            } else {
              respond(false, { error: (result?.error || "The request was rejected.").slice(0, 400) });
            }
          })
          .catch((error) => respond(false, { error: errorMessage(error).slice(0, 400) }));
        return;
      }
      if (message.kind === "accept" || message.kind === "upsert") {
        try {
          const table = bootstrap?.tables.find((candidate) => candidate.id === message.tableId);
          const values = validateAppTableAcceptance(table, message.values);
          if (message.kind === "accept") {
            if (message.retire) {
              const retireTable = bootstrap?.tables.find((candidate) => candidate.id === message.retire?.tableId);
              const retireValues = validateAppTableAcceptance(retireTable, message.retire.values);
              acceptAppMutationWithUpsert(window.localStorage, {
                mutationId: message.mutationId, pagePath, tableId: message.tableId, values,
              }, {
                mutationId: message.retire.mutationId, pagePath, tableId: message.retire.tableId,
                upsertKey: message.retire.upsertKey, values: retireValues,
              });
            } else {
              acceptAppMutation(window.localStorage, {
                mutationId: message.mutationId, pagePath, tableId: message.tableId, values,
              });
            }
          } else {
            upsertAppMutation(window.localStorage, {
              mutationId: message.mutationId, pagePath, tableId: message.tableId,
              upsertKey: message.upsertKey, values,
            });
          }
          const items = readAppMutationOutbox(window.localStorage);
          const pending = items.filter((item) => item.pagePath === pagePath).length;
          setPendingMutations(pending);
          setBootstrap((current) => current?.page.path === pagePath
            ? mergeAppSnapshotWithOutbox(current, items, pagePath)
            : current);
          setOutboxError(null);
          const response: AppFrameRpcResponse = {
            source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId,
            ok: true, data: { accepted: true, mutationId: message.mutationId, pending: true },
          };
          iframeRef.current?.contentWindow?.postMessage(response, "*");
          setStatus(message.kind === "accept" ? "Entry accepted safely; syncing to vault data" : "Draft stored safely; syncing in background");
          void flushPendingMutations().catch((error) => setStatus(errorMessage(error)));
        } catch (error) {
          const response: AppFrameRpcResponse = {
            source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId,
            ok: false, error: errorMessage(error).slice(0, 400),
          };
          iframeRef.current?.contentWindow?.postMessage(response, "*");
        } finally {
          limiter.finish(message.requestId);
        }
        return;
      }
      if (!bootstrap) {
        limiter.finish(message.requestId);
        return;
      }
      const operation = bootstrap.sessionToken
        ? runAppRpc({
            path: pagePath, sessionToken: bootstrap.sessionToken, tableId: message.tableId,
            operation: message.operation, rowId: message.rowId, values: message.values, query: message.query,
          })
        : message.operation === "query" && packageRef.current
          ? Promise.resolve(queryMiniAppPackage(packageRef.current, message.tableId, message.query))
          : Promise.reject(new Error("This App operation needs a live connection. Accepted entries remain available offline."));
      void operation.then((data) => {
        let responseData = data;
        if (message.operation === "query" && data && typeof data === "object" && !Array.isArray(data)) {
          const result = data as { rows?: unknown };
          const table = bootstrap.tables.find((candidate) => candidate.id === message.tableId);
          if (table && Array.isArray(result.rows)) {
            const items = readAppMutationOutbox(window.localStorage);
            const rows = mergeAppQueryRowsWithOutbox(table, result.rows as typeof table.rows, items, pagePath, message.query);
            responseData = { ...data, rows };
          }
        }
        const response: AppFrameRpcResponse = { source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId, ok: true, data: responseData };
        iframeRef.current?.contentWindow?.postMessage(boundedRpcResponse(response), "*");
      }).catch((error) => {
        const response: AppFrameRpcResponse = { source: "smart-notes-app-host", nonce, kind: "rpc-result", requestId: message.requestId, ok: false, error: errorMessage(error).slice(0, 400) };
        iframeRef.current?.contentWindow?.postMessage(response, "*");
      }).finally(() => {
        limiter.finish(message.requestId);
      });
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [bootstrap, flushPendingMutations, nonce, outboxError, pagePath]);

  React.useEffect(() => {
    if (stopped || !enabled || navigationApiAvailable !== true) return;
    lastHeartbeatRef.current = Date.now();
    const handleVisibility = () => {
      if (!document.hidden) lastHeartbeatRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastHeartbeatRef.current > 7000) {
        setStopped(true);
        setStatus("App runtime became unresponsive and was stopped. Recover and reload when ready.");
      }
    }, 2000);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(timer);
    };
  }, [enabled, navigationApiAvailable, nonce, stopped]);

  const saveSource = async () => {
    if (externalSource !== null) {
      setStatus("Choose Update from server or Keep local before saving source.");
      return;
    }
    setBusy(true); setStatus("Saving source…");
    try {
      const page = await saveAppSource(pagePath, title, source);
      await cacheChosenSource();
      setSavedSource(page.body); setSource(page.body); setExternalSource(null); setStatus("Source saved; Reload Preview when ready");
    } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  };

  const reloadSource = async () => {
    if (externalSource !== null && hasProtectedLocalData) {
      setStatus("Choose Update from server or Keep local before reloading source.");
      return;
    }
    if (dirty && !window.confirm("Discard unsaved Source edits and reload from the vault?")) return;
    setBusy(true);
    try {
      const page = await reloadAppSource(pagePath);
      if (hasProtectedLocalData && page.body !== sourceRef.current) {
        setExternalSource(page.body);
        setStatus("Server source changed while local App data is pending. Choose Update from server or Keep local.");
        return;
      }
      setSource(page.body); setSavedSource(page.body); setRuntimeSource(page.body); await refreshBootstrap();
      loadCountRef.current = 0; setNonce(createAppFrameNonce()); setStopped(false); setExternalSource(null); setStatus("Source reloaded");
    } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  };

  const cacheChosenSource = async () => {
    const snapshot = await fetchAppDataSnapshot(pagePath);
    const stored = await writeMiniAppPackage(snapshot);
    if (stored) {
      packageRef.current = stored;
      setKeptOffline(stored.pinned);
    }
    setBootstrap((current) => current?.page.path === pagePath
      ? { ...current, ...mergePendingSnapshot(snapshot) }
      : current);
  };

  const updateFromServer = async () => {
    setBusy(true);
    try {
      const page = await reloadAppSource(pagePath);
      await cacheChosenSource();
      setSource(page.body);
      setSavedSource(page.body);
      setExternalSource(null);
      setStatus(hasProtectedLocalData
        ? "Server source selected. Pending local data is retained; Reload Preview when ready."
        : "Server source selected; Reload Preview when ready.");
    } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  };

  const keepLocalSource = async () => {
    setBusy(true);
    try {
      const page = await saveAppSource(pagePath, title, source);
      await cacheChosenSource();
      setSource(page.body);
      setSavedSource(page.body);
      setExternalSource(null);
      setStatus("Local source kept. Pending local data is retained and will continue syncing.");
    } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  };

  React.useEffect(() => {
    if (reloadRequestNonce === initialReloadRequestRef.current) return;
    initialReloadRequestRef.current = reloadRequestNonce;
    void reloadSource();
    // reloadSource intentionally owns the unsaved-edit confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadRequestNonce]);

  const toggleEnabled = async () => {
    setBusy(true);
    try {
      const manifest = await setAppEnabled(pagePath, !enabled);
      if (manifest.enabled) {
        await refreshBootstrap();
        loadCountRef.current = 0;
        lastHeartbeatRef.current = Date.now();
        setNonce(createAppFrameNonce());
        setStopped(false);
        setStatus("App enabled with a fresh session");
      } else {
        await refreshBootstrap();
        setStopped(false);
        setStatus("App disabled");
      }
    } catch (error) { setStatus(errorMessage(error)); } finally { setBusy(false); }
  };

  const toggleKeptOffline = async () => {
    setBusy(true);
    try {
      let stored = packageRef.current;
      if (!stored && bootstrap?.sessionToken) {
        if (externalSource !== null && hasProtectedLocalData) {
          throw new Error("Choose Update from server or Keep local before changing offline availability.");
        }
        stored = await writeMiniAppPackage(await fetchAppDataSnapshot(pagePath), { pinned: true });
      } else if (stored) {
        stored = await setMiniAppPackagePinned(pagePath, !keptOffline);
      }
      if (!stored) throw new Error("Open this App online once before keeping it offline.");
      packageRef.current = stored;
      setKeptOffline(stored.pinned);
      setStatus(stored.pinned
        ? "Kept offline on this device. Smart Notes will refresh the package after successful opens."
        : "This App remains in the recent offline set until the device package limit evicts it.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: DevelopTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "preview", label: "Preview", icon: Eye }, { id: "data", label: "Data", icon: Database }, { id: "source", label: "Source", icon: Code2 },
  ];

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
    controls[next]?.click();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="app-page-view">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 [&_button]:min-h-11 xl:[&_button]:min-h-8" data-testid="app-page-header">
        {chromeless
          ? (leading ?? null)
          : onOpenSidebar ? <button onClick={onOpenSidebar} aria-label="Open sidebar" className="flex size-11 items-center justify-center rounded text-muted-foreground hover:bg-surface xl:size-7"><Menu className="size-4" /></button> : null}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title || "Untitled app"}</h1>
        <span
          role="status"
          aria-label={`App package status: ${syncMode === "local" ? "Local" : syncMode === "syncing" ? "Syncing" : "Synced"}`}
          data-testid="app-package-status"
          data-state={syncMode}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted-foreground"
        >
          {syncMode === "local" ? <HardDrive className="size-3.5" /> : syncMode === "syncing" ? <RotateCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {syncMode === "local" ? "Local" : syncMode === "syncing" ? "Syncing" : "Synced"}
        </span>
        <Button
          size="sm"
          variant={keptOffline ? "secondary" : "outline"}
          aria-pressed={keptOffline}
          data-testid="app-keep-offline"
          onClick={() => void toggleKeptOffline()}
          disabled={busy || (!bootstrap && !packageRef.current)}
        >
          <Pin className="size-3.5" />{keptOffline ? "Kept offline" : "Keep offline"}
        </Button>
        {chromeless ? (
          trailing ?? null
        ) : (
          <>
            {externalSource !== null && !hasProtectedLocalData ? <Button size="sm" variant="outline" onClick={() => void updateFromServer()}><RotateCw className="size-3.5" />Update from server</Button> : null}
            <a href={focusedAppUrl(pagePath)} data-testid="app-open-focused" className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground xl:min-h-8"><SquareArrowOutUpRight className="size-3.5" />Open focused app</a>
            <Button size="sm" variant={develop ? "secondary" : "outline"} data-testid="app-develop" onClick={() => setDevelop((value) => !value)}><Wrench className="size-3.5" />Develop</Button>
            <Button size="sm" variant="ghost" onClick={() => setStopped(true)} disabled={stopped || !enabled}><Square className="size-3.5" />Stop</Button>
            <Button size="sm" variant="ghost" onClick={() => void reloadRuntime()} disabled={!enabled || busy}><RotateCw className="size-3.5" />Reload</Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleEnabled()} disabled={busy}><Power className="size-3.5" />{enabled ? "Disable" : "Enable"}</Button>
          </>
        )}
      </header>
      {developerActive ? <nav className="flex items-center gap-1 border-b border-border px-3 py-1" role="tablist" aria-label="Develop workspace" onKeyDown={handleTabKeyDown}>{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} data-testid={`app-tab-${id}`} onClick={() => setTab(id)} className={cn("flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium xl:min-h-9", tab === id ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}</button>)}</nav> : null}
      {status ? <div role="status" className="flex items-center gap-2 border-b border-border bg-surface/50 px-3 py-1.5 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" />{status}</div> : null}
      {pendingMutations > 0 ? <div role="status" data-testid="app-pending-mutations" className="border-b border-border bg-surface/50 px-3 py-1.5 text-xs text-muted-foreground">{pendingMutations} local App change{pendingMutations === 1 ? "" : "s"} waiting to sync. Data is retained by Smart Notes.</div> : null}
      {externalSource !== null && hasProtectedLocalData ? (
        <div role="alert" data-testid="app-source-conflict" className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-muted-foreground [&_button]:min-h-11 xl:[&_button]:min-h-8">
          <span className="min-w-0 flex-1">Server source changed while local App data is pending. Choose which source to keep; local data will not be discarded.</span>
          <Button size="sm" variant="outline" onClick={() => void updateFromServer()} disabled={busy}>Update from server</Button>
          <Button size="sm" variant="outline" onClick={() => void keepLocalSource()} disabled={busy}>Keep local</Button>
        </div>
      ) : null}
      {developerActive && tab === "data" ? (
        bootstrap ? <AppDataView bootstrap={bootstrap} onRefresh={refreshDataSnapshot} pendingCount={pendingMutations} outboxError={outboxError} /> : <div className="p-6 text-sm text-muted-foreground">Loading attached data…</div>
      ) : developerActive && tab === "source" ? (
        <div className="flex min-h-0 flex-1 flex-col [&_button]:min-h-11 xl:[&_button]:min-h-8" data-testid="app-source-workspace">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2"><Button size="sm" onClick={() => void saveSource()} disabled={busy || !dirty}><Save className="size-3.5" />Save</Button><Button size="sm" variant="outline" onClick={() => void reloadSource()} disabled={busy}><RotateCw className="size-3.5" />Reload source</Button><span className="text-xs text-muted-foreground">{dirty ? "Unsaved source edits" : "Source and app data are saved separately"}</span></div>
          <div className="min-h-0 flex-1"><CodeMirrorEditor testId="app-source-editor" value={source} onChange={setSource} className="h-full w-full" /></div>
        </div>
      ) : !bootstrap ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" data-testid="app-bootstrap-required">
          <p>{bootstrapError ?? "Loading authenticated App runtime…"}</p>
          {bootstrapError ? <Button variant="outline" onClick={() => void reloadRuntime()} disabled={busy}><RotateCw className="size-4" />Try again</Button> : null}
        </div>
      ) : navigationApiAvailable !== true ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="app-navigation-guard-required"><AlertTriangle className="size-6 text-muted-foreground" /><p className="max-w-lg text-sm">App Preview is blocked because this browser cannot enforce Navigation API interception. Develop → Data and Source remain available for recovery.</p></div>
      ) : !enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><Power className="size-6 text-muted-foreground" /><p className="text-sm">This app is disabled. Its source and attached data are unchanged.</p><Button onClick={() => void toggleEnabled()}>Enable app</Button></div>
      ) : stopped ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><Square className="size-6 text-muted-foreground" /><p className="text-sm">App runtime stopped. Smart Notes and app data are unaffected.</p><Button onClick={() => void reloadRuntime()} disabled={busy}><Play className="size-4" />Recover and reload</Button></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface/40" data-testid="app-preview">
          <iframe
            key={nonce} ref={iframeRef} title={title || "App page"} srcDoc={srcDoc}
            sandbox="allow-scripts" data-testid="app-page-frame"
            onLoad={() => {
              loadCountRef.current += 1;
              if (loadCountRef.current > 1) {
                setStatus("App navigation was reset to its saved source");
                void reloadRuntime();
              }
            }}
            style={{ display: "block", width: "100%", height: `${frameHeight}px`, border: 0, background: "transparent" }}
          />
        </div>
      )}
    </div>
  );
}

export default AppPageView;

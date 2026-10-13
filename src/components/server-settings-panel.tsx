"use client";

import * as React from "react";
import { Play, RotateCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ServerStatus = {
  status: "running" | "stopped" | "starting" | "stopping";
  address: string;
  reachable: boolean;
  pid: number | null;
  uptimeSeconds: number | null;
  build: string | null;
  log: string;
  supervised?: boolean;
  controlPort?: number | null;
  error?: string;
};

type ServerAction = "start" | "stop" | "restart";

const CONTROL_PORT_KEY = "smart-notes:server-control-port";

/**
 * SN-301: the supervisor (gateway-start.js) listens on app port + 8 unless
 * SMART_NOTES_CONTROL_PORT overrides it; the app reports the real port, which
 * is cached so Start still works after the app server is stopped.
 */
function controlPortKey() {
  return `${CONTROL_PORT_KEY}:${window.location.port}`;
}

function supervisorUrl() {
  if (typeof window === "undefined" || window.location.protocol !== "http:" || !window.location.port) return null;
  const cached = Number(window.localStorage.getItem(controlPortKey()));
  const port = cached || Number(window.location.port) + 8;
  return `http://${window.location.hostname}:${port}`;
}

function rememberControlPort(port: number | null | undefined) {
  if (!port || typeof window === "undefined") return;
  window.localStorage.setItem(controlPortKey(), String(port));
}

function formatUptime(seconds: number | null) {
  if (seconds === null) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours ? `${hours}h ` : ""}${minutes}m ${remainder}s`;
}

async function readSupervisor(): Promise<ServerStatus | null> {
  const base = supervisorUrl();
  if (!base) return null;
  try {
    const response = await fetch(`${base}/status`, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function ServerSettingsPanel() {
  const [server, setServer] = React.useState<ServerStatus | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<ServerAction | null>(null);
  const [logOpen, setLogOpen] = React.useState(false);
  const [supervised, setSupervised] = React.useState(false);

  const refresh = React.useCallback(async () => {
    let appStatus: ServerStatus | null = null;
    let supervisor = await readSupervisor();
    if (!supervisor) {
      try {
        const response = await fetch("/api/server/status", { cache: "no-store" });
        if (response.ok) appStatus = await response.json();
      } catch {
        // The app server is down and no supervisor answered.
      }
      if (appStatus?.controlPort) {
        rememberControlPort(appStatus.controlPort);
        supervisor = await readSupervisor();
      }
    }
    if (supervisor) {
      setServer(supervisor);
      setSupervised(true);
      setNotice(null);
      return;
    }
    setSupervised(false);
    if (appStatus) {
      setServer(appStatus);
      setNotice("Start, Stop, and Restart need the Smart Notes supervisor (gateway-start.js). This server was started without it.");
    } else {
      setServer((current) => ({
        status: "stopped",
        address: current?.address ?? "http://localhost:3002",
        reachable: false,
        pid: null,
        uptimeSeconds: null,
        build: current?.build ?? null,
        log: current?.log ?? "",
      }));
      setNotice("The server and its supervisor are not reachable. Start Smart Notes from its launcher.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (action: ServerAction) => {
    const base = supervisorUrl();
    if (!base || !supervised) return;
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch(`${base}/${action}`, { method: "POST" });
      const result: ServerStatus = await response.json();
      setServer(result);
      if (!response.ok) setNotice(result.error || `Could not ${action} the server.`);
    } catch {
      setNotice(`Could not ${action} the server.`);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const phase = busy === "stop" ? "stopping" : busy ? "starting" : server?.status;
  const stateLabel = phase === "starting" ? "Starting…" : phase === "stopping" ? "Stopping…" : phase === "running" ? "Running" : server ? "Stopped" : "Checking…";
  const running = server?.status === "running";
  const pending = busy !== null || server?.status === "starting" || server?.status === "stopping";

  return (
    <div className="space-y-6 pt-1" data-testid="server-settings-panel">
      <section aria-labelledby="server-app-heading">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id="server-app-heading" className="text-[10px] font-normal uppercase tracking-[0.16em] text-muted-foreground">App server</h3>
          <span
            role="status"
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.08em]",
              phase === "running"
                ? "border-[color:var(--accent)] bg-[color:var(--accent)]/12 text-foreground"
                : phase === "starting" || phase === "stopping"
                  ? "border-border bg-muted/40 text-foreground"
                  : "border-border bg-transparent text-muted-foreground"
            )}
            data-testid="server-status-pill"
          >
            {stateLabel}
          </span>
        </div>
        <div className="rounded-md border border-border/80 bg-muted/10 p-3">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm max-[380px]:grid-cols-[5.5rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="break-all font-mono text-foreground">{server?.address ?? "http://localhost:3002"}</dd>
            <dt className="text-muted-foreground">Reachable</dt>
            <dd className="text-foreground">{server ? (server.reachable ? "Yes" : "No") : "—"}</dd>
            <dt className="text-muted-foreground">Process</dt>
            <dd className="font-mono text-foreground">{server?.pid ?? "—"}</dd>
            <dt className="text-muted-foreground">Uptime</dt>
            <dd className="text-foreground">{formatUptime(server?.uptimeSeconds ?? null)}</dd>
            <dt className="text-muted-foreground">Build</dt>
            <dd className="break-all font-mono text-foreground">{server?.build ?? "—"}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => void act("start")} disabled={!supervised || running || pending} data-testid="server-start">
              <Play />Start
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void act("stop")} disabled={!supervised || !running || pending} data-testid="server-stop">
              <Square />Stop
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void act("restart")} disabled={!supervised || !running || pending} data-testid="server-restart">
              <RotateCw />Restart
            </Button>
          </div>
        </div>
        {notice && <p className="mt-2 text-xs text-muted-foreground" data-testid="server-notice">{notice}</p>}
      </section>

      <section aria-labelledby="server-offline-heading">
        <h3 id="server-offline-heading" className="mb-2 text-[10px] font-normal uppercase tracking-[0.16em] text-muted-foreground">Offline edits</h3>
        <p className="text-sm text-foreground">All edits are synced to the vault on disk.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Before an offline edit is written, the server copy is saved to the page&apos;s version history. Creating, moving, or deleting pages needs the server.
        </p>
      </section>

      <section className="-mt-3">
        <button
          type="button"
          aria-expanded={logOpen}
          aria-controls="recent-server-log"
          onClick={() => setLogOpen((value) => !value)}
          className="flex min-h-11 items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          data-testid="server-log-toggle"
        >
          {/* globals.css gives buttons `font: inherit`, so size the label on a span. */}
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]">
            <span aria-hidden className={cn("inline-block transition-transform", logOpen && "rotate-90")}>▸</span>
            Recent server log
          </span>
        </button>
        {logOpen && (
          <pre
            id="recent-server-log"
            className="max-h-48 overflow-auto rounded-md border border-border/80 bg-muted/10 p-3 font-mono text-xs whitespace-pre-wrap break-all text-foreground"
            data-testid="server-log"
          >
            {server?.log || (supervised ? "No recent server output." : "The server log is available when Smart Notes runs under its supervisor.")}
          </pre>
        )}
      </section>
    </div>
  );
}

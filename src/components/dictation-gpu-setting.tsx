"use client";

/**
 * Settings switch for dictation GPU acceleration. PC-wide (stored on the
 * server, unlike the per-device dictation settings): off stops the GPU speech
 * engine to free VRAM and dictation uses the CPU engine; on restarts it.
 * Hidden when the host has no GPU engine configured.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

interface EngineStatus {
  gpuAvailable: boolean;
  gpuAcceleration: boolean;
  gpuEngine: "running" | "stopped";
  controlError?: string;
}

function statusText(status: EngineStatus): string {
  if (!status.gpuAcceleration) {
    return status.gpuEngine === "running" ? "Stopping the GPU engine…" : "Off: GPU engine stopped, dictation uses the CPU engine.";
  }
  return status.gpuEngine === "running"
    ? "On: GPU engine running."
    : "Starting the GPU engine (about a minute); dictation uses the CPU engine meanwhile.";
}

export function DictationGpuSetting({ open }: { open: boolean }) {
  const [status, setStatus] = React.useState<EngineStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/speech/engine", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as EngineStatus);
    } catch {
      /* offline: keep the last known status */
    }
  }, []);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // While the engine is moving toward the chosen state, re-check periodically.
  const settling = Boolean(
    status && (status.gpuAcceleration ? status.gpuEngine !== "running" : status.gpuEngine !== "stopped")
  );
  React.useEffect(() => {
    if (!open || !settling) return;
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [open, settling, refresh]);

  if (!status?.gpuAvailable) return null;

  const enabled = status.gpuAcceleration;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/speech/engine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpuAcceleration: !enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<EngineStatus> & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not change GPU acceleration.");
        return;
      }
      setStatus(payload as EngineStatus);
      if (payload.controlError) setError(payload.controlError);
    } catch {
      setError("Could not reach Smart Notes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="settings-dictation-gpu">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Dictation GPU acceleration</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Dictation GPU acceleration"
          data-testid="settings-dictation-gpu-toggle"
          disabled={busy}
          onClick={() => void toggle()}
          className={cn(
            "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-60",
            enabled ? "border-[color:var(--accent)] bg-[color:var(--accent)]" : "border-border bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-background shadow transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="settings-dictation-gpu-status">
        {statusText(status)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Transcribes on the PC&apos;s graphics card, about 8× faster. Turn off to free its memory for other GPU work. Applies to all devices.
      </p>
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert" data-testid="settings-dictation-gpu-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

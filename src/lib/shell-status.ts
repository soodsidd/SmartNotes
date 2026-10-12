/**
 * SN-289: one compact, text-bearing summary of the shell's save / sync / reload
 * state for phone chrome. Desktop keeps the separate sync and save chips; phones
 * get a single chip whose short label stays readable without relying on the
 * socket icon alone.
 */

export type ShellStatusTone = "ok" | "pending" | "attention" | "error";

export type ShellStatusSummary = {
  tone: ShellStatusTone;
  /** One or two words that fit beside the page title at phone width. */
  shortLabel: string;
  /** Full sentence for screen readers and the tooltip. */
  label: string;
};

export function getShellStatusSummary(input: {
  connectionLost: boolean;
  connectionMessage?: string | null;
  syncConnectionState: "connected" | "connecting" | "disconnected";
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
  saveLabel: string;
  hasPendingPageReload: boolean;
  hasPendingVaultReload: boolean;
  isViewingVersion: boolean;
}): ShellStatusSummary {
  if (input.connectionLost) {
    return {
      tone: "error",
      shortLabel: "Not saved",
      label: input.connectionMessage || "Write failed — changes are not saved",
    };
  }
  if (input.saveState === "error") {
    return { tone: "error", shortLabel: "Save failed", label: input.saveLabel || "Save failed" };
  }
  if (input.syncConnectionState === "disconnected") {
    return { tone: "error", shortLabel: "Offline", label: `Disconnected · ${input.saveLabel}` };
  }
  if (input.saveState === "saving") {
    return { tone: "pending", shortLabel: "Saving…", label: input.saveLabel };
  }
  if (input.saveState === "dirty") {
    return { tone: "pending", shortLabel: "Unsaved", label: input.saveLabel };
  }
  if (input.syncConnectionState === "connecting") {
    return { tone: "pending", shortLabel: "Connecting", label: `Connecting · ${input.saveLabel}` };
  }
  if (input.isViewingVersion) {
    return { tone: "attention", shortLabel: "Old version", label: input.saveLabel };
  }
  if (input.hasPendingPageReload || input.hasPendingVaultReload) {
    return { tone: "attention", shortLabel: "Update ready", label: input.saveLabel };
  }
  return { tone: "ok", shortLabel: "Saved", label: `Connected · ${input.saveLabel}` };
}

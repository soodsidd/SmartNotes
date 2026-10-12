/**
 * @jest-environment node
 */

import { getShellStatusSummary } from "@/lib/shell-status";

const base = {
  connectionLost: false,
  connectionMessage: null as string | null,
  syncConnectionState: "connected" as const,
  saveState: "saved" as const,
  saveLabel: "Saved",
  hasPendingPageReload: false,
  hasPendingVaultReload: false,
  isViewingVersion: false,
};

describe("getShellStatusSummary (SN-289)", () => {
  it("surfaces connection loss with a short readable label", () => {
    const summary = getShellStatusSummary({
      ...base,
      connectionLost: true,
      connectionMessage: "Write failed — changes may not be saving",
    });
    expect(summary.tone).toBe("error");
    expect(summary.shortLabel).toBe("Not saved");
    expect(summary.label).toContain("Write failed");
  });

  it("prefers save errors and offline over idle saved state", () => {
    expect(
      getShellStatusSummary({ ...base, saveState: "error", saveLabel: "Save failed" }).shortLabel
    ).toBe("Save failed");
    expect(
      getShellStatusSummary({
        ...base,
        syncConnectionState: "disconnected",
        saveLabel: "Saved just now",
      }).shortLabel
    ).toBe("Offline");
  });

  it("keeps pending dirty/saving state legible without icon-only chrome", () => {
    expect(getShellStatusSummary({ ...base, saveState: "dirty", saveLabel: "Unsaved changes" })).toEqual(
      expect.objectContaining({ tone: "pending", shortLabel: "Unsaved" })
    );
    expect(getShellStatusSummary({ ...base, saveState: "saving", saveLabel: "Saving…" })).toEqual(
      expect.objectContaining({ tone: "pending", shortLabel: "Saving…" })
    );
  });

  it("flags remote updates and old-version viewing as attention", () => {
    expect(
      getShellStatusSummary({ ...base, hasPendingPageReload: true }).shortLabel
    ).toBe("Update ready");
    expect(
      getShellStatusSummary({ ...base, isViewingVersion: true, saveLabel: "Viewing older version" })
        .shortLabel
    ).toBe("Old version");
  });

  it("returns a short Saved label when everything is healthy", () => {
    expect(getShellStatusSummary(base)).toEqual(
      expect.objectContaining({ tone: "ok", shortLabel: "Saved" })
    );
  });
});

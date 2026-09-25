/**
 * @jest-environment node
 *
 * Targeted unit tests for the reload-guard drain registry and the dirty-state
 * guard behaviour introduced by the SN-85 reviewer fix.
 *
 * These tests exercise:
 *  - drainBeforeReload() with zero / one / multiple drains
 *  - successful flush → reload proceeds
 *  - failed flush → user confirm gate (proceed or cancel)
 *  - drain deregistration (cleanup)
 */

import {
  drainBeforeReload,
  registerReloadDrain,
  __resetReloadGuardForTests,
} from "@/lib/reload-guard";
import { readFileSync } from "fs";
import { join } from "path";

describe("reload-guard drain registry (SN-85 reviewer fix)", () => {
  beforeEach(() => {
    __resetReloadGuardForTests();
  });

  // ── drainBeforeReload ────────────────────────────────────────────────────────

  it("resolves ok:true when no drains are registered", async () => {
    const result = await drainBeforeReload();
    expect(result).toEqual({ ok: true, errorMessage: null });
  });

  it("resolves ok:true and calls the drain when one drain resolves", async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    registerReloadDrain(drain);

    const result = await drainBeforeReload();

    expect(result).toEqual({ ok: true, errorMessage: null });
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("resolves ok:false with the error message when a drain throws an Error", async () => {
    registerReloadDrain(() => Promise.reject(new Error("Network error")));

    const result = await drainBeforeReload();

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Network error");
  });

  it("resolves ok:false with a fallback message when drain throws a non-Error", async () => {
    registerReloadDrain(() => Promise.reject("string-reason"));

    const result = await drainBeforeReload();

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Failed to save changes.");
  });

  it("runs all drains even when one fails and surfaces the first rejection", async () => {
    const drain1 = jest.fn().mockResolvedValue(undefined);
    const drain2 = jest.fn().mockRejectedValue(new Error("Save failed"));
    registerReloadDrain(drain1);
    registerReloadDrain(drain2);

    const result = await drainBeforeReload();

    expect(drain1).toHaveBeenCalled();
    expect(drain2).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Save failed");
  });

  it("deregistered drain is not called after cleanup", async () => {
    const drain = jest.fn().mockResolvedValue(undefined);
    const cleanup = registerReloadDrain(drain);
    cleanup();

    await drainBeforeReload();

    expect(drain).not.toHaveBeenCalled();
  });

  // ── triggerForceReload dirty-state guard ─────────────────────────────────────

  it("reloads immediately when there are no drains (no navigator)", async () => {
    // Import sw-update here to keep the navigator mock contained in this test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { triggerForceReload } = require("@/lib/sw-update") as typeof import("@/lib/sw-update");

    const reload = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = { location: { reload }, confirm: jest.fn() };

    await triggerForceReload();

    expect(reload).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window;
  });

  it("reloads after a successful drain without showing a confirm", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { triggerForceReload } = require("@/lib/sw-update") as typeof import("@/lib/sw-update");

    const drain = jest.fn().mockResolvedValue(undefined);
    registerReloadDrain(drain);

    const reload = jest.fn();
    const confirm = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = { location: { reload }, confirm };

    await triggerForceReload();

    expect(drain).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window;
  });

  it("shows a confirm and reloads when drain fails and user confirms", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { triggerForceReload } = require("@/lib/sw-update") as typeof import("@/lib/sw-update");

    registerReloadDrain(() => Promise.reject(new Error("Server unreachable")));

    const reload = jest.fn();
    const confirm = jest.fn().mockReturnValue(true); // user taps OK
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = { location: { reload }, confirm };

    await triggerForceReload();

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Server unreachable")
    );
    expect(reload).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window;
  });

  it("aborts the reload when drain fails and user cancels the confirm", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { triggerForceReload } = require("@/lib/sw-update") as typeof import("@/lib/sw-update");

    registerReloadDrain(() => Promise.reject(new Error("Offline")));

    const reload = jest.fn();
    const confirm = jest.fn().mockReturnValue(false); // user taps Cancel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).window = { location: { reload }, confirm };

    await triggerForceReload();

    expect(confirm).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled(); // reload must be blocked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).window;
  });
});

describe("notebook shell reload drain registration", () => {
  it("registers the reload drain once and calls the latest flushSave through a ref", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );

    expect(source).toContain("const flushSaveRef = React.useRef<() => Promise<boolean>>(async () => true);");
    expect(source).toContain("flushSaveRef.current = flushSave;");
    expect(source).toContain("const saved = await flushSaveRef.current();");
    expect(source).toMatch(/return registerReloadDrain\(drain\);\s*}, \[\]\);/);
  });
});

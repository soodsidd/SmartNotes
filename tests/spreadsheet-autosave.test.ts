import { createSpreadsheetAutosaveController } from "@/lib/spreadsheet-autosave";

describe("spreadsheet autosave", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("debounces repeated workbook actions into one save", async () => {
    const save = jest.fn(async () => undefined);
    const controller = createSpreadsheetAutosaveController({ delayMs: 800, save });

    controller.markDirty();
    jest.advanceTimersByTime(400);
    controller.markDirty();
    jest.advanceTimersByTime(799);
    expect(save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("flushes immediately and preserves dirty state after a failed save", async () => {
    const save = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const controller = createSpreadsheetAutosaveController({ delayMs: 800, save });

    controller.markDirty();
    await expect(controller.flush()).rejects.toThrow("offline");
    expect(controller.isDirty()).toBe(true);
    await expect(controller.flush()).resolves.toBeUndefined();
    expect(controller.isDirty()).toBe(false);
    expect(controller.hasPendingWork()).toBe(false);
  });

  it("reports pending work while a save is in flight", async () => {
    let resolveSave: (() => void) | undefined;
    const save = jest.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    const controller = createSpreadsheetAutosaveController({ delayMs: 800, save });

    controller.markDirty();
    const flush = controller.flush();
    expect(controller.hasPendingWork()).toBe(true);

    resolveSave?.();
    await flush;
    expect(controller.hasPendingWork()).toBe(false);
  });

  it("pauses an armed autosave for an external workbook update until local changes are discarded", async () => {
    const save = jest.fn(async () => undefined);
    const controller = createSpreadsheetAutosaveController({ delayMs: 800, save });

    controller.markDirty();
    controller.pauseForExternalUpdate();
    expect(controller.isPaused()).toBe(true);
    expect(controller.hasPendingWork()).toBe(true);

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled();
    await controller.flush();
    expect(save).not.toHaveBeenCalled();

    controller.discardPendingChanges();
    expect(controller.isPaused()).toBe(false);
    expect(controller.hasPendingWork()).toBe(false);
  });
});

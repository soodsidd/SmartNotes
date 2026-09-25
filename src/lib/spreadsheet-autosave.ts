export interface SpreadsheetAutosaveController {
  markDirty: () => void;
  flush: () => Promise<void>;
  pauseForExternalUpdate: () => void;
  discardPendingChanges: () => void;
  dispose: () => void;
  isDirty: () => boolean;
  hasPendingWork: () => boolean;
  isPaused: () => boolean;
}

export function createSpreadsheetAutosaveController(options: {
  delayMs: number;
  save: () => Promise<void>;
}): SpreadsheetAutosaveController {
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let pausedForExternalUpdate = false;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = async (): Promise<void> => {
    clearTimer();
    if (pausedForExternalUpdate) return;
    if (saving) {
      await saving;
      if (dirty) await flush();
      return;
    }
    if (!dirty) return;

    dirty = false;
    const pending = options.save();
    saving = pending;
    try {
      await pending;
    } catch (error) {
      dirty = true;
      throw error;
    } finally {
      saving = null;
    }
    if (dirty) await flush();
  };

  return {
    markDirty() {
      dirty = true;
      clearTimer();
      if (pausedForExternalUpdate) return;
      timer = setTimeout(() => {
        void flush().catch(() => undefined);
      }, options.delayMs);
    },
    flush,
    pauseForExternalUpdate() {
      pausedForExternalUpdate = true;
      clearTimer();
    },
    discardPendingChanges() {
      clearTimer();
      dirty = false;
      pausedForExternalUpdate = false;
    },
    dispose() {
      clearTimer();
    },
    isDirty() {
      return dirty;
    },
    hasPendingWork() {
      return dirty || saving !== null;
    },
    isPaused() {
      return pausedForExternalUpdate;
    },
  };
}

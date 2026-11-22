/** @jest-environment jsdom */

import {
  changeInkEngine,
  INK_ENGINE_STORAGE_KEY,
  isInkEngineAvailable,
  readInkEngine,
} from "@/lib/ink-engine-preference";

beforeEach(() => localStorage.clear());

test("defaults to tldraw and accepts the device-local override used by test fixtures", () => {
  expect(readInkEngine()).toBe("tldraw");
  localStorage.setItem(INK_ENGINE_STORAGE_KEY, "unknown-engine");
  expect(readInkEngine()).toBe("tldraw");
  localStorage.setItem(INK_ENGINE_STORAGE_KEY, "tldraw");
  expect(readInkEngine()).toBe("tldraw");
});

test("keeps Smart Notes ink unavailable without replacing a stored preference", async () => {
  localStorage.setItem(INK_ENGINE_STORAGE_KEY, "smart-notes");
  const flush = jest.fn();

  expect(isInkEngineAvailable("smart-notes")).toBe(false);
  expect(readInkEngine()).toBe("tldraw");
  await expect(changeInkEngine("tldraw", "smart-notes", flush)).resolves.toBe("tldraw");
  expect(flush).not.toHaveBeenCalled();
  expect(localStorage.getItem(INK_ENGINE_STORAGE_KEY)).toBe("smart-notes");
});

test("persists an available selection after flushing the outgoing engine", async () => {
  // Model a switch from a previous engine without enabling that engine's renderer.
  let finishFlush!: () => void;
  const flush = jest.fn(() => new Promise<void>((resolve) => { finishFlush = resolve; }));
  const switching = changeInkEngine("smart-notes", "tldraw", flush);

  expect(flush).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(INK_ENGINE_STORAGE_KEY)).toBeNull();
  finishFlush();
  await expect(switching).resolves.toBe("tldraw");
  expect(localStorage.getItem(INK_ENGINE_STORAGE_KEY)).toBe("tldraw");
  expect(readInkEngine()).toBe("tldraw");
});

test("leaves the preference alone if pending ink fails to save", async () => {
  localStorage.setItem(INK_ENGINE_STORAGE_KEY, "smart-notes");
  const flush = jest.fn().mockRejectedValue(new Error("offline"));

  await expect(changeInkEngine("smart-notes", "tldraw", flush)).rejects.toThrow("offline");
  expect(localStorage.getItem(INK_ENGINE_STORAGE_KEY)).toBe("smart-notes");
});

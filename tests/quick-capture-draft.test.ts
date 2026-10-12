import {
  QUICK_CAPTURE_DRAFT_KEY,
  clearQuickCaptureDraft,
  readQuickCaptureDraft,
  writeQuickCaptureDraft,
  type QuickCaptureDraft,
} from "@/lib/quick-capture-draft";

const draft: QuickCaptureDraft = {
  captureId: "85370c2a-fbb4-4ed5-96a8-c2ca297df013",
  destination: "page",
  title: "Unfinished thought",
  content: "Keep this text",
  notebookPath: "Notebook",
  sectionPath: "Notebook/Section",
};

it("retains the full unfinished capture across close and reload until explicit discard", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };

  writeQuickCaptureDraft(storage, draft);
  expect(readQuickCaptureDraft(storage)).toEqual(draft);
  expect(entries.has(QUICK_CAPTURE_DRAFT_KEY)).toBe(true);

  clearQuickCaptureDraft(storage);
  expect(readQuickCaptureDraft(storage)).toBeNull();
});

it("ignores corrupt stored drafts", () => {
  expect(readQuickCaptureDraft({ getItem: () => "{bad json" })).toBeNull();
  expect(readQuickCaptureDraft({ getItem: () => JSON.stringify({ ...draft, captureId: "invalid" }) })).toBeNull();
});

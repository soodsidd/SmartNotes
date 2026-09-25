const CLOSED_NOTEBOOKS_STORAGE_KEY = "smart-notes-closed-notebooks";

function loadClosedNotebooks(storage: Storage): Set<string> {
  try {
    const raw = storage.getItem(CLOSED_NOTEBOOKS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore malformed data
  }
  return new Set();
}

function saveClosedNotebooks(storage: Storage, notebooks: Set<string>): void {
  storage.setItem(CLOSED_NOTEBOOKS_STORAGE_KEY, JSON.stringify([...notebooks]));
}

function closeNotebook(storage: Storage, path: string): Set<string> {
  const current = loadClosedNotebooks(storage);
  current.add(path);
  saveClosedNotebooks(storage, current);
  return current;
}

function openNotebook(storage: Storage, path: string): Set<string> {
  const current = loadClosedNotebooks(storage);
  current.delete(path);
  saveClosedNotebooks(storage, current);
  return current;
}

describe("closed notebooks localStorage persistence", () => {
  let storage: Map<string, string>;
  let mockStorage: Storage;

  beforeEach(() => {
    storage = new Map();
    mockStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
      key: () => null,
      length: 0,
    };
  });

  it("returns an empty set when localStorage has no entry", () => {
    const result = loadClosedNotebooks(mockStorage);
    expect(result.size).toBe(0);
  });

  it("closes a notebook and persists it", () => {
    closeNotebook(mockStorage, "Research");
    const result = loadClosedNotebooks(mockStorage);
    expect(result.has("Research")).toBe(true);
  });

  it("closed state survives a simulated page refresh (re-read from storage)", () => {
    closeNotebook(mockStorage, "Research");
    // Simulate new component mount — read from the same storage
    const afterRefresh = loadClosedNotebooks(mockStorage);
    expect(afterRefresh.has("Research")).toBe(true);
  });

  it("opens a closed notebook and removes it from storage", () => {
    closeNotebook(mockStorage, "Research");
    openNotebook(mockStorage, "Research");
    const result = loadClosedNotebooks(mockStorage);
    expect(result.has("Research")).toBe(false);
  });

  it("handles multiple notebooks independently", () => {
    closeNotebook(mockStorage, "Research");
    closeNotebook(mockStorage, "Personal");
    const afterClose = loadClosedNotebooks(mockStorage);
    expect(afterClose.has("Research")).toBe(true);
    expect(afterClose.has("Personal")).toBe(true);

    openNotebook(mockStorage, "Research");
    const afterOpen = loadClosedNotebooks(mockStorage);
    expect(afterOpen.has("Research")).toBe(false);
    expect(afterOpen.has("Personal")).toBe(true);
  });

  it("returns an empty set when localStorage contains malformed JSON", () => {
    mockStorage.setItem(CLOSED_NOTEBOOKS_STORAGE_KEY, "not-valid-json{{");
    const result = loadClosedNotebooks(mockStorage);
    expect(result.size).toBe(0);
  });
});

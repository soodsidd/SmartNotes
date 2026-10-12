export const QUICK_CAPTURE_DRAFT_KEY = "smart-notes-quick-capture-draft-v1";

export interface QuickCaptureDraft {
  captureId: string;
  destination: "inbox" | "page";
  title: string;
  content: string;
  notebookPath: string;
  sectionPath: string;
}

export function readQuickCaptureDraft(storage: Pick<Storage, "getItem">): QuickCaptureDraft | null {
  try {
    const raw = storage.getItem(QUICK_CAPTURE_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<QuickCaptureDraft>;
    if (
      typeof draft.captureId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.captureId) ||
      (draft.destination !== "inbox" && draft.destination !== "page") ||
      typeof draft.title !== "string" ||
      typeof draft.content !== "string" ||
      typeof draft.notebookPath !== "string" ||
      typeof draft.sectionPath !== "string"
    ) return null;
    return draft as QuickCaptureDraft;
  } catch {
    return null;
  }
}

export function writeQuickCaptureDraft(storage: Pick<Storage, "setItem">, draft: QuickCaptureDraft): void {
  try {
    storage.setItem(QUICK_CAPTURE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // The in-memory draft remains available when browser storage is blocked.
  }
}

export function clearQuickCaptureDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(QUICK_CAPTURE_DRAFT_KEY);
  } catch {
    // The in-memory draft is still cleared by the caller.
  }
}

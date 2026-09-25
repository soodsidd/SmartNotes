import { applyKeyNoteFlag, isKeyNoteFlag, isPageKeyNote, keyNoteMenuLabel } from "@/lib/key-note";

describe("key note helper", () => {
  it("treats only boolean true as a key note", () => {
    expect(isKeyNoteFlag(true)).toBe(true);
    expect(isKeyNoteFlag(false)).toBe(false);
    expect(isKeyNoteFlag("true")).toBe(false);
    expect(isKeyNoteFlag(1)).toBe(false);
    expect(isKeyNoteFlag(undefined)).toBe(false);
  });

  it("reads the first-class flag or metadata fallback", () => {
    expect(isPageKeyNote({ keyNote: true })).toBe(true);
    expect(isPageKeyNote({ keyNote: false, metadata: { key_note: true } })).toBe(true);
    expect(isPageKeyNote({ metadata: { key_note: true } })).toBe(true);
    expect(isPageKeyNote({ keyNote: false, metadata: {} })).toBe(false);
  });

  it("omits the metadata key when unmarked", () => {
    expect(applyKeyNoteFlag({ title: "Plan", key_note: true }, false)).toEqual({ title: "Plan" });
    expect(applyKeyNoteFlag({ title: "Plan" }, true)).toEqual({ title: "Plan", key_note: true });
  });

  it("labels the page menu for mark and unmark", () => {
    expect(keyNoteMenuLabel(false)).toBe("Mark as key note");
    expect(keyNoteMenuLabel(true)).toBe("Unmark key note");
  });
});

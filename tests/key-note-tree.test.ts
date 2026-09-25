import fs from "node:fs";
import path from "node:path";

describe("key-note tree chrome (SN-229)", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("renders a Lucide gem beside the page title without replacing the type icon", () => {
    expect(source).toContain('import { isPageKeyNote, keyNoteMenuLabel } from "@/lib/key-note"');
    expect(source).toContain("Gem");
    expect(source).toContain('aria-label="Key note"');
    expect(source).toContain("page-key-note-gem-${node.page.path}");
    expect(source).toContain("FileText");
    expect(source).toContain("ClipboardList");
    expect(source).toContain("PenLine");
  });

  it("exposes Mark as key note / Unmark key note on the page overflow menu", () => {
    expect(source).toContain("page-key-note-${node.page.path}");
    expect(source).toContain("keyNoteMenuLabel(isPageKeyNote(node.page))");
    expect(source).toContain('action: "keyNote"');
    expect(source).toContain("onSetPageKeyNote");
    expect(source).toContain("handleSidebarSetPageKeyNote");
    expect(source).not.toContain("onSetPageKeyNote(node.page.path, !isPageKeyNote(node.page)).catch(() => {})");
    expect(source).toContain('toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.")');
  });

  it("uses the documented accent token for the gem", () => {
    expect(source).toContain('className="size-3 shrink-0 text-accent"');
    expect(source).toContain("page-key-note-gem-${node.page.path}");
  });
});

import fs from "node:fs";
import path from "node:path";

describe("SN-53 navigation tree performance wiring", () => {
  const shellSrc = fs.readFileSync(
    path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
    "utf8"
  );

  it("memoizes sidebar rendering and page-tree derivation", () => {
    expect(shellSrc).toContain("const Sidebar = React.memo(function Sidebar");
    expect(shellSrc).toContain("const pageRowsBySection = React.useMemo(() => {");
    expect(shellSrc).toContain("buildPageNestingActionLookup(flatNodes)");
  });

  it("does not eagerly fetch full page metadata during page selection", () => {
    const applySelectionBlock = shellSrc.match(
      /const applySelection = React\.useCallback\(\s*\(selection: TreeSelection\) => \{[\s\S]*?\n\s*\},\s*\n\s*\[hydrateDraft\]\s*\n\s*\);/
    );

    expect(applySelectionBlock?.[0]).toContain("hydrateDraft(selection.page ? draftFromTreePage(selection) : null);");
    expect(applySelectionBlock?.[0]).not.toContain("fetchVaultPage(");
  });

  it("paints sidebar selection before background save and editor swap", () => {
    const openPageBlock = shellSrc.match(
      /const openPage = React\.useCallback\(\s*async \(pagePath: string\) => \{[\s\S]*?\n\s*\},\s*\n\s*\[[^\]]*\]\s*\);/
    )?.[0];

    expect(openPageBlock).toBeDefined();
    expect(openPageBlock!.indexOf("applySelection(selection);")).toBeGreaterThan(-1);
    expect(openPageBlock!.indexOf("void (async () => {")).toBeGreaterThan(-1);
    expect(openPageBlock!.indexOf("applySelection(selection);")).toBeLessThan(
      openPageBlock!.indexOf("void (async () => {")
    );

    const editorPanelBlock = shellSrc.match(/function EditorPanel\([\s\S]*?\nfunction EmptyState/)?.[0];
    expect(editorPanelBlock).toContain("editorRef.current?.swapContent(swapPlan.html);");
    // Only the opening tag — later siblings (e.g. ImmersivePdfReader) may use key=.
    expect(editorPanelBlock).not.toMatch(/<RichTextEditor\b[^>]*\bkey=\{/);
    expect(editorPanelBlock).not.toMatch(/<AnnotationLayer\b[^>]*\bkey=\{/);
  });
});

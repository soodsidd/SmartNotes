/**
 * @jest-environment node
 *
 * SN-193 — ordinary PDF reading must expose EmbedPDF's selection interaction
 * without taking native finger navigation away from touch users.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldPreservePdfFingerNavigation } from "@/lib/pdf-reader-interaction";

const READER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/components/immersive-pdf-reader.tsx"),
  "utf8"
);

describe("PDF read-mode text selection (SN-193)", () => {
  test("mounts selection inside an unconditional page pointer provider", () => {
    expect(READER_SOURCE).toContain(
      "createPluginRegistration(SelectionPluginPackage)"
    );
    expect(READER_SOURCE).toMatch(
      /const pageLayers = \([\s\S]*?<SelectionLayer[\s\S]*?\);\s*[\s\S]*?return \(\s*<PagePointerProvider/
    );
    expect(READER_SOURCE).toMatch(
      /<PagePointerProvider[\s\S]*?>\s*\{pageLayers\}\s*<\/PagePointerProvider>/
    );
    expect(READER_SOURCE).not.toContain("needsPointerProvider");
  });

  test("registers read mode as non-raw touch so the provider permits browser pan and pinch", () => {
    expect(READER_SOURCE).toMatch(
      /\{ id: "pointerMode", exclusive: false \}[\s\S]*?wantsRawTouch: false/
    );
  });

  test("routes the standard copy event through EmbedPDF's virtual text selection", () => {
    expect(READER_SOURCE).toContain('document.addEventListener("copy", handleCopy)');
    expect(READER_SOURCE).toContain("selection.getBoundingRects(documentId)");
    expect(READER_SOURCE).toContain("selection.copyToClipboard(documentId)");
  });

  test("keeps a selected range through secondary-click menu opening", () => {
    expect(READER_SOURCE).toMatch(
      /event\.button === 2 && selection\?\.getBoundingRects\(documentId\)\.length[\s\S]*?event\.nativeEvent\.stopImmediatePropagation\(\)/
    );
    expect(READER_SOURCE).toContain("onPointerDownCapture={preserveFingerNavigation}");
  });

  test("captures selected PDF text before asynchronous page extraction and never falls back to page text", () => {
    expect(READER_SOURCE).toMatch(
      /const hasSelection = Boolean\(selection\?\.getBoundingRects\(documentId\)\.length\);[\s\S]*?const selectedTextTask = hasSelection \? selection\?\.getSelectedText\(documentId\)\.toPromise\(\) : null;[\s\S]*?await Promise\.all/
    );
    expect(READER_SOURCE).toContain('target: hasSelection ? "Selection" : "PDF page"');
    expect(READER_SOURCE).toContain("text: hasSelection ? text : pageText.slice(0, 16000)");
    expect(READER_SOURCE).toContain("if (revision !== selectionRevisionRef.current) return");
    expect(READER_SOURCE).toContain("selection?.clear(documentId)");
  });

  test("makes the mobile selection-menu action tappable above annotation hit testing", () => {
    expect(READER_SOURCE).toContain('className="pdf-reader__selection-menu"');
    expect(READER_SOURCE).toContain('style={{ ...menuWrapperProps.style, width: 0, height: 0, overflow: "visible", pointerEvents: "auto", zIndex: 12 }}');
    expect(READER_SOURCE).toContain("selected && !pdfInlineAiOpen");
  });

  test("keeps annotation hit areas above selection for read-mode comment taps", () => {
    expect(READER_SOURCE).toMatch(
      /<SelectionLayer[\s\S]*?<AnnotationLayer[\s\S]*?pointerEvents: annotationPointerEvents/
    );
    expect(READER_SOURCE).toContain(
      'annotateMode && activeTool === "eraser" ? "none" : "auto"'
    );
  });

  test.each([
    {
      label: "read mode",
      annotateMode: false,
      activeTool: "pan" as const,
      expected: true,
    },
    {
      label: "Annotate Pan",
      annotateMode: true,
      activeTool: "pan" as const,
      expected: true,
    },
    {
      label: "Annotate Ink",
      annotateMode: true,
      activeTool: "ink" as const,
      expected: true,
    },
    {
      label: "Annotate Eraser",
      annotateMode: true,
      activeTool: "eraser" as const,
      expected: true,
    },
    {
      label: "Annotate Highlight",
      annotateMode: true,
      activeTool: "highlight" as const,
      expected: false,
    },
  ])(
    "preserves native touch navigation in $label",
    ({ annotateMode, activeTool, expected }) => {
      expect(
        shouldPreservePdfFingerNavigation({
          annotateMode,
          activeTool,
          pointerType: "touch",
        })
      ).toBe(expected);
    }
  );

  test.each(["mouse", "pen"])(
    "allows %s selection and annotation interactions through the provider",
    (pointerType) => {
      expect(
        shouldPreservePdfFingerNavigation({
          annotateMode: false,
          activeTool: "pan",
          pointerType,
        })
      ).toBe(false);
    }
  );
});

describe("PDF selection menu actions (SN-334)", () => {
  test("offers Highlight, Record and Ask Companion from the floating selection menu", () => {
    expect(READER_SOURCE).toMatch(
      /<SelectionLayer[\s\S]*?<PdfPassageMenu[\s\S]*?above=\{Boolean\(placement\?\.suggestTop\)\}[\s\S]*?<PdfPassageActions[\s\S]*?onHighlight=\{highlightSelection\}[\s\S]*?highlightDisabled=\{!annotationsReady\}[\s\S]*?recordSelection\(pageIndex, true\)[\s\S]*?onAsk=[\s\S]*?askPdf\(pageIndex[\s\S]*?<AnnotationLayer/
    );
  });

  test("adds Highlight to the right-click menu only for a live range, captured before page extraction", () => {
    expect(READER_SOURCE).toMatch(
      /const highlightCapture = hasSelection && annotationsReadyRef\.current \? captureSelectionForHighlight\(\) : null;\s*const \[selected, pageText\] = await Promise\.all/
    );
    expect(READER_SOURCE).toContain(
      "pdfHighlight: highlightCapture ? () => void highlightCaptured(highlightCapture) : undefined"
    );
  });

  test("creates highlights through EmbedPDF's annotation model and skips covered passages", () => {
    expect(READER_SOURCE).toContain('annotationCapability?.getTool("highlight")?.defaults');
    expect(READER_SOURCE).toMatch(
      /if \(isSelectionAlreadyHighlighted\(page, existing, PdfAnnotationSubtype\.HIGHLIGHT\)\) continue;\s*scope\.createAnnotation\(page\.pageIndex, buildSelectionHighlight\(/
    );
    expect(READER_SOURCE).toContain("if (!scope || highlightBusyRef.current) return;");
    // Sidecar only: annotations are never committed into the PDF bytes.
    expect(READER_SOURCE).toContain("autoCommit: false");
  });

  test("tapping an existing highlight offers Record and Ask Companion beside comment controls", () => {
    expect(READER_SOURCE).not.toContain("!content.trim() && !recordDestinationPath) return null");
    expect(READER_SOURCE).toContain(
      '<PdfPassageActions label="Highlight actions" onRecord={onRecord} onAsk={onAsk} />'
    );
    expect(READER_SOURCE).toMatch(
      /onAsk=\{\(anchor\) => void \(async \(\) => \{\s*const \{ quote \} = await highlightQuote\(\);[\s\S]*?askHighlight\(context\.pageIndex/
    );
    expect(READER_SOURCE).toContain('data-testid="pdf-reader-anno-delete"');
    expect(READER_SOURCE).toContain('data-testid="pdf-reader-anno-edit"');
  });

  test("a short finger tap selects the highlight under it without touching pan/pinch routing", () => {
    expect(READER_SOURCE).toMatch(
      /event\.pointerType === "touch" &&\s*!candidate\.multiTouch[\s\S]*?findHighlightAtPoint\([\s\S]*?scope\.selectAnnotation\(pageIndex, hitId\)/
    );
    expect(READER_SOURCE).toContain("data-page-index={pageIndex}");
  });

  test("offers Undo for a read-mode Highlight without entering Annotate", () => {
    expect(READER_SOURCE).toContain('data-testid="pdf-reader-highlight-undo"');
    expect(READER_SOURCE).toMatch(
      /history\?\.forDocument\(documentId\)\.undo\("annotations"\);[\s\S]*?window\.setTimeout\(exportAndSave, 0\);\s*setHighlightNotice\(null\)/
    );
  });
});

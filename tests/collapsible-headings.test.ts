/**
 * @jest-environment jsdom
 */

import { Editor } from "@tiptap/core";
import {
  collectCollapsibleHeadingSections,
  extractAnnotationVerticalRanges,
  sectionCollapseBlockedByInk,
} from "@/lib/collapsible-headings";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";

function makeEditor(content: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createEditorExtensions(),
    content,
  });
}

describe("collapsible heading helpers", () => {
  it("builds collapsible heading ranges for nested H1-H3 sections", () => {
    const editor = makeEditor(
      [
        "<h1>Alpha</h1>",
        "<p>Intro</p>",
        "<h2>Beta</h2>",
        "<p>Beta body</p>",
        "<h3>Gamma</h3>",
        "<p>Gamma body</p>",
        "<h2>Delta</h2>",
        "<p>Delta body</p>",
        "<h1>Omega</h1>",
        "<p>Outro</p>",
      ].join("")
    );

    const sections = collectCollapsibleHeadingSections(
      editor.state.doc,
      "Notebook/Section/page.html"
    );

    expect(
      sections.map((section) => ({
        level: section.level,
        title: section.title,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        hasCollapsibleContent: section.hasCollapsibleContent,
      }))
    ).toEqual([
      {
        level: 1,
        title: "Alpha",
        startIndex: 0,
        endIndex: 8,
        hasCollapsibleContent: true,
      },
      {
        level: 2,
        title: "Beta",
        startIndex: 2,
        endIndex: 6,
        hasCollapsibleContent: true,
      },
      {
        level: 3,
        title: "Gamma",
        startIndex: 4,
        endIndex: 6,
        hasCollapsibleContent: true,
      },
      {
        level: 2,
        title: "Delta",
        startIndex: 6,
        endIndex: 8,
        hasCollapsibleContent: true,
      },
      {
        level: 1,
        title: "Omega",
        startIndex: 8,
        endIndex: 10,
        hasCollapsibleContent: true,
      },
    ]);

    editor.destroy();
  });

  it("extracts vertical ink ranges from shape snapshots", () => {
    const ranges = extractAnnotationVerticalRanges({
      document: {
        store: {
          "shape:draw": {
            typeName: "shape",
            y: 120,
            props: {
              segments: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 8, y: 40 },
                  ],
                },
              ],
            },
          },
          "shape:box": {
            typeName: "shape",
            y: 20,
            props: {
              h: 30,
            },
          },
        },
      },
    });

    expect(ranges).toEqual(
      expect.arrayContaining([
        { minY: 120, maxY: 160 },
        { minY: 20, maxY: 50 },
      ])
    );
  });

  it("blocks collapse only when ink overlaps the section content range", () => {
    expect(
      sectionCollapseBlockedByInk(100, 200, [{ minY: 150, maxY: 180 }])
    ).toBe(true);

    expect(
      sectionCollapseBlockedByInk(100, 200, [{ minY: 10, maxY: 90 }])
    ).toBe(false);

    expect(
      sectionCollapseBlockedByInk(100, 200, [{ minY: 250, maxY: 300 }])
    ).toBe(false);

    expect(
      sectionCollapseBlockedByInk(100, 200, [
        { minY: 10, maxY: 90 },
        { minY: 250, maxY: 300 },
      ])
    ).toBe(false);
  });
});

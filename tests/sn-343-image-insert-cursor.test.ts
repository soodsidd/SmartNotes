/**
 * @jest-environment jsdom
 */
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  createEditorExtensions,
  insertUploadedEditorAsset,
  placeCursorAfterInsertedImage,
  type UploadedEditorAsset,
} from "@/lib/rich-text-editor-config";

function makeEditor(content = "<p></p>") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: createEditorExtensions(), content });
  return { editor, element };
}

function imageAsset(url: string): UploadedEditorAsset {
  return { url, path: url.replace(/^\/vault\//, ""), fileName: url.split("/").pop()!, isImage: true };
}

function paragraphImageSrcs(editor: Editor): string[] {
  const json = editor.getJSON();
  const paragraph = (json.content ?? []).find((node) => node.type === "paragraph");
  return (paragraph?.content ?? [])
    .filter((node) => node.type === "image")
    .map((node) => String(node.attrs?.src ?? ""));
}

describe("cursor lands beside an inserted image (SN-343)", () => {
  it("leaves a text cursor on the same line immediately after the image instead of a NodeSelection", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);

      const { selection } = editor.state;
      expect(selection).not.toBeInstanceOf(NodeSelection);
      expect(selection).toBeInstanceOf(TextSelection);

      const resolved = editor.state.doc.resolve(selection.from);
      expect(resolved.parent.type.name).toBe("paragraph");
      // Caret shares the paragraph with the image (same line), not a trailing block below.
      expect(resolved.parent.childCount).toBeGreaterThanOrEqual(1);
      expect(resolved.parent.child(0).type.name).toBe("image");
      expect(resolved.parent.child(0).attrs.width).toBeNull();
      expect(editor.getHTML()).not.toContain('width="40%"');
      // Position is after the image node inside that paragraph.
      expect(selection.from).toBeGreaterThan(resolved.before() + 1);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("adds a second image beside the first in the same paragraph instead of replacing it", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/b.png"), "b.png", () => undefined);

      const html = editor.getHTML();
      expect(html).toContain("a.png");
      expect(html).toContain("b.png");

      const srcs = paragraphImageSrcs(editor);
      expect(srcs).toEqual([
        "/vault/nb/sec/page.assets/a.png",
        "/vault/nb/sec/page.assets/b.png",
      ]);

      // Not top-level block siblings — both live in one paragraph row.
      const topLevelTypes = (editor.getJSON().content ?? []).map((node) => node.type);
      expect(topLevelTypes.filter((type) => type === "image")).toHaveLength(0);
      expect(topLevelTypes.filter((type) => type === "paragraph").length).toBeGreaterThanOrEqual(1);

      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("resizes each image independently without changing the other", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/b.png"), "b.png", () => undefined);

      let firstImagePos = -1;
      let secondImagePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "image") return;
        if (String(node.attrs.src).includes("a.png")) firstImagePos = pos;
        if (String(node.attrs.src).includes("b.png")) secondImagePos = pos;
      });
      expect(firstImagePos).toBeGreaterThanOrEqual(0);
      expect(secondImagePos).toBeGreaterThanOrEqual(0);

      editor.chain().focus().setNodeSelection(firstImagePos).setImageWidth("25%").run();
      editor.chain().focus().setNodeSelection(secondImagePos).setImageWidth("75%").run();

      const widths: Record<string, string | null> = {};
      editor.state.doc.descendants((node) => {
        if (node.type.name === "image") {
          widths[String(node.attrs.src)] = node.attrs.width ?? null;
        }
      });
      expect(widths["/vault/nb/sec/page.assets/a.png"]).toBe("25%");
      expect(widths["/vault/nb/sec/page.assets/b.png"]).toBe("75%");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("supports typing immediately after an image without deleting it", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);
      editor.commands.insertContent("hello");

      const html = editor.getHTML();
      expect(html).toContain("a.png");
      expect(html).toContain("hello");

      const paragraph = (editor.getJSON().content ?? []).find((node) => node.type === "paragraph");
      const types = (paragraph?.content ?? []).map((node) => node.type);
      expect(types[0]).toBe("image");
      expect(types).toContain("text");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("is a no-op when the current selection is not a NodeSelection on an image", () => {
    const { editor, element } = makeEditor("<p>hello</p>");
    try {
      editor.commands.setTextSelection(3);
      const before = editor.state.selection;
      placeCursorAfterInsertedImage(editor);
      expect(editor.state.selection).toBe(before);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("keeps surrounding text on the same line and lands the cursor before the remaining text", () => {
    const { editor, element } = makeEditor("<p>Hello world</p>");
    try {
      editor.commands.setTextSelection(7); // between "Hello " and "world"
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);

      const html = editor.getHTML();
      expect(html).toContain("Hello");
      expect(html).toContain("world");
      expect(html).toContain("a.png");
      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);

      const paragraph = (editor.getJSON().content ?? []).find((node) => node.type === "paragraph");
      const types = (paragraph?.content ?? []).map((node) => node.type);
      expect(types).toContain("image");
      expect(types.filter((type) => type === "text").length).toBeGreaterThanOrEqual(1);

      editor.commands.insertContent("mid ");
      expect(editor.getHTML()).toContain("mid world");
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});

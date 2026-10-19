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

describe("cursor lands beside an inserted image (SN-343)", () => {
  it("leaves a text cursor immediately after the image instead of a NodeSelection on it", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);

      const { selection } = editor.state;
      expect(selection).not.toBeInstanceOf(NodeSelection);
      expect(selection).toBeInstanceOf(TextSelection);
      // The cursor sits in the paragraph that trails the image, ready for more
      // typing or another insert — not on the image node itself.
      const resolved = editor.state.doc.resolve(selection.from);
      expect(resolved.parent.type.name).toBe("paragraph");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("adds a second image beside the first instead of replacing it when inserted from the landed cursor", () => {
    const { editor, element } = makeEditor("<p></p>");
    try {
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/b.png"), "b.png", () => undefined);

      const html = editor.getHTML();
      expect(html).toContain("a.png");
      expect(html).toContain("b.png");

      const json = editor.getJSON();
      const topLevelTypes = (json.content ?? []).map((node) => node.type);
      // Both images land back-to-back in the flow — no stray paragraph wedged
      // between them, and neither insert clobbered the other.
      expect(topLevelTypes.filter((type) => type === "image")).toHaveLength(2);
      const firstImageIndex = topLevelTypes.indexOf("image");
      expect(topLevelTypes[firstImageIndex + 1]).toBe("image");

      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
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

  it("splits text around a mid-paragraph insert and lands the cursor before the remaining text", () => {
    const { editor, element } = makeEditor("<p>Hello world</p>");
    try {
      editor.commands.setTextSelection(7); // between "Hello " and "world"
      insertUploadedEditorAsset(editor, imageAsset("/vault/nb/sec/page.assets/a.png"), "a.png", () => undefined);

      const html = editor.getHTML();
      expect(html).toContain("Hello");
      expect(html).toContain("world");
      expect(html).toContain("a.png");
      expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);

      editor.commands.insertContent("mid ");
      expect(editor.getHTML()).toContain("mid world");
    } finally {
      editor.destroy();
      element.remove();
    }
  });
});

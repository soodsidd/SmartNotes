/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { createEditorExtensions, insertUploadedEditorAsset, setEditorHtmlSilent } from "@/lib/rich-text-editor-config";
import { moveFloatingBox, resizeFloatingBox } from "@/lib/floating-text-box";

function editor(content = "<p>Main flow</p>") {
  return new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content });
}

describe("floating text boxes", () => {
  test("move and resize clamp to valid geometry", () => {
    const start = { x: 40, y: 80, width: 360, height: 48 };
    expect(moveFloatingBox(start, -100, 9)).toEqual({ ...start, x: 0, y: 89 });
    expect(resizeFloatingBox(start, -1000, 20)).toEqual({ ...start, width: 160, height: 68 });
  });

  test("rich text, table, image, and geometry survive HTML reload", () => {
    const first = editor();
    first.commands.insertContentAt(first.state.doc.content.size, {
      type: "floatingTextBox",
      attrs: { x: 280, y: 190, width: 420, height: 60 },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Box text", marks: [{ type: "bold" }] }] },
        { type: "image", attrs: { src: "/vault/notes/image.png", alt: "Pasted image" } },
        { type: "table", content: Array.from({ length: 3 }, () => ({
          type: "tableRow", content: Array.from({ length: 3 }, () => ({
            type: "tableCell", content: [{ type: "paragraph" }],
          })),
        })) },
      ],
    });
    const saved = first.getHTML();
    expect(saved).toContain("Main flow");
    expect(saved).toContain("/vault/notes/image.png");
    const second = editor();
    setEditorHtmlSilent(second, saved);
    expect(second.getJSON()).toEqual(first.getJSON());
    expect(second.getHTML()).toContain("data-x=\"280\"");
    expect(second.getHTML()).toContain("<table");
    first.destroy();
    second.destroy();
  });

  test("move control nudges the stored box and Delete removes it", () => {
    const instance = editor('<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box</p></div></div>');
    const move = instance.view.dom.querySelector<HTMLButtonElement>('[data-testid="floating-text-box-move"]');
    expect(move?.title).toBe("Drag to move; arrow keys to nudge");
    move?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(instance.getHTML()).toContain('data-x="21"');
    instance.view.dom.querySelector<HTMLButtonElement>('[data-testid="floating-text-box-delete"]')?.click();
    expect(instance.getHTML()).not.toContain('data-type="floating-text-box"');
    expect(instance.getHTML()).toContain("Main");
    instance.destroy();
  });

  test("the shared image upload insertion publishes box HTML for the page draft", () => {
    const instance = editor('<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box</p></div></div>');
    let boxPosition = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") boxPosition = pos;
    });
    instance.commands.setTextSelection(boxPosition + 2);
    let pageDraft = "";
    insertUploadedEditorAsset(instance, {
      url: "/vault/notes/pasted.png", path: "notes/pasted.png", fileName: "pasted.png", isImage: true,
    }, "pasted.png", (html) => { pageDraft = html; });
    const reloaded = editor(pageDraft);
    const box = reloaded.state.doc.child(1);
    const sourceBox = Array.from({ length: instance.state.doc.childCount }, (_, index) => instance.state.doc.child(index))
      .find((node) => node.type.name === "floatingTextBox");
    expect(box?.type.name).toBe("floatingTextBox");
    expect(box?.toJSON()).toEqual(sourceBox?.toJSON());
    expect(pageDraft).toContain("/vault/notes/pasted.png");
    instance.destroy();
    reloaded.destroy();
  });

  test("Move and corner drag persist their geometry in page HTML", () => {
    const instance = editor('<div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box</p></div></div>');
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    const move = instance.view.dom.querySelector<HTMLButtonElement>('[data-testid="floating-text-box-move"]')!;
    move.setPointerCapture = jest.fn();
    move.dispatchEvent(pointer("pointerdown", 50, 50));
    move.dispatchEvent(pointer("pointermove", 65, 62));
    move.dispatchEvent(pointer("pointerup", 65, 62));
    expect(instance.getHTML()).toContain('data-x="35"');
    expect(instance.getHTML()).toContain('data-y="42"');
    const resize = instance.view.dom.querySelector<HTMLButtonElement>('[data-testid="floating-text-box-resize"]')!;
    resize.setPointerCapture = jest.fn();
    resize.dispatchEvent(pointer("pointerdown", 100, 100));
    resize.dispatchEvent(pointer("pointermove", 140, 120));
    resize.dispatchEvent(pointer("pointerup", 140, 120));
    expect(instance.getHTML()).toContain('data-width="400"');
    expect(instance.getHTML()).toContain('data-height="68"');
    instance.destroy();
  });
});

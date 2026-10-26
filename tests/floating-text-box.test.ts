/** @jest-environment jsdom */
import { Editor } from "@tiptap/core";
import { createEditorExtensions, insertUploadedEditorAsset, setEditorHtmlSilent } from "@/lib/rich-text-editor-config";
import {
  EDITOR_MAIN_FLOW_WIDTH,
  fitFloatingBoxWidthToContent,
  isFloatingTextBoxEmpty,
  moveFloatingBox,
  pruneEmptyFloatingTextBoxes,
  resizeFloatingBoxWidth,
  selectionInFloatingTextBox,
} from "@/lib/floating-text-box";

function editor(content = "<p>Main flow</p>") {
  return new Editor({ element: document.createElement("div"), extensions: createEditorExtensions(), content });
}

describe("floating text boxes", () => {
  test("chrome follows the caret inside its own content, not hover or another selection", async () => {
    const instance = editor('<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box</p></div></div>');
    document.body.append(instance.view.dom);
    const box = instance.view.dom.querySelector<HTMLElement>(".floating-text-box")!;
    const content = box.querySelector<HTMLElement>(".floating-text-box__content")!;
    let boxPos = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") boxPos = pos;
    });
    expect(box.dataset.editing).toBe("false");
    box.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(box.dataset.editing).toBe("false");
    instance.commands.setTextSelection(boxPos + 2);
    instance.view.focus();
    expect(box.dataset.editing).toBe("true");
    expect(content.contains(instance.view.domAtPos(instance.state.selection.from).node)).toBe(true);
    instance.commands.setTextSelection(1);
    expect(box.dataset.editing).toBe("false");
    instance.commands.setTextSelection(boxPos + 2);
    expect(box.dataset.editing).toBe("true");
    instance.view.dom.blur();
    await Promise.resolve();
    expect(box.dataset.editing).toBe("false");
    instance.view.dom.remove();
    instance.destroy();
  });

  test("main flow selection stays distinct from floating box content and node selection", () => {
    const instance = editor('<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Box</p></div></div>');
    let boxPos = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") boxPos = pos;
    });

    instance.commands.setTextSelection(1);
    expect(selectionInFloatingTextBox(instance.state)).toBe(false);
    instance.commands.setTextSelection(boxPos + 2);
    expect(selectionInFloatingTextBox(instance.state)).toBe(true);
    instance.commands.setNodeSelection(boxPos);
    expect(selectionInFloatingTextBox(instance.state)).toBe(true);
    instance.destroy();
  });

  test("move clamps to valid geometry", () => {
    const start = { x: 40, y: 80, width: 360 };
    expect(moveFloatingBox(start, -100, 9)).toEqual({ ...start, x: 0, y: 89 });
  });

  test("rich text, table, image, and geometry survive HTML reload", () => {
    const first = editor();
    first.commands.insertContentAt(first.state.doc.content.size, {
      type: "floatingTextBox",
      attrs: { x: 280, y: 190, width: 420 },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Box text", marks: [{ type: "bold" }] }] },
        // SN-343: images are inline atoms — nest inside a paragraph, not as a block sibling.
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/vault/notes/image.png", alt: "Pasted image" } }],
        },
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

  test("empty boxes prune when the caret leaves; filled boxes stay", () => {
    const instance = editor(
      '<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p></p></div></div>'
    );
    let boxPos = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") {
        boxPos = pos;
        expect(isFloatingTextBoxEmpty(node)).toBe(true);
      }
    });
    instance.commands.setTextSelection(boxPos + 2);
    expect(pruneEmptyFloatingTextBoxes(instance)).toBe(0);
    instance.commands.setTextSelection(1);
    expect(pruneEmptyFloatingTextBoxes(instance)).toBe(1);
    expect(instance.getHTML()).not.toContain('data-type="floating-text-box"');

    const filled = editor(
      '<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Keep me</p></div></div>'
    );
    filled.commands.setTextSelection(1);
    expect(pruneEmptyFloatingTextBoxes(filled)).toBe(0);
    expect(filled.getHTML()).toContain("Keep me");
    expect(EDITOR_MAIN_FLOW_WIDTH).toBe(672);
    instance.destroy();
    filled.destroy();
  });

  test("Move drag persists its geometry in page HTML", () => {
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
    instance.destroy();
  });

  test("SN-316: width-only resize keeps x/y and clamps width; content fit only grows", () => {
    const start = { x: 40, y: 80, width: 360 };
    expect(resizeFloatingBoxWidth(start, 140)).toEqual({ ...start, width: 500 });
    expect(resizeFloatingBoxWidth(start, -1000)).toEqual({ ...start, width: 160 });
    expect(fitFloatingBoxWidthToContent(start, 452.2, 340)).toEqual({ ...start, width: 473 });
    expect(fitFloatingBoxWidthToContent(start, 300, 340)).toBe(start);
    expect(fitFloatingBoxWidthToContent(start, Number.NaN, 340)).toBe(start);
  });

  test("SN-316/SN-314: right-edge handle changes only width, live on every pointer move, so text reflows", () => {
    const instance = editor('<div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Long wrapped text that reflows</p></div></div>');
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    const box = instance.view.dom.querySelector<HTMLElement>('[data-testid="floating-text-box"]')!;
    const handle = instance.view.dom.querySelector<HTMLButtonElement>('[data-testid="floating-text-box-resize-width"]')!;
    expect(handle.getAttribute("aria-label")).toBe("Resize text box width");
    handle.setPointerCapture = jest.fn();
    handle.dispatchEvent(pointer("pointerdown", 100, 100));
    handle.dispatchEvent(pointer("pointermove", 40, 180));
    // Mid-drag: the box DOM already has the new width, so text reflows live.
    expect(box.style.width).toBe("300px");
    expect(box.style.minHeight).toBe("");
    expect(box.style.height).toBe("");
    // The content column has no width of its own, so paragraphs wrap to the box.
    const content = box.querySelector<HTMLElement>(".floating-text-box__content")!;
    expect(content.style.width).toBe("");
    expect(content.querySelector("p")?.textContent).toBe("Long wrapped text that reflows");
    handle.dispatchEvent(pointer("pointermove", 220, 300));
    handle.dispatchEvent(pointer("pointerup", 220, 300));
    const html = instance.getHTML();
    expect(html).toContain('data-width="480"');
    expect(html).toContain('data-x="20"');
    expect(html).toContain('data-y="30"');
    expect(html).not.toContain("data-height");
    expect(html).not.toContain("min-height");

    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(instance.getHTML()).toContain('data-width="479"');
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(instance.getHTML()).toContain('data-width="489"');
    instance.destroy();
  });

  test("SN-316: an embedded image resized wider than the box grows the box to contain it", () => {
    const callbacks: Array<() => void> = [];
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    };
    try {
      const instance = editor('<div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="48"><div data-floating-box-content><p>Caption</p><img src="/vault/notes/a.png" width="300"></div></div>');
      const content = instance.view.dom.querySelector<HTMLElement>(".floating-text-box__content")!;
      const image = content.querySelector<HTMLImageElement>("img")!;
      const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
      Object.defineProperty(content, "clientWidth", { configurable: true, value: 340 });
      content.getBoundingClientRect = () => rect(10, 340);
      // Image dragged from 300px to 420px: 80px past the content edge.
      image.getBoundingClientRect = () => rect(10, 420);
      callbacks.forEach((callback) => callback());
      expect(instance.getHTML()).toContain('data-width="440"');
      // Image fits again: the box never shrinks on its own.
      image.getBoundingClientRect = () => rect(10, 200);
      callbacks.forEach((callback) => callback());
      expect(instance.getHTML()).toContain('data-width="440"');
      instance.destroy();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  test("SN-314: height always fits content: no min-height, stale data-height ignored, image growth never pins height", () => {
    const callbacks: Array<() => void> = [];
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    };
    try {
      // Older pages stored data-height and rendered it as min-height (SN-344), which left
      // empty chrome below short content. It must no longer influence layout.
      const instance = editor('<div data-type="floating-text-box" data-x="20" data-y="30" data-width="360" data-height="300" style="min-height:300px"><div data-floating-box-content><p>One line</p><img src="/vault/notes/a.png" width="200"></div></div>');
      const box = instance.view.dom.querySelector<HTMLElement>('[data-testid="floating-text-box"]')!;
      const content = box.querySelector<HTMLElement>(".floating-text-box__content")!;
      const image = content.querySelector<HTMLImageElement>("img")!;
      expect(box.style.minHeight).toBe("");
      expect(box.style.height).toBe("");
      expect(box.dataset.height).toBeUndefined();
      expect(instance.getHTML()).not.toContain("data-height");
      expect(instance.getHTML()).not.toContain("min-height");

      const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
      Object.defineProperty(content, "clientWidth", { configurable: true, value: 340 });
      Object.defineProperty(content, "scrollHeight", { configurable: true, value: 640 });
      content.getBoundingClientRect = () => rect(10, 340);
      // The image is resized larger than the box: width grows to contain it; height
      // stays auto so the box grows with the taller image instead of clipping it.
      image.getBoundingClientRect = () => rect(10, 600);
      callbacks.forEach((callback) => callback());
      expect(instance.getHTML()).toContain('data-width="620"');
      expect(box.style.width).toBe("620px");
      expect(box.style.minHeight).toBe("");
      expect(box.style.height).toBe("");
      // A content change that needs no wider box makes no transaction at all.
      const before = instance.getHTML();
      image.getBoundingClientRect = () => rect(10, 100);
      Object.defineProperty(content, "scrollHeight", { configurable: true, value: 20 });
      callbacks.forEach((callback) => callback());
      expect(instance.getHTML()).toBe(before);
      expect(box.style.minHeight).toBe("");
      instance.destroy();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  test("SN-314: image growth includes the resize container's right margin so no empty line wraps under the image", () => {
    const callbacks: Array<() => void> = [];
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() {}
    };
    try {
      const instance = editor('<div data-type="floating-text-box" data-x="20" data-y="30" data-width="360"><div data-floating-box-content><p><img src="/vault/notes/a.png" width="300"></p></div></div>');
      const content = instance.view.dom.querySelector<HTMLElement>(".floating-text-box__content")!;
      const image = content.querySelector<HTMLImageElement>("img")!;
      const container = image.closest<HTMLElement>("[data-resize-container]")!;
      expect(container).not.toBeNull();
      const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON() {} }) as DOMRect;
      Object.defineProperty(content, "clientWidth", { configurable: true, value: 340 });
      content.getBoundingClientRect = () => rect(10, 340);
      image.getBoundingClientRect = () => rect(10, 400);
      container.getBoundingClientRect = () => rect(10, 400);
      container.style.marginRight = "6px";
      callbacks.forEach((callback) => callback());
      // 400px image + 6px margin needs 406px of content: 66px past the 340px column.
      expect(instance.getHTML()).toContain('data-width="426"');
      instance.destroy();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  test("SN-314: border/chrome shows for any selection inside the box (image node, box node), and there is no corner resize", () => {
    const instance = editor('<p>Main</p><div data-type="floating-text-box" data-x="20" data-y="30" data-width="360"><div data-floating-box-content><p>Box <img src="/vault/notes/a.png"></p></div></div>');
    document.body.append(instance.view.dom);
    const box = instance.view.dom.querySelector<HTMLElement>(".floating-text-box")!;
    expect(box.querySelector('[data-testid="floating-text-box-resize"]')).toBeNull();
    expect(box.querySelectorAll('[data-testid="floating-text-box-resize-width"]')).toHaveLength(1);
    let boxPos = -1;
    let imagePos = -1;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === "floatingTextBox") boxPos = pos;
      if (node.type.name === "image") imagePos = pos;
    });
    instance.view.focus();
    expect(box.dataset.editing).toBe("false");
    instance.commands.setNodeSelection(imagePos);
    expect(box.dataset.editing).toBe("true");
    instance.commands.setTextSelection(1);
    expect(box.dataset.editing).toBe("false");
    instance.commands.setNodeSelection(boxPos);
    expect(box.dataset.editing).toBe("true");
    instance.commands.selectAll();
    expect(box.dataset.editing).toBe("false");
    instance.view.dom.remove();
    instance.destroy();
  });
});

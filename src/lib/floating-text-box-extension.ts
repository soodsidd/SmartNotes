import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import {
  FLOATING_BOX_DEFAULT_WIDTH,
  deleteFloatingTextBox,
  moveFloatingBox,
  normalizeFloatingBoxGeometry,
  resizeFloatingBoxWidth,
  type FloatingBoxGeometry,
} from "./floating-text-box";
import { nonTextContentWidth } from "./non-text-content-width";

const attrs = (element: HTMLElement) => normalizeFloatingBoxGeometry({
  x: Number(element.dataset.x),
  y: Number(element.dataset.y),
  width: Number(element.dataset.width),
});

export const FloatingTextBox = Node.create({
  name: "floatingTextBox",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      x: { default: 0, parseHTML: (el: HTMLElement) => attrs(el).x },
      y: { default: 0, parseHTML: (el: HTMLElement) => attrs(el).y },
      width: { default: FLOATING_BOX_DEFAULT_WIDTH, parseHTML: (el: HTMLElement) => attrs(el).width },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="floating-text-box"]' }]; },
  renderHTML({ HTMLAttributes }) {
    const geometry = normalizeFloatingBoxGeometry(HTMLAttributes as FloatingBoxGeometry);
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "floating-text-box",
      "data-x": geometry.x,
      "data-y": geometry.y,
      "data-width": geometry.width,
      style: `position:absolute;left:${geometry.x}px;top:${geometry.y}px;width:${geometry.width}px`,
    }), ["div", { "data-floating-box-content": "" }, 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }): NodeView => {
      let current = node;
      const dom = document.createElement("div");
      dom.className = "floating-text-box";
      dom.dataset.type = "floating-text-box";
      dom.dataset.testid = "floating-text-box";
      const controls = document.createElement("div");
      controls.className = "floating-text-box__controls";
      const move = document.createElement("button");
      move.type = "button";
      move.className = "floating-text-box__move";
      move.textContent = "Move";
      move.title = "Drag to move; arrow keys to nudge";
      move.setAttribute("aria-label", "Move text box");
      move.dataset.testid = "floating-text-box-move";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete text box");
      remove.dataset.testid = "floating-text-box-delete";
      // Keep the editor selection in this box until the click deletes it.
      remove.addEventListener("pointerdown", (event) => event.preventDefault());
      controls.append(move, remove);
      const contentDOM = document.createElement("div");
      contentDOM.className = "floating-text-box__content";
      contentDOM.dataset.floatingBoxContent = "";
      const resizeWidth = document.createElement("button");
      resizeWidth.type = "button";
      resizeWidth.className = "floating-text-box__resize-width";
      resizeWidth.title = "Drag to change width; arrow keys to adjust";
      resizeWidth.setAttribute("aria-label", "Resize text box width");
      resizeWidth.dataset.testid = "floating-text-box-resize-width";
      dom.append(controls, contentDOM, resizeWidth);

      // The content is inside ProseMirror's focused root, so :focus-within on
      // contentDOM cannot tell which box owns the caret. Any selection within
      // the box counts (SN-314): a caret, a text range, or a selected image.
      function syncEditingChrome() {
        const pos = getPos();
        const selection = editor.state.selection;
        const selectionInside = editor.isFocused && typeof pos === "number" &&
          selection.from >= pos && selection.to <= pos + current.nodeSize;
        const chromeFocused = dom.dataset.editing === "true" &&
          (controls.contains(document.activeElement) || document.activeElement === resizeWidth);
        dom.dataset.editing = selectionInside || chromeFocused ? "true" : "false";
      }
      const syncAfterBlur = () => queueMicrotask(syncEditingChrome);
      editor.on("selectionUpdate", syncEditingChrome);
      editor.on("focus", syncEditingChrome);
      editor.on("blur", syncAfterBlur);
      dom.addEventListener("focusin", syncEditingChrome);
      dom.addEventListener("focusout", syncAfterBlur);

      function geometry(): FloatingBoxGeometry {
        return normalizeFloatingBoxGeometry(current.attrs as FloatingBoxGeometry);
      }
      function paint() {
        const next = geometry();
        dom.style.left = `${next.x}px`;
        dom.style.top = `${next.y}px`;
        dom.style.width = `${Math.max(next.width, fittedContentWidth)}px`;
        Object.entries(next).forEach(([key, value]) => { dom.dataset[key] = String(value); });
      }
      function commit(next: FloatingBoxGeometry) {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const prev = geometry();
        if (prev.x === next.x && prev.y === next.y && prev.width === next.width) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
      }
      // Keep content-fit width on the DOM only. The persisted width is the manual
      // reading width, so the box contracts when the widest table/image shrinks.
      let fittedContentWidth = 0;
      function fitToContent() {
        const chrome = dom.offsetWidth ? dom.offsetWidth - contentDOM.clientWidth : 20;
        const needed = nonTextContentWidth(contentDOM) + chrome;
        if (needed === fittedContentWidth) return;
        fittedContentWidth = needed;
        paint();
      }
      const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => fitToContent())
        : null;
      resizeObserver?.observe(contentDOM);
      const mutationObserver = new MutationObserver(fitToContent);
      mutationObserver.observe(contentDOM, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "width", "colwidth", "data-fixed-widths"] });
      contentDOM.addEventListener("load", fitToContent, true);
      function drag(handle: HTMLElement, transform: (start: FloatingBoxGeometry, dx: number, dy: number) => FloatingBoxGeometry) {
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handle.focus();
          dom.dataset.interacting = "true";
          const start = geometry();
          const originX = event.clientX;
          const originY = event.clientY;
          const scale = dom.getBoundingClientRect().width / start.width || 1;
          handle.setPointerCapture(event.pointerId);
          const onMove = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            commit(transform(start, (next.clientX - originX) / scale, (next.clientY - originY) / scale));
          };
          const onEnd = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onEnd);
            handle.removeEventListener("pointercancel", onEnd);
            delete dom.dataset.interacting;
            syncEditingChrome();
          };
          handle.addEventListener("pointermove", onMove);
          handle.addEventListener("pointerup", onEnd);
          handle.addEventListener("pointercancel", onEnd);
        });
      }
      drag(move, moveFloatingBox);
      drag(resizeWidth, (start, dx) => resizeFloatingBoxWidth(start, dx));
      resizeWidth.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 10 : 1;
        const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        commit(resizeFloatingBoxWidth(geometry(), delta));
      });
      move.addEventListener("keydown", (event) => {
        const direction: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        };
        const delta = direction[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        commit(moveFloatingBox(geometry(), delta[0], delta[1]));
      });
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") return;
        deleteFloatingTextBox(editor, pos);
      });
      paint();
      syncEditingChrome();
      return {
        dom, contentDOM,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          syncEditingChrome();
          return true;
        },
        destroy() {
          resizeObserver?.disconnect();
          mutationObserver.disconnect();
          contentDOM.removeEventListener("load", fitToContent, true);
          editor.off("selectionUpdate", syncEditingChrome);
          editor.off("focus", syncEditingChrome);
          editor.off("blur", syncAfterBlur);
        },
        stopEvent(event) { return (event.target instanceof globalThis.Node && controls.contains(event.target)) || event.target === resizeWidth; },
        ignoreMutation(mutation) { return mutation.type === "attributes" && mutation.target === dom; },
      };
    };
  },
});

import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import {
  FLOATING_BOX_DEFAULT_HEIGHT,
  FLOATING_BOX_DEFAULT_WIDTH,
  fitFloatingBoxWidthToContent,
  moveFloatingBox,
  normalizeFloatingBoxGeometry,
  resizeFloatingBox,
  resizeFloatingBoxWidth,
  type FloatingBoxGeometry,
} from "./floating-text-box";

const attrs = (element: HTMLElement) => normalizeFloatingBoxGeometry({
  x: Number(element.dataset.x),
  y: Number(element.dataset.y),
  width: Number(element.dataset.width),
  height: Number(element.dataset.height),
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
      height: { default: FLOATING_BOX_DEFAULT_HEIGHT, parseHTML: (el: HTMLElement) => attrs(el).height },
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
      "data-height": geometry.height,
      style: `position:absolute;left:${geometry.x}px;top:${geometry.y}px;width:${geometry.width}px;min-height:${geometry.height}px`,
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
      controls.append(move, remove);
      const contentDOM = document.createElement("div");
      contentDOM.className = "floating-text-box__content";
      contentDOM.dataset.floatingBoxContent = "";
      const resize = document.createElement("button");
      resize.type = "button";
      resize.className = "floating-text-box__resize";
      resize.setAttribute("aria-label", "Resize text box");
      resize.dataset.testid = "floating-text-box-resize";
      const resizeWidth = document.createElement("button");
      resizeWidth.type = "button";
      resizeWidth.className = "floating-text-box__resize-width";
      resizeWidth.title = "Drag to change width; arrow keys to adjust";
      resizeWidth.setAttribute("aria-label", "Resize text box width");
      resizeWidth.dataset.testid = "floating-text-box-resize-width";
      dom.append(controls, contentDOM, resizeWidth, resize);

      function geometry(): FloatingBoxGeometry {
        return normalizeFloatingBoxGeometry(current.attrs as FloatingBoxGeometry);
      }
      function paint() {
        const next = geometry();
        dom.style.left = `${next.x}px`;
        dom.style.top = `${next.y}px`;
        dom.style.width = `${next.width}px`;
        dom.style.minHeight = `${next.height}px`;
        Object.entries(next).forEach(([key, value]) => { dom.dataset[key] = String(value); });
      }
      function commit(next: FloatingBoxGeometry) {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const prev = geometry();
        if (prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
      }
      // Height is min-height, so it already follows content. Width is explicit,
      // so grow it when an embedded image is resized wider than the box.
      // Expanded tables are left to overflow on purpose (SN-278).
      function fitToContent() {
        if (!editor.isEditable || contentDOM.clientWidth === 0) return;
        const area = contentDOM.getBoundingClientRect();
        const scale = area.width / contentDOM.clientWidth || 1;
        let right = area.right;
        contentDOM.querySelectorAll("img").forEach((image) => {
          right = Math.max(right, image.getBoundingClientRect().right);
        });
        const needed = contentDOM.clientWidth + (right - area.right) / scale;
        commit(fitFloatingBoxWidthToContent(geometry(), needed, contentDOM.clientWidth));
      }
      const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => fitToContent())
        : null;
      resizeObserver?.observe(contentDOM);
      function drag(handle: HTMLElement, transform: (start: FloatingBoxGeometry, dx: number, dy: number) => FloatingBoxGeometry) {
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handle.focus();
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
          };
          handle.addEventListener("pointermove", onMove);
          handle.addEventListener("pointerup", onEnd);
          handle.addEventListener("pointercancel", onEnd);
        });
      }
      drag(move, moveFloatingBox);
      drag(resize, resizeFloatingBox);
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
        editor.view.dispatch(editor.state.tr.delete(pos, pos + current.nodeSize));
      });
      paint();
      return {
        dom, contentDOM,
        update(next) {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        destroy() { resizeObserver?.disconnect(); },
        stopEvent(event) { return (event.target instanceof globalThis.Node && controls.contains(event.target)) || event.target === resize || event.target === resizeWidth; },
        ignoreMutation(mutation) { return mutation.type === "attributes" && mutation.target === dom; },
      };
    };
  },
});

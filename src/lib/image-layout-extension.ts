import Image from "@tiptap/extension-image";
import { mergeAttributes, type CommandProps } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

export type ImageAlign = "left" | "center" | "right";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageLayout: {
      setImageAlign: (align: ImageAlign) => ReturnType;
      setImageWidth: (width: string | null) => ReturnType;
    };
  }
}

function normalizeWidth(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${Math.round(value)}px`;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return `${raw}px`;
  if (/^\d+(\.\d+)?%$/.test(raw)) return raw;
  if (/^\d+(\.\d+)?px$/.test(raw)) return raw;
  return null;
}

/**
 * Updating a leaf image's attributes replaces the node, which maps a
 * NodeSelection on it to a text caret. Re-select it so the toolbar and resize
 * handles (shown only on the selected image, SN-391) stay put after a change.
 */
function updateKeepingSelection(
  { commands, state }: CommandProps,
  name: string,
  attributes: Record<string, unknown>
) {
  const { selection } = state;
  const selected =
    selection instanceof NodeSelection && selection.node.type.name === name ? selection.from : null;
  if (!commands.updateAttributes(name, attributes)) return false;
  if (selected !== null) commands.setNodeSelection(selected);
  return true;
}

export const ImageLayout = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "left",
        parseHTML: (element) => element.getAttribute("data-align") ?? "left",
        renderHTML: (attributes) => {
          const align = attributes.align as ImageAlign | undefined;
          if (!align || align === "left") return {};
          return { "data-align": align };
        },
      },
      width: {
        default: null,
        parseHTML: (element) =>
          normalizeWidth(element.getAttribute("width") ?? element.style.width),
        renderHTML: (attributes) => {
          const width = normalizeWidth(attributes.width);
          if (!width) return {};
          return {
            width,
            style: `width: ${width}; height: auto;`,
          };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "editor-image",
      }),
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align) =>
        (props) =>
          updateKeepingSelection(props, this.name, { align }),
      setImageWidth:
        (width) =>
        (props) =>
          updateKeepingSelection(props, this.name, { width: normalizeWidth(width) }),
    };
  },

  /**
   * TipTap's stock resize NodeView `onUpdate` returns true without syncing
   * `img.src`. Across SN-55 page swaps the editor stays mounted, so ProseMirror
   * can reuse the NodeView while the model already holds the next page's URL —
   * leaving the previous bitmap visible. Rebuild when `src` changes (SN-280)
   * or sizing changes so the image and its resize wrapper stay in sync.
   */
  addNodeView() {
    const parent = this.parent?.();
    if (!parent) {
      return null;
    }

    return (props) => {
      const nodeView = parent(props);
      if (!nodeView || typeof nodeView.update !== "function") {
        return nodeView;
      }

      const appliedSrc = String(props.node.attrs.src ?? "");
      const appliedWidth = normalizeWidth(props.node.attrs.width);
      // TipTap's resize view appends "px" to the width attribute. For a
      // percentage preset that produces an invalid value such as "50%px".
      // Size the outer inline container against the editor column instead;
      // the picture and handles then share exactly the same width.
      if (appliedWidth?.endsWith("%")) {
        const container = nodeView.dom as HTMLElement;
        const image = container.querySelector("[data-resize-wrapper] > img") as HTMLImageElement | null;
        container.style.width = appliedWidth;
        if (image) {
          image.style.width = "100%";
          image.style.height = "auto";
          const beginResize = () => {
            const width = image.getBoundingClientRect().width;
            if (width > 0) image.style.width = `${width}px`;
            container.style.width = "";
          };
          container.querySelectorAll("[data-resize-handle]").forEach((handle) => {
            handle.addEventListener("mousedown", beginResize, { capture: true });
            handle.addEventListener("touchstart", beginResize, { capture: true });
          });
        }
      }
      // SN-391: TipTap's resize view only finishes a drag on `mouseup`. A touch
      // drag never produces one (the handle's touchstart is preventDefault-ed),
      // so the resize never committed and its document `touchmove` listener kept
      // resizing the image on every later swipe. End touch drags explicitly.
      const resizable = nodeView as unknown as {
        isResizing: boolean;
        handleMouseUp: () => void;
        handleTouchMove: (event: TouchEvent) => void;
        onCommit: (width: number, height: number) => void;
      };
      // The stock commit selects the image and then updates its attributes,
      // but replacing a leaf node maps that NodeSelection to a text caret. With
      // handles shown only on the selected image (SN-391) they would vanish
      // after every drag, so re-select the image at its unchanged position.
      const commit = resizable.onCommit;
      resizable.onCommit = (width, height) => {
        const pos = typeof props.getPos === "function" ? props.getPos() : undefined;
        commit(width, height);
        if (typeof pos === "number") props.editor.commands.setNodeSelection(pos);
      };
      const endTouchResize = () => {
        document.removeEventListener("touchend", endTouchResize);
        document.removeEventListener("touchcancel", endTouchResize);
        document.removeEventListener("touchmove", resizable.handleTouchMove);
        if (resizable.isResizing) resizable.handleMouseUp();
      };
      // Listen on the container: handles are recreated when editability toggles.
      (nodeView.dom as HTMLElement).addEventListener(
        "touchstart",
        (event) => {
          if (!(event.target instanceof Element) || !event.target.closest("[data-resize-handle]")) return;
          document.addEventListener("touchend", endTouchResize);
          document.addEventListener("touchcancel", endTouchResize);
        },
        { capture: true }
      );
      const originalDestroy = nodeView.destroy?.bind(nodeView);
      nodeView.destroy = () => {
        document.removeEventListener("touchend", endTouchResize);
        document.removeEventListener("touchcancel", endTouchResize);
        document.removeEventListener("touchmove", resizable.handleTouchMove);
        originalDestroy?.();
      };
      const originalUpdate = nodeView.update.bind(nodeView);

      nodeView.update = (updatedNode, decorations, innerDecorations) => {
        if (updatedNode.type.name !== this.name) {
          return false;
        }

        const nextSrc = String(updatedNode.attrs.src ?? "");
        if (nextSrc !== appliedSrc || normalizeWidth(updatedNode.attrs.width) !== appliedWidth) {
          return false;
        }

        return originalUpdate(updatedNode, decorations, innerDecorations);
      };

      return nodeView;
    };
  },
});

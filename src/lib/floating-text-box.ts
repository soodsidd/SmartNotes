import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

export const FLOATING_BOX_DEFAULT_WIDTH = 360;
export const FLOATING_BOX_MIN_WIDTH = 160;

/** Main editor column width — floating boxes sit on the canvas beside this frame. */
export const EDITOR_MAIN_FLOW_WIDTH = 672;

/**
 * SN-314: height is not geometry. The box always fits its content (CSS height
 * auto), so a legacy `data-height` attribute in older page HTML is ignored.
 */
export type FloatingBoxGeometry = { x: number; y: number; width: number };

export function normalizeFloatingBoxGeometry(value: Partial<FloatingBoxGeometry>): FloatingBoxGeometry {
  const finite = (number: number | undefined, fallback: number) =>
    typeof number === "number" && Number.isFinite(number) ? Math.round(number) : fallback;
  return {
    x: Math.max(0, finite(value.x, 0)),
    y: Math.max(0, finite(value.y, 0)),
    width: Math.max(FLOATING_BOX_MIN_WIDTH, finite(value.width, FLOATING_BOX_DEFAULT_WIDTH)),
  };
}

export function moveFloatingBox(geometry: FloatingBoxGeometry, dx: number, dy: number): FloatingBoxGeometry {
  return normalizeFloatingBoxGeometry({ ...geometry, x: geometry.x + dx, y: geometry.y + dy });
}

/** Right-edge resize, the only resize: width changes, text reflows, height follows content. */
export function resizeFloatingBoxWidth(geometry: FloatingBoxGeometry, dx: number): FloatingBoxGeometry {
  return normalizeFloatingBoxGeometry({ ...geometry, width: geometry.width + dx });
}

/**
 * Grow the box width by however much its content overflows horizontally
 * (e.g. an embedded image resized wider than the box). Never shrinks.
 */
export function fitFloatingBoxWidthToContent(
  geometry: FloatingBoxGeometry,
  neededContentWidth: number,
  availableContentWidth: number,
): FloatingBoxGeometry {
  const overflow = Math.ceil(neededContentWidth - availableContentWidth);
  if (!Number.isFinite(overflow) || overflow <= 0) return geometry;
  return normalizeFloatingBoxGeometry({ ...geometry, width: geometry.width + overflow });
}

/** True when a floating box has no typed text, images, tables, or other non-empty blocks. */
export function isFloatingTextBoxEmpty(node: PMNode): boolean {
  if (node.type.name !== "floatingTextBox") return false;
  let empty = true;
  node.descendants((child) => {
    if (!empty) return false;
    if (child.type.name === "floatingTextBox") return true;
    if (child.isText) {
      if (child.text && child.text.trim().length > 0) empty = false;
      return false;
    }
    if (child.type.name === "image" || child.type.name === "table" || child.type.name === "horizontalRule") {
      empty = false;
      return false;
    }
    if (child.isAtom && !child.isText) {
      empty = false;
      return false;
    }
    return true;
  });
  return empty;
}

/**
 * SN-321: true when the selection sits in (or selects) a floating text box rather
 * than the main flow. Floating boxes share the main ProseMirror view, so editor
 * focus alone can't tell the two apart.
 */
export function selectionInFloatingTextBox(state: EditorState): boolean {
  const { selection } = state;
  const selected = (selection as { node?: PMNode }).node;
  if (selected?.type.name === "floatingTextBox") return true;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "floatingTextBox") return true;
  }
  return false;
}

/**
 * Delete empty floating text boxes that are not under the current selection
 * and not currently focused via Move/Delete/resize chrome.
 * Returns how many boxes were removed.
 */
export function pruneEmptyFloatingTextBoxes(editor: Editor): number {
  const { selection, doc } = editor.state;
  const from = selection.from;
  const to = selection.to;
  const active =
    typeof document !== "undefined" ? document.activeElement : null;
  const deletions: Array<{ from: number; to: number }> = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "floatingTextBox") return true;
    const boxFrom = pos;
    const boxTo = pos + node.nodeSize;
    const selectionInside = from >= boxFrom && to <= boxTo;
    if (selectionInside) return false;
    const dom = editor.view.nodeDOM(pos);
    if (
      dom instanceof HTMLElement &&
      active instanceof globalThis.Node &&
      dom.contains(active)
    ) {
      return false;
    }
    if (isFloatingTextBoxEmpty(node)) {
      deletions.push({ from: boxFrom, to: boxTo });
    }
    return false;
  });

  if (deletions.length === 0) return 0;

  let tr = editor.state.tr;
  for (const range of deletions.sort((a, b) => b.from - a.from)) {
    tr = tr.delete(range.from, range.to);
  }
  editor.view.dispatch(tr);
  return deletions.length;
}

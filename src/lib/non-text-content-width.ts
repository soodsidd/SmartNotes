/** A fluid table's rendered 100% width cannot be used as its content width:
 * it would keep an expanded frame open after the fixed-width asset shrinks. */
function intrinsicTableWidth(table: HTMLTableElement): number {
  const probe = document.createElement("div");
  probe.className = "editor-content";
  probe.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;width:1px";
  const wrapper = document.createElement("div");
  wrapper.className = "tableWrapper";
  wrapper.style.cssText = "width:1px;max-width:none;overflow:visible";
  const copy = table.cloneNode(true) as HTMLTableElement;
  copy.style.width = "100%";
  copy.style.minWidth = "0";
  wrapper.append(copy);
  probe.append(wrapper);
  document.body.append(probe);
  const width = Math.max(copy.scrollWidth, wrapper.scrollWidth, copy.getBoundingClientRect().width);
  probe.remove();
  return width;
}

/** Width-bearing editor content is measured independently of the prose column.
 * Text and percentage-sized blocks must not hold an expanded frame open. */
export function nonTextContentWidth(root: HTMLElement): number {
  let widest = 0;
  const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
  for (const table of root.querySelectorAll<HTMLTableElement>(".tableWrapper > table")) {
    const fixed = table.closest(".tableWrapper")?.getAttribute("data-fixed-widths") === "true";
    widest = Math.max(widest, fixed ? parseFloat(table.style.width) || table.offsetWidth : intrinsicTableWidth(table));
  }
  for (const element of root.querySelectorAll<HTMLElement>("img, video, iframe, embed, object, canvas, svg")) {
    if (element.style.width.endsWith("%")) continue;
    const container = element instanceof HTMLImageElement
      ? element.closest<HTMLElement>("[data-resize-container]") : null;
    const explicit = parseFloat(element.style.width) || 0;
    const rendered = element.getBoundingClientRect().width / scale;
    const width = Math.max(
      rendered,
      container ? container.getBoundingClientRect().width / scale : 0,
      explicit,
      element instanceof HTMLImageElement && !explicit && !rendered ? element.naturalWidth : 0,
    );
    if (!width) continue;
    const margin = parseFloat(getComputedStyle(container ?? element).marginRight) || 0;
    widest = Math.max(widest, width + margin);
  }
  return Math.ceil(widest);
}

export function mainFlowNonTextWidth(proseMirror: HTMLElement): number {
  let widest = 0;
  for (const child of Array.from(proseMirror.children)) {
    if (child.matches('[data-type="floating-text-box"]')) continue;
    widest = Math.max(widest, nonTextContentWidth(child as HTMLElement));
  }
  return widest;
}

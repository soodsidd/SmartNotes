import type { Node as PMNode } from "@tiptap/pm/model";

export interface PageOutlineEntry {
  key: number;
  level: 1 | 2 | 3;
  title: string;
  children: PageOutlineEntry[];
}

/** Build a heading tree from the live document without changing saved HTML. */
export function buildPageOutline(doc: PMNode): PageOutlineEntry[] {
  const roots: PageOutlineEntry[] = [];
  const parents: PageOutlineEntry[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading" || ![1, 2, 3].includes(node.attrs.level)) return;
    const level = node.attrs.level as 1 | 2 | 3;
    const entry: PageOutlineEntry = {
      key: offset,
      level,
      title: node.textContent.trim() || "Untitled section",
      children: [],
    };
    while (parents.length && parents[parents.length - 1].level >= level) parents.pop();
    if (parents.length) parents[parents.length - 1].children.push(entry);
    else roots.push(entry);
    parents.push(entry);
  });
  return roots;
}

export function outlineBranchKeys(entries: PageOutlineEntry[]): number[] {
  return entries.flatMap((entry) =>
    entry.children.length ? [entry.key, ...outlineBranchKeys(entry.children)] : []
  );
}

/** Keys to expand so the outline shows one level below the roots (sections under H1). */
export function outlineDefaultExpandedKeys(entries: PageOutlineEntry[]): number[] {
  return entries.filter((entry) => entry.children.length > 0).map((entry) => entry.key);
}

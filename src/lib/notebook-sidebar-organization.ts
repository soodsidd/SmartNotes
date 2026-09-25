import { isPageKeyNote } from "@/lib/key-note";
import type { VaultNotebook, VaultPage, VaultSection } from "@/lib/vault-contract";

export interface NotebookGroup {
  id: string;
  name: string;
  notebookPaths: string[];
  collapsed: boolean;
}

export interface NotebookFilterResult {
  tree: VaultNotebook[];
  expandedNotebooks: Set<string>;
  expandedSections: Set<string>;
  expandedPages: Set<string>;
}

export interface KeyNoteEntry {
  notebookPath: string;
  notebookName: string;
  sectionPath: string | null;
  sectionName: string | null;
  page: VaultPage;
}

export interface NotebookPresentationRow {
  kind: "group" | "notebook";
  key: string;
  group: NotebookGroup | null;
  notebook?: VaultNotebook;
}

export function sortNotebooksByOverride(
  notebooks: VaultNotebook[],
  order: string[]
): VaultNotebook[] {
  const positions = new Map(order.map((path, index) => [path, index]));
  return notebooks
    .map((notebook, sourceIndex) => ({ notebook, sourceIndex }))
    .sort((left, right) => {
      const leftPosition = positions.get(left.notebook.path);
      const rightPosition = positions.get(right.notebook.path);
      if (leftPosition !== undefined || rightPosition !== undefined) {
        if (leftPosition === undefined) return 1;
        if (rightPosition === undefined) return -1;
        return leftPosition - rightPosition;
      }
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ notebook }) => notebook);
}

function filterPagesWithAncestors(pages: VaultPage[], query: string) {
  const byParent = new Map<string | null, VaultPage[]>();
  for (const page of pages) {
    const parentId = page.parentId && pages.some((candidate) => candidate.path === page.parentId)
      ? page.parentId
      : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(page);
    byParent.set(parentId, siblings);
  }

  const included = new Set<string>();
  const expanded = new Set<string>();
  const visit = (page: VaultPage): boolean => {
    const childMatches = (byParent.get(page.path) ?? []).map(visit).some(Boolean);
    const matches = page.title.toLocaleLowerCase().includes(query);
    if (matches || childMatches) {
      included.add(page.path);
      if (childMatches) expanded.add(page.path);
      return true;
    }
    return false;
  };
  for (const root of byParent.get(null) ?? []) visit(root);

  return {
    pages: pages.filter((page) => included.has(page.path)),
    expanded,
  };
}

export function filterNotebookTree(tree: VaultNotebook[], rawQuery: string): NotebookFilterResult {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) {
    return {
      tree,
      expandedNotebooks: new Set(),
      expandedSections: new Set(),
      expandedPages: new Set(),
    };
  }

  const expandedNotebooks = new Set<string>();
  const expandedSections = new Set<string>();
  const expandedPages = new Set<string>();
  const filtered: VaultNotebook[] = [];

  for (const notebook of tree) {
    const notebookMatches = notebook.name.toLocaleLowerCase().includes(query);
    const rootPages = notebookMatches
      ? { pages: notebook.pages, expanded: new Set<string>() }
      : filterPagesWithAncestors(notebook.pages, query);
    const sections: VaultSection[] = [];

    for (const section of notebook.sections) {
      const sectionMatches = section.name.toLocaleLowerCase().includes(query);
      const pages = sectionMatches
        ? { pages: section.pages, expanded: new Set<string>() }
        : filterPagesWithAncestors(section.pages, query);
      if (notebookMatches || sectionMatches || pages.pages.length > 0) {
        sections.push({ ...section, pages: notebookMatches || sectionMatches ? section.pages : pages.pages });
        expandedSections.add(section.path);
        pages.expanded.forEach((path) => expandedPages.add(path));
      }
    }

    if (notebookMatches || rootPages.pages.length > 0 || sections.length > 0) {
      filtered.push({
        ...notebook,
        pages: notebookMatches ? notebook.pages : rootPages.pages,
        sections: notebookMatches ? notebook.sections : sections,
      });
      expandedNotebooks.add(notebook.path);
      rootPages.expanded.forEach((path) => expandedPages.add(path));
      if (notebookMatches) {
        notebook.sections.forEach((section) => expandedSections.add(section.path));
      }
    }
  }

  return { tree: filtered, expandedNotebooks, expandedSections, expandedPages };
}

export function collectKeyNoteEntries(tree: VaultNotebook[]): KeyNoteEntry[] {
  return tree.flatMap((notebook) => [
    ...notebook.pages.filter(isPageKeyNote).map((page) => ({
      notebookPath: notebook.path,
      notebookName: notebook.name,
      sectionPath: null,
      sectionName: null,
      page,
    })),
    ...notebook.sections.flatMap((section) =>
      section.pages.filter(isPageKeyNote).map((page) => ({
        notebookPath: notebook.path,
        notebookName: notebook.name,
        sectionPath: section.path,
        sectionName: section.name,
        page,
      }))
    ),
  ]);
}

export function buildNotebookPresentationRows(
  notebooks: VaultNotebook[],
  groups: NotebookGroup[]
): NotebookPresentationRow[] {
  const assigned = new Set<string>();
  const rows: NotebookPresentationRow[] = [];

  for (const group of groups) {
    const members = notebooks.filter((notebook) => group.notebookPaths.includes(notebook.path));
    if (members.length === 0) continue;
    rows.push({ kind: "group", key: `group:${group.id}`, group });
    if (!group.collapsed) {
      for (const notebook of members) {
        assigned.add(notebook.path);
        rows.push({ kind: "notebook", key: notebook.path, group, notebook });
      }
    } else {
      members.forEach((notebook) => assigned.add(notebook.path));
    }
  }

  const ungrouped = notebooks.filter((notebook) => !assigned.has(notebook.path));
  if (ungrouped.length > 0) {
    rows.push({ kind: "group", key: "group:ungrouped", group: null });
    ungrouped.forEach((notebook) =>
      rows.push({ kind: "notebook", key: notebook.path, group: null, notebook })
    );
  }
  return rows;
}

export function reorderNotebookPaths(
  currentOrder: string[],
  availablePaths: string[],
  sourcePath: string,
  targetPath: string
): string[] {
  if (sourcePath === targetPath) return currentOrder;
  const base = [
    ...currentOrder.filter((path) => availablePaths.includes(path)),
    ...availablePaths.filter((path) => !currentOrder.includes(path)),
  ].filter((path, index, values) => values.indexOf(path) === index && path !== sourcePath);
  const targetIndex = base.indexOf(targetPath);
  if (targetIndex < 0 || !availablePaths.includes(sourcePath)) return currentOrder;
  base.splice(targetIndex, 0, sourcePath);
  return base;
}

export function toggleNotebookExpansion(
  current: Set<string>,
  path: string,
  accordionMode: boolean
): Set<string> {
  if (current.has(path)) {
    const next = new Set(current);
    next.delete(path);
    return next;
  }
  return accordionMode ? new Set([path]) : new Set([...current, path]);
}

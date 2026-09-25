import { type VaultPage } from "@/lib/vault-contract";

export interface PageTreeNode {
  page: VaultPage;
  children: PageTreeNode[];
  depth: number;
}

export interface PageNestingActionState {
  canIndent: boolean;
  indentParentId: string | null;
  canOutdent: boolean;
  outdentParentId: string | null;
}

export type PageNestingActionLookup = Map<string, PageNestingActionState>;

export function buildPageTree(pages: VaultPage[]): PageTreeNode[] {
  const byPath = new Map<string, PageTreeNode>();
  const roots: PageTreeNode[] = [];
  for (const page of pages) {
    byPath.set(page.path, { page, children: [], depth: 0 });
  }
  for (const page of pages) {
    const node = byPath.get(page.path)!;
    if (page.parentId && byPath.has(page.parentId)) {
      const parent = byPath.get(page.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface PagePathLookup {
  path: string;
  parentId: string | null;
}

export interface TreeExpandEnsurePaths {
  notebookPath?: string | null;
  sectionPath?: string | null;
  pagePath?: string | null;
}

export function collectPageAncestorPaths(pagePath: string, pages: PagePathLookup[]): string[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const ancestors: string[] = [];
  let current = byPath.get(pagePath);

  while (current?.parentId) {
    ancestors.unshift(current.parentId);
    current = byPath.get(current.parentId);
  }

  return ancestors;
}

export function mergeTreeExpandState(
  current: { notebooks: Set<string>; sections: Set<string>; pages: Set<string> },
  ensure: TreeExpandEnsurePaths,
  allPages: PagePathLookup[]
): { notebooks: Set<string>; sections: Set<string>; pages: Set<string> } {
  const notebooks = new Set(current.notebooks);
  const sections = new Set(current.sections);
  const pages = new Set(current.pages);

  if (ensure.notebookPath) {
    notebooks.add(ensure.notebookPath);
  }

  if (ensure.sectionPath) {
    sections.add(ensure.sectionPath);
  }

  if (ensure.pagePath) {
    for (const ancestorPath of collectPageAncestorPaths(ensure.pagePath, allPages)) {
      pages.add(ancestorPath);
    }
  }

  return { notebooks, sections, pages };
}

export function resolveTreeExpandPathsForPage(
  tree: Array<{ path: string; pages?: PagePathLookup[]; sections: Array<{ path: string; pages: PagePathLookup[] }> }>,
  pagePath: string | null | undefined
): TreeExpandEnsurePaths {
  if (!pagePath) {
    return {};
  }

  for (const notebook of tree) {
    if (notebook.pages?.some((page) => page.path === pagePath)) {
      return {
        notebookPath: notebook.path,
        pagePath,
      };
    }

    for (const section of notebook.sections) {
      if (section.pages.some((page) => page.path === pagePath)) {
        return {
          notebookPath: notebook.path,
          sectionPath: section.path,
          pagePath,
        };
      }
    }
  }

  return { pagePath };
}

export function flattenPageTree(nodes: PageTreeNode[], expanded: Set<string>): PageTreeNode[] {
  const result: PageTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0 && expanded.has(node.page.path)) {
      result.push(...flattenPageTree(node.children, expanded));
    }
  }
  return result;
}

export function buildPageNestingActionLookup(flatNodes: PageTreeNode[]): PageNestingActionLookup {
  const byPath = new Map(flatNodes.map((node) => [node.page.path, node]));
  const lookup: PageNestingActionLookup = new Map();

  flatNodes.forEach((node, index) => {
    const previous = index > 0 ? flatNodes[index - 1] : null;
    const canIndent = previous !== null && previous.depth < 2;
    const indentParentId = canIndent ? previous.page.path : null;

    if (!node.page.parentId) {
      lookup.set(node.page.path, {
        canIndent,
        indentParentId,
        canOutdent: false,
        outdentParentId: null,
      });
      return;
    }

    const parent = byPath.get(node.page.parentId) ?? null;
    lookup.set(node.page.path, {
      canIndent,
      indentParentId,
      canOutdent: true,
      outdentParentId: parent?.page.parentId ?? null,
    });
  });

  return lookup;
}

export function getPageNestingActionState(
  lookup: PageNestingActionLookup,
  currentPath: string
): PageNestingActionState {
  return (
    lookup.get(currentPath) ?? {
      canIndent: false,
      indentParentId: null,
      canOutdent: false,
      outdentParentId: null,
    }
  );
}

export type SidebarPageDropIntent = "nest" | "unnest" | "reorder";

export interface SidebarPageDropResult {
  parentId: string | null;
  orderedIds: string[];
}

export function isPageDescendantOf(
  pages: PagePathLookup[],
  candidatePath: string,
  ancestorPath: string
): boolean {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  let current = byPath.get(candidatePath);
  while (current?.parentId) {
    if (current.parentId === ancestorPath) {
      return true;
    }
    current = byPath.get(current.parentId);
  }
  return false;
}

export function computePageDepthInSection(
  pagePath: string,
  pages: PagePathLookup[]
): number {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  let depth = 0;
  let current = byPath.get(pagePath);
  while (current?.parentId && byPath.has(current.parentId)) {
    depth += 1;
    current = byPath.get(current.parentId)!;
  }
  return depth;
}

export function resolveSidebarPageDrop(input: {
  intent: SidebarPageDropIntent;
  sourcePath: string;
  targetPath: string;
  dropSide: "before" | "after" | null;
  pages: PagePathLookup[];
  nestingLookup: PageNestingActionLookup;
}): SidebarPageDropResult | null {
  const { intent, sourcePath, targetPath, dropSide, pages, nestingLookup } = input;
  if (sourcePath === targetPath) {
    return null;
  }

  const sourcePage = pages.find((page) => page.path === sourcePath);
  const targetPage = pages.find((page) => page.path === targetPath);
  if (!sourcePage || !targetPage) {
    return null;
  }

  let nextParentId = sourcePage.parentId ?? null;

  if (intent === "nest") {
    if (isPageDescendantOf(pages, targetPath, sourcePath)) {
      return null;
    }
    const targetDepth = computePageDepthInSection(targetPath, pages);
    if (targetDepth >= 2) {
      return null;
    }
    nextParentId = targetPath;
  } else if (intent === "unnest") {
    const sourceNesting = getPageNestingActionState(nestingLookup, sourcePath);
    if (!sourceNesting.canOutdent) {
      return null;
    }
    nextParentId = sourceNesting.outdentParentId;
  } else if (intent === "reorder") {
    if (!dropSide) {
      return null;
    }
    nextParentId = targetPage.parentId ?? null;
  } else {
    return null;
  }

  if (nextParentId) {
    if (isPageDescendantOf(pages, nextParentId, sourcePath)) {
      return null;
    }
    if (computePageDepthInSection(nextParentId, pages) >= 2) {
      return null;
    }
  }

  const filtered = pages.map((page) => page.path).filter((path) => path !== sourcePath);
  const targetIdx = filtered.indexOf(targetPath);
  if (targetIdx < 0) {
    return null;
  }

  let insertAt = targetIdx;
  if (intent === "nest" || dropSide === "after") {
    insertAt = targetIdx + 1;
  }
  filtered.splice(insertAt, 0, sourcePath);

  return { parentId: nextParentId, orderedIds: filtered };
}

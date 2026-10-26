type VaultNotebook = { path: string; color: string; pages: unknown[]; sections: unknown[] };

/** SN-382: closed notebooks are identity-only tree rows; these helpers keep the shell's scoped tree consistent. */

export function sameNotebookSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const path of left) if (!right.has(path)) return false;
  return true;
}

/**
 * Merge a one-notebook scoped payload into the tree. The scoped read colors its
 * only result as index 0, so keep the color the full tree already assigned.
 */
export function mergeScopedNotebook<T extends Pick<VaultNotebook, "path" | "color">>(tree: T[], opened: T): T[] {
  let found = false;
  const next = tree.map((notebook) => {
    if (notebook.path !== opened.path) return notebook;
    found = true;
    return { ...opened, color: notebook.color };
  });
  return found ? next : [...tree, opened];
}

/** Drop a closed notebook's pages and sections from client state. */
export function releaseNotebook<T extends Pick<VaultNotebook, "path" | "pages" | "sections">>(tree: T[], notebookPath: string): T[] {
  return tree.map((notebook) => notebook.path === notebookPath ? { ...notebook, pages: [], sections: [] } : notebook);
}

/** Notebooks that left the closed set and still hold only an identity row. */
export function notebooksNeedingHydration<T extends Pick<VaultNotebook, "path" | "pages" | "sections">>(
  tree: T[],
  previouslyClosed: ReadonlySet<string>,
  closed: ReadonlySet<string>
): string[] {
  return tree
    .filter((notebook) => previouslyClosed.has(notebook.path) && !closed.has(notebook.path))
    .filter((notebook) => notebook.pages.length === 0 && notebook.sections.length === 0)
    .map((notebook) => notebook.path);
}

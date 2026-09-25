import type { NotebookGroup } from "@/lib/notebook-sidebar-organization";

export interface VaultUiStatePayload {
  expandedNotebooks?: string[];
  expandedSections?: string[];
  closedNotebooks?: string[];
  expandedPages?: string[];
  accordionMode?: boolean;
  pinnedNotebooks?: string[];
  pinnedPages?: string[];
  notebookOrder?: string[];
  notebookGroups?: NotebookGroup[];
  archivedNotebooks?: string[];
  companionPersist?: boolean;
}

export function hasPersistedExpandState(state: VaultUiStatePayload | null | undefined): boolean {
  if (!state) {
    return false;
  }
  return Array.isArray(state.expandedNotebooks) || Array.isArray(state.expandedSections);
}

export function resolveClosedNotebooksFromVaultState(
  state: VaultUiStatePayload | null | undefined,
  localFallback: Iterable<string>
): Set<string> {
  if (Array.isArray(state?.closedNotebooks)) {
    return new Set(state.closedNotebooks);
  }
  return new Set(localFallback);
}

export function filterPersistedPaths(
  paths: string[] | undefined,
  validPaths: Set<string>
): Set<string> {
  return new Set((paths ?? []).filter((path) => validPaths.has(path)));
}

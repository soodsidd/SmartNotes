import { parseStickyDeepWorkRecord, stickyDeepWorkRecord, isStickyDeepWorkCandidate } from "@/lib/deep-work-sticky";
import { workspaceDisplayNameFromPath, type DeepWorkDescriptor } from "@/lib/deep-work";
import { sameDeepWorkRootPath, stickyRootRevalidationDisposition } from "@/lib/deep-work-refresh";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

// ---------------------------------------------------------------------------
// Page-owned Deep Work workspace binding (SN-347)
//
// A vault Jupyter page can bind an absolute disk folder directly to itself,
// persisted in its own frontmatter (`jupyter_workspace`) instead of the
// app-global SN-262 sticky root. The record shape is identical to the sticky
// one (minus `savedAt`) and reuses its validation, so a page binding is held
// to the exact same bar: an owner-opened disk root only, never AV identity or
// a return URL, and a restored record is a request, never an authorization —
// the shell re-enters the ordinary /api/jupyter/workspace/session launch
// exactly like SN-262 sticky restore (see notebook-shell-reliable.tsx).
// ---------------------------------------------------------------------------

export const JUPYTER_PAGE_WORKSPACE_KEY = "jupyter_workspace";

/** Shown when a page-bound root's own launch attempt fails definitively (SN-270 boundary). */
export const JUPYTER_PAGE_WORKSPACE_FALLBACK_MESSAGE =
  "This page's linked Deep Work folder is missing or invalid. Showing this page's own notebook. Use Open workspace… to relink, or unlink it from the folder menu.";

/** Frontmatter carries a request, never a session capability or AV identity. */
export function pageWorkspaceRecord(workspace: DeepWorkDescriptor) {
  const record = stickyDeepWorkRecord(workspace);
  if (!record) return null;
  const { savedAt: _savedAt, ...request } = record;
  return request;
}

export function pageWorkspaceFromMetadata(metadata: Record<string, unknown> | undefined): DeepWorkDescriptor | null {
  const request = metadata?.[JUPYTER_PAGE_WORKSPACE_KEY];
  const descriptor = parseStickyDeepWorkRecord(request);
  return descriptor ? { ...descriptor, projectName: workspaceDisplayNameFromPath(descriptor.rootPath) } : null;
}

export function activeJupyterPageBindingTarget(input: {
  pagePath: string | null;
  activePagePath: string | null;
  noteType: string | null;
  avLinked: boolean;
}): string | null {
  return input.noteType === "jupyter" &&
    input.pagePath &&
    input.pagePath === input.activePagePath &&
    !input.pagePath.startsWith("deep-work-") &&
    !input.avLinked
      ? input.pagePath
      : null;
}

/** Only a server decision about the root may replace the bound Lab with the page notebook. */
export function shouldFallbackBoundJupyterWorkspace(error: unknown): boolean {
  return stickyRootRevalidationDisposition(error) === "clear";
}

function hashIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function jupyterLabWorkspaceName(pagePath: string, rootPath?: string): string {
  return `sn-${hashIdentity(pagePath)}-${hashIdentity(rootPath ?? pagePath)}`;
}

/** JupyterLab's named workspace URL preserves tabs and layout for this page/root pair. */
export function jupyterLabWorkspaceUrl(url: string, pagePath: string, rootPath?: string): string {
  const match = /^(.*\/lab)(\/tree\/[^?]*)?(\?.*)?$/.exec(url);
  if (!match) return url;
  return `${match[1]}/workspaces/${jupyterLabWorkspaceName(pagePath, rootPath)}${match[2] ?? ""}${match[3] ?? ""}`;
}

/** True when this vault Jupyter page's stored binding requests the given disk root. */
export function pageBindsDeepWorkRoot(
  page: Pick<VaultPage, "noteType" | "metadata"> | null | undefined,
  rootPath: string
): boolean {
  if (page?.noteType !== "jupyter") return false;
  const bound = pageWorkspaceFromMetadata(page.metadata);
  return Boolean(bound && sameDeepWorkRootPath(bound.rootPath, rootPath));
}

export interface BoundVaultPageMatch {
  notebookPath: string;
  sectionPath: string | null;
  pagePath: string;
  page: VaultPage;
}

/**
 * Find vault Jupyter pages that already claim `rootPath` via jupyter_workspace.
 * Prefer `preferredPagePath` when it is one of those pages.
 */
export function findVaultPageBoundToRoot(
  tree: VaultNotebook[] | null | undefined,
  rootPath: string,
  preferredPagePath?: string | null
): BoundVaultPageMatch | null {
  if (!tree?.length || !rootPath.trim()) return null;
  const matches: BoundVaultPageMatch[] = [];
  for (const notebook of tree) {
    for (const page of notebook.pages) {
      if (pageBindsDeepWorkRoot(page, rootPath)) {
        matches.push({ notebookPath: notebook.path, sectionPath: null, pagePath: page.path, page });
      }
    }
    for (const section of notebook.sections) {
      for (const page of section.pages) {
        if (pageBindsDeepWorkRoot(page, rootPath)) {
          matches.push({
            notebookPath: notebook.path,
            sectionPath: section.path,
            pagePath: page.path,
            page,
          });
        }
      }
    }
  }
  if (matches.length === 0) return null;
  if (preferredPagePath) {
    const preferred = matches.find((match) => match.pagePath === preferredPagePath);
    if (preferred) return preferred;
  }
  return matches[0] ?? null;
}

export type StickyBootPreference =
  /** Mount the SN-262 orphan Deep Work draft for an unbound sticky root. */
  | { kind: "sticky"; workspace: DeepWorkDescriptor }
  /** Select the vault page that already owns this sticky root (SN-347). */
  | { kind: "bound-page"; match: BoundVaultPageMatch }
  /** No sticky orphan: AV URL wins, last page keeps its binding claim, or nothing to restore. */
  | { kind: "none" };

/**
 * SN-347 boot preference over SN-262 sticky restore: a sticky disk root that is
 * already bound to a vault Jupyter page must select that page — never a
 * synthetic deep-work-pending orphan. Sticky localStorage itself is left alone
 * so non-page opens and unbound restore still work.
 */
export function resolveStickyBootPreference(input: {
  linkedWorkspace?: DeepWorkDescriptor | null;
  sticky?: DeepWorkDescriptor | null;
  tree?: VaultNotebook[] | null;
  lastPagePath?: string | null;
}): StickyBootPreference {
  if (input.linkedWorkspace) return { kind: "none" };
  if (!isStickyDeepWorkCandidate(input.sticky)) return { kind: "none" };

  const bound = findVaultPageBoundToRoot(input.tree, input.sticky.rootPath, input.lastPagePath);
  if (bound) return { kind: "bound-page", match: bound };

  // A last-selected Jupyter page that claims a binding (valid or malformed)
  // owns reload; do not replace it with an unrelated sticky orphan.
  if (input.lastPagePath && input.tree?.length) {
    for (const notebook of input.tree) {
      const pages = [
        ...notebook.pages,
        ...notebook.sections.flatMap((section) => section.pages),
      ];
      const lastPage = pages.find((page) => page.path === input.lastPagePath);
      if (
        lastPage?.noteType === "jupyter" &&
        Object.prototype.hasOwnProperty.call(lastPage.metadata ?? {}, JUPYTER_PAGE_WORKSPACE_KEY)
      ) {
        return { kind: "none" };
      }
    }
  }

  return { kind: "sticky", workspace: input.sticky };
}

import { parseStickyDeepWorkRecord, stickyDeepWorkRecord } from "@/lib/deep-work-sticky";
import { workspaceDisplayNameFromPath, type DeepWorkDescriptor } from "@/lib/deep-work";
import { stickyRootRevalidationDisposition } from "@/lib/deep-work-refresh";

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

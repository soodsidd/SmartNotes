export interface ReloadableDraftSnapshot {
  path: string;
  title: string;
  content: string;
}

/**
 * Apply server-owned save metadata without letting an older in-flight response
 * overwrite edits made after that save began. The queued save path will persist
 * the preserved local title/content next (SN-272).
 */
export function rebaseDraftAfterSave<T extends ReloadableDraftSnapshot>(
  latestDraft: T,
  savedPage: T
): T {
  return {
    ...latestDraft,
    ...savedPage,
    path: latestDraft.path,
    title: latestDraft.title,
    content: latestDraft.content,
  };
}

export function buildReloadDraftSnapshot(page: ReloadableDraftSnapshot) {
  return JSON.stringify({
    path: page.path,
    title: page.title,
    content: page.content,
  });
}

/** Synthetic Deep Work shell drafts are not vault pages and have no local SN autosave. */
export function isDeepWorkShellDraftPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith("deep-work-");
}

export function hasUnsavedLocalDraftChanges(
  draft: ReloadableDraftSnapshot | null | undefined,
  lastSavedSnapshot: string | null | undefined
) {
  if (!draft) {
    return false;
  }

  // SN-263: sticky/open Deep Work seeds a synthetic draft without hydrateDraft's
  // lastSavedSnapshot. Treat those drafts as clean so vault_updated cannot arm a
  // permanent pending-reload indicator against a non-vault page.
  if (isDeepWorkShellDraftPath(draft.path)) {
    return false;
  }

  return buildReloadDraftSnapshot(draft) !== lastSavedSnapshot;
}

export function shouldBlockPendingPageReload(input: {
  draft: ReloadableDraftSnapshot | null | undefined;
  pendingPath: string | null | undefined;
  lastSavedSnapshot: string | null | undefined;
  hasUnsavedSurfaceChanges?: boolean;
}) {
  const { draft, pendingPath, lastSavedSnapshot, hasUnsavedSurfaceChanges = false } = input;
  if (!draft || !pendingPath || draft.path !== pendingPath) {
    return false;
  }

  return hasUnsavedSurfaceChanges || hasUnsavedLocalDraftChanges(draft, lastSavedSnapshot);
}

export function getReloadStatusLabel(input: {
  reloadSafetyMessage: string | null;
  hasPendingPageReload: boolean;
  hasPendingVaultReload: boolean;
  saveStateLabel: string;
}) {
  if (input.reloadSafetyMessage) {
    return input.reloadSafetyMessage;
  }

  if (input.hasPendingPageReload) {
    return "Remote update available";
  }

  if (input.hasPendingVaultReload) {
    return "Vault structure changed";
  }

  return input.saveStateLabel;
}

export function getReloadButtonLabel(input: {
  hasPendingPageReload: boolean;
  hasPendingVaultReload: boolean;
}) {
  if (input.hasPendingPageReload) {
    return "Reload latest page changes";
  }

  if (input.hasPendingVaultReload) {
    return "Reload vault structure";
  }

  return "Reload vault";
}

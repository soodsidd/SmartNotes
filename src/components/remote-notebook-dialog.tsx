"use client";

import * as React from "react";
import {
  Check,
  ChevronLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Server,
} from "lucide-react";
import {
  createServerFolder,
  listServerFolders,
  pickNativeFolder,
  validateServerFolder,
  type ServerFolderListing,
} from "@/lib/api/fs-native";
import {
  registerPortableNotebook,
  type PortableNotebookRecord,
} from "@/lib/api/notebook-registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SERVER_BOUNDARY_MESSAGE =
  "This browser shows folders on the Smart Notes backend host, not folders on this phone.";

type FolderMode = "native" | "server";

function shouldUseServerBrowserByDefault() {
  if (typeof window === "undefined") {
    return true;
  }

  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  const narrow = window.matchMedia?.("(max-width: 767px)")?.matches || window.innerWidth < 768;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
  return Boolean(standalone || (narrow && coarsePointer));
}

function formatApiError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function registerPortableNotebookWithTimeout(
  payload: Parameters<typeof registerPortableNotebook>[0],
  timeoutMs = 15000
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await registerPortableNotebook(payload, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        "Registering the server folder timed out. The selected path must be reachable from the Smart Notes backend host."
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function ServerFolderBrowser({
  initialPath,
  disabled,
  onUseFolder,
}: {
  initialPath?: string | null;
  disabled?: boolean;
  onUseFolder: (path: string) => void;
}) {
  const [listing, setListing] = React.useState<ServerFolderListing | null>(null);
  const [pathInput, setPathInput] = React.useState(initialPath ?? "");
  const [folderName, setFolderName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [using, setUsing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadFolder = React.useCallback(async (path?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const nextListing = await listServerFolders(path ?? undefined);
      setListing(nextListing);
      setPathInput(nextListing.path);
    } catch (loadError) {
      setError(formatApiError(loadError, "Failed to list server folders."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadFolder(initialPath);
  }, [initialPath, loadFolder]);

  const handleCreateFolder = React.useCallback(async () => {
    if (!listing || !folderName.trim()) {
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const nextListing = await createServerFolder({
        parentPath: listing.path,
        folderName: folderName.trim(),
      });
      setFolderName("");
      setListing(nextListing);
      setPathInput(nextListing.path);
    } catch (createError) {
      setError(formatApiError(createError, "Failed to create server folder."));
    } finally {
      setCreating(false);
    }
  }, [folderName, listing]);

  const handleUseFolder = React.useCallback(async () => {
    if (!listing) {
      return;
    }

    setUsing(true);
    setError(null);
    try {
      const result = await validateServerFolder(listing.path);
      onUseFolder(result.path);
    } catch (validateError) {
      setError(formatApiError(validateError, "Failed to validate server folder."));
    } finally {
      setUsing(false);
    }
  }, [listing, onUseFolder]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3" data-testid="server-folder-browser">
      <div className="flex items-start gap-2">
        <Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Server folder browser</p>
          <p className="text-xs text-muted-foreground">{SERVER_BOUNDARY_MESSAGE}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {listing?.roots.map((root) => (
          <Button
            key={`${root.label}:${root.path}`}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void loadFolder(root.path)}
            disabled={disabled || loading || creating || using}
            data-testid="server-folder-root-btn"
          >
            {root.label}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          placeholder="Server path"
          disabled={disabled || loading || creating || using}
          data-testid="server-folder-path-input"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="Open server path"
          onClick={() => void loadFolder(pathInput)}
          disabled={disabled || loading || creating || using || !pathInput.trim()}
          data-testid="server-folder-go-btn"
        >
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="sr-only">Open server path</span>
        </Button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-background" data-testid="server-folder-list">
        {listing?.parentPath ? (
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-foreground hover:bg-muted/40 disabled:opacity-50"
            onClick={() => void loadFolder(listing.parentPath)}
            disabled={disabled || loading || creating || using}
            data-testid="server-folder-parent-btn"
          >
            <ChevronLeft className="size-4 text-muted-foreground" />
            Parent folder
          </button>
        ) : null}
        {loading && !listing ? (
          <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading server folders
          </div>
        ) : null}
        {listing?.entries.length ? (
          listing.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="flex min-h-10 w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm text-foreground last:border-b-0 hover:bg-muted/40 disabled:opacity-50"
              onClick={() => void loadFolder(entry.path)}
              disabled={disabled || loading || creating || using}
              data-testid="server-folder-entry-btn"
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{entry.name}</span>
            </button>
          ))
        ) : listing && !loading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No child folders here.</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          placeholder="New folder name"
          disabled={disabled || loading || creating || using || !listing}
          data-testid="server-folder-new-name-input"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleCreateFolder()}
          disabled={disabled || loading || creating || using || !listing || !folderName.trim()}
          data-testid="server-folder-create-btn"
        >
          {creating ? <LoaderCircle className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
          Create
        </Button>
      </div>

      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="server-folder-error">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        className="w-full"
        onClick={() => void handleUseFolder()}
        disabled={disabled || loading || creating || using || !listing}
        data-testid="server-folder-use-btn"
      >
        {using ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
        Use this folder
      </Button>
    </div>
  );
}

export function RemoteNotebookForm({
  onCancel,
  onSuccess,
  onRegistered,
}: {
  onCancel?: () => void;
  onSuccess?: () => void;
  onRegistered?: (notebook: PortableNotebookRecord) => void | Promise<void>;
}) {
  const [displayName, setDisplayName] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [folderMode, setFolderMode] = React.useState<FolderMode>(() =>
    shouldUseServerBrowserByDefault() ? "server" : "native"
  );
  const [serverBrowserDefault, setServerBrowserDefault] = React.useState(() =>
    shouldUseServerBrowserByDefault()
  );
  const [picking, setPicking] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const shouldUseServer = shouldUseServerBrowserByDefault();
    setServerBrowserDefault(shouldUseServer);
    setFolderMode(shouldUseServer ? "server" : "native");
  }, []);

  const resetForm = React.useCallback(() => {
    setDisplayName("");
    setSelectedPath(null);
    setError(null);
    setPicking(false);
    setSubmitting(false);
    const shouldUseServer = shouldUseServerBrowserByDefault();
    setServerBrowserDefault(shouldUseServer);
    setFolderMode(shouldUseServer ? "server" : "native");
  }, []);

  const handlePickFolder = React.useCallback(async () => {
    setPicking(true);
    setError(null);
    try {
      const result = await pickNativeFolder({
        initialPath: selectedPath ?? undefined,
        title: "Choose or create a notebook folder",
      });
      if (result.cancelled || !result.path) {
        return;
      }
      setSelectedPath(result.path);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Failed to open folder picker.");
    } finally {
      setPicking(false);
    }
  }, [selectedPath]);

  const handleRegister = React.useCallback(async () => {
    if (!selectedPath) {
      setError(
        folderMode === "server"
          ? "Use the server folder browser to select a backend-host folder first."
          : "Choose a folder in Windows Explorer first."
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    let notebook: PortableNotebookRecord | null = null;
    try {
      const response = await registerPortableNotebookWithTimeout(
        {
          rootPath: selectedPath,
          name: displayName.trim() || undefined,
          createIfMissing: true,
        }
      );
      notebook = response.notebook;
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Failed to register notebook.");
      return;
    } finally {
      setSubmitting(false);
    }

    resetForm();
    onSuccess?.();

    if (notebook) {
      try {
        await onRegistered?.(notebook);
      } catch (followUpError) {
        console.error("[smart-notes] remote notebook registered but follow-up failed", followUpError);
      }
    }
  }, [displayName, folderMode, onRegistered, onSuccess, resetForm, selectedPath]);

  const handleCancel = React.useCallback(() => {
    resetForm();
    onCancel?.();
  }, [onCancel, resetForm]);

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="remote-notebook-name">
            Display name (optional)
          </label>
          <Input
            id="remote-notebook-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Project notes"
            data-testid="remote-notebook-name-input"
          />
        </div>

        <div className="rounded-md border border-border bg-muted/10 p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Folder location</p>
          <p className="mt-1 truncate text-sm text-foreground" data-testid="remote-notebook-selected-path">
            {selectedPath ?? "No folder selected yet"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!serverBrowserDefault ? (
              <Button
                type="button"
                variant={folderMode === "native" ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setFolderMode("native");
                  void handlePickFolder();
                }}
                disabled={picking || submitting}
                data-testid="remote-notebook-pick-folder-btn"
              >
                {picking ? <LoaderCircle className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                Windows picker
              </Button>
            ) : null}
            <Button
              type="button"
              variant={folderMode === "server" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setFolderMode("server")}
              disabled={picking || submitting}
              data-testid="remote-notebook-server-browser-btn"
            >
              <Server className="size-4" />
              Browse server folders
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <HardDrive className="size-3.5" />
            {serverBrowserDefault
              ? SERVER_BOUNDARY_MESSAGE
              : "The Windows picker opens on this backend computer; server browsing also works from phones and tablets."}
          </p>
        </div>

        {folderMode === "server" ? (
          <ServerFolderBrowser
            initialPath={selectedPath}
            disabled={submitting || picking}
            onUseFolder={(path) => {
              setSelectedPath(path);
              setError(null);
            }}
          />
        ) : null}

        {error ? (
          <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={handleCancel} data-testid="remote-notebook-cancel-btn">
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void handleRegister()}
          disabled={submitting || !selectedPath}
          data-testid="remote-notebook-register-btn"
        >
          {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
          Add notebook
        </Button>
      </DialogFooter>
    </>
  );
}

export function RemoteNotebookDialog({
  open,
  onOpenChange,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered?: (notebook: PortableNotebookRecord) => void | Promise<void>;
}) {
  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="remote-notebook-dialog">
        <DialogHeader>
          <DialogTitle>Remote notebook</DialogTitle>
          <DialogDescription>
            Register a notebook folder on the Smart Notes backend host. Desktop can use the Windows picker; phones use the in-app server-folder browser.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <RemoteNotebookForm
            key="remote-notebook-form"
            onCancel={() => handleOpenChange(false)}
            onSuccess={() => handleOpenChange(false)}
            onRegistered={onRegistered}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

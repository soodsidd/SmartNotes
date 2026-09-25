"use client";

import * as React from "react";
import {
  ChevronLeft,
  FileCode2,
  Folder,
  Link2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FsNativeApiError, listPortableHtml, type PortableHtmlListing } from "@/lib/api/fs-native";
import { cn } from "@/lib/utils";

function formatApiError(error: unknown, fallback: string) {
  if (error instanceof FsNativeApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * In-app HTML picker constrained to portable-notebook roots.
 * Used for Link / Relink so Inspect and phone clients are not stuck waiting
 * on a host-only WinForms dialog.
 */
export function LinkDesignSourceDialog({
  open,
  onOpenChange,
  initialPath,
  mode = "link",
  replaceCurrent = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string | null;
  mode?: "link" | "relink";
  replaceCurrent?: boolean;
  onConfirm: (absolutePath: string) => void | Promise<void>;
}) {
  const [listing, setListing] = React.useState<PortableHtmlListing | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadFolder = React.useCallback(async (folderPath?: string | null) => {
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    try {
      const next = await listPortableHtml(folderPath ?? undefined);
      setListing(next);
    } catch (loadError) {
      setListing(null);
      setError(formatApiError(loadError, "Failed to list HTML files in the portable notebook."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadFolder(initialPath);
  }, [open, initialPath, loadFolder]);

  const handleConfirm = React.useCallback(async () => {
    if (!selectedPath) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirm(selectedPath);
      onOpenChange(false);
    } catch (confirmError) {
      setError(formatApiError(confirmError, "Failed to link the selected HTML file."));
    } finally {
      setConfirming(false);
    }
  }, [onConfirm, onOpenChange, selectedPath]);

  const title =
    mode === "relink"
      ? "Relink design source"
      : replaceCurrent
        ? "Choose source for this design"
        : "Link design from source";
  const confirmLabel =
    mode === "relink" ? "Relink…" : replaceCurrent ? "Use this HTML" : "Link design…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,640px)] w-[min(96vw,560px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        data-testid="link-design-source-dialog"
      >
        <DialogHeader className="space-y-1 border-b border-border px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Choose a self-contained <code className="font-mono">.html</code> file inside a
            registered remote (portable) notebook. Smart Notes keeps link metadata separately and
            does not copy the file.
            {replaceCurrent
              ? " The empty design page will be replaced, leaving one tree entry."
              : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {listing?.roots.map((root) => (
              <Button
                key={`${root.id}:${root.path}`}
                type="button"
                variant={listing.portableNotebookId === root.id ? "secondary" : "outline"}
                size="xs"
                onClick={() => void loadFolder(root.path)}
                disabled={loading || confirming}
                data-testid="link-design-root-btn"
              >
                {root.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className="min-w-0 flex-1 truncate font-mono"
              title={listing?.path}
              data-testid="link-design-current-path"
            >
              {listing?.path ?? "…"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void loadFolder(listing?.path ?? initialPath)}
              disabled={loading || confirming}
              data-testid="link-design-refresh-btn"
              aria-label="Refresh folder"
            >
              {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </Button>
          </div>

          <div
            className="min-h-[220px] flex-1 overflow-y-auto rounded-md border border-border bg-background"
            data-testid="link-design-file-list"
          >
            {listing?.parentPath ? (
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-50"
                onClick={() => void loadFolder(listing.parentPath)}
                disabled={loading || confirming}
                data-testid="link-design-parent-btn"
              >
                <ChevronLeft className="size-4 text-muted-foreground" />
                Parent folder
              </button>
            ) : null}

            {loading && !listing ? (
              <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Loading…
              </div>
            ) : null}

            {listing?.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className="flex min-h-10 w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40 disabled:opacity-50"
                onClick={() => void loadFolder(folder.path)}
                disabled={loading || confirming}
                data-testid="link-design-folder-btn"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{folder.name}</span>
              </button>
            ))}

            {listing?.files.map((file) => {
              const selected = selectedPath === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  className={cn(
                    "flex min-h-10 w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40 disabled:opacity-50",
                    selected && "bg-accent/10 text-foreground"
                  )}
                  onClick={() => setSelectedPath(file.path)}
                  onDoubleClick={() => {
                    setSelectedPath(file.path);
                    void (async () => {
                      setConfirming(true);
                      setError(null);
                      try {
                        await onConfirm(file.path);
                        onOpenChange(false);
                      } catch (confirmError) {
                        setError(
                          formatApiError(confirmError, "Failed to link the selected HTML file.")
                        );
                      } finally {
                        setConfirming(false);
                      }
                    })();
                  }}
                  disabled={loading || confirming}
                  data-testid="link-design-file-btn"
                  data-path={file.path}
                >
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{file.name}</span>
                </button>
              );
            })}

            {listing && !loading && listing.folders.length === 0 && listing.files.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                No HTML files in this folder. Copy a self-contained design here, then refresh.
              </p>
            ) : null}
          </div>

          {error ? (
            <p
              className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="link-design-error"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-4 py-3 sm:justify-between">
          <p className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block" title={selectedPath ?? undefined}>
            {selectedPath ? selectedPath : "Select an .html file to continue"}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={!selectedPath || confirming || loading}
              data-testid="link-design-confirm-btn"
              className="gap-1.5"
            >
              {confirming ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

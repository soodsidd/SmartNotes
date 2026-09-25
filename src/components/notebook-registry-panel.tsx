"use client";

import * as React from "react";
import { FolderPlus, LoaderCircle, Trash2 } from "lucide-react";
import {
  fetchPortableNotebooks,
  unregisterPortableNotebook,
  type PortableNotebookRecord,
} from "@/lib/api/notebook-registry";
import { RemoteNotebookDialog } from "@/components/remote-notebook-dialog";
import { Button } from "@/components/ui/button";

export function NotebookRegistryPanel({
  onTreeRefresh,
}: {
  onTreeRefresh?: (notebook?: PortableNotebookRecord) => void | Promise<void>;
}) {
  const [notebooks, setNotebooks] = React.useState<PortableNotebookRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [remoteDialogOpen, setRemoteDialogOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadNotebooks = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchPortableNotebooks();
      setNotebooks(response.notebooks);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load remote notebooks.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);

  const handleRegistered = React.useCallback(
    async (notebook: PortableNotebookRecord) => {
      await loadNotebooks();
      await onTreeRefresh?.(notebook);
    },
    [loadNotebooks, onTreeRefresh]
  );

  const handleRemove = React.useCallback(
    async (id: string) => {
      setRemovingId(id);
      setError(null);
      try {
        await unregisterPortableNotebook(id);
        await loadNotebooks();
        await onTreeRefresh?.();
      } catch (removeError) {
        setError(removeError instanceof Error ? removeError.message : "Failed to remove notebook.");
      } finally {
        setRemovingId(null);
      }
    },
    [loadNotebooks, onTreeRefresh]
  );

  return (
    <div className="space-y-5 pt-1">
      <section className="space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Remote notebooks</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Register folders from anywhere on this computer. Use the Windows folder browser to choose or create a notebook directory.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => setRemoteDialogOpen(true)}
          data-testid="settings-add-remote-notebook-btn"
        >
          <FolderPlus className="size-4" />
          Add remote notebook
        </Button>
      </section>

      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Registered folders</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Loading…
          </div>
        ) : notebooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No remote notebooks registered yet.</p>
        ) : (
          <ul className="space-y-2">
            {notebooks.map((notebook) => (
              <li
                key={notebook.id}
                className="flex items-start gap-3 rounded border border-border px-3 py-2.5"
                data-testid={`portable-notebook-${notebook.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{notebook.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{notebook.rootPath}</p>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${notebook.name}`}
                  disabled={removingId === notebook.id}
                  onClick={() => void handleRemove(notebook.id)}
                  data-testid={`remove-portable-notebook-${notebook.id}`}
                >
                  {removingId === notebook.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RemoteNotebookDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onRegistered={handleRegistered}
      />
    </div>
  );
}

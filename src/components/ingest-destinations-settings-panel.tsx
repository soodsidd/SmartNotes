"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createEmptyIngestDestination,
  fetchIngestDestinationsSettings,
  fetchIngestNotebookOptions,
  saveIngestDestinationsSettings,
  type IngestNotebookOption,
} from "@/lib/api/ingest-destinations";
import type { IngestDestination } from "@/server/ingest-destinations";

interface DraftRow extends IngestDestination {
  key: string;
}

let draftKeySeq = 0;
function nextDraftKey() {
  draftKeySeq += 1;
  return `draft-${draftKeySeq}`;
}

function toDraftRows(destinations: IngestDestination[]): DraftRow[] {
  return destinations.map((entry) => ({ ...entry, key: nextDraftKey() }));
}

function validateDraftRows(
  rows: DraftRow[],
  notebooks: IngestNotebookOption[]
): string | null {
  const knownPaths = new Set(notebooks.map((notebook) => notebook.path.trim().toLowerCase()));
  const seenIds = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = row.id.trim();
    const label = row.label.trim();
    const notebookPath = row.notebookPath.trim();
    const position = `Destination ${index + 1}`;

    if (!id) {
      return `${position} is missing an id.`;
    }
    const key = id.toLowerCase();
    if (seenIds.has(key)) {
      return `Duplicate destination id "${id}".`;
    }
    seenIds.add(key);

    if (!label) {
      return `Destination "${id}" is missing a label.`;
    }

    if (!notebookPath || !knownPaths.has(notebookPath.toLowerCase())) {
      return `Destination "${id}" must reference a notebook picked from the list.`;
    }
  }

  return null;
}

export function IngestDestinationsSettingsPanel() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [notebooks, setNotebooks] = React.useState<IngestNotebookOption[]>([]);
  const [rows, setRows] = React.useState<DraftRow[]>([]);
  const [defaultId, setDefaultId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, notebookOptions] = await Promise.all([
        fetchIngestDestinationsSettings(),
        fetchIngestNotebookOptions(),
      ]);
      setRows(toDraftRows(settings.destinations));
      setDefaultId(settings.defaultId);
      setNotebooks(notebookOptions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load ingest destinations.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const updateRow = React.useCallback((key: string, patch: Partial<IngestDestination>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const addRow = React.useCallback(() => {
    setRows((current) => [...current, { ...createEmptyIngestDestination(), key: nextDraftKey() }]);
  }, []);

  const removeRow = React.useCallback((key: string) => {
    setRows((current) => {
      const removed = current.find((row) => row.key === key);
      const next = current.filter((row) => row.key !== key);
      if (removed && defaultId && removed.id.trim().toLowerCase() === defaultId.toLowerCase()) {
        setDefaultId(null);
      }
      return next;
    });
  }, [defaultId]);

  const moveRow = React.useCallback((key: string, direction: -1 | 1) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, []);

  const handleSave = React.useCallback(async () => {
    setError(null);
    setStatusMessage(null);

    const validationError = validateDraftRows(rows, notebooks);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const destinations: IngestDestination[] = rows.map((row) => ({
        id: row.id.trim(),
        label: row.label.trim(),
        notebookPath: row.notebookPath.trim(),
      }));
      const saved = await saveIngestDestinationsSettings({ destinations, defaultId });
      setRows(toDraftRows(saved.destinations));
      setDefaultId(saved.defaultId);
      setStatusMessage("Ingest destinations saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save ingest destinations.");
    } finally {
      setSaving(false);
    }
  }, [defaultId, notebooks, rows]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="ingest-destinations-loading">
        <Loader2 className="size-4 animate-spin" />
        Loading ingest destinations…
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="ingest-destinations-settings-panel">
      <section>
        <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Ingest destinations</p>
        <p className="text-xs text-muted-foreground">
          The allowlist an external sender (e.g. Clear Reader) can capture into over{" "}
          <span className="font-mono text-foreground">POST /api/ingest</span>. Each destination points at a notebook
          chosen from the list below — free-typed notebook paths are not accepted.
        </p>
      </section>

      {notebooks.length === 0 ? (
        <p
          className="rounded-md border border-border/80 bg-muted/10 p-3 text-xs text-muted-foreground"
          data-testid="ingest-destinations-no-notebooks"
        >
          No notebooks exist yet. Create a notebook before adding an ingest destination.
        </p>
      ) : null}

      <section className="space-y-2">
        {rows.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground"
            data-testid="ingest-destinations-empty"
          >
            No ingest destinations configured. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className="space-y-2 rounded-md border border-border/80 bg-muted/10 p-3"
                data-testid={`ingest-destination-row-${row.key}`}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Id</span>
                    <Input
                      value={row.id}
                      onChange={(event) => updateRow(row.key, { id: event.target.value })}
                      placeholder="reading"
                      data-testid={`ingest-destination-id-${row.key}`}
                      className="text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Label</span>
                    <Input
                      value={row.label}
                      onChange={(event) => updateRow(row.key, { label: event.target.value })}
                      placeholder="Reading Queue"
                      data-testid={`ingest-destination-label-${row.key}`}
                      className="text-xs"
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Notebook</span>
                  <select
                    value={row.notebookPath}
                    onChange={(event) => updateRow(row.key, { notebookPath: event.target.value })}
                    data-testid={`ingest-destination-notebook-${row.key}`}
                    className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground"
                  >
                    <option value="">Choose a notebook…</option>
                    {notebooks.map((notebook) => (
                      <option key={notebook.path} value={notebook.path}>
                        {notebook.name}
                        {notebook.isPortable ? " (remote)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="ingest-destination-default"
                      checked={Boolean(row.id.trim()) && defaultId?.toLowerCase() === row.id.trim().toLowerCase()}
                      onChange={() => setDefaultId(row.id.trim())}
                      disabled={!row.id.trim()}
                      data-testid={`ingest-destination-default-${row.key}`}
                    />
                    Default
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => moveRow(row.key, -1)}
                      data-testid={`ingest-destination-move-up-${row.key}`}
                    >
                      <ChevronUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={index === rows.length - 1}
                      onClick={() => moveRow(row.key, 1)}
                      data-testid={`ingest-destination-move-down-${row.key}`}
                    >
                      <ChevronDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove destination"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(row.key)}
                      data-testid={`ingest-destination-remove-${row.key}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addRow}
          disabled={notebooks.length === 0}
          data-testid="ingest-destination-add"
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          Add destination
        </Button>
      </section>

      <Button
        type="button"
        size="sm"
        onClick={() => void handleSave()}
        disabled={saving}
        data-testid="ingest-destinations-save"
      >
        {saving ? "Saving…" : "Save ingest destinations"}
      </Button>

      {error ? (
        <p className="text-xs text-destructive" data-testid="ingest-destinations-error">
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="text-xs text-foreground" data-testid="ingest-destinations-status-message">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}

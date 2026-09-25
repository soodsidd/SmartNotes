import { vaultWriteFetch } from "@/lib/connection-status";
import type { IngestDestination, IngestDestinationsSettings } from "@/server/ingest-destinations";

export interface IngestNotebookOption {
  id: string;
  path: string;
  name: string;
  isPortable: boolean;
}

export async function fetchIngestDestinationsSettings(): Promise<IngestDestinationsSettings> {
  const response = await fetch("/api/ingest/settings", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load ingest destination settings.");
  }
  return response.json() as Promise<IngestDestinationsSettings>;
}

export async function saveIngestDestinationsSettings(
  input: IngestDestinationsSettings
): Promise<IngestDestinationsSettings> {
  const response = await vaultWriteFetch("/api/ingest/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as IngestDestinationsSettings & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Failed to save ingest destination settings.");
  }
  return data;
}

export async function fetchIngestNotebookOptions(): Promise<IngestNotebookOption[]> {
  const response = await fetch("/api/notebooks", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load notebooks.");
  }
  const data = (await response.json()) as { notebooks: IngestNotebookOption[] };
  return data.notebooks;
}

export function createEmptyIngestDestination(): IngestDestination {
  return { id: "", label: "", notebookPath: "" };
}

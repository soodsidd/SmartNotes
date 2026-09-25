import fs from "node:fs/promises";
import path from "node:path";
import { getVaultRoot } from "./config";
import type { NotebookGroup } from "@/lib/notebook-sidebar-organization";

export const VAULT_UI_STATE_FILENAME = ".smart-notes-ui-state.json";

export interface VaultUiState {
  version: 1;
  expandedNotebooks: string[];
  expandedSections: string[];
  closedNotebooks: string[];
  expandedPages: string[];
  /** SN-232: keep a single notebook expanded unless the owner opts out. */
  accordionMode: boolean;
  pinnedNotebooks: string[];
  pinnedPages: string[];
  notebookOrder: string[];
  notebookGroups: NotebookGroup[];
  archivedNotebooks: string[];
  /** SN-80: opt-in "Keep conversation" companion preference, synced via vault. */
  companionPersist: boolean;
}

const EMPTY_UI_STATE: VaultUiState = {
  version: 1,
  expandedNotebooks: [],
  expandedSections: [],
  closedNotebooks: [],
  expandedPages: [],
  accordionMode: true,
  pinnedNotebooks: [],
  pinnedPages: [],
  notebookOrder: [],
  notebookGroups: [],
  archivedNotebooks: [],
  companionPersist: false,
};

function uiStatePath() {
  return path.join(getVaultRoot(), VAULT_UI_STATE_FILENAME);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const normalized = String(entry ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeStrictStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function normalizeNotebookGroups(value: unknown): NotebookGroup[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const assignedNotebooks = new Set<string>();
  const groups: NotebookGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<NotebookGroup>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    const notebookPaths = normalizeStrictStringList(candidate.notebookPaths).filter((notebookPath) => {
      if (assignedNotebooks.has(notebookPath)) return false;
      assignedNotebooks.add(notebookPath);
      return true;
    });
    groups.push({ id, name, notebookPaths, collapsed: candidate.collapsed === true });
  }
  return groups;
}

function normalizeUiState(input: Partial<VaultUiState> | null | undefined): VaultUiState {
  return {
    version: 1,
    expandedNotebooks: normalizeStringList(input?.expandedNotebooks),
    expandedSections: normalizeStringList(input?.expandedSections),
    closedNotebooks: normalizeStringList(input?.closedNotebooks),
    expandedPages: normalizeStringList(input?.expandedPages),
    accordionMode: input?.accordionMode !== false,
    pinnedNotebooks: normalizeStrictStringList(input?.pinnedNotebooks),
    pinnedPages: normalizeStrictStringList(input?.pinnedPages),
    notebookOrder: normalizeStrictStringList(input?.notebookOrder),
    notebookGroups: normalizeNotebookGroups(input?.notebookGroups),
    archivedNotebooks: normalizeStrictStringList(input?.archivedNotebooks),
    companionPersist: input?.companionPersist === true,
  };
}

export async function readVaultUiState(): Promise<VaultUiState> {
  try {
    const raw = await fs.readFile(uiStatePath(), "utf8");
    return normalizeUiState(JSON.parse(raw) as Partial<VaultUiState>);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ...EMPTY_UI_STATE };
    }
    // Recover from truncated / double-written state files so a corrupt
    // .smart-notes-ui-state.json cannot 500 every PATCH /api/ui-state.
    if (error instanceof SyntaxError) {
      console.warn("[smart-notes] ignoring corrupt vault ui-state JSON", error.message);
      return { ...EMPTY_UI_STATE };
    }
    throw error;
  }
}

export async function writeVaultUiState(patch: Partial<VaultUiState>): Promise<VaultUiState> {
  const current = await readVaultUiState();
  const next = normalizeUiState({
    ...current,
    ...patch,
    version: 1,
  });

  const directory = path.dirname(uiStatePath());
  const tempPath = path.join(
    directory,
    `.${path.basename(VAULT_UI_STATE_FILENAME)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, uiStatePath());
  return next;
}

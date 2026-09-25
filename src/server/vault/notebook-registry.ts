import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAppStateDir } from "@/server/app-state";
import { dirNameFromLabel } from "./paths";
import { VaultError } from "./errors";

export const NOTEBOOK_REGISTRY_FILENAME = "notebook-registry.json";
export const PORTABLE_NOTEBOOK_PATH_PREFIX = "+";

export interface PortableNotebookEntry {
  id: string;
  name: string;
  rootPath: string;
  addedAt: string;
}

export interface NotebookRegistry {
  version: 1;
  notebooks: PortableNotebookEntry[];
}

const EMPTY_REGISTRY: NotebookRegistry = {
  version: 1,
  notebooks: [],
};

function registryPath(stateDir = getAppStateDir()) {
  return path.join(path.resolve(stateDir), NOTEBOOK_REGISTRY_FILENAME);
}

function normalizeEntry(input: Partial<PortableNotebookEntry>): PortableNotebookEntry | null {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const rootPath = String(input.rootPath ?? "").trim();
  const addedAt = String(input.addedAt ?? "").trim();
  if (!id || !name || !rootPath || !addedAt) {
    return null;
  }
  return { id, name, rootPath: path.resolve(rootPath), addedAt };
}

function normalizeRegistry(input: Partial<NotebookRegistry> | null | undefined): NotebookRegistry {
  const notebooks: PortableNotebookEntry[] = [];
  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();

  for (const raw of input?.notebooks ?? []) {
    const entry = normalizeEntry(raw);
    if (!entry || seenIds.has(entry.id) || seenRoots.has(entry.rootPath)) {
      continue;
    }
    seenIds.add(entry.id);
    seenRoots.add(entry.rootPath);
    notebooks.push(entry);
  }

  return { version: 1, notebooks };
}

export function portableNotebookPath(id: string) {
  return `${PORTABLE_NOTEBOOK_PATH_PREFIX}${id}`;
}

export function parsePortableNotebookPath(notebookPath: string): string | null {
  const normalized = notebookPath.replaceAll("\\", "/").trim();
  if (!normalized.startsWith(PORTABLE_NOTEBOOK_PATH_PREFIX)) {
    return null;
  }
  const id = normalized.slice(PORTABLE_NOTEBOOK_PATH_PREFIX.length).split("/")[0]?.trim();
  return id || null;
}

export function isPortableNotebookPath(notebookPath: string) {
  return parsePortableNotebookPath(notebookPath) !== null;
}

export function loadNotebookRegistry(stateDir = getAppStateDir()): NotebookRegistry {
  const filePath = registryPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return { ...EMPTY_REGISTRY };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeRegistry(JSON.parse(raw) as Partial<NotebookRegistry>);
  } catch {
    return { ...EMPTY_REGISTRY };
  }
}

export function saveNotebookRegistry(
  registry: NotebookRegistry,
  stateDir = getAppStateDir()
): NotebookRegistry {
  const next = normalizeRegistry(registry);
  const filePath = registryPath(stateDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return next;
}

export function findPortableNotebookById(
  id: string,
  stateDir = getAppStateDir()
): PortableNotebookEntry | null {
  return loadNotebookRegistry(stateDir).notebooks.find((entry) => entry.id === id) ?? null;
}

export function findPortableNotebookByPath(
  notebookPath: string,
  stateDir = getAppStateDir()
): PortableNotebookEntry | null {
  const id = parsePortableNotebookPath(notebookPath);
  return id ? findPortableNotebookById(id, stateDir) : null;
}

export function resolvePortableRootForRelativePath(
  relativePath: string,
  stateDir = getAppStateDir()
): PortableNotebookEntry | null {
  const normalized = relativePath.replaceAll("\\", "/").trim();
  const id = parsePortableNotebookPath(normalized.split("/")[0] ?? "");
  return id ? findPortableNotebookById(id, stateDir) : null;
}

function generatePortableNotebookId(existing: Set<string>) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = crypto.randomBytes(4).toString("hex");
    if (!existing.has(id)) {
      return id;
    }
  }
  throw new VaultError("REGISTRY_ERROR", "Could not allocate a portable notebook id.", 500);
}

export interface RegisterPortableNotebookInput {
  rootPath?: string;
  parentPath?: string;
  folderName?: string;
  name?: string;
  createIfMissing?: boolean;
}

export function resolvePortableNotebookRootPath(input: RegisterPortableNotebookInput): string {
  const parentPath = String(input.parentPath ?? "").trim();
  const folderName = String(input.folderName ?? "").trim();
  if (parentPath && folderName) {
    const dirName = dirNameFromLabel(folderName);
    if (!dirName) {
      throw new VaultError("INVALID_NAME", "Notebook folder name is required.");
    }
    return path.resolve(parentPath, dirName);
  }

  const rootPath = path.resolve(String(input.rootPath ?? "").trim());
  if (!rootPath) {
    throw new VaultError("INVALID_PATH", "Notebook directory path is required.");
  }
  return rootPath;
}

function ensurePortableNotebookDirectory(rootPath: string, createIfMissing: boolean) {
  const stat = fs.statSync(rootPath, { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    return;
  }
  if (stat) {
    throw new VaultError("INVALID_PATH", `Path is not a directory: ${rootPath}`, 400);
  }
  if (!createIfMissing) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Directory not found: ${rootPath}`, 404);
  }
  fs.mkdirSync(rootPath, { recursive: true });
}

export function registerPortableNotebook(
  rootPathInput: string,
  nameInput?: string,
  stateDir = getAppStateDir(),
  options?: { createIfMissing?: boolean }
): PortableNotebookEntry {
  const rootPath = path.resolve(String(rootPathInput ?? "").trim());
  if (!rootPath) {
    throw new VaultError("INVALID_PATH", "Notebook directory path is required.");
  }

  ensurePortableNotebookDirectory(rootPath, Boolean(options?.createIfMissing));

  const registry = loadNotebookRegistry(stateDir);
  const duplicate = registry.notebooks.find((entry) => entry.rootPath === rootPath);
  if (duplicate) {
    throw new VaultError(
      "NOTEBOOK_EXISTS",
      `That directory is already registered as "${duplicate.name}".`,
      409
    );
  }

  const primaryVault = process.env.SMART_NOTES_VAULT
    ? path.resolve(process.env.SMART_NOTES_VAULT)
    : null;
  if (primaryVault && rootPath === primaryVault) {
    throw new VaultError(
      "INVALID_PATH",
      "The primary vault directory is already available without registration.",
      400
    );
  }

  const name = String(nameInput ?? "").trim() || path.basename(rootPath) || "Notebook";
  const id = generatePortableNotebookId(new Set(registry.notebooks.map((entry) => entry.id)));
  const entry: PortableNotebookEntry = {
    id,
    name,
    rootPath,
    addedAt: new Date().toISOString(),
  };

  saveNotebookRegistry({
    version: 1,
    notebooks: [...registry.notebooks, entry],
  }, stateDir);

  return entry;
}

export function registerPortableNotebookFromInput(
  input: RegisterPortableNotebookInput,
  stateDir = getAppStateDir()
): PortableNotebookEntry {
  const parentPath = String(input.parentPath ?? "").trim();
  const folderName = String(input.folderName ?? "").trim();
  const createIfMissing = Boolean(
    input.createIfMissing || (parentPath && folderName)
  );
  const rootPath = resolvePortableNotebookRootPath(input);
  const displayName = String(input.name ?? "").trim() || undefined;
  const defaultName =
    folderName ? dirNameFromLabel(folderName) : path.basename(rootPath) || "Notebook";

  return registerPortableNotebook(
    rootPath,
    displayName ?? defaultName,
    stateDir,
    { createIfMissing }
  );
}

export function unregisterPortableNotebook(id: string, stateDir = getAppStateDir()) {
  const registry = loadNotebookRegistry(stateDir);
  const entry = registry.notebooks.find((notebook) => notebook.id === id);
  if (!entry) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Portable notebook not found: ${id}`, 404);
  }

  saveNotebookRegistry({
    version: 1,
    notebooks: registry.notebooks.filter((notebook) => notebook.id !== id),
  }, stateDir);

  return {
    id: entry.id,
    path: portableNotebookPath(entry.id),
    name: entry.name,
    rootPath: entry.rootPath,
  };
}

export function renamePortableNotebook(
  id: string,
  nameInput: string,
  stateDir = getAppStateDir()
): PortableNotebookEntry {
  const name = String(nameInput ?? "").trim();
  if (!name) {
    throw new VaultError("INVALID_NAME", "Notebook name is required.");
  }

  const registry = loadNotebookRegistry(stateDir);
  const index = registry.notebooks.findIndex((notebook) => notebook.id === id);
  if (index < 0) {
    throw new VaultError("NOTEBOOK_NOT_FOUND", `Portable notebook not found: ${id}`, 404);
  }

  const current = registry.notebooks[index];
  const nextEntry = { ...current, name };
  const nextNotebooks = [...registry.notebooks];
  nextNotebooks[index] = nextEntry;
  saveNotebookRegistry({ version: 1, notebooks: nextNotebooks }, stateDir);
  return nextEntry;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVaultRoot } from "@/server/vault/config";
import { VaultError } from "@/server/vault/errors";
import { dirNameFromLabel } from "@/server/vault/paths";

export interface ServerFolderEntry {
  name: string;
  path: string;
}

export interface ServerFolderRoot {
  label: string;
  path: string;
}

export interface ServerFolderListing {
  path: string;
  parentPath: string | null;
  roots: ServerFolderRoot[];
  entries: ServerFolderEntry[];
}

function uniqueRoots(roots: ServerFolderRoot[]) {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const resolved = path.resolve(root.path);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    return true;
  });
}

export function getServerFolderRoots(): ServerFolderRoot[] {
  const home = os.homedir();
  const cwd = process.cwd();
  const vaultRoot = getVaultRoot();
  const roots: ServerFolderRoot[] = [
    { label: "Vault", path: vaultRoot },
    { label: "App folder", path: cwd },
  ];

  if (home) {
    roots.push({ label: "Home", path: home });
  }

  for (const candidate of [process.env.SystemDrive, process.env.HOMEDRIVE, path.parse(cwd).root, home ? path.parse(home).root : ""]) {
    if (candidate) {
      roots.push({ label: candidate.replace(/\\$/, ""), path: candidate });
    }
  }

  return uniqueRoots(roots).filter((root) => {
    const stat = fs.statSync(root.path, { throwIfNoEntry: false });
    return stat?.isDirectory() ?? false;
  });
}

function defaultServerFolderPath() {
  const roots = getServerFolderRoots();
  return roots[0]?.path ?? os.homedir() ?? process.cwd();
}

function resolveServerDirectory(inputPath?: string) {
  const rawPath = String(inputPath ?? "").trim();
  const resolvedPath = path.resolve(rawPath || defaultServerFolderPath());
  const stat = fs.statSync(resolvedPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new VaultError("SERVER_FOLDER_NOT_FOUND", `Server folder not found: ${resolvedPath}`, 404);
  }
  if (!stat.isDirectory()) {
    throw new VaultError("INVALID_PATH", `Server path is not a folder: ${resolvedPath}`, 400);
  }
  return resolvedPath;
}

function resolveChildDirectory(parentPath: string, folderName: string) {
  const parent = resolveServerDirectory(parentPath);
  const safeName = dirNameFromLabel(folderName);
  if (!safeName || safeName === "Untitled") {
    throw new VaultError("INVALID_NAME", "Folder name is required.");
  }

  const child = path.resolve(parent, safeName);
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new VaultError("INVALID_PATH", "Folder must be created inside the selected server folder.");
  }
  return child;
}

export function listServerFolders(inputPath?: string): ServerFolderListing {
  const currentPath = resolveServerDirectory(inputPath);
  let entries: ServerFolderEntry[] = [];

  try {
    entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(currentPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read server folder.";
    throw new VaultError("SERVER_FOLDER_UNREADABLE", message, 403);
  }

  const parentPath = path.dirname(currentPath);
  return {
    path: currentPath,
    parentPath: parentPath === currentPath ? null : parentPath,
    roots: getServerFolderRoots(),
    entries,
  };
}

export function createServerFolder(parentPath: string, folderName: string): ServerFolderListing {
  const child = resolveChildDirectory(parentPath, folderName);
  const existing = fs.statSync(child, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isDirectory()) {
      throw new VaultError("INVALID_PATH", `Server path is not a folder: ${child}`, 400);
    }
    return listServerFolders(child);
  }

  fs.mkdirSync(child, { recursive: false });
  return listServerFolders(child);
}

export function validateServerFolder(inputPath: string) {
  return { path: resolveServerDirectory(inputPath), valid: true };
}

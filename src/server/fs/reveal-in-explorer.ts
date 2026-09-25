import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getVaultRoot } from "@/server/vault/config";
import { VaultError } from "@/server/vault/errors";
import {
  findPortableNotebookByPath,
  isPortableNotebookPath,
} from "@/server/vault/notebook-registry";

function isPathInsideRoot(candidate: string, root: string) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveNotebookRevealPath(notebookPath: string) {
  const normalized = notebookPath.replaceAll("\\", "/").trim();
  if (!normalized) {
    throw new VaultError("INVALID_PATH", "Notebook path is required.");
  }

  if (isPortableNotebookPath(normalized)) {
    const entry = findPortableNotebookByPath(normalized);
    if (!entry) {
      throw new VaultError("NOTEBOOK_NOT_FOUND", `Portable notebook not found: ${normalized}`, 404);
    }
    return path.resolve(entry.rootPath);
  }

  const vaultRoot = getVaultRoot();
  const absolutePath = path.resolve(vaultRoot, normalized);
  if (!isPathInsideRoot(absolutePath, vaultRoot)) {
    throw new VaultError("INVALID_PATH", "Notebook path escapes the vault root.");
  }
  if (!fs.existsSync(absolutePath)) {
    throw new VaultError("NOT_FOUND", "Notebook folder does not exist on disk.", 404);
  }
  return absolutePath;
}

export function revealPathInExplorer(absolutePath: string) {
  const resolved = path.resolve(absolutePath);
  if (!fs.existsSync(resolved)) {
    throw new VaultError("NOT_FOUND", "Path does not exist on disk.", 404);
  }

  if (process.platform === "win32") {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      spawn("explorer.exe", ["/select,", resolved], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("explorer.exe", [resolved], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "darwin") {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      spawn("open", ["-R", resolved], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("open", [resolved], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [path.dirname(resolved)], { detached: true, stdio: "ignore" }).unref();
}

export function revealNotebookInExplorer(notebookPath: string) {
  const absolutePath = resolveNotebookRevealPath(notebookPath);
  revealPathInExplorer(absolutePath);
  return { path: absolutePath };
}

/** Reveal an arbitrary absolute file/folder that already passed containment checks. */
export function revealAbsolutePathInExplorer(absolutePath: string) {
  const resolved = path.resolve(absolutePath);
  revealPathInExplorer(resolved);
  return { path: resolved };
}

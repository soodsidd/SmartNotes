import fs from "node:fs/promises";
import path from "node:path";

import { pageWorkspaceFromMetadata } from "@/lib/jupyter-page-workspace";
import { readPage } from "@/server/vault/pages";

// SN-404: a page-bound Deep Work folder (SN-347) has a host vault page. The
// browser names it on session launch, but it is trusted only when that page is
// a Jupyter page whose own frontmatter binds this exact real root. Anything
// else (sticky/opened folders, stale or forged paths) yields no host page.
async function realOrResolved(value: string): Promise<string> {
  const resolved = path.resolve(value);
  return fs.realpath(resolved).catch(() => resolved);
}

function sameRoot(a: string, b: string): boolean {
  const left = path.normalize(a);
  const right = path.normalize(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function verifiedWorkspaceHostPage(
  hostPagePath: unknown,
  realRoot: string
): Promise<string | null> {
  if (typeof hostPagePath !== "string" || !hostPagePath.trim() || hostPagePath.length > 1024) return null;
  try {
    const page = await readPage(hostPagePath.trim());
    const noteType = typeof page.metadata.note_type === "string" ? page.metadata.note_type : "";
    if (noteType !== "jupyter") return null;
    const bound = pageWorkspaceFromMetadata(page.metadata as Record<string, unknown>);
    if (!bound) return null;
    const [boundRoot, actualRoot] = await Promise.all([realOrResolved(bound.rootPath), realOrResolved(realRoot)]);
    return sameRoot(boundRoot, actualRoot) ? page.path : null;
  } catch {
    return null;
  }
}

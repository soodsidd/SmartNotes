import { vaultWriteFetch } from "@/lib/connection-status";
import { paperPath } from "@/lib/papers";

export interface InlinePaperSnapshot {
  path: string;
  title: string;
  body: string;
  revision: string;
}

export async function loadInlinePaper(id: string): Promise<InlinePaperSnapshot> {
  const path = paperPath(id);
  const response = await fetch(`/api/page?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Paper unavailable.");
  const payload = await response.json() as { page: { path: string; title: string; body: string }; revision?: string };
  if (payload.page.path !== path || !/^sha256:[a-f0-9]{64}$/.test(payload.revision ?? "")) {
    throw new Error("Paper revision unavailable. Refresh before editing.");
  }
  return { path, title: payload.page.title, body: payload.page.body, revision: payload.revision! };
}

/** A conditional write is trusted only after a fresh read confirms the canonical body. */
export async function saveInlinePaper(snapshot: InlinePaperSnapshot, body: string): Promise<InlinePaperSnapshot> {
  const response = await vaultWriteFetch("/api/page", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: snapshot.path, title: snapshot.title, content: body, expectedPaperRevision: snapshot.revision }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "Paper changes could not be saved.");
  }
  const verified = await loadInlinePaper(snapshot.path.split("/").pop()!.replace(/\.html$/, ""));
  if (verified.body !== body) throw new Error("Paper save could not be verified. Refresh before editing again.");
  return verified;
}

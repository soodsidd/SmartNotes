import type { VaultNotebook, VaultPage } from "./vault-contract";

export const BIBLIOGRAPHY_PATH = ".bibliography";
export const PAPER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function paperPath(id: string): string {
  if (!PAPER_ID_PATTERN.test(id)) throw new Error("Invalid paper identity.");
  return `${BIBLIOGRAPHY_PATH}/${id.toLowerCase()}.html`;
}

export function isBibliographyPath(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === BIBLIOGRAPHY_PATH || normalized.startsWith(`${BIBLIOGRAPHY_PATH}/`);
}

/** Only the dedicated HTML node is a paper reference; .ref.json is ingest metadata. */
export function paperReferenceIds(html: string): string[] {
  const ids = new Set<string>();
  // Skip comments and raw-text elements: examples/scripts are not references.
  const content = html.replace(/<!--[\s\S]*?-->|<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const tag of content.matchAll(/<div\b[^>]*>/gi)) {
    if (!/\bdata-type\s*=\s*["']paper-reference["']/i.test(tag[0])) continue;
    const id = tag[0].match(/\bdata-paper-id\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id && PAPER_ID_PATTERN.test(id)) ids.add(id.toLowerCase());
  }
  return [...ids];
}

export function paperReferenceHtml(id: string): string {
  paperPath(id);
  return `<div data-type="paper-reference" data-paper-id="${id.toLowerCase()}"></div>`;
}

export interface PaperReferrer {
  path: string;
  title: string;
  notebookPath: string;
  notebookName: string;
}

export function bibliographyEntries(tree: VaultNotebook[]) {
  const papers = tree.find((notebook) => notebook.path === BIBLIOGRAPHY_PATH)?.pages ?? [];
  const referrers = new Map<string, PaperReferrer[]>();
  for (const notebook of tree) {
    for (const page of [...notebook.pages, ...notebook.sections.flatMap((section) => section.pages)]) {
      for (const id of paperReferenceIds(page.content)) {
        const entries = referrers.get(id) ?? [];
        entries.push({ path: page.path, title: page.title, notebookPath: notebook.path, notebookName: notebook.name });
        referrers.set(id, entries);
      }
    }
  }
  return papers.map((page) => ({ page, id: String(page.metadata?.paper_id ?? ""), referrers: referrers.get(String(page.metadata?.paper_id)) ?? [] }));
}

export function paperChildren(parent: VaultPage, papers: VaultPage[]): VaultPage[] {
  return paperReferenceIds(parent.content).map((id) => {
    const canonical = papers.find((page) => page.metadata?.paper_id === id);
    return {
      id: `${parent.path}::paper:${id}`, path: `${parent.path}::paper:${id}`,
      title: canonical?.title ?? "Unavailable paper", slug: id,
      createdAt: null, updatedAt: canonical?.updatedAt ?? null,
      preview: "Shared paper · Bibliography", content: "", parentId: parent.path,
      noteType: "text", paperReference: { id, canonicalPath: paperPath(id), parentPath: parent.path, missing: !canonical },
    };
  });
}

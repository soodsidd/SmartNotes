import type { VaultNotebook } from "@/lib/api/pages";

export function captureDestinationLabel(
  capture: { destination: "inbox" | "page"; notebookPath: string; sectionPath: string },
  tree: VaultNotebook[]
): string {
  if (capture.destination === "page") {
    for (const notebook of tree) {
      const section = notebook.sections.find((item) => item.path === capture.sectionPath);
      if (section) return `${notebook.name} / ${section.name}`;
    }
    return "Choose a section";
  }

  const notebook = tree.find((item) => item.path === capture.notebookPath);
  if (notebook) return `${notebook.name} / Inbox`;
  if (capture.notebookPath) return "Notebook unavailable / Inbox";
  return tree[0] ? `${tree[0].name} / Inbox` : "Personal Notebook / Inbox (created on save)";
}

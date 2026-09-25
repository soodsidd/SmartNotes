import {
  buildNotebookPresentationRows,
  collectKeyNoteEntries,
  filterNotebookTree,
  reorderNotebookPaths,
  sortNotebooksByOverride,
  toggleNotebookExpansion,
  type NotebookGroup,
} from "@/lib/notebook-sidebar-organization";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

function page(path: string, title: string, parentId: string | null = null, keyNote = false): VaultPage {
  return {
    id: path, path, title, slug: path, createdAt: null, updatedAt: null,
    preview: "", content: "", parentId, noteType: "text", keyNote,
  };
}

function notebook(path: string, pages: VaultPage[] = [], sectionPages: VaultPage[] = []): VaultNotebook {
  return {
    id: path, path, name: path, color: "#000", pages,
    sections: [{ id: `${path}/Research`, path: `${path}/Research`, name: "Research", pages: sectionPages }],
  };
}

describe("notebook sidebar organization", () => {
  const tree = [
    notebook("Work", [page("Work/roadmap", "Roadmap")], [
      page("Work/Research/parent", "Parent"),
      page("Work/Research/child", "Laser calibration", "Work/Research/parent", true),
    ]),
    notebook("Personal", [page("Personal/travel", "Travel", null, true)]),
  ];

  it("filters by structural names, retains ancestors, and derives expansion", () => {
    const result = filterNotebookTree(tree, "laser");
    expect(result.tree).toHaveLength(1);
    expect(result.tree[0].sections[0].pages.map((candidate) => candidate.title)).toEqual([
      "Parent",
      "Laser calibration",
    ]);
    expect(result.expandedNotebooks).toEqual(new Set(["Work"]));
    expect(result.expandedSections).toEqual(new Set(["Work/Research"]));
    expect(result.expandedPages).toEqual(new Set(["Work/Research/parent"]));
    expect(filterNotebookTree(tree, "missing").tree).toEqual([]);
  });

  it("collects key notes across notebook roots and sections grouped by notebook identity", () => {
    expect(collectKeyNoteEntries(tree).map((entry) => [entry.notebookName, entry.page.title])).toEqual([
      ["Work", "Laser calibration"],
      ["Personal", "Travel"],
    ]);
  });

  it("honors manual order and renders each grouped notebook once", () => {
    expect(sortNotebooksByOverride(tree, ["Personal", "Work"]).map((item) => item.path)).toEqual([
      "Personal", "Work",
    ]);
    const groups: NotebookGroup[] = [
      { id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: false },
    ];
    const rows = buildNotebookPresentationRows(tree, groups);
    expect(rows.filter((row) => row.kind === "notebook").map((row) => row.notebook?.path)).toEqual([
      "Work", "Personal",
    ]);
    expect(reorderNotebookPaths([], ["Work", "Personal"], "Personal", "Work")).toEqual([
      "Personal", "Work",
    ]);
  });

  it("collapses other notebooks only while accordion mode is enabled", () => {
    expect(toggleNotebookExpansion(new Set(["Work"]), "Personal", true)).toEqual(new Set(["Personal"]));
    expect(toggleNotebookExpansion(new Set(["Work"]), "Personal", false)).toEqual(new Set(["Work", "Personal"]));
  });

  it("keeps collapsed group membership out of the ungrouped bucket", () => {
    const rows = buildNotebookPresentationRows(tree, [
      { id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: true },
    ]);
    expect(rows.filter((row) => row.kind === "notebook").map((row) => row.notebook?.path)).toEqual([
      "Personal",
    ]);
  });
});

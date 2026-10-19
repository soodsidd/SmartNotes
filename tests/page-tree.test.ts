import {
  buildPageNestingActionLookup,
  buildPageTree,
  collectPageSubtreePaths,
  flattenPageTree,
  getPageNestingActionState,
  mergeTreeExpandState,
  remapPagePathToSection,
  resolveSidebarCrossContainerDrop,
  resolveSidebarPageDrop,
  resolveTreeExpandPathsForPage,
} from "@/lib/page-tree";
import { type VaultPage } from "@/lib/vault-contract";
import { paperReferenceHtml } from "@/lib/papers";

function makePage(path: string, title: string, parentId: string | null): VaultPage {
  return {
    id: path,
    path,
    title,
    slug: path,
    createdAt: null,
    updatedAt: null,
    preview: "",
    content: "",
    parentId,
  };
}

describe("page tree nesting actions", () => {
  it("keeps real nested pages but creates no paper children or paper-only chevrons", () => {
    const paperId = "12345678-1234-4567-8123-123456789abc";
    const article = { ...makePage("article", "Article", null), content: paperReferenceHtml(paperId) };
    const nested = makePage("nested", "Nested", "article");
    const paperOnly = { ...makePage("paper-only", "Paper only", null), content: paperReferenceHtml(paperId) };
    const tree = buildPageTree([article, nested, paperOnly]);
    expect(tree[0].children.map((node) => node.page.path)).toEqual(["nested"]);
    expect(tree[1].children).toEqual([]);
    expect(flattenPageTree(tree, new Set(["article", "paper-only"])).map((node) => node.page.path)).toEqual(["article", "nested", "paper-only"]);
  });
  it("indents under the immediately previous visible page when depth allows", () => {
    const flatNodes = flattenPageTree(
      buildPageTree([
        makePage("a", "A", null),
        makePage("b", "B", null),
        makePage("c", "C", null),
      ]),
      new Set<string>()
    );
    const nestingLookup = buildPageNestingActionLookup(flatNodes);

    expect(getPageNestingActionState(nestingLookup, "b")).toMatchObject({
      canIndent: true,
      indentParentId: "a",
      canOutdent: false,
      outdentParentId: null,
    });
  });

  it("blocks indent when the page above is already at max depth", () => {
    const flatNodes = flattenPageTree(
      buildPageTree([
        makePage("root", "Root", null),
        makePage("child", "Child", "root"),
        makePage("grandchild", "Grandchild", "child"),
        makePage("sibling", "Sibling", null),
      ]),
      new Set<string>(["root", "child"])
    );
    const nestingLookup = buildPageNestingActionLookup(flatNodes);

    expect(getPageNestingActionState(nestingLookup, "sibling")).toMatchObject({
      canIndent: false,
      indentParentId: null,
    });
  });

  it("outdents one level by targeting the parent's parent", () => {
    const flatNodes = flattenPageTree(
      buildPageTree([
        makePage("root", "Root", null),
        makePage("child", "Child", "root"),
        makePage("grandchild", "Grandchild", "child"),
      ]),
      new Set<string>(["root", "child"])
    );
    const nestingLookup = buildPageNestingActionLookup(flatNodes);

    expect(getPageNestingActionState(nestingLookup, "grandchild")).toMatchObject({
      canOutdent: true,
      outdentParentId: "root",
    });
    expect(getPageNestingActionState(nestingLookup, "child")).toMatchObject({
      canOutdent: true,
      outdentParentId: null,
    });
  });
});

describe("sidebar page drop resolution", () => {
  const pages = [
    makePage("a", "A", null),
    makePage("b", "B", "a"),
    makePage("c", "C", "b"),
    makePage("d", "D", null),
  ];

  function lookupForExpanded(expanded: string[]) {
    const flatNodes = flattenPageTree(buildPageTree(pages), new Set(expanded));
    return buildPageNestingActionLookup(flatNodes);
  }

  it("nests a root page under another root page", () => {
    const result = resolveSidebarPageDrop({
      intent: "nest",
      sourcePath: "d",
      targetPath: "a",
      dropSide: null,
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toEqual({
      parentId: "a",
      orderedIds: ["a", "d", "b", "c"],
    });
  });

  it("outdents one level instead of always clearing parent_id", () => {
    const result = resolveSidebarPageDrop({
      intent: "unnest",
      sourcePath: "c",
      targetPath: "a",
      dropSide: "after",
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toEqual({
      parentId: "a",
      orderedIds: ["a", "c", "b", "d"],
    });
  });

  it("outdents a child page to top level", () => {
    const result = resolveSidebarPageDrop({
      intent: "unnest",
      sourcePath: "b",
      targetPath: "d",
      dropSide: null,
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toEqual({
      parentId: null,
      orderedIds: ["a", "b", "c", "d"],
    });
  });

  it("reorders at the target nesting level when dropping vertically", () => {
    const result = resolveSidebarPageDrop({
      intent: "reorder",
      sourcePath: "b",
      targetPath: "d",
      dropSide: "before",
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toEqual({
      parentId: null,
      orderedIds: ["a", "b", "c", "d"],
    });
  });

  it("drags a page with its descendants as one ordered block", () => {
    const result = resolveSidebarPageDrop({
      intent: "reorder",
      sourcePath: "a",
      targetPath: "d",
      dropSide: "after",
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toEqual({ parentId: null, orderedIds: ["d", "a", "b", "c"] });
  });

  it("rejects a drag that would place a descendant beyond the depth cap", () => {
    const result = resolveSidebarPageDrop({
      intent: "nest",
      sourcePath: "a",
      targetPath: "d",
      dropSide: null,
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toBeNull();
  });

  it("blocks nesting under a descendant page", () => {
    const result = resolveSidebarPageDrop({
      intent: "nest",
      sourcePath: "a",
      targetPath: "b",
      dropSide: null,
      pages,
      nestingLookup: lookupForExpanded(["a", "b"]),
    });
    expect(result).toBeNull();
  });
});

describe("sidebar cross-container drop resolution (SN-320)", () => {
  const sourcePages = [
    makePage("Nb/Alpha/root.html", "Root", null),
    makePage("Nb/Alpha/child.html", "Child", "Nb/Alpha/root.html"),
    makePage("Nb/Alpha/grand.html", "Grand", "Nb/Alpha/child.html"),
    makePage("Nb/Alpha/other.html", "Other", null),
  ];
  const targetPages = [
    makePage("Nb/Archive/keep.html", "Keep", null),
    makePage("Nb/Archive/tail.html", "Tail", null),
  ];

  it("remaps a page path into the destination section by basename", () => {
    expect(remapPagePathToSection("Nb/Alpha/root.html", "Nb/Archive")).toBe("Nb/Archive/root.html");
  });

  it("collects the dragged page and its descendants in container order", () => {
    expect(collectPageSubtreePaths(sourcePages, "Nb/Alpha/root.html")).toEqual([
      "Nb/Alpha/root.html",
      "Nb/Alpha/child.html",
      "Nb/Alpha/grand.html",
    ]);
  });

  it("appends via movePage when dropping on a section header or empty zone", () => {
    const result = resolveSidebarCrossContainerDrop({
      sourcePath: "Nb/Alpha/root.html",
      sourceContainerPath: "Nb/Alpha",
      targetSectionPath: "Nb/Archive",
      sourcePages,
      targetPages: [],
    });
    expect(result).toEqual({ targetSectionPath: "Nb/Archive", orderedIds: null });
  });

  it("inserts the remapped subtree before an existing target page", () => {
    const result = resolveSidebarCrossContainerDrop({
      sourcePath: "Nb/Alpha/root.html",
      sourceContainerPath: "Nb/Alpha",
      targetSectionPath: "Nb/Archive",
      targetPagePath: "Nb/Archive/keep.html",
      dropSide: "before",
      sourcePages,
      targetPages,
    });
    expect(result).toEqual({
      targetSectionPath: "Nb/Archive",
      orderedIds: [
        "Nb/Archive/root.html",
        "Nb/Archive/child.html",
        "Nb/Archive/grand.html",
        "Nb/Archive/keep.html",
        "Nb/Archive/tail.html",
      ],
    });
  });

  it("inserts the remapped subtree after an existing target page", () => {
    const result = resolveSidebarCrossContainerDrop({
      sourcePath: "Nb/Alpha/root.html",
      sourceContainerPath: "Nb/Alpha",
      targetSectionPath: "Nb/Archive",
      targetPagePath: "Nb/Archive/keep.html",
      dropSide: "after",
      sourcePages,
      targetPages,
    });
    expect(result).toEqual({
      targetSectionPath: "Nb/Archive",
      orderedIds: [
        "Nb/Archive/keep.html",
        "Nb/Archive/root.html",
        "Nb/Archive/child.html",
        "Nb/Archive/grand.html",
        "Nb/Archive/tail.html",
      ],
    });
  });

  it("rejects same-container drops so local DnD stays on resolveSidebarPageDrop", () => {
    expect(
      resolveSidebarCrossContainerDrop({
        sourcePath: "Nb/Alpha/root.html",
        sourceContainerPath: "Nb/Alpha",
        targetSectionPath: "Nb/Alpha",
        sourcePages,
        targetPages: sourcePages,
      })
    ).toBeNull();
  });

  it("rejects basename collisions in the destination section", () => {
    const collidingTarget = [
      makePage("Nb/Archive/root.html", "Existing", null),
      ...targetPages,
    ];
    expect(
      resolveSidebarCrossContainerDrop({
        sourcePath: "Nb/Alpha/root.html",
        sourceContainerPath: "Nb/Alpha",
        targetSectionPath: "Nb/Archive",
        sourcePages,
        targetPages: collidingTarget,
      })
    ).toBeNull();
  });

  it("rejects a page-relative drop without a drop side", () => {
    expect(
      resolveSidebarCrossContainerDrop({
        sourcePath: "Nb/Alpha/other.html",
        sourceContainerPath: "Nb/Alpha",
        targetSectionPath: "Nb/Archive",
        targetPagePath: "Nb/Archive/keep.html",
        dropSide: null,
        sourcePages,
        targetPages,
      })
    ).toBeNull();
  });
});

describe("tree expand state preservation", () => {
  const tree = [
    {
      path: "notebook-a",
      sections: [
        {
          path: "notebook-a/section-a",
          pages: [
            { path: "notebook-a/section-a/root.html", parentId: null },
            { path: "notebook-a/section-a/child.html", parentId: "notebook-a/section-a/root.html" },
          ],
        },
        {
          path: "notebook-a/section-b",
          pages: [{ path: "notebook-a/section-b/other.html", parentId: null }],
        },
      ],
    },
    {
      path: "notebook-b",
      sections: [{ path: "notebook-b/inbox", pages: [{ path: "notebook-b/inbox/note.html", parentId: null }] }],
    },
  ];

  it("expands only the parent path for a newly added page", () => {
    const current = {
      notebooks: new Set(["notebook-a"]),
      sections: new Set(["notebook-a/section-a"]),
      pages: new Set<string>(),
    };
    const ensure = resolveTreeExpandPathsForPage(tree, "notebook-a/section-a/child.html");
    const merged = mergeTreeExpandState(current, ensure, tree[0]!.sections.flatMap((section) => section.pages));

    expect(merged.notebooks).toEqual(new Set(["notebook-a"]));
    expect(merged.sections).toEqual(new Set(["notebook-a/section-a"]));
    expect(merged.pages).toEqual(new Set(["notebook-a/section-a/root.html"]));
    expect(merged.sections.has("notebook-a/section-b")).toBe(false);
    expect(merged.notebooks.has("notebook-b")).toBe(false);
  });

  it("leaves unrelated collapsed branches untouched when adding a section", () => {
    const current = {
      notebooks: new Set(["notebook-a"]),
      sections: new Set<string>(),
      pages: new Set<string>(),
    };
    const merged = mergeTreeExpandState(
      current,
      { notebookPath: "notebook-a", sectionPath: "notebook-a/section-b" },
      []
    );

    expect(merged.notebooks).toEqual(new Set(["notebook-a"]));
    expect(merged.sections).toEqual(new Set(["notebook-a/section-b"]));
    expect(merged.sections.has("notebook-a/section-a")).toBe(false);
  });
});

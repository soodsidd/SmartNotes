import {
  buildPageNestingActionLookup,
  buildPageTree,
  flattenPageTree,
  getPageNestingActionState,
  mergeTreeExpandState,
  resolveSidebarPageDrop,
  resolveTreeExpandPathsForPage,
} from "@/lib/page-tree";
import { type VaultPage } from "@/lib/vault-contract";

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
      orderedIds: ["a", "c", "b", "d"],
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
      orderedIds: ["a", "c", "b", "d"],
    });
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

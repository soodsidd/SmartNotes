import * as htmlUtils from "@/lib/html-utils";
import {
  buildRecentSearchResults,
  buildVaultSearchIndex,
  searchVaultIndex,
  VaultSearchIndexer,
} from "@/lib/search";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

jest.mock("@/lib/html-utils", () => {
  const actual = jest.requireActual("@/lib/html-utils");
  return { ...actual, stripHtml: jest.fn(actual.stripHtml) };
});

const TREE: VaultNotebook[] = [
  {
    id: "research",
    path: "Research",
    name: "Research",
    color: "var(--notebook-color-1)",
    pages: [],
    sections: [
      {
        id: "optics",
        path: "Research/Optics",
        name: "Optics",
        pages: [
          {
            id: "research/optics/interferometer.html",
            path: "Research/Optics/interferometer.html",
            title: "Interferometer alignment",
            slug: "interferometer-alignment",
            createdAt: "2026-06-01T12:00:00Z",
            updatedAt: "2026-06-05T18:00:00Z",
            preview: "Laser alignment checklist.",
            content: "<p>Laser alignment checklist with <strong>phase drift</strong> notes.</p>",
            parentId: null,
            noteType: "text",
          },
          {
            id: "research/optics/beam-log.html",
            path: "Research/Optics/beam-log.html",
            title: "Beam log",
            slug: "beam-log",
            createdAt: "2026-06-02T12:00:00Z",
            updatedAt: "2026-06-06T08:15:00Z",
            preview: "Daily beam checks.",
            content: "<p>Recorded calibration offsets and detector drift.</p>",
            parentId: null,
            noteType: "text",
          },
        ],
      },
    ],
  },
];

describe("search helpers", () => {
  it("indexes stripped HTML body text and returns fuzzy results with snippets", () => {
    const index = buildVaultSearchIndex(TREE);
    const results = searchVaultIndex(index, "phse drft");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: "Research/Optics/interferometer.html",
      breadcrumb: "Research / Optics",
      source: "client",
    });
    expect(results[0].excerpt).toContain("phase drift");
    expect(results[0].excerpt).not.toContain("<strong>");
    expect(results[0].excerptHighlights?.length).toBeGreaterThan(0);
  });

  it("builds recent-note results from updatedAt ordering when the query is empty", () => {
    const index = buildVaultSearchIndex(TREE);
    const recents = buildRecentSearchResults(index, 2);

    expect(recents.map((result) => result.path)).toEqual([
      "Research/Optics/beam-log.html",
      "Research/Optics/interferometer.html",
    ]);
    expect(recents[0]).toMatchObject({
      source: "recent",
      breadcrumb: "Research / Optics",
    });
  });
});

function makeVault(pageCount: number): VaultNotebook[] {
  const pages: VaultPage[] = Array.from({ length: pageCount }, (_, i) => ({
    id: `vault/page-${i}.html`,
    path: `Vault/page-${i}.html`,
    title: `Page ${i}`,
    slug: `page-${i}`,
    createdAt: "2026-06-01T12:00:00Z",
    updatedAt: "2026-06-01T12:00:00Z",
    preview: "",
    content: `<p>Ordinary body text number ${i}.</p>`,
    parentId: null,
    noteType: "text",
  }));
  return [{ id: "vault", path: "Vault", name: "Vault", color: "", pages, sections: [] }];
}

// Mirrors the shell's syncTreePage: unchanged pages keep object identity.
function patchPage(tree: VaultNotebook[], path: string, content: string): VaultNotebook[] {
  return tree.map((notebook) => ({
    ...notebook,
    pages: notebook.pages.map((page) => (page.path === path ? { ...page, content } : page)),
    sections: notebook.sections.map((section) => ({
      ...section,
      pages: section.pages.map((page) => (page.path === path ? { ...page, content } : page)),
    })),
  }));
}

describe("VaultSearchIndexer (SN-288)", () => {
  const stripHtmlMock = htmlUtils.stripHtml as jest.Mock;

  beforeEach(() => stripHtmlMock.mockClear());

  it("re-indexes only the edited page on a single-page draft update and finds the live draft", () => {
    const indexer = new VaultSearchIndexer();
    let tree = makeVault(200);
    expect(indexer.sync(tree)).toEqual({ added: 200, updated: 0, removed: 0 });
    expect(stripHtmlMock).toHaveBeenCalledTimes(200);
    const before = indexer.getIndex();

    stripHtmlMock.mockClear();
    tree = patchPage(tree, "Vault/page-42.html", "<p>Freshly typed zanzibar quokka draft</p>");
    expect(indexer.sync(tree)).toEqual({ added: 0, updated: 1, removed: 0 });
    expect(stripHtmlMock).toHaveBeenCalledTimes(1);

    const after = indexer.getIndex();
    expect(after).not.toBe(before);
    expect(after.fuse).toBe(before.fuse); // mutated in place, not reconstructed
    expect(after.entries).toHaveLength(200);
    const results = searchVaultIndex(after, "zanzibar quokka");
    expect(results[0]?.path).toBe("Vault/page-42.html");
    expect(results[0]?.excerpt).toContain("zanzibar quokka");
    expect(searchVaultIndex(after, "Ordinary body text number 42")[0]?.path).not.toBe(
      "Vault/page-42.html"
    );
  });

  it("does no work for an identical tree and handles add/remove incrementally", () => {
    const indexer = new VaultSearchIndexer();
    const tree = makeVault(5);
    indexer.sync(tree);
    const snapshot = indexer.getIndex();
    stripHtmlMock.mockClear();

    expect(indexer.sync(tree)).toEqual({ added: 0, updated: 0, removed: 0 });
    // New tree object, same page objects (e.g. unrelated sibling-state patch).
    expect(indexer.sync(tree.map((notebook) => ({ ...notebook })))).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
    });
    expect(indexer.getIndex()).toBe(snapshot);
    expect(stripHtmlMock).not.toHaveBeenCalled();

    const [notebook] = tree;
    const trimmed = [{ ...notebook, pages: notebook.pages.slice(1) }];
    expect(indexer.sync(trimmed)).toEqual({ added: 0, updated: 0, removed: 1 });
    expect(indexer.getIndex().entries).toHaveLength(4);
    expect(searchVaultIndex(indexer.getIndex(), "Page 0").map((r) => r.path)).not.toContain(
      "Vault/page-0.html"
    );
    expect(stripHtmlMock).not.toHaveBeenCalled();
  });
});

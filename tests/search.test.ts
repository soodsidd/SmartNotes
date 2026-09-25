import {
  buildRecentSearchResults,
  buildVaultSearchIndex,
  searchVaultIndex,
} from "@/lib/search";
import type { VaultNotebook } from "@/lib/vault-contract";

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

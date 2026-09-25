import {
  createWorkspaceSource,
  editWorkspaceSource,
  fetchWorkspaceAnnotations,
  fetchWorkspaceSource,
  listWorkspaceSources,
  saveWorkspaceAnnotations,
} from "@/lib/api/workspace";

describe("SN-258 workspace API client helpers", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      path: "src/index.ts",
      source: "const x = 1;",
      revision: `sha256:${"a".repeat(64)}`,
      size: 12,
      truncated: false,
      annotations: [],
      ok: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as jest.Mock;
  });

  it("requests one bounded file and sends expected-revision edits", async () => {
    await listWorkspaceSources("deep-work:test", 200);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/workspace/source?workspace=deep-work%3Atest&operation=list&maxCount=200",
      { cache: "no-store" }
    );
    await fetchWorkspaceSource("deep-work:test", "src/index.ts", 4096);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/workspace/source?workspace=deep-work%3Atest&path=src%2Findex.ts&maxBytes=4096",
      { cache: "no-store" }
    );
    await editWorkspaceSource("deep-work:test", "src/index.ts", `sha256:${"a".repeat(64)}`, [
      { start: 10, end: 11, text: "2" },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/workspace/source", expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"expectedRevision":"sha256:'),
    }));
    await createWorkspaceSource("deep-work:test", "walkthrough.ipynb", '{"nbformat":4}');
    expect(fetch).toHaveBeenNthCalledWith(4, "/api/workspace/source", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        workspace: "deep-work:test",
        path: "walkthrough.ipynb",
        source: '{"nbformat":4}',
      }),
    }));
  });

  it("reads and writes workspace annotations through the app-state route", async () => {
    await fetchWorkspaceAnnotations("deep-work:test", "src/index.ts");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/workspace/annotations?workspace=deep-work%3Atest&path=src%2Findex.ts",
      { cache: "no-store" }
    );
    await saveWorkspaceAnnotations("deep-work:test", "src/index.ts", []);
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/workspace/annotations", expect.objectContaining({
      method: "PUT",
    }));
  });
});

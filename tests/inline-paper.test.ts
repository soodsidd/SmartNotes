import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/page/route";
import { loadInlinePaper, saveInlinePaper } from "@/lib/inline-paper";
import { paperReferenceHtml } from "@/lib/papers";
import { createPaper, createPage, invalidateVaultTreeCache, readPage, savePage } from "@/server/vault/pages";

describe("SN-294 inline paper save safety", () => {
  let root: string;
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const realFetch = global.fetch;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-inline-paper-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research", "Articles"), { recursive: true });
    invalidateVaultTreeCache();
    global.fetch = async (input, init) => {
      const request = new Request(new URL(String(input), "http://localhost"), init);
      return request.method === "PUT" ? PUT(request) : GET(request);
    };
  });

  afterEach(async () => {
    global.fetch = realFetch;
    if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = previousVault;
    if (previousState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = previousState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("saves only the canonical paper and both references refresh to the change", async () => {
    const paper = await createPaper("Shared", "Research");
    const id = String(paper.metadata.paper_id);
    const first = await createPage({ sectionPath: "Research/Articles", title: "First" });
    const second = await createPage({ sectionPath: "Research/Articles", title: "Second" });
    const firstBody = `<p>First page stays</p>${paperReferenceHtml(id)}`;
    const secondBody = `<p>Second page stays</p>${paperReferenceHtml(id)}`;
    await savePage({ path: first.path, title: first.title, body: firstBody });
    await savePage({ path: second.path, title: second.title, body: secondBody });

    const firstView = await loadInlinePaper(id);
    const secondView = await loadInlinePaper(id);
    const edited = "<h2>New shared note</h2><p>Edited inline</p>";
    const verified = await saveInlinePaper(firstView, edited);

    expect(verified.body).toBe(edited);
    expect((await readPage(paper.path)).body).toBe(edited);
    expect((await loadInlinePaper(id)).body).toBe(edited); // second reference Refresh/reopen
    expect((await readPage(first.path)).body).toBe(firstBody);
    expect((await readPage(second.path)).body).toBe(secondBody);
    await expect(saveInlinePaper(secondView, "<p>Stale overwrite</p>")).rejects.toThrow(/changed elsewhere/i);
    expect((await readPage(paper.path)).body).toBe(edited);

    // Second reference after Refresh: its edit persists on top of the first one.
    const secondRefreshed = await loadInlinePaper(id);
    const both = `${edited}<p>Edited from the second reference</p>`;
    expect((await saveInlinePaper(secondRefreshed, both)).body).toBe(both);
    expect((await readPage(paper.path)).body).toBe(both);
    expect((await loadInlinePaper(id)).body).toBe(both); // first reference Refresh/reopen
    expect((await readPage(first.path)).body).toBe(firstBody);
    expect((await readPage(second.path)).body).toBe(secondBody);
  });
  it("rejects stale or malformed conditional writes without touching any file", async () => {
    const paper = await createPaper("Guarded", "Research");
    const id = String(paper.metadata.paper_id);
    const page = await createPage({ sectionPath: "Research/Articles", title: "Referrer" });
    const pageBody = `<p>Mine</p>${paperReferenceHtml(id)}`;
    await savePage({ path: page.path, title: page.title, body: pageBody });
    const stale = await loadInlinePaper(id);
    await saveInlinePaper(stale, "<p>Newer</p>");
    const paperFile = path.join(root, paper.path);
    const pageFile = path.join(root, page.path);
    const paperBytes = await fs.readFile(paperFile, "utf8");
    const pageBytes = await fs.readFile(pageFile, "utf8");
    const put = (body: object) => PUT(new Request("http://localhost/api/page", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

    expect((await put({ path: paper.path, title: stale.title, content: "<p>Old</p>", expectedPaperRevision: stale.revision })).status).toBe(409);
    expect((await put({ path: paper.path, title: stale.title, content: "<p>Old</p>", expectedPaperRevision: "sha256:nope" })).status).toBe(400);
    expect((await put({ path: page.path, title: page.title, content: "<p>Clobber</p>", expectedPaperRevision: stale.revision })).status).toBe(400);
    expect(await fs.readFile(paperFile, "utf8")).toBe(paperBytes);
    expect(await fs.readFile(pageFile, "utf8")).toBe(pageBytes);
  });
});

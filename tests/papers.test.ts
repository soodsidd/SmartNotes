import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bibliographyEntries, paperBackTarget, paperHomeNotebook, paperPath, paperReferenceHtml, paperReferenceIds } from "@/lib/papers";
import { createPaper, createPage, readPage, savePage, renamePage, movePage, readVaultTree, deletePage, invalidateVaultTreeCache, renameNotebook, renameSection, savePageComments } from "@/server/vault/pages";

describe("Bibliography identity and references", () => {
  let root: string;
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-papers-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research", "Articles"), { recursive: true });
    await fs.mkdir(path.join(root, "Research", "Moved"), { recursive: true });
    invalidateVaultTreeCache();
  });
  afterEach(async () => {
    if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = previousVault;
    if (previousState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = previousState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps one standard canonical page through paper and referring-page renames and moves", async () => {
    const paper = await createPaper("Shared research", "Research");
    const id = String(paper.metadata.paper_id);
    expect(paper.path).toBe(paperPath(id));
    expect(paper.metadata.note_type).toBe("text");
    expect(paper.metadata.paper_home_notebook).toBe("Research");
    await savePage({ path: paper.path, title: paper.title, body: '<p>Canonical notes</p><a href="/vault/paper.pdf">PDF</a>' });
    const parent = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    await savePage({ path: parent.path, title: parent.title, body: paperReferenceHtml(id) });
    const renamed = await renamePage(parent.path, "Renamed article");
    const moved = await movePage(renamed.path, "Research/Moved");
    await renameSection("Research/Moved", "Sources");
    await renameNotebook("Research", "Reading");
    const renamedPaper = await renamePage(paper.path, "Renamed paper");
    expect(renamedPaper.path).toBe(paper.path);
    expect(renamedPaper.metadata.paper_id).toBe(id);
    const entries = bibliographyEntries((await readVaultTree({ skipCache: true })).tree);
    expect(entries[0].referrers).toEqual([expect.objectContaining({ path: moved.path.replace("Research/Moved", "Reading/Sources") })]);
    expect(renamedPaper.body).toContain("Canonical notes");
    const renamedTree = (await readVaultTree({ skipCache: true })).tree;
    expect((await readPage(paper.path)).metadata.paper_home_notebook).toBe("Reading");
    expect(paperHomeNotebook(entries[0].page, renamedTree)?.name).toBe("Reading");
    expect(bibliographyEntries(renamedTree).filter((entry) => entry.referrers.some((referrer) => referrer.notebookPath === "Reading")).map((entry) => entry.page.path)).toEqual([paper.path]);
    await expect(movePage(paper.path, "Reading/Articles")).rejects.toMatchObject({ code: "BIBLIOGRAPHY_OWNERSHIP" });
  });

  it("deduplicates page referrers; removes membership without deleting notes or ingest metadata", async () => {
    const paper = await createPaper("One paper", "Research");
    const id = String(paper.metadata.paper_id);
    const parent = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    const sidecarPath = path.join(root, parent.path.replace(/\.html$/, ".ref.json"));
    await fs.writeFile(sidecarPath, '{"referenceType":"paper","doi":"legacy"}');
    await savePage({ path: parent.path, title: parent.title, body: paperReferenceHtml(id).repeat(2) });
    let tree = (await readVaultTree({ skipCache: true })).tree;
    let entry = bibliographyEntries(tree)[0];
    expect(entry.referrers).toHaveLength(1);
    await expect(deletePage(paper.path)).rejects.toMatchObject({ code: "PAPER_REFERENCED" });
    await savePage({ path: parent.path, title: parent.title, body: "<p>Reference removed</p>" });
    tree = (await readVaultTree({ skipCache: true })).tree;
    entry = bibliographyEntries(tree)[0];
    expect(entry.referrers).toHaveLength(0);
    expect(bibliographyEntries(tree).filter((paper) => paper.referrers.some((referrer) => referrer.notebookPath === "Research"))).toEqual([]);
    expect((await readPage(paper.path)).metadata.paper_id).toBe(id);
    expect(await fs.readFile(sidecarPath, "utf8")).toBe('{"referenceType":"paper","doi":"legacy"}');
  });

  it("uses the standard save path for shared notes and preserves identity, comments and attachments", async () => {
    const paper = await createPaper("Live notes", "Research");
    const content = '<h2>Edited inline</h2><p><strong>Shared</strong></p><a data-type="file-attachment" href="/vault/paper.pdf">paper.pdf</a>';
    await savePage({ path: paperPath(String(paper.metadata.paper_id)), title: paper.title, body: content });
    await savePageComments(paper.path, [{ id: "comment-1", quote: "Shared", text: "A shared comment", createdAt: new Date().toISOString(), resolvedAt: null }]);
    const entry = bibliographyEntries((await readVaultTree({ skipCache: true })).tree)[0];
    expect(entry.page.content).toBe(content);
    expect((await readPage(paper.path)).body).toBe(content);
    expect((await readPage(paper.path)).metadata.comments).toEqual([expect.objectContaining({ text: "A shared comment" })]);
    await expect(createPage({ notebookPath: ".bibliography", title: "Bypass" })).rejects.toMatchObject({ code: "BIBLIOGRAPHY_OWNERSHIP" });
  });

  it("SN-292: requires a real home notebook and breadcrumbs legacy papers by their referrer", async () => {
    await expect(createPaper("Nowhere", "Missing")).rejects.toMatchObject({ code: "INVALID_NOTEBOOK" });
    await expect(createPaper("Inside library", ".bibliography")).rejects.toMatchObject({ code: "INVALID_NOTEBOOK" });
    const paper = await createPaper("Sourced", "Research", " https://doi.org/10.1/x ");
    expect(paper.metadata.paper_source).toBe("https://doi.org/10.1/x");
    // A foundation-branch paper has no paper_home_notebook; its first referrer's notebook stands in.
    const id = String(paper.metadata.paper_id);
    const raw = await fs.readFile(path.join(root, paper.path), "utf8");
    await fs.writeFile(path.join(root, paper.path), raw.replace(/^paper_home_notebook:.*\r?\n/m, ""));
    const article = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    await savePage({ path: article.path, title: article.title, body: paperReferenceHtml(id) });
    const tree = (await readVaultTree({ skipCache: true })).tree;
    const legacy = bibliographyEntries(tree)[0].page;
    expect(legacy.metadata?.paper_home_notebook).toBeUndefined();
    expect(paperHomeNotebook(legacy, tree)?.name).toBe("Research");
  });

  it("SN-292: Back to topic prefers the clicked referrer, then the previous page, then a home referrer", async () => {
    await fs.mkdir(path.join(root, "Reading", "Sources"), { recursive: true });
    invalidateVaultTreeCache();
    const paper = await createPaper("Topic paper", "Research");
    const id = String(paper.metadata.paper_id);
    const home = await createPage({ sectionPath: "Research/Articles", title: "Home ref" });
    const away = await createPage({ sectionPath: "Reading/Sources", title: "Away ref" });
    const unrelated = await createPage({ sectionPath: "Research/Moved", title: "Unrelated" });
    await savePage({ path: away.path, title: away.title, body: paperReferenceHtml(id) });
    await savePage({ path: home.path, title: home.title, body: paperReferenceHtml(id) });
    let tree = (await readVaultTree({ skipCache: true })).tree;
    expect(paperBackTarget({ paperPath: paper.path, tree, referringPath: away.path, previousPath: unrelated.path })).toBe(away.path);
    expect(paperBackTarget({ paperPath: paper.path, tree, previousPath: unrelated.path })).toBe(unrelated.path);
    // Another paper page or a deleted page is never the "topic".
    expect(paperBackTarget({ paperPath: paper.path, tree, previousPath: paper.path })).toBe(home.path);
    await deletePage(unrelated.path);
    tree = (await readVaultTree({ skipCache: true })).tree;
    expect(paperBackTarget({ paperPath: paper.path, tree, previousPath: unrelated.path })).toBe(home.path);
    // Removing every reference leaves nothing to return to, but never removes the paper.
    await savePage({ path: home.path, title: home.title, body: "<p></p>" });
    await savePage({ path: away.path, title: away.title, body: "<p></p>" });
    tree = (await readVaultTree({ skipCache: true })).tree;
    expect(paperBackTarget({ paperPath: paper.path, tree })).toBeNull();
    expect(bibliographyEntries(tree).map((entry) => entry.page.path)).toEqual([paper.path]);
  });

  it("rejects unsafe identities and ignores ingest metadata and code examples", () => {
    expect(() => paperPath("../escape")).toThrow();
    const id = "12345678-1234-4567-8123-123456789abc";
    expect(paperReferenceIds(`<pre>${paperReferenceHtml(id)}</pre><!--${paperReferenceHtml(id)}--><a href="legacy.ref.json">ingest</a>`)).toEqual([]);
    expect(paperReferenceIds(paperReferenceHtml(id))).toEqual([id]);
  });
});

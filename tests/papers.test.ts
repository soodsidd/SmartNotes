import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bibliographyEntries, paperChildren, paperPath, paperReferenceHtml, paperReferenceIds } from "@/lib/papers";
import { createPaper, createPage, readPage, savePage, renamePage, movePage, readVaultTree, deletePage, invalidateVaultTreeCache, renameNotebook, renameSection, saveReferenceSidecar } from "@/server/vault/pages";

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
    const paper = await createPaper("Shared research");
    const id = String(paper.metadata.paper_id);
    expect(paper.path).toBe(paperPath(id));
    expect(paper.metadata.note_type).toBe("text");
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
    await expect(movePage(paper.path, "Reading/Articles")).rejects.toMatchObject({ code: "BIBLIOGRAPHY_OWNERSHIP" });
  });

  it("deduplicates virtual children; removes membership without deleting notes or ingest metadata", async () => {
    const paper = await createPaper("One paper");
    const id = String(paper.metadata.paper_id);
    const parent = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    const sidecarPath = path.join(root, parent.path.replace(/\.html$/, ".ref.json"));
    await fs.writeFile(sidecarPath, '{"referenceType":"paper","doi":"legacy"}');
    await savePage({ path: parent.path, title: parent.title, body: paperReferenceHtml(id).repeat(2) });
    let tree = (await readVaultTree({ skipCache: true })).tree;
    let entry = bibliographyEntries(tree)[0];
    const parentSummary = tree[0].sections.flatMap((section) => section.pages)[0];
    expect(paperChildren(parentSummary, [entry.page])).toEqual([expect.objectContaining({ content: "", paperReference: expect.objectContaining({ canonicalPath: paper.path }) })]);
    expect(entry.referrers).toHaveLength(1);
    await expect(deletePage(paper.path)).rejects.toMatchObject({ code: "PAPER_REFERENCED" });
    await savePage({ path: parent.path, title: parent.title, body: "<p>Reference removed</p>" });
    tree = (await readVaultTree({ skipCache: true })).tree;
    entry = bibliographyEntries(tree)[0];
    expect(entry.referrers).toHaveLength(0);
    expect(paperChildren({ ...parentSummary, content: "" }, [entry.page])).toEqual([]);
    expect((await readPage(paper.path)).metadata.paper_id).toBe(id);
    expect(await fs.readFile(sidecarPath, "utf8")).toBe('{"referenceType":"paper","doi":"legacy"}');
  });

  it("uses the standard save path for shared notes and preserves identity, comments and attachments", async () => {
    const paper = await createPaper("Live notes");
    const content = '<h2>Edited inline</h2><p><strong>Shared</strong></p><a data-type="file-attachment" href="/vault/paper.pdf">paper.pdf</a>';
    await savePage({ path: paperPath(String(paper.metadata.paper_id)), title: paper.title, body: content });
    const entry = bibliographyEntries((await readVaultTree({ skipCache: true })).tree)[0];
    expect(entry.page.content).toBe(content);
    expect((await readPage(paper.path)).body).toBe(content);
    await expect(createPage({ notebookPath: ".bibliography", title: "Bypass" })).rejects.toMatchObject({ code: "BIBLIOGRAPHY_OWNERSHIP" });
  });

  it("rejects unsafe identities and ignores ingest metadata and code examples", () => {
    expect(() => paperPath("../escape")).toThrow();
    const id = "12345678-1234-4567-8123-123456789abc";
    expect(paperReferenceIds(`<pre>${paperReferenceHtml(id)}</pre><!--${paperReferenceHtml(id)}--><a href="legacy.ref.json">ingest</a>`)).toEqual([]);
    expect(paperReferenceIds(paperReferenceHtml(id))).toEqual([id]);
  });
});

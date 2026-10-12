import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bibliographyEntries, paperReferenceHtml, paperReferenceIds, removePaperReferences } from "@/lib/papers";
import { executeVaultTool, VAULT_TOOL_DEFINITIONS } from "@/server/vault/agent-tools";
import { buildCompanionPageContext } from "@/server/vault/companion-context";
import { createPage, invalidateVaultTreeCache, readPage, readVaultTree, savePage } from "@/server/vault/pages";
import { attachPdfToPaper, downloadPdf, pdfAttachmentChipHtml, type FetchLike } from "@/server/vault/paper-tools";
import { listPageVersions } from "@/server/vault/versions";

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const publicLookup = async () => [{ address: "93.184.216.34" }];

function pdfFetch(body: Buffer = PDF_BYTES, headers: Record<string, string> = {}): FetchLike {
  return async () => new Response(body, { status: 200, headers: { "content-type": "application/pdf", ...headers } });
}

async function tool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const outcome = await executeVaultTool(name, args);
  if (!outcome.ok) throw Object.assign(new Error(outcome.error), { code: outcome.code });
  return outcome.result as T;
}

describe("SN-282 companion paper tools", () => {
  let root: string;
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-paper-tools-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research", "Articles"), { recursive: true });
    invalidateVaultTreeCache();
  });
  afterEach(async () => {
    if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = previousVault;
    if (previousState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = previousState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("registers the paper tools on the existing agent vault surface", () => {
    const names = VAULT_TOOL_DEFINITIONS.filter((definition) => definition.group === "paper").map((definition) => definition.name);
    expect(names).toEqual(["paper_list", "paper_create", "paper_reference_add", "paper_remove", "paper_attach_pdf"]);
  });

  it("creates a canonical paper from an article, references it once, and finds it by title", async () => {
    const article = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    await savePage({ path: article.path, title: article.title, body: "<p>Article body</p>" });

    const created = await tool("paper_create", { title: "Attention Is All You Need", referenceFromPath: article.path });
    expect(created.treeChanged).toBe(true);
    expect(created.data.paper.path).toBe(`.bibliography/${created.data.paper.id}.html`);
    expect(created.data.referencedFrom).toBe(article.path);
    // SN-292: the referring article's notebook becomes the paper's home.
    expect((await readPage(created.data.paper.path)).metadata.paper_home_notebook).toBe("Research");
    await expect(tool("paper_create", { title: "Homeless" })).rejects.toMatchObject({ code: "INVALID_NOTEBOOK" });
    expect(created.fileUpdated.path).toBe(article.path);

    const body = (await readPage(article.path)).body;
    expect(body).toContain("<p>Article body</p>");
    expect(paperReferenceIds(body)).toEqual([created.data.paper.id]);

    // Idempotent re-reference by id: no duplicate chip, no write.
    const again = await tool("paper_reference_add", { path: article.path, paper: created.data.paper.id });
    expect(again.data.added).toBe(false);
    expect(again.fileUpdated).toBeUndefined();

    const found = await tool("paper_list", { query: "attention" });
    expect(found.data.papers).toEqual([
      expect.objectContaining({ id: created.data.paper.id, title: "Attention Is All You Need", referrers: [{ path: article.path, title: "Article" }] }),
    ]);
    expect((await tool("paper_list", { query: "nothing like this" })).data.papers).toEqual([]);

    // SN-279 child row contract: the article now owns a virtual child for the paper.
    const entries = bibliographyEntries((await readVaultTree({ skipCache: true })).tree);
    expect(entries[0].referrers.map((referrer) => referrer.path)).toEqual([article.path]);
  });

  it("references an existing paper by canonical path and rejects non-paper targets", async () => {
    const article = await createPage({ sectionPath: "Research/Articles", title: "Second article" });
    const paper = (await tool("paper_create", { title: "Existing", homeNotebookPath: "Research" })).data.paper;
    const added = await tool("paper_reference_add", { path: article.path, paper: `/vault/${paper.path}` });
    expect(added.data.added).toBe(true);
    expect(paperReferenceIds((await readPage(article.path)).body)).toEqual([paper.id]);
    await expect(tool("paper_reference_add", { path: article.path, paper: article.path })).rejects.toMatchObject({ code: "NOT_A_PAPER" });
    await expect(tool("paper_reference_add", { path: paper.path, paper: paper.id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("removes a paper by clearing every reference first (snapshotted) so no reference is orphaned", async () => {
    const keep = (await tool("paper_create", { title: "Keep", homeNotebookPath: "Research" })).data.paper;
    const drop = (await tool("paper_create", { title: "Drop", homeNotebookPath: "Research" })).data.paper;
    const first = await createPage({ sectionPath: "Research/Articles", title: "First" });
    const second = await createPage({ sectionPath: "Research/Articles", title: "Second" });
    await savePage({ path: first.path, title: first.title, body: `<p>Intro</p>${paperReferenceHtml(drop.id)}${paperReferenceHtml(keep.id)}<p>Outro</p>` });
    await savePage({ path: second.path, title: second.title, body: `<div data-paper-id="${drop.id.toUpperCase()}" data-type="paper-reference"></div>` });
    const assetDir = path.join(root, ".bibliography", `${drop.id}.assets`);
    await fs.mkdir(assetDir, { recursive: true });
    await fs.writeFile(path.join(assetDir, "drop.pdf"), PDF_BYTES);

    const removed = await tool("paper_remove", { paper: drop.path });
    expect(removed.data.clearedReferences.map((entry: { path: string }) => entry.path).sort()).toEqual([first.path, second.path].sort());
    expect(removed.filesUpdated).toHaveLength(2);

    const firstBody = (await readPage(first.path)).body;
    expect(firstBody).toBe(`<p>Intro</p>${paperReferenceHtml(keep.id)}<p>Outro</p>`);
    expect(paperReferenceIds((await readPage(second.path)).body)).toEqual([]);
    await expect(readPage(drop.path)).rejects.toBeTruthy();
    await expect(fs.stat(assetDir)).rejects.toBeTruthy();
    expect((await listPageVersions(first.path)).length).toBeGreaterThan(0);

    const entries = bibliographyEntries((await readVaultTree({ skipCache: true })).tree);
    expect(entries.map((entry) => entry.id)).toEqual([keep.id]);
    await expect(tool("paper_remove", { paper: drop.id })).rejects.toBeTruthy();
  });

  it("removePaperReferences leaves other ids, unrelated divs and text untouched", () => {
    const a = "0b7a3c1e-4f2d-4a8b-9c3d-2e1f0a9b8c7d";
    const b = "1c8b4d2f-5a3e-4b9c-8d4e-3f2a1b0c9d8e";
    const html = `<div class="x"></div>${paperReferenceHtml(a)}<p>${a}</p>${paperReferenceHtml(b)}`;
    expect(removePaperReferences(html, a.toUpperCase())).toBe(`<div class="x"></div><p>${a}</p>${paperReferenceHtml(b)}`);
  });

  it("downloads a PDF and attaches it to the paper like a normal upload", async () => {
    const paper = (await tool("paper_create", { title: "With PDF", homeNotebookPath: "Research" })).data.paper;
    await savePage({ path: paper.path, title: "With PDF", body: "<p>My notes</p>" });
    const result = await attachPdfToPaper(
      { paper: paper.id, url: "https://arxiv.org/pdf/1706.03762" },
      { fetchImpl: pdfFetch(PDF_BYTES, { "content-disposition": 'attachment; filename="attention.pdf"' }), lookup: publicLookup }
    );
    expect(result.attachment).toMatchObject({
      href: `/vault/.bibliography/${paper.id}.assets/attention.pdf`,
      fileName: "attention.pdf",
      bytes: PDF_BYTES.length,
    });
    expect(await fs.readFile(path.join(root, ".bibliography", `${paper.id}.assets`, "attention.pdf"))).toEqual(PDF_BYTES);
    const body = (await readPage(paper.path)).body;
    expect(body).toBe(`<p>My notes</p>\n${pdfAttachmentChipHtml(result.attachment.href, "attention.pdf")}`);
    expect(body).toContain('data-file-type="pdf"');

    // Name fallback from the URL, uniquified on collision, .pdf enforced.
    const second = await attachPdfToPaper(
      { paper: paper.path, url: "https://example.org/files/attention" , fileName: "attention" },
      { fetchImpl: pdfFetch(), lookup: publicLookup }
    );
    expect(second.attachment.fileName).toBe("attention-2.pdf");

    // Durable and visible to the paper-scoped companion context.
    const context = await buildCompanionPageContext({ path: paper.path, basePageContext: body });
    expect(context.pageContext).toContain("## Open paper (Bibliography)");
    expect(context.pageContext).toContain(`.bibliography/${paper.id}.assets/attention.pdf`);
    expect(context.pageContext).toContain(`.bibliography/${paper.id}.assets/attention-2.pdf`);
  });

  it("replaces a new paper's empty placeholder body instead of appending under it", async () => {
    const paper = (await tool("paper_create", { title: "Fresh", homeNotebookPath: "Research" })).data.paper;
    expect((await readPage(paper.path)).body).toBe("<p></p>");
    const result = await attachPdfToPaper({ paper: paper.id, url: "https://example.org/fresh.pdf" }, { fetchImpl: pdfFetch(), lookup: publicLookup });
    expect((await readPage(paper.path)).body).toBe(pdfAttachmentChipHtml(result.attachment.href, "fresh.pdf"));
  });

  it("rejects non-PDF responses, oversize bodies, and private or non-http URLs without writing", async () => {
    const paper = (await tool("paper_create", { title: "Guarded", homeNotebookPath: "Research" })).data.paper;
    const html = async () => new Response("<html>landing page</html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(attachPdfToPaper({ paper: paper.id, url: "https://example.org/abs/1" }, { fetchImpl: html, lookup: publicLookup }))
      .rejects.toMatchObject({ code: "NOT_A_PDF" });
    await expect(downloadPdf("https://example.org/big.pdf", { fetchImpl: pdfFetch(Buffer.concat([PDF_BYTES, Buffer.alloc(2048)])), lookup: publicLookup, maxBytes: 1024 }))
      .rejects.toMatchObject({ code: "PDF_TOO_LARGE" });
    await expect(downloadPdf("https://example.org/missing.pdf", { fetchImpl: async () => new Response("", { status: 404 }), lookup: publicLookup }))
      .rejects.toMatchObject({ code: "PDF_DOWNLOAD_FAILED" });
    for (const url of ["file:///etc/passwd", "http://localhost:3000/a.pdf", "http://127.0.0.1/a.pdf", "http://[::1]/a.pdf", "http://192.168.1.5/a.pdf"]) {
      await expect(downloadPdf(url, { fetchImpl: pdfFetch(), lookup: publicLookup })).rejects.toMatchObject({ code: "INVALID_URL" });
    }
    await expect(downloadPdf("https://intranet.example/a.pdf", { fetchImpl: pdfFetch(), lookup: async () => [{ address: "10.0.0.8" }] }))
      .rejects.toMatchObject({ code: "INVALID_URL" });
    // A public URL may not redirect into the local network.
    const redirect: FetchLike = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret.pdf" } });
    await expect(downloadPdf("https://example.org/a.pdf", { fetchImpl: redirect, lookup: publicLookup })).rejects.toMatchObject({ code: "INVALID_URL" });
    // Redirects to public hosts are followed.
    let hops = 0;
    const follow: FetchLike = async () => (hops++ === 0
      ? new Response(null, { status: 301, headers: { location: "/pdf/real.pdf" } })
      : new Response(PDF_BYTES, { status: 200 }));
    expect((await downloadPdf("https://example.org/abs", { fetchImpl: follow, lookup: publicLookup })).url).toBe("https://example.org/pdf/real.pdf");

    expect((await readPage(paper.path)).body).toBe("<p></p>");
    await expect(fs.stat(path.join(root, ".bibliography", `${paper.id}.assets`))).rejects.toBeTruthy();
    await expect(tool("paper_attach_pdf", { paper: paper.id, url: "http://localhost/x.pdf" })).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("gives Companion the whole paper when its notes are open as an ordinary page", async () => {
    const paper = (await tool("paper_create", { title: "Notes mode", homeNotebookPath: "Research" })).data.paper;
    const assets = path.join(root, ".bibliography", `${paper.id}.assets`);
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, "main.pdf"), PDF_BYTES);
    await fs.writeFile(path.join(assets, "figure.png"), "png");
    const body = `<p>Claim</p>${pdfAttachmentChipHtml(`/vault/.bibliography/${paper.id}.assets/main.pdf`, "main.pdf")}`;
    await savePage({ path: paper.path, title: "Notes mode", body });

    const context = await buildCompanionPageContext({ path: paper.path, basePageContext: body });
    expect(context.pageContext).toContain("## Open paper (Bibliography)");
    expect(context.pageContext).toContain("The owner has this Bibliography paper open");
    expect(context.pageContext).toContain(`Paper id: ${paper.id}`);
    expect(context.pageContext).toContain(`main.pdf — .bibliography/${paper.id}.assets/main.pdf`);
    expect(context.pageContext).toContain(`### Other attachments (1)`);
    expect(context.pageContext).toContain(`.bibliography/${paper.id}.assets/figure.png`);
    expect(context.pageContext).toContain("the current page context above is this paper's notes");

    // Ordinary pages do not gain a paper block.
    const article = await createPage({ sectionPath: "Research/Articles", title: "Plain" });
    const plain = await buildCompanionPageContext({ path: article.path, basePageContext: "Plain" });
    expect(plain.pageContext).not.toContain("Open paper");
  });
});

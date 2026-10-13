import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { paperReferenceHtml, paperReferenceIds } from "@/lib/papers";
import { defaultPaperTitleFromPdfName, listPagePdfChips } from "@/lib/paper-attach";
import { executeVaultTool, VAULT_TOOL_DEFINITIONS } from "@/server/vault/agent-tools";
import { createPage, invalidateVaultTreeCache, readPage, savePage } from "@/server/vault/pages";
import {
  createPaperFromVaultPdf,
  insertPaperReferenceAtPdf,
  normalizeVaultPdfSource,
  pdfAttachmentChipHtml,
  removePdfAttachmentChip,
  titleFromPdfFileName,
} from "@/server/vault/paper-tools";
import { uploadPageAsset } from "@/server/vault/assets";

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

async function tool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const outcome = await executeVaultTool(name, args);
  if (!outcome.ok) throw Object.assign(new Error(outcome.error), { code: outcome.code });
  return outcome.result as T;
}

describe("SN-302 promote vault PDF to paper", () => {
  let root: string;
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-paper-promote-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research", "Articles"), { recursive: true });
    invalidateVaultTreeCache();
  });

  afterEach(async () => {
    if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT;
    else process.env.SMART_NOTES_VAULT = previousVault;
    if (previousState === undefined) delete process.env.SMART_NOTES_STATE_DIR;
    else process.env.SMART_NOTES_STATE_DIR = previousState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("registers paper_create_from_pdf beside the existing paper tools", () => {
    const names = VAULT_TOOL_DEFINITIONS.filter((definition) => definition.group === "paper").map((definition) => definition.name);
    expect(names).toEqual([
      "paper_list",
      "paper_create",
      "paper_reference_add",
      "paper_remove",
      "paper_attach_pdf",
      "paper_create_from_pdf",
    ]);
  });

  it("defaults titles from the PDF filename and lists page chips", () => {
    expect(titleFromPdfFileName("Attention.pdf")).toBe("Attention");
    expect(defaultPaperTitleFromPdfName("notes.PDF")).toBe("notes");
    expect(normalizeVaultPdfSource("/vault/Research/Articles/page.assets/doc.pdf")).toBe(
      "Research/Articles/page.assets/doc.pdf"
    );
    const chips = listPagePdfChips(
      `<p>${pdfAttachmentChipHtml("/vault/Research/Articles/page.assets/doc.pdf", "doc.pdf")}</p>`
    );
    expect(chips).toEqual([{ href: "/vault/Research/Articles/page.assets/doc.pdf", fileName: "doc.pdf" }]);
  });

  it("copies the vault PDF onto a new paper, inserts a paper chip in place, and keeps the original by default", async () => {
    const article = await createPage({ sectionPath: "Research/Articles", title: "Article" });
    const asset = await uploadPageAsset(article.path, "attention.pdf", PDF_BYTES);
    const pdfChip = pdfAttachmentChipHtml(asset.url, asset.fileName);
    await savePage({
      path: article.path,
      title: article.title,
      body: `<p>Intro</p>${pdfChip}<p>Outro</p>`,
    });

    const result = await createPaperFromVaultPdf({
      href: asset.url,
      referenceFromPath: article.path,
      homeNotebookPath: "Research",
    });

    expect(result.created).toBe(true);
    expect(result.paper.title).toBe("attention");
    expect(result.attachment?.path).toBe(`.bibliography/${result.paper.id}.assets/attention.pdf`);
    expect(await fs.readFile(path.join(root, result.attachment!.path))).toEqual(PDF_BYTES);
    expect(await fs.readFile(path.join(root, asset.path))).toEqual(PDF_BYTES);

    const paperBody = (await readPage(result.paper.path)).body;
    expect(paperBody).toBe(pdfAttachmentChipHtml(result.attachment!.href, "attention.pdf"));

    const articleBody = (await readPage(article.path)).body;
    expect(paperReferenceIds(articleBody)).toEqual([result.paper.id]);
    expect(articleBody).toContain('data-file-type="pdf"');
    expect(articleBody).toContain(asset.url);
    expect(result.replacedChip).toBe(false);
    // Paper chip sits at the PDF location (before the original chip), not appended after Outro.
    expect(articleBody.indexOf("data-type=\"paper-reference\"")).toBeGreaterThan(articleBody.indexOf("<p>Intro</p>"));
    expect(articleBody.indexOf("data-type=\"paper-reference\"")).toBeLessThan(articleBody.indexOf('data-file-type="pdf"'));
    expect(articleBody.indexOf('data-file-type="pdf"')).toBeLessThan(articleBody.indexOf("<p>Outro</p>"));
    expect(articleBody.endsWith("<p>Outro</p>") || articleBody.includes("<p>Outro</p>")).toBe(true);
    expect(articleBody.lastIndexOf("data-type=\"paper-reference\"")).toBeLessThan(articleBody.indexOf("<p>Outro</p>"));
  });

  it("optionally replaces the original PDF chip in place when replaceChip is true", async () => {
    const article = await createPage({ sectionPath: "Research/Articles", title: "Replace" });
    const asset = await uploadPageAsset(article.path, "drop.pdf", PDF_BYTES);
    await savePage({
      path: article.path,
      title: article.title,
      body: `<p>Keep</p>${pdfAttachmentChipHtml(asset.url, asset.fileName)}<p>Tail</p>`,
    });

    const result = await createPaperFromVaultPdf({
      sourcePath: asset.path,
      title: "Dropped PDF",
      referenceFromPath: article.path,
      replaceChip: true,
    });

    expect(result.replacedChip).toBe(true);
    const body = (await readPage(article.path)).body;
    expect(body).toContain("<p>Keep</p>");
    expect(body).toContain("<p>Tail</p>");
    expect(body).not.toContain('data-file-type="pdf"');
    expect(paperReferenceIds(body)).toEqual([result.paper.id]);
    expect(await fs.readFile(path.join(root, asset.path))).toEqual(PDF_BYTES);
    expect(body.indexOf("data-type=\"paper-reference\"")).toBeGreaterThan(body.indexOf("<p>Keep</p>"));
    expect(body.indexOf("data-type=\"paper-reference\"")).toBeLessThan(body.indexOf("<p>Tail</p>"));
  });

  it("attaches an existing paper when that exact vault PDF asset is already on a paper", async () => {
    const first = await createPage({ sectionPath: "Research/Articles", title: "First" });
    const second = await createPage({ sectionPath: "Research/Articles", title: "Second" });
    const asset = await uploadPageAsset(first.path, "shared.pdf", PDF_BYTES);
    await savePage({
      path: first.path,
      title: first.title,
      body: pdfAttachmentChipHtml(asset.url, asset.fileName),
    });

    const created = await createPaperFromVaultPdf({
      href: asset.url,
      title: "Shared",
      referenceFromPath: first.path,
    });
    expect(created.created).toBe(true);

    const again = await createPaperFromVaultPdf({
      href: asset.url,
      referenceFromPath: second.path,
    });
    expect(again.created).toBe(false);
    expect(again.paper.id).toBe(created.paper.id);
    expect(paperReferenceIds((await readPage(second.path)).body)).toEqual([created.paper.id]);
    const papers = await fs.readdir(path.join(root, ".bibliography"));
    expect(papers.filter((name) => name.endsWith(".html"))).toHaveLength(1);
  });

  it("rejects web URLs so paper_attach_pdf stays the URL-only path", async () => {
    await expect(
      createPaperFromVaultPdf({ href: "https://arxiv.org/pdf/1706.03762", homeNotebookPath: "Research" })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(tool("paper_create_from_pdf", { href: "http://example.com/a.pdf", homeNotebookPath: "Research" })).rejects.toMatchObject({
      code: "INVALID_URL",
    });
  });

  it("removePdfAttachmentChip only strips matching PDF chips", () => {
    const keep = pdfAttachmentChipHtml("/vault/a.assets/keep.pdf", "keep.pdf");
    const drop = pdfAttachmentChipHtml("/vault/a.assets/drop.pdf", "drop.pdf");
    const html = `<p>Intro</p>${keep}${drop}<p>Outro</p>`;
    expect(removePdfAttachmentChip(html, "a.assets/drop.pdf")).toBe(`<p>Intro</p>${keep}<p>Outro</p>`);
  });

  it("insertPaperReferenceAtPdf places the chip at the PDF, not at the document end", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const pdf = pdfAttachmentChipHtml("/vault/a.assets/mid.pdf", "mid.pdf");
    const html = `<p>Intro</p>${pdf}<p>Outro</p>`;
    const kept = insertPaperReferenceAtPdf(html, "a.assets/mid.pdf", id);
    expect(kept.atPdf).toBe(true);
    expect(kept.replaced).toBe(false);
    expect(kept.html).toBe(`<p>Intro</p>${paperReferenceHtml(id)}${pdf}<p>Outro</p>`);

    const swapped = insertPaperReferenceAtPdf(html, "a.assets/mid.pdf", id, { replaceChip: true });
    expect(swapped.replaced).toBe(true);
    expect(swapped.html).toBe(`<p>Intro</p>${paperReferenceHtml(id)}<p>Outro</p>`);
  });
});

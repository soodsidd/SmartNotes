import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendPdfRecord, createPage, invalidateVaultTreeCache, readPage, savePage, undoPdfRecord } from "@/server/vault/pages";
import { exactPdfHighlightQuote, pdfRecordMarkup, type PdfRecordInput } from "@/lib/pdf-record";
import { POST as postRecord } from "@/app/api/pdf-record/route";

describe("PDF Record provenance and retry", () => {
  let root: string;
  const oldVault = process.env.SMART_NOTES_VAULT;
  const oldState = process.env.SMART_NOTES_STATE_DIR;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-pdf-record-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research"));
    invalidateVaultTreeCache();
  });
  afterEach(async () => {
    if (oldVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = oldVault;
    if (oldState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = oldState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  function input(destinationPath: string): PdfRecordInput {
    return { id: "54c2a31a-734f-43b7-ab1e-d95fb5d93353", destinationPath, pdfPath: "Research/Paper.assets/source.pdf", pdfTitle: "A <paper>", page: 7,
      quote: "  First line\nSecond  line & <detail>  ", thought: "Check this", question: "Explain this text.", answer: "AI says <possible answer>." };
  }

  it("writes the exact escaped quote, source jump, and separately labeled AI answer", async () => {
    expect(exactPdfHighlightQuote({ text: "  marked\ntext  ", quote: "normalized" })).toBe("  marked\ntext  ");
    expect(exactPdfHighlightQuote({ quote: "legacy exact" })).toBe("legacy exact");
    expect(exactPdfHighlightQuote({})).toBeNull();
    const note = await createPage({ notebookPath: "Research", title: "Notes" });
    const record = input(note.path);
    const result = await appendPdfRecord(record);
    expect(result.created).toBe(true);
    const body = (await readPage(note.path)).body;
    expect(body).toContain("First line\nSecond  line &amp; &lt;detail&gt;  ");
    expect(body).toContain("Source passage (verbatim)");
    expect(body).toContain("Question/action:");
    expect(body).toContain("AI answer:");
    expect(body).toContain("/vault/Research/Paper.assets/source.pdf#page=7");
    expect(body).toContain("A &lt;paper&gt;");
    expect(pdfRecordMarkup({ ...record, quote: null, quoteUnavailable: true })).toContain("Text unavailable");
    expect(pdfRecordMarkup({ ...record, quoteRecovered: true })).toContain("spacing may differ");
  });

  it("retries once in the original destination and undo removes only that record", async () => {
    const first = await createPage({ notebookPath: "Research", title: "First" });
    const other = await createPage({ notebookPath: "Research", title: "Other" });
    const record = input(first.path);
    const results = await Promise.all([appendPdfRecord(record), appendPdfRecord(record)]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect((await readPage(first.path)).body.match(/<!-- pdf-record:/g)).toHaveLength(1);
    expect((await readPage(other.path)).body).not.toContain(record.id);
    await savePage({ path: first.path, title: first.title, body: (await readPage(first.path)).body + "<p>Later note</p>" });
    await undoPdfRecord(first.path, record.id);
    const after = await readPage(first.path);
    expect(after.body).toContain("Later note");
    expect(after.body).not.toContain(record.id);
    expect(String(after.metadata.pdf_record_ids ?? "")).not.toContain(record.id);
  });

  it("rejects a retry when an editor removed the record body but its ledger remains", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Notes" });
    const record = input(note.path);
    await appendPdfRecord(record);
    await savePage({ path: note.path, title: note.title, body: "<p>Edited out</p>" });
    await expect(appendPdfRecord(record)).rejects.toMatchObject({ code: "RECORD_MISSING" });
  });

  it("API confirms only a durable destination write and rejects unavailable text without disclosure", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Notes" });
    const pdf = path.join(root, "Research", "Paper.assets", "source.pdf");
    await fs.mkdir(path.dirname(pdf), { recursive: true });
    await fs.writeFile(pdf, "%PDF-1.4\n");
    const record = input(note.path);
    const request = (body: unknown) => new Request("http://localhost/api/pdf-record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const invalid = await postRecord(request({ ...record, quote: null, quoteUnavailable: false }));
    expect(invalid.status).toBe(400);
    expect((await readPage(note.path)).body).not.toContain(record.id);
    const saved = await postRecord(request(record));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ path: note.path, created: true });
    const retry = await postRecord(request(record));
    expect(await retry.json()).toMatchObject({ path: note.path, created: false });
  });
});

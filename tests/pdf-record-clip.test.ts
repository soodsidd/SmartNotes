import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restoreRect } from "@embedpdf/models";
import { appendPdfRecord, createPage, invalidateVaultTreeCache, readPage, undoPdfRecord } from "@/server/vault/pages";
import {
  PDF_CLIP_MAX_PIXELS, PDF_CLIP_MAX_SIDE, isIntentionalPdfCrop, normalizePdfCrop, nudgePdfCrop,
  pdfClipScale, pdfCropToPageRect, pdfRecordAssetPath, pdfRecordMarkup, type PdfRecordInput,
} from "@/lib/pdf-record";
import { POST as postRecord } from "@/app/api/pdf-record/route";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("figure-pixels")]);

describe("SN-336 crop geometry and render scale", () => {
  it("orders drag corners, clamps to the page and rejects accidental taps", () => {
    const crop = normalizePdfCrop({ x: 0.8, y: 0.9 }, { x: 0.2, y: -0.5 });
    expect(crop.x).toBeCloseTo(0.2);
    expect(crop.y).toBe(0);
    expect(crop.width).toBeCloseTo(0.6);
    expect(crop.height).toBeCloseTo(0.9);
    expect(isIntentionalPdfCrop(normalizePdfCrop({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 }))).toBe(false);
    expect(isIntentionalPdfCrop(normalizePdfCrop({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.3 }))).toBe(true);
    expect(isIntentionalPdfCrop(null)).toBe(false);
  });

  it.each([0, 1, 2, 3])("maps a displayed crop to the unrotated PDF rect EmbedPDF renders (rotation %i)", (rotation) => {
    const page = { width: 612, height: 792 };
    const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.25 };
    const turned = rotation % 2 === 1;
    const container = turned ? { width: page.height, height: page.width } : page;
    const displayed = { origin: { x: crop.x * container.width, y: crop.y * container.height }, size: { width: crop.width * container.width, height: crop.height * container.height } };
    const expected = restoreRect(container, displayed, rotation as 0 | 1 | 2 | 3, 1);
    const actual = pdfCropToPageRect(crop, page, rotation);
    expect(actual.origin.x).toBeCloseTo(expected.origin.x);
    expect(actual.origin.y).toBeCloseTo(expected.origin.y);
    expect(actual.size.width).toBeCloseTo(expected.size.width);
    expect(actual.size.height).toBeCloseTo(expected.size.height);
  });

  it("renders at useful resolution without exceeding the side or pixel budget", () => {
    const letter = { width: 612, height: 792 };
    const pageScale = pdfClipScale(letter);
    expect(Math.round(letter.height * pageScale)).toBe(PDF_CLIP_MAX_SIDE);
    expect(letter.width * letter.height * pageScale ** 2).toBeLessThanOrEqual(PDF_CLIP_MAX_PIXELS);
    expect(pageScale).toBeGreaterThan(2.5); // > 180 dpi for a full page
    expect(pdfClipScale({ width: 120, height: 80 })).toBe(4); // small figures at 288 dpi
    const poster = { width: 2400, height: 3400 };
    expect(Math.max(poster.width, poster.height) * pdfClipScale(poster)).toBeLessThanOrEqual(PDF_CLIP_MAX_SIDE);
  });

  it("gives keyboard users a crop: seed, move and resize inside the page", () => {
    const seeded = nudgePdfCrop(null, "Enter", false)!;
    expect(seeded).toEqual({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
    expect(nudgePdfCrop(seeded, "ArrowRight", false)!.x).toBeCloseTo(0.22);
    expect(nudgePdfCrop(seeded, "ArrowDown", true)!.height).toBeCloseTo(0.62);
    let edge = seeded;
    for (let i = 0; i < 40; i += 1) edge = nudgePdfCrop(edge, "ArrowLeft", false)!;
    expect(edge.x).toBe(0);
    expect(nudgePdfCrop(null, "a", false)).toBeNull();
  });
});

describe("SN-336 image Record persistence", () => {
  let root: string;
  const oldVault = process.env.SMART_NOTES_VAULT;
  const oldState = process.env.SMART_NOTES_STATE_DIR;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-pdf-clip-"));
    process.env.SMART_NOTES_VAULT = root;
    process.env.SMART_NOTES_STATE_DIR = path.join(root, ".state");
    await fs.mkdir(path.join(root, "Research", "Paper.assets"), { recursive: true });
    await fs.writeFile(path.join(root, "Research", "Paper.assets", "scan.pdf"), "%PDF-1.4\n");
    invalidateVaultTreeCache();
  });
  afterEach(async () => {
    if (oldVault === undefined) delete process.env.SMART_NOTES_VAULT; else process.env.SMART_NOTES_VAULT = oldVault;
    if (oldState === undefined) delete process.env.SMART_NOTES_STATE_DIR; else process.env.SMART_NOTES_STATE_DIR = oldState;
    invalidateVaultTreeCache();
    await fs.rm(root, { recursive: true, force: true });
  });

  function clip(destinationPath: string, kind: "area" | "page" = "area"): PdfRecordInput {
    return { id: "7d0c6f1e-2b8a-4c1f-9e8d-3a5b6c7d8e9f", destinationPath, pdfPath: "Research/Paper.assets/scan.pdf", pdfTitle: "Scanned <atlas>", page: 12,
      quote: null, clip: { kind, width: 1200, height: 800 }, thought: "Compare with fig 3" };
  }
  const assetFiles = async (notePath: string) =>
    fs.readdir(path.join(root, notePath.replace(/\.html$/, ".assets"))).catch(() => [] as string[]);

  it("saves an image-only clip as a durable note asset with title, 1-based page and return link", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Figures" });
    const record = clip(note.path);
    await appendPdfRecord(record, PNG);
    const body = (await readPage(note.path)).body;
    const assetUrl = `/vault/${pdfRecordAssetPath(note.path, record.id).split("/").map(encodeURIComponent).join("/")}`;
    expect(body).toContain(`<img src="${assetUrl}"`);
    expect(body).toContain('alt="Figure area from Scanned &lt;atlas&gt;, page 12"');
    expect(body).toContain("Scanned &lt;atlas&gt;</strong> · Page 12");
    expect(body).toContain('href="/vault/Research/Paper.assets/scan.pdf#page=12"');
    expect(body).toContain("Compare with fig 3");
    expect(body).not.toContain("Text unavailable");
    expect(await fs.readFile(path.join(root, pdfRecordAssetPath(note.path, record.id)))).toEqual(PNG);
    expect(pdfRecordMarkup(clip(note.path, "page"))).toContain('alt="Page 12 of Scanned &lt;atlas&gt;"');
  });

  it("retries into one asset and one record, never another note, and Undo removes both", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Figures" });
    const other = await createPage({ notebookPath: "Research", title: "Other" });
    const record = clip(note.path);
    const results = await Promise.all([appendPdfRecord(record, PNG), appendPdfRecord(record, PNG), appendPdfRecord(record, PNG)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect((await readPage(note.path)).body.match(/<!-- pdf-record:/g)).toHaveLength(1);
    expect(await assetFiles(note.path)).toEqual([`pdf-record-${record.id}.png`]);
    expect((await readPage(other.path)).body).not.toContain(record.id);
    expect(await assetFiles(other.path)).toEqual([]);
    expect((await undoPdfRecord(note.path, record.id)).removed).toBe(true);
    expect((await readPage(note.path)).body).not.toContain(record.id);
    expect(await assetFiles(note.path)).toEqual([]);
  });

  it("requires the clip and its rendered image together", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Figures" });
    await expect(appendPdfRecord(clip(note.path))).rejects.toMatchObject({ code: "INVALID_RECORD" });
    await expect(appendPdfRecord({ ...clip(note.path), clip: undefined, quote: "text" }, PNG)).rejects.toMatchObject({ code: "INVALID_RECORD" });
    expect(await assetFiles(note.path)).toEqual([]);
  });

  it("API accepts multipart PNG clips idempotently and rejects non-PNG uploads", async () => {
    const note = await createPage({ notebookPath: "Research", title: "Figures" });
    const record = clip(note.path, "page");
    const request = (image: Buffer, body: unknown = record) => {
      const form = new FormData();
      form.append("record", JSON.stringify(body));
      form.append("image", new Blob([new Uint8Array(image)], { type: "image/png" }), "clip.png");
      return new Request("http://localhost/api/pdf-record", { method: "POST", body: form });
    };
    expect((await postRecord(request(Buffer.from("<svg onload=alert(1)>")))).status).toBe(400);
    expect((await postRecord(request(PNG, { ...record, clip: { kind: "page", width: 99999, height: 10 } }))).status).toBe(400);
    expect(await assetFiles(note.path)).toEqual([]);
    const saved = await postRecord(request(PNG));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ path: note.path, created: true });
    const retry = await postRecord(request(PNG));
    expect(await retry.json()).toMatchObject({ path: note.path, created: false });
    expect(await assetFiles(note.path)).toEqual([`pdf-record-${record.id}.png`]);
  });
});

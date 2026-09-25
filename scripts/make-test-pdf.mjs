// Generates a small, valid multi-page PDF fixture for the immersive PDF
// reader e2e (SN-135). Page 2 is intentionally wide/landscape to exercise the
// SN-131 "no horizontal clipping" case. No external dependency: we emit the
// PDF bytes directly with a correctly-computed xref table.
import { writeFileSync } from "node:fs";

function buildPdf(pages) {
  const objects = [];
  // Reserve ids: 1=catalog, 2=pages, then per-page [pageObj, contentObj], last=font.
  const fontId = 3 + pages.length * 2;
  const pageIds = pages.map((_, i) => 3 + i * 2);

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pages.length} >>`;

  pages.forEach((p, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const stream = p.content;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  // Serialize with byte-offset tracking.
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(body, "latin1");
  const count = objects.length; // includes free object 0
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) {
    const off = offsets[id] ?? 0;
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer =
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, "latin1");
}

function textContent(width, height, lines, fontSize = 40) {
  // Always draw a solid marker rect so pages are non-blank even when the
  // referenced Type1 font is not embedded and font fallback is unavailable.
  let ops = "0.1 0.2 0.55 rg\n72 72 180 120 re\nf\n";
  ops += "BT\n/F1 " + fontSize + " Tf\n";
  const startY = height - 100;
  lines.forEach((line, i) => {
    const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    ops += `1 0 0 1 60 ${startY - i * (fontSize + 14)} Tm (${escaped}) Tj\n`;
  });
  ops += "ET";
  return ops;
}

const LETTER_W = 612;
const LETTER_H = 792;
const WIDE_W = 1584; // deliberately very wide (landscape spread)
const WIDE_H = 612;

const pages = [
  {
    width: LETTER_W,
    height: LETTER_H,
    content: textContent(LETTER_W, LETTER_H, [
      "Catalogue (Final)",
      "Page 1 of 3",
      "Portrait Letter page.",
    ]),
  },
  {
    width: WIDE_W,
    height: WIDE_H,
    content: textContent(WIDE_W, WIDE_H, [
      "Page 2 of 3  --  WIDE LANDSCAPE SPREAD",
      "This page is 1584pt wide to exercise SN-131 no-clip.",
      "Right edge marker >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
    ]),
  },
  {
    width: LETTER_W,
    height: LETTER_H,
    content: textContent(LETTER_W, LETTER_H, [
      "Page 3 of 3",
      "Remembered-place target page.",
    ]),
  },
];

const out = process.argv[2] || "e2e/fixtures/catalogue-final.pdf";
writeFileSync(out, buildPdf(pages));
console.log(`Wrote ${out}`);

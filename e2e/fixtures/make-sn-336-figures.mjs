// Generates e2e/fixtures/sn-336-figures.pdf (SN-336 Record area/page walkthrough).
// Page 1: a text heading plus a vector diagram (bars) in the lower half.
// Page 2: image-only — one raster XObject, no text layer at all.
// Run: node e2e/fixtures/make-sn-336-figures.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const W = 160, H = 120;
const pixels = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3;
    const ring = Math.hypot(x - W / 2, y - H / 2) < 40;
    pixels[i] = ring ? 200 : Math.round((x / W) * 255);
    pixels[i + 1] = ring ? 40 : Math.round((y / H) * 255);
    pixels[i + 2] = ring ? 60 : 160;
  }
}
const image = zlib.deflateSync(pixels);

const page1 = [
  "BT /F1 22 Tf 72 720 Td (SN-336 Figure Fixture) Tj ET",
  "BT /F1 12 Tf 72 696 Td (Figure 1 below is a vector bar chart with no text inside.) Tj ET",
  "0 0 0 RG 2 w 100 200 m 100 450 l 500 450 m 100 450 m S 100 200 m 500 200 l S",
  "0.20 0.45 0.85 rg 130 200 60 120 re f",
  "0.90 0.50 0.10 rg 230 200 60 200 re f",
  "0.15 0.65 0.35 rg 330 200 60 80 re f",
  "0.60 0.20 0.70 rg 430 200 50 230 re f",
].join("\n");
const page2 = "q 480 0 0 360 66 216 cm /Im1 Do Q";

const objects = [];
objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
objects[2] = "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>";
objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>";
objects[4] = { stream: Buffer.from(page1) };
objects[5] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>";
objects[6] = { stream: Buffer.from(page2) };
objects[7] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
objects[8] = { stream: image, dict: `/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode` };

const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
const offsets = [];
let length = chunks[0].length;
for (let n = 1; n < objects.length; n += 1) {
  offsets[n] = length;
  const obj = objects[n];
  const body = typeof obj === "string"
    ? Buffer.from(`${n} 0 obj\n${obj}\nendobj\n`)
    : Buffer.concat([Buffer.from(`${n} 0 obj\n<< ${obj.dict ? `${obj.dict} ` : ""}/Length ${obj.stream.length} >>\nstream\n`), obj.stream, Buffer.from("\nendstream\nendobj\n")]);
  chunks.push(body);
  length += body.length;
}
const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "sn-336-figures.pdf");
fs.writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}`);

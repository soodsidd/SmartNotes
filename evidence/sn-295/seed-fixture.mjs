import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vault = path.join(root, ".e2e-vault-sn295");
const state = path.join(root, ".e2e-state-sn295");
const id = "5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41";
const paperPath = `.bibliography/${id}.html`;
const pdfName = "Catalogue(Final).pdf";
const pdfHref = `/vault/.bibliography/${id}.assets/${pdfName}`;
const stamp = "2026-10-12T18:00:00Z";
const fm = (data) => `---\n${Object.entries(data).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;

await fs.mkdir(path.join(vault, ".bibliography", `${id}.assets`), { recursive: true });
await fs.mkdir(path.join(vault, "General", "Precision Engineering"), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.copyFile(path.join(root, "e2e", "fixtures", "catalogue-final.pdf"), path.join(vault, ".bibliography", `${id}.assets`, pdfName));
await fs.copyFile(path.join(root, "e2e", "fixtures", "rect-only.pdf"), path.join(vault, ".bibliography", `${id}.assets`, "Supplement.pdf"));
await fs.writeFile(path.join(vault, paperPath), fm({ title: "deviation", paper_id: id, paper_home_notebook: "General", note_type: "text", created: stamp, updated: stamp })
  + `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${pdfHref}">${pdfName}</span></span></p><p>Paper notes for the split reader.</p>`);
await fs.writeFile(path.join(vault, "General", "Precision Engineering", "Test.html"), fm({ title: "Test", created: stamp, updated: stamp })
  + `<div data-paper-id="${id}" data-type="paper-reference"></div><p></p>`);
console.log(JSON.stringify({ vault, state, paperPath, pdfHref }));

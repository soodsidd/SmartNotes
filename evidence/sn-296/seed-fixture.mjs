import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vault = path.join(root, ".e2e-vault-sn296");
const state = path.join(root, ".e2e-state-sn296");
const id = "5d0c2b8e-4f1a-4c3e-9a77-2e1f0b6d9c41";
const paperDir = path.join(vault, ".bibliography");
const pdfName = "cat--interferoMETER--en-us.pdf";
const pdfHref = `/vault/.bibliography/${id}.assets/${pdfName}`;
const stamp = "2026-10-12T18:00:00Z";
const fm = (data) => `---\n${Object.entries(data).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;
const pdf = `<p><span data-file-attachment="" data-file-type="pdf" class="file-attachment-chip file-attachment-chip--pdf" contenteditable="false"><span class="file-attachment-icon" aria-hidden="true">PDF</span><span class="file-attachment-name" data-href="${pdfHref}">${pdfName}</span></span></p>`;
const box = (geometry, content) => `<div data-type="floating-text-box" data-x="${geometry.x}" data-y="${geometry.y}" data-width="${geometry.width}" data-height="${geometry.height}"><div data-floating-box-content="">${content}</div></div>`;

await fs.mkdir(path.join(paperDir, `${id}.assets`), { recursive: true });
await fs.mkdir(path.join(vault, "General", "Precision Engineering"), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.copyFile(path.join(root, "e2e", "fixtures", "catalogue-final.pdf"), path.join(paperDir, `${id}.assets`, pdfName));
await fs.writeFile(path.join(paperDir, `${id}.html`), fm({ title: "deviation", paper_id: id, paper_home_notebook: "General", note_type: "text", created: stamp, updated: stamp })
  + pdf + box({ x: 36, y: 78, width: 340, height: 172 }, `<table><tbody>${Array.from({ length: 3 }, () => `<tr>${Array.from({ length: 3 }, () => "<td><p></p></td>").join("")}</tr>`).join("")}</tbody></table>`));
await fs.writeFile(path.join(vault, "General", "Precision Engineering", "Test.html"), fm({ title: "shared paper page", created: stamp, updated: stamp })
  + pdf + box({ x: 340, y: 144, width: 360, height: 48 }, "<p></p>"));
console.log(JSON.stringify({ vault, state, pdfHref }));

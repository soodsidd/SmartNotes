// Isolated vault for SN-318: a main-flow page with long prose, an image, and a floating box beside it.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vault = path.join(root, ".e2e-vault-sn318");
const state = path.join(root, ".e2e-state-sn318");
const stamp = "2026-10-15T18:00:00Z";
const dir = path.join(vault, "General");
await fs.rm(vault, { recursive: true, force: true });
await fs.mkdir(path.join(dir, "Column.assets"), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.copyFile(path.join(root, "public", "icon-512.png"), path.join(dir, "Column.assets", "figure.png"));
const prose = "OneNote-style column: drag the right edge of the main flow and this paragraph rewraps to the new width immediately. "
  + "Height keeps following the content, so nothing is clipped and the ink page frame still grows with the text below.";
await fs.writeFile(path.join(dir, "Column.html"), `---\ntitle: Column\ncreated: ${stamp}\nupdated: ${stamp}\n---\n`
  + `<p data-testid-anchor="lead">${prose}</p>`
  + `<p>Short line.</p>`
  + `<img src="/vault/General/Column.assets/figure.png" alt="figure">`
  + `<p>${prose}</p>`
  + `<div data-type="floating-text-box" data-x="1010" data-y="40" data-width="200" data-height="48"><div data-floating-box-content=""><p>Floating note</p></div></div>`);
console.log(JSON.stringify({ vault, state }));

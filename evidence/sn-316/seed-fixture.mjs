// Isolated vault for SN-316: a floating box with wrapped text and an embedded image.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vault = path.join(root, ".e2e-vault-sn316");
const state = path.join(root, ".e2e-state-sn316");
const stamp = "2026-10-14T18:00:00Z";
const dir = path.join(vault, "General");
await fs.mkdir(path.join(dir, "Resize.assets"), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.copyFile(path.join(root, "public", "icon-512.png"), path.join(dir, "Resize.assets", "figure.png"));
const text = "OneNote-style container: drag the right edge and this paragraph immediately rewraps to the new width while the box height follows its content.";
await fs.writeFile(path.join(dir, "Resize.html"), `---\ntitle: Resize\ncreated: ${stamp}\nupdated: ${stamp}\n---\n<p>Main flow</p>`
  + `<div data-type="floating-text-box" data-x="80" data-y="120" data-width="240" data-height="48"><div data-floating-box-content=""><p>${text}</p>`
  + `<img src="/vault/General/Resize.assets/figure.png" alt="figure" width="160" style="width: 160px; height: auto;"></div></div>`);
console.log(JSON.stringify({ vault, state }));

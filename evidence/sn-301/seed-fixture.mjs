// Isolated vault + state for the SN-301 supervised preview (never the production vault).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vault = path.join(root, ".e2e-vault-sn301");
const state = path.join(root, ".e2e-state-sn301");
const stamp = "2026-10-13T09:00:00Z";

await fs.mkdir(path.join(vault, "General"), { recursive: true });
await fs.mkdir(state, { recursive: true });
await fs.writeFile(
  path.join(vault, "General", "Welcome.html"),
  `---\ntitle: Welcome\ncreated: ${stamp}\nupdated: ${stamp}\n---\n<p>SN-301 server settings fixture.</p>`
);
console.log(JSON.stringify({ vault, state }));

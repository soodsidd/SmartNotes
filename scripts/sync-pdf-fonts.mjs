/**
 * Copy EmbedPDF Latin fallback fonts into public/ so the immersive reader
 * can substitute missing PDF fonts without hitting a CDN (offline-first).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(path.join(root, "package.json"));

function resolveLatinFontsDir() {
  const candidates = [];
  try {
    // Prefer resolved package entry, then walk up to package root / fonts.
    const entry = require.resolve("@embedpdf/fonts-latin");
    candidates.push(path.join(path.dirname(entry), "..", "fonts"));
    candidates.push(path.join(path.dirname(entry), "fonts"));
  } catch {
    // fall through to workspace-relative paths
  }
  candidates.push(
    path.join(root, "node_modules", "@embedpdf", "fonts-latin", "fonts"),
    // Worktrees sometimes hoist via the primary repo link.
    path.join(root, "..", "..", "smart-notes", "node_modules", "@embedpdf", "fonts-latin", "fonts")
  );
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

const srcDir = resolveLatinFontsDir();
const destDir = path.join(root, "public", "pdf-fonts", "latin");

if (!srcDir) {
  console.warn("[sync-pdf-fonts] @embedpdf/fonts-latin fonts/ not found; skipping");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
const files = fs.readdirSync(srcDir).filter((name) => name.endsWith(".ttf"));
if (files.length === 0) {
  console.warn(`[sync-pdf-fonts] no .ttf files in ${srcDir}`);
  process.exit(0);
}
for (const name of files) {
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}
console.log(`[sync-pdf-fonts] copied ${files.length} fonts → public/pdf-fonts/latin`);

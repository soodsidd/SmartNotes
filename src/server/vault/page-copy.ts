import fs from "node:fs/promises";
import path from "node:path";
import { createPage, deletePage, readPage, readVaultTree, savePage, updatePageMetadata } from "./pages";
import { resolveVaultPath, siblingAssetDirectory } from "./paths";
import { VaultError } from "./errors";
import type { NoteType, VaultPageDocument } from "./types";

/** Shared subtree copy primitive. Parent links are paths, not independent IDs. */
export async function copyPageTree(sourcePath: string, targetPath: string, title?: string) {
  const source = await readPage(sourcePath);
  const target = await readPage(targetPath);
  const { tree } = await readVaultTree();
  const summaries = tree.flatMap((n) => [...n.pages, ...n.sections.flatMap((s) => s.pages)]);
  const planned: Array<{ page: VaultPageDocument; parent: string | null; depth: number }> = [];
  const seen = new Set<string>();
  async function visit(page: VaultPageDocument, parent: string | null, depth: number) {
    if (seen.has(page.path)) throw new VaultError("INVALID_PARENT", "Template contains a parent cycle.", 400);
    seen.add(page.path);
    if (page.sourceMissing) throw new VaultError("PAGE_NOT_FOUND", "Template source is missing.", 404);
    planned.push({ page, parent, depth });
    for (const child of summaries.filter((p) => p.parentId === page.path)) {
      await visit(await readPage(child.path), page.path, depth + 1);
    }
  }
  await visit(source, null, 0);
  let targetDepth = 0;
  let ancestor = target;
  const ancestors = new Set([target.path]);
  while (typeof ancestor.metadata.parent_id === "string") {
    ancestor = await readPage(ancestor.metadata.parent_id);
    if (ancestors.has(ancestor.path)) throw new VaultError("INVALID_PARENT", "Target contains a parent cycle.", 400);
    ancestors.add(ancestor.path);
    targetDepth++;
  }
  if (planned.some((p) => p.depth + targetDepth + 1 > 2)) {
    throw new VaultError("DEPTH_CAP", "Template and children exceed the two-level nesting limit at this target.", 400);
  }

  const copies = new Map<string, VaultPageDocument>();
  try {
    for (const item of planned) {
      const created = await createPage({
        notebookPath: target.path.split("/")[0],
        parentId: item.parent ? copies.get(item.parent)!.path : target.path,
        title: item.parent ? item.page.title : title || item.page.title,
        noteType: (item.page.metadata.note_type as NoteType) || "text",
      });
      copies.set(item.page.path, created);
      const metadata = { ...item.page.metadata, ...created.metadata };
      // Copies are artifacts, never new notebook policies or recipes.
      for (const key of ["recipe", "recipe_template", "notebook_instructions", "comments", "id"]) delete metadata[key];
      await updatePageMetadata(created.path, metadata);
      const from = resolveVaultPath(item.page.path, "page").absolutePath;
      const to = resolveVaultPath(created.path, "page").absolutePath;
      const stem = path.basename(from, ".html");
      const suffixes = [".ink.json", ".annotations.json", ".log.json", ".form.json", ".spreadsheet.json", ".app.json", ".jupyter"];
      const names = await fs.readdir(path.dirname(from));
      suffixes.push(...names.filter((name) => name.startsWith(`${stem}.app-data.`) && name.endsWith(".json")).map((name) => name.slice(stem.length)));
      for (const suffix of suffixes) {
        const src = from.replace(/\.html$/i, suffix);
        if (await fs.stat(src).then(() => true).catch(() => false)) {
          await fs.cp(src, to.replace(/\.html$/i, suffix), { recursive: true });
        }
      }
      const sourceAssets = resolveVaultPath(siblingAssetDirectory(item.page.path), "section").absolutePath;
      if (await fs.stat(sourceAssets).then(() => true).catch(() => false)) {
        await fs.cp(sourceAssets, resolveVaultPath(siblingAssetDirectory(created.path), "section").absolutePath, { recursive: true });
      }
    }
    for (const item of planned) {
      const created = copies.get(item.page.path)!;
      let body = item.page.body;
      for (const [oldPath, copy] of copies) {
        for (const [before, after] of [[oldPath, copy.path], [siblingAssetDirectory(oldPath), siblingAssetDirectory(copy.path)]]) {
          body = body.split(before).join(after);
          body = body.split(before.split("/").map(encodeURIComponent).join("/"))
            .join(after.split("/").map(encodeURIComponent).join("/"));
        }
      }
      // Relative references to the page's own asset directory move with the copy.
      body = body.split(path.posix.basename(siblingAssetDirectory(item.page.path)))
        .join(path.posix.basename(siblingAssetDirectory(created.path)));
      await savePage({ path: created.path, title: created.title, body });
    }
    return { page: await readPage(copies.get(source.path)!.path), children: [...copies.values()].slice(1).map((p) => p.path) };
  } catch (error) {
    // Only pages allocated by this invocation are rolled back.
    for (const copy of [...copies.values()].reverse()) await deletePage(copy.path);
    throw error;
  }
}

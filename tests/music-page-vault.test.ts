import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readInkScene, readVaultTree, saveInkScene } from "@/server/vault/pages";
import { POST } from "@/app/api/page/route";

it("creates a music page through the page API and reloads its ink sidecar", async () => {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sn-415-music-"));
  process.env.SMART_NOTES_VAULT = root;
  try {
    await fs.mkdir(path.join(root, "Notebook", "Section"), { recursive: true });
    const response = await POST(new Request("http://localhost/api/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionPath: "Notebook/Section", title: "Melody", noteType: "music" }),
    }));
    expect(response.status).toBe(201);
    const { page } = await response.json() as { page: { path: string; noteType: string } };
    expect(page.noteType).toBe("music");
    const source = await fs.readFile(path.join(root, page.path), "utf8");
    expect(source).toContain("note_type: music");
    const scene = { document: { store: { "shape:note": { typeName: "shape", x: 120, y: 145 } } } };
    await saveInkScene(page.path, scene);
    expect((await readInkScene(page.path)).scene).toEqual(scene);
    const tree = await readVaultTree({ skipCache: true });
    const pages = tree.tree.flatMap((notebook) => [...notebook.pages, ...notebook.sections.flatMap((section) => section.pages)]);
    expect(pages.find((entry) => entry.path === page.path)?.noteType).toBe("music");
  } finally {
    if (previousVault === undefined) delete process.env.SMART_NOTES_VAULT;
    else process.env.SMART_NOTES_VAULT = previousVault;
    await fs.rm(root, { recursive: true, force: true });
  }
});

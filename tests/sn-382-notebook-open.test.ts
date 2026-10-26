import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalidateVaultTreeCacheForTesting, readVaultTree } from "@/server/vault/pages";
import { mergeScopedNotebook, notebooksNeedingHydration, releaseNotebook, sameNotebookSet } from "@/lib/notebook-open-scope";

describe("SN-382 scoped notebook hydration", () => {
  const previousVault = process.env.SMART_NOTES_VAULT;
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sn382-vault-"));
    process.env.SMART_NOTES_VAULT = vaultRoot;
    for (const name of ["Active", "Closed", "Unrelated"]) {
      const section = path.join(vaultRoot, name, "Notes");
      await fs.promises.mkdir(section, { recursive: true });
      await Promise.all(Array.from({ length: 12 }, (_, index) =>
        fs.promises.writeFile(path.join(section, `Page ${index}.html`),
          `---\ntitle: Page ${index}\n---\n<p>${name} body ${index}</p>`, "utf8")
      ));
    }
    invalidateVaultTreeCacheForTesting();
  });

  afterEach(async () => {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    invalidateVaultTreeCacheForTesting();
    await fs.promises.rm(vaultRoot, { recursive: true, force: true });
  });

  it("keeps closed notebooks as lightweight rows and reads one notebook on reopen", async () => {
    const readFile = jest.spyOn(fs.promises, "readFile");
    try {
      const full = await readVaultTree({ skipCache: true });
      expect(full.tree.find((notebook) => notebook.path === "Closed")?.sections[0].pages).toHaveLength(12);

      readFile.mockClear();
      const initial = await readVaultTree({
        skipCache: true,
        closedNotebookPaths: new Set(["Closed", "Unrelated"]),
      });
      expect(initial.tree.find((notebook) => notebook.path === "Active")?.sections[0].pages).toHaveLength(12);
      expect(initial.tree.find((notebook) => notebook.path === "Closed")).toMatchObject({
        name: "Closed", pages: [], sections: [],
      });
      expect(initial.tree.find((notebook) => notebook.path === "Unrelated")?.sections).toEqual([]);
      expect(readFile.mock.calls.some(([file]) => String(file).includes(`${path.sep}Closed${path.sep}`))).toBe(false);
      expect(readFile.mock.calls.some(([file]) => String(file).includes(`${path.sep}Unrelated${path.sep}`))).toBe(false);

      readFile.mockClear();
      const reopened = await readVaultTree({ skipCache: true, notebookPath: "Closed" });
      expect(reopened.tree).toHaveLength(1);
      expect(reopened.tree[0].sections[0].pages).toHaveLength(12);
      expect(readFile.mock.calls.some(([file]) => String(file).includes(`${path.sep}Active${path.sep}`))).toBe(false);
      expect(readFile.mock.calls.some(([file]) => String(file).includes(`${path.sep}Unrelated${path.sep}`))).toBe(false);
    } finally {
      readFile.mockRestore();
    }
  });
});

describe("SN-382 client tree scope helpers", () => {
  const row = (path: string, color: string, pages: unknown[] = []) => ({ path, color, pages, sections: [] as unknown[] });

  it("keeps the full-tree color when merging a one-notebook scoped payload", () => {
    const tree = [row("A", "red", ["a"]), row("B", "blue")];
    const merged = mergeScopedNotebook(tree, row("B", "red", ["b1", "b2"]));
    expect(merged[1]).toEqual({ path: "B", color: "blue", pages: ["b1", "b2"], sections: [] });
    expect(merged[0]).toBe(tree[0]);
  });

  it("releases only the closed notebook's pages", () => {
    const tree = [row("A", "red", ["a"]), row("B", "blue", ["b"])];
    expect(releaseNotebook(tree, "B").map((notebook) => notebook.pages)).toEqual([["a"], []]);
  });

  it("compares closed sets by contents and hydrates only newly opened identity rows", () => {
    expect(sameNotebookSet(new Set(["A", "B"]), new Set(["B", "A"]))).toBe(true);
    expect(sameNotebookSet(new Set(["A"]), new Set(["B"]))).toBe(false);
    const tree = [row("A", "red"), row("B", "blue"), row("C", "green", ["c"])];
    expect(notebooksNeedingHydration(tree, new Set(["A", "B", "C"]), new Set(["B"]))).toEqual(["A"]);
  });
});

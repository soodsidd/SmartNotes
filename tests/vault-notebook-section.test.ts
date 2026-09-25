/**
 * SN-4: Notebook & section CRUD, page move, and Inbox capture unit tests.
 *
 * All tests run against a temporary vault directory and clean up after
 * themselves, so they are safe to run in parallel or in CI.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  captureToInbox,
  createNotebook,
  createPage,
  createSection,
  deleteNotebook,
  deleteSection,
  ensureInboxSection,
  movePage,
  readVaultTree,
  renameNotebook,
  renameSection,
  reorderSectionPages,
} from "@/server/vault/pages";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function withEmptyVault(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-sn4-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

async function withPopulatedVault(run: (vaultRoot: string) => Promise<void>) {
  await withEmptyVault(async (vaultRoot) => {
    // Create: NbA/S1, NbA/S2, NbB/S3
    await fs.mkdir(path.join(vaultRoot, "NbA", "S1"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "NbA", "S2"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "NbB", "S3"), { recursive: true });

    // Seed page in NbA/S1
    await fs.writeFile(
      path.join(vaultRoot, "NbA", "S1", "seed.html"),
      `---\ntitle: Seed\ncreated: 2026-05-26T10:00:00Z\nupdated: 2026-05-26T10:00:00Z\n---\nSeed body.\n`,
      "utf8"
    );

    await run(vaultRoot);
  });
}

// ---------------------------------------------------------------------------
// Notebook CRUD
// ---------------------------------------------------------------------------

describe("notebook CRUD", () => {
  it("creates a notebook directory", async () => {
    await withEmptyVault(async (vaultRoot) => {
      const result = await createNotebook("My Research");
      expect(result.name).toBe("My Research");
      expect(result.path).toBe("My Research");
      expect(result).not.toHaveProperty("inboxSectionPath");

      const stat = await fs.stat(path.join(vaultRoot, "My Research"));
      expect(stat.isDirectory()).toBe(true);

      const entries = await fs.readdir(path.join(vaultRoot, "My Research"));
      expect(entries).toEqual([]);
    });
  });

  it("prevents duplicate notebook names", async () => {
    await withEmptyVault(async () => {
      await createNotebook("Shared");
      await expect(createNotebook("Shared")).rejects.toThrow("already exists");
    });
  });

  it("strips illegal filesystem characters from the name", async () => {
    await withEmptyVault(async (vaultRoot) => {
      const result = await createNotebook('Research: 2026 "Notes"');
      // Characters <, >, :, ", etc. should be stripped.
      expect(result.name).not.toContain(":");
      expect(result.name).not.toContain('"');
      const stat = await fs.stat(path.join(vaultRoot, result.name));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("renames a notebook directory", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await createNotebook("Old Name");
      const result = await renameNotebook("Old Name", "New Name");
      expect(result.name).toBe("New Name");
      expect(result.path).toBe("New Name");

      await expect(fs.stat(path.join(vaultRoot, "Old Name"))).rejects.toThrow();
      const stat = await fs.stat(path.join(vaultRoot, "New Name"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("rejects rename when destination already exists", async () => {
    await withEmptyVault(async () => {
      await createNotebook("Alpha");
      await createNotebook("Beta");
      await expect(renameNotebook("Alpha", "Beta")).rejects.toThrow("already exists");
    });
  });

  it("deletes a notebook and all contents", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      await deleteNotebook("NbA");
      await expect(fs.stat(path.join(vaultRoot, "NbA"))).rejects.toThrow();

      // NbB should be unaffected.
      const stat = await fs.stat(path.join(vaultRoot, "NbB"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("throws when deleting a non-existent notebook", async () => {
    await withEmptyVault(async () => {
      await expect(deleteNotebook("ghost")).rejects.toThrow("not found");
    });
  });

  it("vault tree reflects notebook create/rename/delete", async () => {
    await withEmptyVault(async () => {
      await createNotebook("Alpha");
      const tree1 = await readVaultTree();
      expect(tree1.tree.map((n) => n.name)).toContain("Alpha");

      await renameNotebook("Alpha", "Beta");
      const tree2 = await readVaultTree();
      const names2 = tree2.tree.map((n) => n.name);
      expect(names2).toContain("Beta");
      expect(names2).not.toContain("Alpha");

      await deleteNotebook("Beta");
      const tree3 = await readVaultTree();
      expect(tree3.tree.map((n) => n.name)).not.toContain("Beta");
    });
  });
});

// ---------------------------------------------------------------------------
// Section CRUD
// ---------------------------------------------------------------------------

describe("section CRUD", () => {
  it("creates a section inside an existing notebook", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await createNotebook("NbX");
      const result = await createSection("NbX", "Ideas");
      expect(result.name).toBe("Ideas");
      expect(result.path).toBe("NbX/Ideas");

      const stat = await fs.stat(path.join(vaultRoot, "NbX", "Ideas"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("prevents duplicate section names within a notebook", async () => {
    await withEmptyVault(async () => {
      await createNotebook("NbX");
      await createSection("NbX", "Shared");
      await expect(createSection("NbX", "Shared")).rejects.toThrow("already exists");
    });
  });

  it("throws when creating section in a non-existent notebook", async () => {
    await withEmptyVault(async () => {
      await expect(createSection("ghost", "Ideas")).rejects.toThrow("not found");
    });
  });

  it("renames a section directory", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await createNotebook("NbX");
      await createSection("NbX", "Old");
      const result = await renameSection("NbX/Old", "New");
      expect(result.name).toBe("New");
      expect(result.path).toBe("NbX/New");

      await expect(fs.stat(path.join(vaultRoot, "NbX", "Old"))).rejects.toThrow();
      const stat = await fs.stat(path.join(vaultRoot, "NbX", "New"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("deletes a section and all its pages", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      await deleteSection("NbA/S1");
      await expect(fs.stat(path.join(vaultRoot, "NbA", "S1"))).rejects.toThrow();

      // S2 should be unaffected.
      const stat = await fs.stat(path.join(vaultRoot, "NbA", "S2"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("vault tree reflects section create/rename/delete", async () => {
    await withEmptyVault(async () => {
      await createNotebook("NbY");
      await createSection("NbY", "Alpha");
      const tree1 = await readVaultTree();
      const nb1 = tree1.tree.find((n) => n.name === "NbY")!;
      expect(nb1.sections.map((s) => s.name)).toContain("Alpha");

      await renameSection("NbY/Alpha", "Beta");
      const tree2 = await readVaultTree();
      const nb2 = tree2.tree.find((n) => n.name === "NbY")!;
      const names2 = nb2.sections.map((s) => s.name);
      expect(names2).toContain("Beta");
      expect(names2).not.toContain("Alpha");

      await deleteSection("NbY/Beta");
      const tree3 = await readVaultTree();
      const nb3 = tree3.tree.find((n) => n.name === "NbY")!;
      expect(nb3.sections.map((s) => s.name)).not.toContain("Beta");
    });
  });
});

// ---------------------------------------------------------------------------
// Page order (SN-89)
// ---------------------------------------------------------------------------

describe("section page order", () => {
  it("persists custom page order via _page-order.json and readVaultTree", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await createNotebook("NbX");
      await createSection("NbX", "Pages");
      const alpha = await createPage({ sectionPath: "NbX/Pages", title: "Alpha" });
      const beta = await createPage({ sectionPath: "NbX/Pages", title: "Beta" });
      const gamma = await createPage({ sectionPath: "NbX/Pages", title: "Gamma" });

      await reorderSectionPages("NbX/Pages", [gamma.path, alpha.path, beta.path]);

      const orderFile = path.join(vaultRoot, "NbX", "Pages", "_page-order.json");
      const orderContent = await fs.readFile(orderFile, "utf8");
      expect(JSON.parse(orderContent)).toEqual({
        orderedIds: [gamma.path, alpha.path, beta.path],
      });

      const tree = await readVaultTree();
      const section = tree.tree.find((n) => n.name === "NbX")!.sections.find((s) => s.name === "Pages")!;
      expect(section.pages.map((p) => p.path)).toEqual([gamma.path, alpha.path, beta.path]);
    });
  });
});

// ---------------------------------------------------------------------------
// Page move
// ---------------------------------------------------------------------------

describe("page move", () => {
  it("moves a page to another section", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      const moved = await movePage("NbA/S1/seed.html", "NbA/S2");
      expect(moved.path).toBe("NbA/S2/seed.html");
      expect(moved.title).toBe("Seed");

      // Source should be gone.
      await expect(fs.stat(path.join(vaultRoot, "NbA", "S1", "seed.html"))).rejects.toThrow();
      // Destination should exist.
      const stat = await fs.stat(path.join(vaultRoot, "NbA", "S2", "seed.html"));
      expect(stat.isFile()).toBe(true);
    });
  });

  it("moves a page across notebooks", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      const moved = await movePage("NbA/S1/seed.html", "NbB/S3");
      expect(moved.path).toBe("NbB/S3/seed.html");

      await expect(fs.stat(path.join(vaultRoot, "NbA", "S1", "seed.html"))).rejects.toThrow();
      const stat = await fs.stat(path.join(vaultRoot, "NbB", "S3", "seed.html"));
      expect(stat.isFile()).toBe(true);
    });
  });

  it("is a no-op when moving to the same section", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      const result = await movePage("NbA/S1/seed.html", "NbA/S1");
      expect(result.path).toBe("NbA/S1/seed.html");

      // File should still be in place.
      const stat = await fs.stat(path.join(vaultRoot, "NbA", "S1", "seed.html"));
      expect(stat.isFile()).toBe(true);
    });
  });

  it("throws when target section does not exist", async () => {
    await withPopulatedVault(async () => {
      await expect(movePage("NbA/S1/seed.html", "NbA/Ghost")).rejects.toThrow("not found");
    });
  });

  it("throws on filename collision in the target section", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      // Plant a file with the same name in S2.
      await fs.writeFile(
        path.join(vaultRoot, "NbA", "S2", "seed.html"),
        "---\ntitle: Collision\n---\nbody.\n",
        "utf8"
      );
      await expect(movePage("NbA/S1/seed.html", "NbA/S2")).rejects.toThrow("already exists");
    });
  });

  it("moves the .assets directory alongside the page", async () => {
    await withPopulatedVault(async (vaultRoot) => {
      // Create an assets directory for the seed page.
      const assetsDir = path.join(vaultRoot, "NbA", "S1", "seed.assets");
      await fs.mkdir(assetsDir);
      await fs.writeFile(path.join(assetsDir, "image.png"), "fake-png", "utf8");

      await movePage("NbA/S1/seed.html", "NbA/S2");

      await expect(fs.stat(assetsDir)).rejects.toThrow();
      const movedAssets = await fs.stat(path.join(vaultRoot, "NbA", "S2", "seed.assets"));
      expect(movedAssets.isDirectory()).toBe(true);
    });
  });

  it("vault tree reflects move: page appears in target section", async () => {
    await withPopulatedVault(async () => {
      await movePage("NbA/S1/seed.html", "NbB/S3");
      const tree = await readVaultTree();

      const nbA = tree.tree.find((n) => n.name === "NbA")!;
      const s1 = nbA.sections.find((s) => s.name === "S1")!;
      expect(s1.pages.map((p) => p.path)).not.toContain("NbA/S1/seed.html");

      const nbB = tree.tree.find((n) => n.name === "NbB")!;
      const s3 = nbB.sections.find((s) => s.name === "S3")!;
      expect(s3.pages.map((p) => p.path)).toContain("NbB/S3/seed.html");
    });
  });
});

// ---------------------------------------------------------------------------
// Inbox / Capture
// ---------------------------------------------------------------------------

describe("inbox and capture", () => {
  it("ensureInboxSection finds an existing Inbox section", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "Personal Notebook", "Inbox"), { recursive: true });
      const inboxPath = await ensureInboxSection();
      expect(inboxPath).toBe("Personal Notebook/Inbox");
    });
  });

  it("ensureInboxSection creates Inbox in the first notebook when none exists", async () => {
    await withEmptyVault(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "My Notebook"), { recursive: true });
      const inboxPath = await ensureInboxSection();
      expect(inboxPath).toBe("My Notebook/Inbox");

      const stat = await fs.stat(path.join(vaultRoot, "My Notebook", "Inbox"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("ensureInboxSection bootstraps a Personal Notebook when vault is empty", async () => {
    await withEmptyVault(async (vaultRoot) => {
      const inboxPath = await ensureInboxSection();
      expect(inboxPath).toBe("Personal Notebook/Inbox");

      const stat = await fs.stat(path.join(vaultRoot, "Personal Notebook", "Inbox"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  it("captureToInbox creates a page in the Inbox section", async () => {
    await withEmptyVault(async () => {
      const page = await captureToInbox("Quick thought");
      expect(page.title).toBe("Quick thought");
      expect(page.path).toContain("Inbox");
      expect(page.path).toMatch(/\.html$/);
    });
  });

  it("captureToInbox without title uses a default", async () => {
    await withEmptyVault(async () => {
      const page = await captureToInbox();
      expect(page.title).toBeTruthy();
      expect(page.path).toContain("Inbox");
    });
  });

  it("multiple captures land in the same Inbox section", async () => {
    await withEmptyVault(async () => {
      const p1 = await captureToInbox("Note A");
      const p2 = await captureToInbox("Note B");

      // Both should share the same parent directory (the Inbox section).
      const dir1 = p1.path.split("/").slice(0, -1).join("/");
      const dir2 = p2.path.split("/").slice(0, -1).join("/");
      expect(dir1).toBe(dir2);
    });
  });

  it("captured pages appear in the vault tree", async () => {
    await withEmptyVault(async () => {
      await captureToInbox("Tree Check");
      const tree = await readVaultTree();
      const allPages = tree.tree.flatMap((nb) =>
        nb.sections.flatMap((sec) => sec.pages)
      );
      expect(allPages.some((p) => p.title === "Tree Check")).toBe(true);
    });
  });

  it("createPage also works with the auto-created Inbox section", async () => {
    await withEmptyVault(async () => {
      const inboxPath = await ensureInboxSection();
      const page = await createPage({ sectionPath: inboxPath, title: "Via createPage" });
      expect(page.title).toBe("Via createPage");
    });
  });
});

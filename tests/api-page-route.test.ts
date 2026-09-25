import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/page/route";
import { readVaultTree } from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-api-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "seed.html"),
      `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
Initial body.
`,
      "utf8"
    );
    await run(vaultRoot);
  } finally {
    if (previousVault) {
      process.env.SMART_NOTES_VAULT = previousVault;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

describe("page route", () => {
  it("loads and saves a page through the route handlers", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const getResponse = await GET(
        new Request("http://localhost/api/page?path=Notebook/Section/seed.html")
      );
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Section/seed.html",
          title: "Seed",
          notebookPath: "Notebook",
          sectionPath: "Notebook/Section",
        },
      });

      const putResponse = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: "Notebook/Section/seed.html",
            title: "Seed",
            body: "# Updated\n\nRoute save body.",
          }),
        })
      );

      expect(putResponse.status).toBe(200);
      await expect(putResponse.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Section/seed.html",
          content: "# Updated\n\nRoute save body.",
        },
      });

      const savedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        "utf8"
      );
      expect(savedSource).toContain("Route save body.");
    });
  });

  it("moves a page through the route handler", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Inbox"), { recursive: true });

      const patchResponse = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "move",
            path: "Notebook/Section/seed.html",
            sectionPath: "Notebook/Inbox",
          }),
        })
      );

      expect(patchResponse.status).toBe(200);
      await expect(patchResponse.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Inbox/seed.html",
          sectionPath: "Notebook/Inbox",
        },
      });

      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Inbox", "seed.html"), "utf8")
      ).resolves.toContain("Initial body.");
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Section", "seed.html"), "utf8")
      ).rejects.toBeDefined();
    });
  });

  it("nests and un-nests a page via PATCH action=nest", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "---\ntitle: Child\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\n---\nChild body.\n",
        "utf8"
      );

      // Nest child under seed
      const nestResponse = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nest",
            path: "Notebook/Section/child.html",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(nestResponse.status).toBe(200);
      await expect(nestResponse.json()).resolves.toMatchObject({
        page: { path: "Notebook/Section/child.html" },
      });
      const nestedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "utf8"
      );
      expect(nestedSource).toContain("parent_id: Notebook/Section/seed.html");

      // Un-nest by setting parentId to null
      const unnestResponse = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nest",
            path: "Notebook/Section/child.html",
            parentId: null,
          }),
        })
      );
      expect(unnestResponse.status).toBe(200);
      const unnested = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "utf8"
      );
      expect(unnested).not.toContain("parent_id");
    });
  });

  it("marks and unmarks a key note in page frontmatter via PATCH action=keyNote", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "---\ntitle: Child\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\n---\nChild body.\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "log.html"),
        "---\ntitle: Workout\nnote_type: log\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\n---\n",
        "utf8"
      );

      const nestResponse = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nest",
            path: "Notebook/Section/child.html",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(nestResponse.status).toBe(200);

      const markNested = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "keyNote",
            path: "Notebook/Section/child.html",
            keyNote: true,
          }),
        })
      );
      expect(markNested.status).toBe(200);
      await expect(markNested.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Section/child.html",
          keyNote: true,
        },
      });

      const nestedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "utf8"
      );
      expect(nestedSource).toContain("key_note: true");
      expect(nestedSource).toContain("parent_id: Notebook/Section/seed.html");

      const markLog = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "keyNote",
            path: "Notebook/Section/log.html",
            keyNote: true,
          }),
        })
      );
      expect(markLog.status).toBe(200);
      await expect(markLog.json()).resolves.toMatchObject({
        page: { path: "Notebook/Section/log.html", keyNote: true, noteType: "log" },
      });

      const putResponse = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/child.html",
            title: "Child",
            body: "Child body kept.",
          }),
        })
      );
      expect(putResponse.status).toBe(200);
      const savedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "utf8"
      );
      expect(savedSource).toContain("key_note: true");

      const tree = await readVaultTree({ skipCache: true });
      const notebook = tree.tree.find((entry) => entry.path === "Notebook");
      const section = notebook?.sections.find((entry) => entry.path === "Notebook/Section");
      expect(section?.pages.find((page) => page.path === "Notebook/Section/child.html")?.keyNote).toBe(true);
      expect(section?.pages.find((page) => page.path === "Notebook/Section/log.html")?.keyNote).toBe(true);
      expect(section?.pages.find((page) => page.path === "Notebook/Section/seed.html")?.keyNote).toBe(false);

      const unmark = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "keyNote",
            path: "Notebook/Section/child.html",
            keyNote: false,
          }),
        })
      );
      expect(unmark.status).toBe(200);
      const unmarkedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "child.html"),
        "utf8"
      );
      expect(unmarkedSource).not.toContain("key_note");
    });
  });

  it("rejects PATCH action=keyNote without a boolean flag", async () => {
    await withVaultFixture(async () => {
      const response = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "keyNote",
            path: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(response.status).toBe(400);
    });
  });

  it("emits live sync signals for page writes and structure mutations", async () => {
    await withVaultFixture(async () => {
      const emit = jest.fn();
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit };

      const putResponse = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/seed.html",
            title: "Seed",
            body: "Route save body.",
          }),
        })
      );
      expect(putResponse.status).toBe(200);
      expect(emit).toHaveBeenCalledWith("file_updated", {
        path: "Notebook/Section/seed.html",
        content: "Route save body.",
      });

      const postResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Live Sync Child",
          }),
        })
      );
      expect(postResponse.status).toBe(201);
      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });

      const nestResponse = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nest",
            path: "Notebook/Section/live-sync-child.html",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(nestResponse.status).toBe(200);
      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });
    });
  });

  it("suppresses file_updated echoes to the originating socket when provided", async () => {
    await withVaultFixture(async () => {
      const emit = jest.fn();
      const exceptEmit = jest.fn();
      const except = jest.fn(() => ({ emit: exceptEmit }));
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit, except };

      const putResponse = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/seed.html",
            title: "Seed",
            content: "Origin-tagged save body.",
            originSocketId: "socket-123",
            originClientId: "client-abc",
          }),
        })
      );

      expect(putResponse.status).toBe(200);
      expect(except).toHaveBeenCalledWith("socket-123");
      expect(exceptEmit).toHaveBeenCalledWith("file_updated", {
        path: "Notebook/Section/seed.html",
        content: "Origin-tagged save body.",
        originSocketId: "socket-123",
        originClientId: "client-abc",
      });
      expect(emit).not.toHaveBeenCalledWith("file_updated", expect.anything());
    });
  });

  it("creates notebook-root, section, nested, and Jupyter pages with correct placement and metadata", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const notebookRootResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notebookPath: "Notebook",
            title: "Notebook Root",
          }),
        })
      );
      expect(notebookRootResponse.status).toBe(201);
      const notebookRootJson = (await notebookRootResponse.json()) as {
        page: { path: string; parentId: string | null; sectionPath: string | null; notebookPath: string };
      };
      expect(notebookRootJson.page).toMatchObject({
        path: "Notebook/notebook-root.html",
        parentId: null,
        notebookPath: "Notebook",
        sectionPath: null,
      });
      await expect(fs.stat(path.join(vaultRoot, "Notebook", "notebook-root.html"))).resolves.toBeDefined();

      const notebookRootJupyterResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notebookPath: "Notebook",
            title: "Root Notebook",
            noteType: "jupyter",
          }),
        })
      );
      expect(notebookRootJupyterResponse.status).toBe(201);
      const notebookRootJupyterJson = (await notebookRootJupyterResponse.json()) as {
        page: { path: string; parentId: string | null; noteType: string; sectionPath: string | null };
      };
      expect(notebookRootJupyterJson.page).toMatchObject({
        path: "Notebook/root-notebook.html",
        parentId: null,
        noteType: "jupyter",
        sectionPath: null,
      });
      await expect(
        fs.stat(path.join(vaultRoot, "Notebook", "root-notebook.jupyter", "notebook.ipynb"))
      ).resolves.toBeDefined();

      const treeAfterRootCreate = await readVaultTree({ skipCache: true });
      const notebook = treeAfterRootCreate.tree.find((entry) => entry.path === "Notebook");
      expect(notebook?.pages.map((page) => page.path)).toEqual([
        "Notebook/notebook-root.html",
        "Notebook/root-notebook.html",
      ]);
      expect(notebook?.sections.flatMap((section) => section.pages.map((page) => page.path))).not.toContain(
        "Notebook/notebook-root.html"
      );

      const rootResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Root Created",
          }),
        })
      );
      expect(rootResponse.status).toBe(201);
      const rootJson = (await rootResponse.json()) as { page: { path: string; parentId: string | null; sectionPath: string } };
      expect(rootJson.page).toMatchObject({
        path: "Notebook/Section/root-created.html",
        parentId: null,
        sectionPath: "Notebook/Section",
      });

      const childResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Child Created",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(childResponse.status).toBe(201);
      const childJson = (await childResponse.json()) as { page: { path: string; parentId: string | null; sectionPath: string } };
      expect(childJson.page).toMatchObject({
        path: "Notebook/Section/child-created.html",
        parentId: "Notebook/Section/seed.html",
        sectionPath: "Notebook/Section",
      });

      const jupyterResponse = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            title: "Child Notebook",
            noteType: "jupyter",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );
      expect(jupyterResponse.status).toBe(201);
      const jupyterJson = (await jupyterResponse.json()) as {
        page: { path: string; parentId: string | null; noteType: string; sectionPath: string };
      };
      expect(jupyterJson.page).toMatchObject({
        path: "Notebook/Section/child-notebook.html",
        parentId: "Notebook/Section/seed.html",
        noteType: "jupyter",
        sectionPath: "Notebook/Section",
      });

      await expect(
        fs.stat(path.join(vaultRoot, "Notebook", "Section", "child-notebook.jupyter", "notebook.ipynb"))
      ).resolves.toBeDefined();

      const childSource = await fs.readFile(path.join(vaultRoot, "Notebook", "Section", "child-created.html"), "utf8");
      expect(childSource).toContain("parent_id: Notebook/Section/seed.html");

      const saveResponse = await PUT(
        new Request("http://localhost/api/page", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/child-created.html",
            title: "Child Created",
            body: "Nested save body.",
          }),
        })
      );
      expect(saveResponse.status).toBe(200);

      const reloadResponse = await GET(
        new Request("http://localhost/api/page?path=Notebook/Section/child-created.html")
      );
      expect(reloadResponse.status).toBe(200);
      await expect(reloadResponse.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Section/child-created.html",
          content: "Nested save body.",
          parentId: "Notebook/Section/seed.html",
          sectionPath: "Notebook/Section",
        },
      });
    });
  });

  it("rejects creating a nested page in a different section than its parent", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.mkdir(path.join(vaultRoot, "Notebook", "Other"), { recursive: true });

      const response = await POST(
        new Request("http://localhost/api/page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Other",
            title: "Wrong Section Child",
            parentId: "Notebook/Section/seed.html",
          }),
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_PARENT",
      });
    });
  });

  it("rejects nesting that would exceed the 2-level depth cap", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "level1.html"),
        "---\ntitle: Level1\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\nparent_id: Notebook/Section/seed.html\n---\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "level2.html"),
        "---\ntitle: Level2\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\nparent_id: Notebook/Section/level1.html\n---\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "level3.html"),
        "---\ntitle: Level3\ncreated: 2026-05-25T18:12:00Z\nupdated: 2026-05-25T18:12:00Z\n---\n",
        "utf8"
      );

      // Attempt to nest level3 under level2 (would be depth 3 — rejected)
      const response = await PATCH(
        new Request("http://localhost/api/page", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nest",
            path: "Notebook/Section/level3.html",
            parentId: "Notebook/Section/level2.html",
          }),
        })
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "DEPTH_CAP",
      });
    });
  });

  it("deletes a page through DELETE and removes the file from disk", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const response = await DELETE(
        new Request("http://localhost/api/page?path=Notebook/Section/seed.html")
      );
      expect(response.status).toBe(200);
      await expect(
        fs.stat(path.join(vaultRoot, "Notebook", "Section", "seed.html"))
      ).rejects.toBeDefined();
    });
  });

  it("rejects legacy AI attachment and splice commit actions", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const png = Buffer.from(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000000500010d0a2db40000000049454e44ae426082",
        "hex"
      );
      const sourcePath = path.join(vaultRoot, "assistant-output.png");
      await fs.writeFile(sourcePath, png);

      for (const body of [
        {
          action: "previewAttachment",
          path: "Notebook/Section/seed.html",
          sourcePath,
        },
        {
          action: "copyAttachment",
          path: "Notebook/Section/seed.html",
          sourcePath,
          description: "Assistant output",
        },
        {
          action: "aiSpliceCommit",
          path: "Notebook/Section/seed.html",
          start: 0,
          end: 5,
          content: "Replacement",
        },
      ]) {
        const response = await PATCH(
          new Request("http://localhost/api/page", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: expect.stringContaining("disabled"),
        });
      }

      await expect(fs.stat(path.join(vaultRoot, "attachments"))).rejects.toBeDefined();
      await expect(fs.readFile(path.join(vaultRoot, "Notebook", "Section", "seed.html"), "utf8")).resolves.toContain(
        "Initial body."
      );
    });
  });
});

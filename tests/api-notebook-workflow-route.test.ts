import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as postCapture } from "@/app/api/capture/route";
import {
  DELETE as deleteNotebookRoute,
  PATCH as patchNotebookRoute,
  POST as postNotebookRoute,
} from "@/app/api/notebook/route";
import {
  DELETE as deleteSectionRoute,
  PATCH as patchSectionRoute,
  POST as postSectionRoute,
  PUT as putSectionRoute,
} from "@/app/api/section/route";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-route-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
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

describe("notebook workflow routes", () => {
  it("creates, renames, and deletes notebooks and sections", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const createNotebookResponse = await postNotebookRoute(
        new Request("http://localhost/api/notebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Research" }),
        })
      );
      expect(createNotebookResponse.status).toBe(201);
      await expect(createNotebookResponse.json()).resolves.toMatchObject({
        notebook: {
          path: "Research",
        },
      });

      const createSectionResponse = await postSectionRoute(
        new Request("http://localhost/api/section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookPath: "Research", name: "Sources" }),
        })
      );
      expect(createSectionResponse.status).toBe(201);
      await expect(createSectionResponse.json()).resolves.toMatchObject({
        section: {
          path: "Research/Sources",
          notebookPath: "Research",
        },
      });

      const renameSectionResponse = await patchSectionRoute(
        new Request("http://localhost/api/section", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Research/Sources", name: "Primary Sources" }),
        })
      );
      expect(renameSectionResponse.status).toBe(200);
      await expect(renameSectionResponse.json()).resolves.toMatchObject({
        section: {
          previousPath: "Research/Sources",
          path: "Research/Primary Sources",
        },
      });

      const renameNotebookResponse = await patchNotebookRoute(
        new Request("http://localhost/api/notebook", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Research", name: "Archive" }),
        })
      );
      expect(renameNotebookResponse.status).toBe(200);
      await expect(renameNotebookResponse.json()).resolves.toMatchObject({
        notebook: {
          previousPath: "Research",
          path: "Archive",
        },
      });

      const sectionDirectory = path.join(vaultRoot, "Archive", "Primary Sources");
      const sectionStat = await fs.stat(sectionDirectory);
      expect(sectionStat.isDirectory()).toBe(true);

      const deleteSectionResponse = await deleteSectionRoute(
        new Request("http://localhost/api/section?path=Archive/Primary%20Sources", {
          method: "DELETE",
        })
      );
      expect(deleteSectionResponse.status).toBe(200);

      const deleteNotebookResponse = await deleteNotebookRoute(
        new Request("http://localhost/api/notebook?path=Archive", {
          method: "DELETE",
        })
      );
      expect(deleteNotebookResponse.status).toBe(200);
      await expect(fs.stat(path.join(vaultRoot, "Archive"))).rejects.toBeDefined();
    });
  });

  it("captures content into a predictable Inbox destination", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const captureResponse = await postCapture(
        new Request("http://localhost/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: "inbox",
            notebookPath: "Notebook",
            title: "Captured Route Note",
            content: "Captured route body.",
          }),
        })
      );

      expect(captureResponse.status).toBe(201);
      await expect(captureResponse.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Inbox/captured-route-note.html",
          notebookPath: "Notebook",
          sectionPath: "Notebook/Inbox",
          content: "Captured route body.",
        },
      });

      const savedSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Inbox", "captured-route-note.html"),
        "utf8"
      );
      expect(savedSource).toContain("Captured route body.");
    });
  });

  it("reuses one capture page for retries after an uncertain response and edits", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const captureId = "85370c2a-fbb4-4ed5-96a8-c2ca297df013";
      const send = (content: string, destination: "inbox" | "page" = "inbox") => postCapture(
        new Request("http://localhost/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureId, destination, notebookPath: "Notebook", sectionPath: "Notebook/Section", title: "Retry note", content }),
        })
      );

      const first = await send("First body");
      expect(first.status).toBe(201);
      const firstPage = (await first.json()).page;

      const retry = await send("First body");
      expect(retry.status).toBe(201);
      expect((await retry.json()).page.path).toBe(firstPage.path);

      const editedRetry = await send("Edited body", "page");
      expect(editedRetry.status).toBe(201);
      expect((await editedRetry.json()).page.path).toBe(firstPage.path);
      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Inbox"))).toEqual(["retry-note.html"]);
      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Section"))).toEqual([]);
      expect(await fs.readFile(path.join(vaultRoot, "Notebook", "Inbox", "retry-note.html"), "utf8"))
        .toContain("Edited body");
    });
  });

  it("publishes one capture page when the same capture ID races itself", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const send = () => postCapture(
        new Request("http://localhost/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            captureId: "0f6f4c9e-3c1d-4a8b-9e2f-5b7a1c2d3e4f",
            destination: "page",
            sectionPath: "Notebook/Section",
            title: "Race note",
            content: "Body",
          }),
        })
      );
      const responses = await Promise.all([send(), send()]);
      const paths = await Promise.all(responses.map(async (response) => (await response.json()).page.path));
      expect(paths[1]).toBe(paths[0]);
      expect((await fs.readdir(path.join(vaultRoot, "Notebook", "Section"))).filter((name) => !name.startsWith("."))).toEqual(["race-note.html"]);
    });
  });

  it("rejects a malformed capture ID without writing a page", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const response = await postCapture(
        new Request("http://localhost/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureId: "not-a-uuid", destination: "page", sectionPath: "Notebook/Section", content: "x" }),
        })
      );
      expect(response.status).toBe(400);
      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Section"))).toEqual([]);
    });
  });

  it("persists section page order via PUT /api/section", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "alpha.html"),
        "---\ntitle: Alpha\n---\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "beta.html"),
        "---\ntitle: Beta\n---\n",
        "utf8"
      );

      const reorderResponse = await putSectionRoute(
        new Request("http://localhost/api/section", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Notebook/Section",
            orderedIds: ["Notebook/Section/beta.html", "Notebook/Section/alpha.html"],
          }),
        })
      );
      expect(reorderResponse.status).toBe(200);
      await expect(reorderResponse.json()).resolves.toEqual({ ok: true });

      const orderFile = path.join(vaultRoot, "Notebook", "Section", "_page-order.json");
      const orderContent = await fs.readFile(orderFile, "utf8");
      expect(JSON.parse(orderContent)).toEqual({
        orderedIds: ["Notebook/Section/beta.html", "Notebook/Section/alpha.html"],
      });
    });
  });

  it("emits vault structure updates for notebook, section, capture, and reorder routes", async () => {
    await withVaultFixture(async () => {
      const emit = jest.fn();
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit };

      const createNotebookResponse = await postNotebookRoute(
        new Request("http://localhost/api/notebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Live Sync" }),
        })
      );
      expect(createNotebookResponse.status).toBe(201);

      const createSectionResponse = await postSectionRoute(
        new Request("http://localhost/api/section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookPath: "Live Sync", name: "Inbox" }),
        })
      );
      expect(createSectionResponse.status).toBe(201);

      const captureResponse = await postCapture(
        new Request("http://localhost/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: "page",
            sectionPath: "Live Sync/Inbox",
            title: "Captured",
            content: "Captured body.",
          }),
        })
      );
      expect(captureResponse.status).toBe(201);

      const reorderResponse = await putSectionRoute(
        new Request("http://localhost/api/section", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionPath: "Live Sync/Inbox",
            orderedIds: ["Live Sync/Inbox/captured.html"],
          }),
        })
      );
      expect(reorderResponse.status).toBe(200);

      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });
      expect(emit).toHaveBeenCalledTimes(4);
    });
  });

  it("returns 409 NOTEBOOK_EXISTS with an actionable message on duplicate name (SN-83)", async () => {
    await withVaultFixture(async () => {
      // First creation succeeds
      const first = await postNotebookRoute(
        new Request("http://localhost/api/notebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Duplicate" }),
        })
      );
      expect(first.status).toBe(201);

      // Second creation with same sanitised name returns 409
      const second = await postNotebookRoute(
        new Request("http://localhost/api/notebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Duplicate" }),
        })
      );
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string; code: string };
      expect(body.code).toBe("NOTEBOOK_EXISTS");
      expect(body.error).toMatch(/already exists/i);
    });
  });
});

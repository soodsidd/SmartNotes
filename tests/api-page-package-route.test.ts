import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/page/package/route";
import { serializeFrontmatterDocument } from "@/server/vault/frontmatter";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-package-route-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  invalidateVaultTreeCacheForTesting();
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Source"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Imported"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Source", "route-page.html"),
      serializeFrontmatterDocument(
        { title: "Route page", created: "2026-09-30T00:00:00.000Z" },
        "<h1>Route page</h1><p>Saved HTML.</p>"
      )
    );
    await run(vaultRoot);
  } finally {
    invalidateVaultTreeCacheForTesting();
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    delete (global as Record<string, unknown>)["_smartNotesIo"];
  }
}

describe("page package route", () => {
  it("downloads and additively imports a native page package", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const download = await GET(
        new Request(
          "http://localhost/api/page/package?path=Notebook%2FSource%2Froute-page.html"
        )
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/vnd.smart-notes.page+zip");
      expect(download.headers.get("content-disposition")).toContain("Route page.snpkg");

      const formData = new FormData();
      formData.set("sectionPath", "Notebook/Imported");
      formData.set(
        "file",
        new File([await download.arrayBuffer()], "route-page.snpkg", {
          type: "application/vnd.smart-notes.page+zip",
        })
      );
      const emit = jest.fn();
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit };
      const imported = await POST(
        new Request("http://localhost/api/page/package", { method: "POST", body: formData })
      );
      expect(imported.status).toBe(201);
      await expect(imported.json()).resolves.toMatchObject({
        page: {
          path: "Notebook/Imported/route-page.html",
          title: "Route page",
          content: "<h1>Route page</h1><p>Saved HTML.</p>",
        },
      });
      await expect(
        fs.readFile(path.join(vaultRoot, "Notebook", "Imported", "route-page.html"), "utf8")
      ).resolves.toContain("Saved HTML.");
      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });
    });
  });

  it("returns a clear error for an unsupported upload without changing the section", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const formData = new FormData();
      formData.set("sectionPath", "Notebook/Imported");
      formData.set("file", new File(["broken"], "broken.snpkg"));
      const response = await POST(
        new Request("http://localhost/api/page/package", { method: "POST", body: formData })
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PAGE_PACKAGE" });
      expect(await fs.readdir(path.join(vaultRoot, "Notebook", "Imported"))).toEqual([]);
    });
  });
});

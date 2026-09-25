import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/page/spreadsheet/route";
import { createPage, invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

async function withVaultFixture(run: () => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-spreadsheet-api-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await run();
  } finally {
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    invalidateVaultTreeCacheForTesting();
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("spreadsheet page API", () => {
  it("opens and persists native workbook JSON while creating a restorable version", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Data", noteType: "spreadsheet" });
      const open = await GET(new Request(`http://localhost/api/page/spreadsheet?path=${encodeURIComponent(page.path)}`));
      expect(open.status).toBe(200);
      await expect(open.json()).resolves.toMatchObject({ workbook: { Workbook: { sheets: [{ name: "Sheet1" }] } } });

      const workbook = { Workbook: { sheets: [{ name: "Imported", rows: [{ cells: [{ value: "saved" }] }] }] } };
      const syncfusionSaveResult = { jsonObject: workbook };
      const save = await PUT(new Request("http://localhost/api/page/spreadsheet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: page.path, workbook: syncfusionSaveResult }),
      }));
      expect(save.status).toBe(200);

      const reopened = await GET(new Request(`http://localhost/api/page/spreadsheet?path=${encodeURIComponent(page.path)}`));
      await expect(reopened.json()).resolves.toEqual({ workbook });

      const versions = JSON.parse(await fs.readFile(
        path.join(process.env.SMART_NOTES_VAULT!, "Notebook", "Section", ".versions", "data.spreadsheet", "index.json"),
        "utf8"
      )) as unknown[];
      expect(versions).toHaveLength(1);
    });
  });

  it("rejects workbook writes to non-spreadsheet pages", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Text" });
      const response = await PUT(new Request("http://localhost/api/page/spreadsheet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: page.path, workbook: { Workbook: {} } }),
      }));
      expect(response.status).toBe(400);
    });
  });

  it("returns a clear client error for malformed workbook JSON", async () => {
    await withVaultFixture(async () => {
      const page = await createPage({ sectionPath: "Notebook/Section", title: "Data", noteType: "spreadsheet" });
      const response = await PUT(new Request("http://localhost/api/page/spreadsheet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: page.path, workbook: { sheets: [] } }),
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "INVALID_SPREADSHEET_WORKBOOK",
        error: "Spreadsheet data must be Syncfusion native workbook JSON.",
      });
    });
  });
});

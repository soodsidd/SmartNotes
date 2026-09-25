import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, POST } from "@/app/api/page/versions/route";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-api-versions-"));
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

describe("page versions route", () => {
  it("lists and snapshots versions through the API", async () => {
    await withVaultFixture(async () => {
      const snapshotResponse = await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/seed.html" }),
        })
      );
      expect(snapshotResponse.status).toBe(200);
      await expect(snapshotResponse.json()).resolves.toMatchObject({
        created: true,
        noteType: "text",
      });

      const listResponse = await GET(
        new Request("http://localhost/api/page/versions?path=Notebook/Section/seed.html")
      );
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toMatchObject({
        versions: expect.arrayContaining([
          expect.objectContaining({ hash: expect.any(String), ts: expect.any(String) }),
        ]),
      });
    });
  });

  it("returns version content through the API", async () => {
    await withVaultFixture(async () => {
      const snapshotResponse = await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/seed.html" }),
        })
      );
      expect(snapshotResponse.status).toBe(200);

      const listResponse = await GET(
        new Request("http://localhost/api/page/versions?path=Notebook/Section/seed.html")
      );
      const { versions } = (await listResponse.json()) as { versions: Array<{ id: string }> };
      const versionId = versions[0].id;

      const contentResponse = await GET(
        new Request(
          `http://localhost/api/page/versions?path=Notebook/Section/seed.html&versionId=${encodeURIComponent(versionId)}`
        )
      );
      expect(contentResponse.status).toBe(200);
      await expect(contentResponse.json()).resolves.toMatchObject({
        versionId,
        noteType: "text",
        content: expect.stringContaining("Initial body."),
      });
    });
  });

  it("restores a version through the API", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const emit = jest.fn();
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit };

      await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/seed.html" }),
        })
      );

      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
Changed body.
`,
        "utf8"
      );

      const listResponse = await GET(
        new Request("http://localhost/api/page/versions?path=Notebook/Section/seed.html")
      );
      const { versions } = (await listResponse.json()) as { versions: Array<{ id: string }> };
      const versionId = versions[0].id;

      const restoreResponse = await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/seed.html",
            action: "restore",
            versionId,
          }),
        })
      );

      expect(restoreResponse.status).toBe(200);
      const restoredSource = await fs.readFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        "utf8"
      );
      expect(restoredSource).toContain("Initial body.");
      expect(emit).toHaveBeenCalledWith("file_updated", {
        path: "Notebook/Section/seed.html",
        content: "Initial body.\n",
      });
      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });
    });
  });

  it("suppresses version-restore file_updated echoes to the originating socket when provided", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const emit = jest.fn();
      const exceptEmit = jest.fn();
      const except = jest.fn(() => ({ emit: exceptEmit }));
      (global as Record<string, unknown>)["_smartNotesIo"] = { emit, except };

      await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/seed.html" }),
        })
      );

      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "seed.html"),
        `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
Changed body.
`,
        "utf8"
      );

      const listResponse = await GET(
        new Request("http://localhost/api/page/versions?path=Notebook/Section/seed.html")
      );
      const { versions } = (await listResponse.json()) as { versions: Array<{ id: string }> };
      const versionId = versions[0].id;

      const restoreResponse = await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "Notebook/Section/seed.html",
            action: "restore",
            versionId,
            originSocketId: "socket-restore",
            originClientId: "client-restore",
          }),
        })
      );

      expect(restoreResponse.status).toBe(200);
      expect(except).toHaveBeenCalledWith("socket-restore");
      expect(exceptEmit).toHaveBeenCalledWith("file_updated", {
        path: "Notebook/Section/seed.html",
        content: "Initial body.\n",
        originSocketId: "socket-restore",
        originClientId: "client-restore",
      });
      expect(emit).not.toHaveBeenCalledWith("file_updated", expect.anything());
      expect(emit).toHaveBeenCalledWith("vault_updated", { reason: "agent_vault_tool" });
    });
  });

  it("does not snapshot Jupyter notebook stubs as page versions", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, "Notebook", "Section", "analysis.html"),
        `---
title: Analysis
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
note_type: jupyter
---
`,
        "utf8"
      );

      const snapshotResponse = await POST(
        new Request("http://localhost/api/page/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "Notebook/Section/analysis.html" }),
        })
      );
      expect(snapshotResponse.status).toBe(400);
      await expect(snapshotResponse.json()).resolves.toMatchObject({
        code: "UNSUPPORTED_NOTE_TYPE",
      });

      const listResponse = await GET(
        new Request("http://localhost/api/page/versions?path=Notebook/Section/analysis.html")
      );
      expect(listResponse.status).toBe(400);
      await expect(listResponse.json()).resolves.toMatchObject({
        code: "UNSUPPORTED_NOTE_TYPE",
      });
    });
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/search/route";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-search-api-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "seed.html"),
      `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-06-08T09:15:00Z
---
<p>Alpha launch notes.</p>
<p>Wavefront calibration holds through the evening run.</p>
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(vaultRoot, "Notebook", "Section", "follow-up.html"),
      `---
title: Follow Up
created: 2026-05-26T18:12:00Z
updated: 2026-06-09T09:15:00Z
---
<p>Wavefront drift showed up again after the mirror swap.</p>
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
  }
}

describe("GET /api/search", () => {
  it("returns full-body HTML-vault matches with centered excerpts", async () => {
    await withVaultFixture(async () => {
      const response = await GET(
        new Request("http://localhost/api/search?q=evening%20run&limit=1")
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        results: Array<{
          path: string;
          title: string;
          breadcrumb: string;
          source: string;
          excerpt: string;
        }>;
      };
      expect(body).toMatchObject({
        results: [
          {
            path: "Notebook/Section/seed.html",
            title: "Seed",
            breadcrumb: "Notebook / Section",
            source: "server",
          },
        ],
      });

      expect(body.results).toHaveLength(1);
      expect(body.results[0].excerpt.toLowerCase()).toContain("evening run");
      expect(body.results[0].excerpt).not.toContain("<p>");
      expect(body.results[0].excerpt.length).toBeLessThanOrEqual(140);
    });
  });

  it("rejects empty search queries", async () => {
    const response = await GET(new Request("http://localhost/api/search?q="));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

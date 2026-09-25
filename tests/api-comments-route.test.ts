import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "@/app/api/page/comments/route";

const SEED_PATH = "Notebook/Section/seed.html";
const SEED_CONTENT = `---
title: Seed
created: 2026-05-25T18:12:00Z
updated: 2026-05-25T18:15:21Z
---
This is the seed page body text for testing comments.
`;

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-comments-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook", "Section"), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, SEED_PATH), SEED_CONTENT, "utf8");
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

function makeGetRequest(path: string) {
  return new Request(`http://localhost/api/page/comments?path=${encodeURIComponent(path)}`);
}

function makePutRequest(body: object) {
  return new Request("http://localhost/api/page/comments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/page/comments", () => {
  it("returns empty array for a page with no comments", async () => {
    await withVaultFixture(async () => {
      const res = await GET(makeGetRequest(SEED_PATH));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.comments).toEqual([]);
    });
  });

  it("returns 400 when path is missing", async () => {
    await withVaultFixture(async () => {
      const res = await GET(new Request("http://localhost/api/page/comments"));
      expect(res.status).toBe(400);
    });
  });

  it("returns 400 for non-.html path", async () => {
    await withVaultFixture(async () => {
      const res = await GET(makeGetRequest("Notebook/Section/seed.txt"));
      expect(res.status).toBe(400);
    });
  });

  it("returns 404 for a missing page", async () => {
    await withVaultFixture(async () => {
      const res = await GET(makeGetRequest("Notebook/Section/missing.html"));
      expect(res.status).toBe(404);
    });
  });
});

describe("PUT /api/page/comments", () => {
  it("saves comments to frontmatter and returns them", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const comment = {
        id: "cmt_test1",
        quote: "seed page body text",
        text: "A note about this",
        createdAt: "2026-06-01T22:00:00Z",
        resolvedAt: null,
      };

      const res = await PUT(makePutRequest({ path: SEED_PATH, comments: [comment] }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.comments).toHaveLength(1);
      expect(json.comments[0].id).toBe("cmt_test1");
      expect(json.comments[0].quote).toBe("seed page body text");

      // Verify the file was actually written
      const raw = await fs.readFile(path.join(vaultRoot, SEED_PATH), "utf8");
      expect(raw).toContain("cmt_test1");
      expect(raw).toContain("seed page body text");
      // Markdown body is untouched
      expect(raw).toContain("This is the seed page body text for testing comments.");
    });
  });

  it("removes comments key from frontmatter when list is empty", async () => {
    await withVaultFixture(async (vaultRoot) => {
      // First add a comment
      await PUT(
        makePutRequest({
          path: SEED_PATH,
          comments: [
            {
              id: "cmt_x",
              quote: "seed page",
              text: "hello",
              createdAt: "2026-06-01T22:00:00Z",
              resolvedAt: null,
            },
          ],
        })
      );

      // Then clear it
      const res = await PUT(makePutRequest({ path: SEED_PATH, comments: [] }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.comments).toEqual([]);

      const raw = await fs.readFile(path.join(vaultRoot, SEED_PATH), "utf8");
      expect(raw).not.toContain("comments:");
    });
  });

  it("GET returns previously PUT comments across round-trips", async () => {
    await withVaultFixture(async () => {
      const comment = {
        id: "cmt_persist",
        quote: "seed page",
        text: "persisted comment",
        createdAt: "2026-06-01T22:00:00Z",
        resolvedAt: null,
      };
      await PUT(makePutRequest({ path: SEED_PATH, comments: [comment] }));

      const res = await GET(makeGetRequest(SEED_PATH));
      const json = await res.json();
      expect(json.comments).toHaveLength(1);
      expect(json.comments[0].text).toBe("persisted comment");
    });
  });

  it("resolving a comment (setting resolvedAt) persists correctly", async () => {
    await withVaultFixture(async () => {
      const comment = {
        id: "cmt_resolve",
        quote: "body text",
        text: "needs resolution",
        createdAt: "2026-06-01T22:00:00Z",
        resolvedAt: null,
      };
      await PUT(makePutRequest({ path: SEED_PATH, comments: [comment] }));

      // Resolve it
      const resolved = { ...comment, resolvedAt: "2026-06-01T23:00:00Z" };
      await PUT(makePutRequest({ path: SEED_PATH, comments: [resolved] }));

      const res = await GET(makeGetRequest(SEED_PATH));
      const json = await res.json();
      expect(json.comments[0].resolvedAt).toBe("2026-06-01T23:00:00Z");
    });
  });

  it("returns 400 when path is missing from body", async () => {
    await withVaultFixture(async () => {
      const res = await PUT(makePutRequest({ comments: [] }));
      expect(res.status).toBe(400);
    });
  });
});

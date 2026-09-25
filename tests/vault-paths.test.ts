import { canonicalizePagePath, resolveVaultPath } from "@/server/vault/paths";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function withVaultEnv(run: (vaultRoot: string) => Promise<void>) {
  const prev = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-paths-test-"));
  process.env.SMART_NOTES_VAULT = vaultRoot;
  try {
    await run(vaultRoot);
  } finally {
    if (prev) {
      process.env.SMART_NOTES_VAULT = prev;
    } else {
      delete process.env.SMART_NOTES_VAULT;
    }
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

describe("vault paths — resolveVaultPath", () => {
  it("rejects traversal outside the vault root", () => {
    expect(() => resolveVaultPath("../escape.html", "page")).toThrow(
      "Path traversal is not allowed."
    );
  });

  it("rejects unknown extensions such as .txt", () => {
    expect(() => resolveVaultPath("Notebook/Section/page.txt", "page")).toThrow(
      "Page files must use the .html extension."
    );
  });
});

describe("vault paths — canonicalizePagePath (SN-84)", () => {
  it("passes .html paths through unchanged", () => {
    expect(canonicalizePagePath("Notebook/Section/note.html")).toBe("Notebook/Section/note.html");
  });

  it("appends .html when extension is missing", () => {
    expect(canonicalizePagePath("Notebook/Section/my-note")).toBe("Notebook/Section/my-note.html");
  });

  it("replaces legacy .md extension with .html", () => {
    expect(canonicalizePagePath("Notebook/Section/old-note.md")).toBe(
      "Notebook/Section/old-note.html"
    );
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(canonicalizePagePath("Notebook\\Section\\note.html")).toBe("Notebook/Section/note.html");
  });

  it("strips leading slashes", () => {
    expect(canonicalizePagePath("/Notebook/Section/note.html")).toBe("Notebook/Section/note.html");
  });

  it("strips absolute vault root prefix", async () => {
    await withVaultEnv(async (vaultRoot) => {
      const absolutePath = path.join(vaultRoot, "Notebook", "Section", "note.html");
      const result = canonicalizePagePath(absolutePath);
      expect(result).toBe("Notebook/Section/note.html");
    });
  });

  it("leaves unknown non-.md extensions intact (so validation downstream still fires)", () => {
    // .txt should not be auto-fixed — it will fail PAGE_FILE_EXTENSION validation.
    expect(canonicalizePagePath("Notebook/Section/page.txt")).toBe("Notebook/Section/page.txt");
  });

  it("resolveVaultPath accepts a path without .html extension via canonicalization", () => {
    // Should not throw — .html is appended automatically.
    expect(() => resolveVaultPath("Notebook/Section/my-note", "page")).not.toThrow();
    const { relativePath } = resolveVaultPath("Notebook/Section/my-note", "page");
    expect(relativePath).toBe("Notebook/Section/my-note.html");
  });
});

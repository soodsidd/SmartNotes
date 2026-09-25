import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readVaultUiState,
  VAULT_UI_STATE_FILENAME,
  writeVaultUiState,
} from "@/server/vault/ui-state";

async function withVaultFixture(run: (vaultRoot: string) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-ui-state-"));
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

describe("vault UI state sidecar", () => {
  it("returns empty defaults when no sidecar exists", async () => {
    await withVaultFixture(async () => {
      await expect(readVaultUiState()).resolves.toEqual({
        version: 1,
        expandedNotebooks: [],
        expandedSections: [],
        closedNotebooks: [],
        expandedPages: [],
        accordionMode: true,
        pinnedNotebooks: [],
        pinnedPages: [],
        notebookOrder: [],
        notebookGroups: [],
        archivedNotebooks: [],
        companionPersist: false,
      });
    });
  });

  it("persists expanded notebook and section state to the vault root", async () => {
    await withVaultFixture(async (vaultRoot) => {
      const saved = await writeVaultUiState({
        expandedNotebooks: ["Notebook A"],
        expandedSections: ["Notebook A/Section 1"],
        closedNotebooks: ["Notebook B"],
        expandedPages: ["Notebook A/Section 1/page.html"],
        accordionMode: false,
        pinnedNotebooks: ["Notebook A"],
        pinnedPages: ["Notebook A/Section 1/page.html"],
        notebookOrder: ["Notebook B", "Notebook A"],
        notebookGroups: [
          { id: "work", name: "Work", notebookPaths: ["Notebook A"], collapsed: true },
        ],
        archivedNotebooks: ["Notebook C"],
      });

      expect(saved).toEqual({
        version: 1,
        expandedNotebooks: ["Notebook A"],
        expandedSections: ["Notebook A/Section 1"],
        closedNotebooks: ["Notebook B"],
        expandedPages: ["Notebook A/Section 1/page.html"],
        accordionMode: false,
        pinnedNotebooks: ["Notebook A"],
        pinnedPages: ["Notebook A/Section 1/page.html"],
        notebookOrder: ["Notebook B", "Notebook A"],
        notebookGroups: [
          { id: "work", name: "Work", notebookPaths: ["Notebook A"], collapsed: true },
        ],
        archivedNotebooks: ["Notebook C"],
        companionPersist: false,
      });

      const raw = await fs.readFile(path.join(vaultRoot, VAULT_UI_STATE_FILENAME), "utf8");
      expect(raw).toContain('"expandedNotebooks"');
      await expect(readVaultUiState()).resolves.toEqual(saved);
    });
  });

  it("normalizes malformed SN-232 organization fields without failing", async () => {
    await withVaultFixture(async (vaultRoot) => {
      await fs.writeFile(
        path.join(vaultRoot, VAULT_UI_STATE_FILENAME),
        JSON.stringify({
          accordionMode: "yes",
          pinnedNotebooks: [" Notebook A ", 42, "Notebook A", ""],
          pinnedPages: { path: "page" },
          notebookOrder: ["Notebook B", null, "Notebook B"],
          notebookGroups: [
            { id: " work ", name: " Work ", notebookPaths: ["Notebook A", 7], collapsed: true },
            { id: "work", name: "Duplicate", notebookPaths: ["Notebook B"] },
            { id: "personal", name: "Personal", notebookPaths: ["Notebook A", "Notebook C"] },
            { id: "", name: "Missing id" },
            "bad",
          ],
          archivedNotebooks: ["Notebook D", {}, "Notebook D"],
        }),
        "utf8"
      );

      await expect(readVaultUiState()).resolves.toMatchObject({
        accordionMode: true,
        pinnedNotebooks: ["Notebook A"],
        pinnedPages: [],
        notebookOrder: ["Notebook B"],
        notebookGroups: [
          { id: "work", name: "Work", notebookPaths: ["Notebook A"], collapsed: true },
          { id: "personal", name: "Personal", notebookPaths: ["Notebook C"], collapsed: false },
        ],
        archivedNotebooks: ["Notebook D"],
      });
    });
  });

  it("persists the SN-80 companionPersist preference without losing other fields", async () => {
    await withVaultFixture(async () => {
      await writeVaultUiState({ expandedNotebooks: ["Notebook A"] });

      const enabled = await writeVaultUiState({ companionPersist: true });
      expect(enabled.companionPersist).toBe(true);
      expect(enabled.expandedNotebooks).toEqual(["Notebook A"]);
      await expect(readVaultUiState()).resolves.toMatchObject({ companionPersist: true });

      const disabled = await writeVaultUiState({ companionPersist: false });
      expect(disabled.companionPersist).toBe(false);
      expect(disabled.expandedNotebooks).toEqual(["Notebook A"]);
    });
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  INGEST_DESTINATIONS_SETTINGS_FILENAME,
  loadIngestDestinationCatalog,
  loadIngestDestinationsSettings,
  saveIngestDestinationsSettings,
  validateIngestDestinationsSettings,
} from "@/server/ingest-destinations";
import { VaultError } from "@/server/vault/errors";
import { GET as getIngestSettings, PUT as putIngestSettings } from "@/app/api/ingest/settings/route";
import { GET as getIngestDestinations } from "@/app/api/ingest/destinations/route";
import { invalidateVaultTreeCacheForTesting } from "@/server/vault/pages";

const KNOWN_NOTEBOOKS = new Set(["notebook", "research"]);
const INGEST_TOKEN = "test-ingest-token";

async function withFixture(run: (input: { vaultRoot: string; stateDir: string }) => Promise<void>) {
  const previousVault = process.env.SMART_NOTES_VAULT;
  const previousState = process.env.SMART_NOTES_STATE_DIR;
  const previousToken = process.env.SMART_NOTES_INGEST_TOKEN;
  const previousDestinations = process.env.SMART_NOTES_INGEST_DESTINATIONS;
  const previousDefaultDestination = process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;

  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sn235-vault-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "sn235-state-"));

  process.env.SMART_NOTES_VAULT = vaultRoot;
  process.env.SMART_NOTES_STATE_DIR = stateDir;
  process.env.SMART_NOTES_INGEST_TOKEN = INGEST_TOKEN;
  delete process.env.SMART_NOTES_INGEST_DESTINATIONS;
  delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;

  try {
    await fs.mkdir(path.join(vaultRoot, "Notebook"), { recursive: true });
    await fs.mkdir(path.join(vaultRoot, "Research"), { recursive: true });
    await run({ vaultRoot, stateDir });
  } finally {
    invalidateVaultTreeCacheForTesting();
    if (previousVault) process.env.SMART_NOTES_VAULT = previousVault;
    else delete process.env.SMART_NOTES_VAULT;
    if (previousState) process.env.SMART_NOTES_STATE_DIR = previousState;
    else delete process.env.SMART_NOTES_STATE_DIR;
    if (previousToken) process.env.SMART_NOTES_INGEST_TOKEN = previousToken;
    else delete process.env.SMART_NOTES_INGEST_TOKEN;
    if (previousDestinations) process.env.SMART_NOTES_INGEST_DESTINATIONS = previousDestinations;
    else delete process.env.SMART_NOTES_INGEST_DESTINATIONS;
    if (previousDefaultDestination) process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = previousDefaultDestination;
    else delete process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION;
    await fs.rm(vaultRoot, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("ingest destinations settings store", () => {
  it("reads back an empty allowlist when nothing is configured", async () => {
    await withFixture(async ({ stateDir }) => {
      expect(loadIngestDestinationsSettings(stateDir)).toEqual({ destinations: [], defaultId: null });
      expect(() => loadIngestDestinationCatalog(stateDir)).toThrow(VaultError);
    });
  });

  it("seeds once from the SN-234 env vars and then ignores further env edits", async () => {
    await withFixture(async ({ stateDir }) => {
      process.env.SMART_NOTES_INGEST_DESTINATIONS = JSON.stringify([
        { id: "reading", label: "Reading Queue", notebookPath: "Notebook" },
      ]);
      process.env.SMART_NOTES_INGEST_DEFAULT_DESTINATION = "reading";

      const seeded = loadIngestDestinationsSettings(stateDir);
      expect(seeded).toEqual({
        destinations: [{ id: "reading", label: "Reading Queue", notebookPath: "Notebook" }],
        defaultId: "reading",
      });

      const settingsFile = path.join(stateDir, INGEST_DESTINATIONS_SETTINGS_FILENAME);
      await expect(fs.stat(settingsFile)).resolves.toBeDefined();

      // Editing the env var after the first read must not change what is served:
      // the settings file is now the source of truth.
      process.env.SMART_NOTES_INGEST_DESTINATIONS = JSON.stringify([
        { id: "other", label: "Other", notebookPath: "Research" },
      ]);
      expect(loadIngestDestinationsSettings(stateDir)).toEqual(seeded);
    });
  });

  it("validates duplicate id, missing label, and an unknown notebook", async () => {
    await withFixture(async () => {
      expect(
        validateIngestDestinationsSettings(
          {
            destinations: [
              { id: "a", label: "A", notebookPath: "Notebook" },
              { id: "a", label: "Duplicate", notebookPath: "Research" },
            ],
            defaultId: null,
          },
          KNOWN_NOTEBOOKS
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining("Duplicate destination id") });

      expect(
        validateIngestDestinationsSettings(
          { destinations: [{ id: "a", label: "", notebookPath: "Notebook" }], defaultId: null },
          KNOWN_NOTEBOOKS
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining("missing a label") });

      expect(
        validateIngestDestinationsSettings(
          { destinations: [{ id: "", label: "A", notebookPath: "Notebook" }], defaultId: null },
          KNOWN_NOTEBOOKS
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining("missing an id") });

      expect(
        validateIngestDestinationsSettings(
          { destinations: [{ id: "a", label: "A", notebookPath: "DoesNotExist" }], defaultId: null },
          KNOWN_NOTEBOOKS
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });

      expect(
        validateIngestDestinationsSettings(
          { destinations: [{ id: "a", label: "A", notebookPath: "Notebook" }], defaultId: "missing" },
          KNOWN_NOTEBOOKS
        )
      ).toMatchObject({ ok: false, error: expect.stringContaining("is not in the list") });
    });
  });

  it("accepts a valid list and normalizes the default", () => {
    const result = validateIngestDestinationsSettings(
      {
        destinations: [
          { id: "a", label: "A", notebookPath: "Notebook" },
          { id: "b", label: "B", notebookPath: "Research" },
        ],
        defaultId: "A",
      },
      KNOWN_NOTEBOOKS
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        destinations: [
          { id: "a", label: "A", notebookPath: "Notebook" },
          { id: "b", label: "B", notebookPath: "Research" },
        ],
        defaultId: "a",
      },
    });
  });

  it("persists add/edit/remove/reorder as full-list saves", async () => {
    await withFixture(async ({ stateDir }) => {
      const afterAdd = saveIngestDestinationsSettings(
        stateDir,
        {
          destinations: [
            { id: "a", label: "A", notebookPath: "Notebook" },
            { id: "b", label: "B", notebookPath: "Research" },
          ],
          defaultId: "a",
        },
        KNOWN_NOTEBOOKS
      );
      expect(afterAdd.destinations).toHaveLength(2);

      // Edit label + reorder (b first) + remove "a" in one full-list save.
      const afterEditAndReorder = saveIngestDestinationsSettings(
        stateDir,
        {
          destinations: [{ id: "b", label: "B Renamed", notebookPath: "Research" }],
          defaultId: "b",
        },
        KNOWN_NOTEBOOKS
      );
      expect(afterEditAndReorder).toEqual({
        destinations: [{ id: "b", label: "B Renamed", notebookPath: "Research" }],
        defaultId: "b",
      });

      expect(loadIngestDestinationsSettings(stateDir)).toEqual(afterEditAndReorder);
    });
  });

  it("rejects an invalid save with a 400 VaultError and does not persist it", async () => {
    await withFixture(async ({ stateDir }) => {
      saveIngestDestinationsSettings(
        stateDir,
        { destinations: [{ id: "a", label: "A", notebookPath: "Notebook" }], defaultId: null },
        KNOWN_NOTEBOOKS
      );

      expect(() =>
        saveIngestDestinationsSettings(
          stateDir,
          { destinations: [{ id: "a", label: "", notebookPath: "Notebook" }], defaultId: null },
          KNOWN_NOTEBOOKS
        )
      ).toThrow(VaultError);

      // The rejected save must not overwrite the last-good settings.
      expect(loadIngestDestinationsSettings(stateDir).destinations).toEqual([
        { id: "a", label: "A", notebookPath: "Notebook" },
      ]);
    });
  });
});

describe("ingest destinations settings route (SN-235)", () => {
  function settingsRequest(init?: RequestInit) {
    return new Request("http://localhost/api/ingest/settings", init);
  }

  it("reflects a saved destination through GET /api/ingest/destinations without a restart", async () => {
    await withFixture(async () => {
      const empty = await getIngestSettings();
      await expect(empty.json()).resolves.toEqual({ destinations: [], defaultId: null });

      const putResponse = await putIngestSettings(
        settingsRequest({
          method: "PUT",
          body: JSON.stringify({
            destinations: [{ id: "reading", label: "Reading Queue", notebookPath: "Notebook" }],
            defaultId: "reading",
          }),
        })
      );
      expect(putResponse.status).toBe(200);

      const catalogResponse = await getIngestDestinations(
        new Request("http://localhost/api/ingest/destinations", {
          headers: { Authorization: `Bearer ${INGEST_TOKEN}` },
        })
      );
      expect(catalogResponse.status).toBe(200);
      await expect(catalogResponse.json()).resolves.toEqual({
        destinations: [{ id: "reading", label: "Reading Queue", isDefault: true }],
        defaultId: "reading",
      });
    });
  });

  it("rejects a notebook path that does not exist in the vault", async () => {
    await withFixture(async () => {
      const putResponse = await putIngestSettings(
        settingsRequest({
          method: "PUT",
          body: JSON.stringify({
            destinations: [{ id: "reading", label: "Reading Queue", notebookPath: "GhostNotebook" }],
            defaultId: null,
          }),
        })
      );
      expect(putResponse.status).toBe(400);
      await expect(putResponse.json()).resolves.toMatchObject({
        code: "INVALID_INGEST_DESTINATIONS",
      });
    });
  });
});

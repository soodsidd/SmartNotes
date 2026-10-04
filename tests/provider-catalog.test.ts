import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createProviderCatalog } = require("../packages/cli-chat/provider-catalog");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createChatModule } = require("../packages/cli-chat/index");

const catalog = {
  schemaVersion: 1,
  generatedAt: "2026-10-04T00:00:00Z",
  providers: [
    {
      id: "codex", label: "Codex", models: [
        { id: "new-model", label: "New Model", status: "enabled" },
        { id: "hidden-model", label: "Hidden Model", status: "pending-review" },
      ],
    },
    { id: "cursor", label: "Cursor", models: [{ id: "auto", label: "Auto", status: "enabled" }] },
  ],
  modelsByProvider: { codex: ["new-model"], cursor: ["auto"] },
  pendingReview: [{ provider: "codex", model: "hidden-model" }],
};

function response(payload: unknown) {
  return { ok: true, json: async () => payload };
}

function requestProviders(chat: { handleRequest: (req: unknown, res: unknown) => void }) {
  return new Promise<Record<string, unknown>>((resolve) => {
    chat.handleRequest({ url: "/api/chat/providers", method: "GET", headers: {} }, {
      writeHead: jest.fn(),
      end: (body: string) => resolve(JSON.parse(body)),
    });
  });
}

describe("AV provider catalog", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sn276-catalog-"));
    cachePath = path.join(dir, "provider-catalog.json");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("fetches enabled models, saves the response, and uses it after an unreachable sidecar and restart", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(response(catalog)).mockRejectedValueOnce(new Error("offline"));
    const client = createProviderCatalog({ cachePath, fetchImpl });
    expect(client.get()).toBeNull();
    await client.refresh();
    expect(client.get().providers[0].models).toEqual([{ id: "new-model", label: "New Model" }]);
    expect(fs.existsSync(cachePath)).toBe(true);

    await client.refresh();
    expect(client.get().providers[0].models.map((model: { id: string }) => model.id)).toEqual(["new-model"]);

    const restarted = createProviderCatalog({ cachePath, fetchImpl: jest.fn().mockRejectedValue(new Error("offline")) });
    await restarted.refresh();
    expect(restarted.get()).toEqual(client.get());
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8787/api/provider-catalog", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps the last good response when the sidecar returns an incompatible or invalid catalog", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(catalog))
      .mockResolvedValueOnce(response({ ...catalog, schemaVersion: 2 }))
      .mockResolvedValueOnce(response({ ...catalog, modelsByProvider: { codex: ["hidden-model"], cursor: ["auto"] } }));
    const client = createProviderCatalog({ cachePath, fetchImpl });
    await client.refresh();
    const saved = fs.readFileSync(cachePath, "utf8");
    await client.refresh();
    await client.refresh();
    expect(client.get().providers[0].models[0].id).toBe("new-model");
    expect(fs.readFileSync(cachePath, "utf8")).toBe(saved);
  });

  it("picks up a newly enabled model on the next fetch", async () => {
    const updated = {
      ...catalog,
      providers: [{
        ...catalog.providers[0],
        models: [...catalog.providers[0].models, { id: "newer-model", label: "Newer Model", status: "enabled" }],
      }, catalog.providers[1]],
      modelsByProvider: { ...catalog.modelsByProvider, codex: ["newer-model", "new-model"] },
    };
    const client = createProviderCatalog({
      cachePath,
      fetchImpl: jest.fn().mockResolvedValueOnce(response(catalog)).mockResolvedValueOnce(response(updated)),
    });
    await client.refresh();
    await client.refresh();
    expect(client.get().providers[0].models.map((model: { id: string }) => model.id)).toEqual(["newer-model", "new-model"]);
    expect(createProviderCatalog({ cachePath, fetchImpl: jest.fn() }).get()).toEqual(client.get());
  });

  it("serves provider names and model labels from the shared catalog route", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(catalog));
    const chat = createChatModule(null, null, {
      workingDirectory: dir, stateDir: dir, uploadDir: path.join(dir, "uploads"),
      recoverInterruptedOnStartup: false, providerCatalogFetch: fetchImpl,
    });
    const result = await requestProviders(chat) as { providers: Array<{ id: string; name: string; modelLabels: Record<string, string> }> };
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.providers.find(provider => provider.id === "codex")).toEqual(expect.objectContaining({
      name: "Codex", modelLabels: { "new-model": "New Model" },
    }));
    expect(result.providers.find(provider => provider.id === "codex")?.modelLabels["hidden-model"]).toBeUndefined();
  });
});

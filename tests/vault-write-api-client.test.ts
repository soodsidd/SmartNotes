/**
 * @jest-environment node
 */

import {
  __resetConnectionStatusForTests,
  getConnectionState,
  recordWriteFailure,
} from "@/lib/connection-status";
import { savePage } from "@/lib/api/pages";
import { saveCompanionSessions } from "@/lib/api/companion";
import { snapshotPageVersion } from "@/lib/api/versions";
import { restoreVaultSnapshot } from "@/lib/api/backup";
import { registerPortableNotebook } from "@/lib/api/notebook-registry";
import { revealNotebookInExplorer } from "@/lib/api/fs-native";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Server Error",
    json: jest.fn().mockResolvedValue(body),
  };
}

describe("vault write client APIs report connection health (SN-85)", () => {
  beforeEach(() => {
    __resetConnectionStatusForTests();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it("raises the sticky connection-lost signal when a shared page write fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue(
      jsonResponse({ error: "disk unavailable" }, false, 500)
    );

    await expect(savePage("Notebook/Section/Page.html", "Page", "<p>x</p>")).rejects.toThrow(
      "disk unavailable"
    );

    expect(getConnectionState().status).toBe("lost");
  });

  it("clears the signal on a later successful write", async () => {
    recordWriteFailure();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        path: "Notebook/Section/Page.html",
        title: "Page",
        body: "<p>saved</p>",
        createdAt: null,
        updatedAt: null,
        metadata: {},
      })
    );

    await savePage("Notebook/Section/Page.html", "Page", "<p>saved</p>");

    expect(getConnectionState()).toEqual({ status: "ok", message: null });
  });

  it("routes sidecar, version, backup, registry, and fs-native writes through the same signal", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          created: true,
          entry: { id: "v1", ts: "2026-06-25T00:00:00Z", hash: "abc", size: 1 },
          noteType: "text",
        })
      )
      .mockResolvedValueOnce(jsonResponse({ restoredPaths: 1 }))
      .mockResolvedValueOnce(
        jsonResponse({
          notebook: {
            id: "nb_1",
            name: "Notebook",
            rootPath: "C:/Notebook",
            path: "+nb_1",
            addedAt: "2026-06-25T00:00:00Z",
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ path: "C:/Notebook" }));

    await saveCompanionSessions("Notebook/Section/Page.html", { scopes: {} });
    await snapshotPageVersion("Notebook/Section/Page.html");
    await restoreVaultSnapshot("smart-notes-vault.zip");
    await registerPortableNotebook({ rootPath: "C:/Notebook" });
    await revealNotebookInExplorer("+nb_1");

    expect(getConnectionState()).toEqual({ status: "ok", message: null });
  });

  it("falls back from keepalive when a kept companion session exceeds the browser body quota", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;

    await saveCompanionSessions(
      "Notebook/Section/Page.html",
      {
        scopes: {
          whole: {
            messages: [{ id: "long", role: "assistant", content: "x".repeat(70 * 1024) }],
          },
        },
      },
      { keepalive: true }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/companion",
      expect.objectContaining({ keepalive: false })
    );
  });

  it("retains keepalive for a small durable companion pointer write", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = fetchMock;

    await saveCompanionSessions(
      "Notebook/Section/Page.html",
      { scopes: {} },
      { keepalive: true }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/companion",
      expect.objectContaining({ keepalive: true })
    );
  });
});

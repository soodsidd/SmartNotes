jest.mock("@/server/ai/jupyter-fast-lane", () => ({
  ensureJupyterFastLaneWarm: jest.fn(),
  closeJupyterFastLaneSession: jest.fn(),
  closeAllJupyterFastLaneSessions: jest.fn(),
  sendJupyterFastLaneMessage: jest.fn(),
}));

import { DELETE, POST as WARM } from "@/app/api/companion/fast-lane/route";
import { POST as SEND } from "@/app/api/companion/fast-lane/send/route";
import {
  closeAllJupyterFastLaneSessions,
  closeJupyterFastLaneSession,
  ensureJupyterFastLaneWarm,
  sendJupyterFastLaneMessage,
} from "@/server/ai/jupyter-fast-lane";

const mockedEnsureWarm = jest.mocked(ensureJupyterFastLaneWarm);
const mockedClose = jest.mocked(closeJupyterFastLaneSession);
const mockedCloseAll = jest.mocked(closeAllJupyterFastLaneSessions);
const mockedSend = jest.mocked(sendJupyterFastLaneMessage);

function validInlineContext() {
  return {
    pagePath: "ignored-client-page.html",
    workspacePath: "analysis.ipynb",
    documentKind: "notebook",
    activeCellIndex: 0,
    activeCellId: "cell-0",
    caret: { line: 0, column: 5, offset: 5 },
    selection: null,
    selectionRects: [],
    content: {
      activeCellSource: "x = 1",
      activeCellSourceTruncated: false,
      cells: [{ index: 0, id: "cell-0", kind: "code", source: "x = 1", sourceTruncated: false }],
      windowTruncated: false,
    },
  };
}

describe("companion fast-lane route (SN-247)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST warms the fast-lane session for the given page", async () => {
    mockedEnsureWarm.mockResolvedValue({ status: "ready", sessionId: "sess-1" });

    const response = await WARM(
      new Request("http://localhost/api/companion/fast-lane", {
        method: "POST",
        body: JSON.stringify({ path: "Notebook/Section/analysis.html" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready", sessionId: "sess-1" });
    expect(mockedEnsureWarm).toHaveBeenCalledWith("Notebook/Section/analysis.html");
  });

  it("POST rejects a missing path", async () => {
    const response = await WARM(
      new Request("http://localhost/api/companion/fast-lane", { method: "POST", body: JSON.stringify({}) })
    );
    expect(response.status).toBe(400);
    expect(mockedEnsureWarm).not.toHaveBeenCalled();
  });

  it("DELETE closes one page's session when a path is supplied", async () => {
    mockedClose.mockReturnValue({ closed: true });
    const response = await DELETE(
      new Request("http://localhost/api/companion/fast-lane?path=Notebook%2FSection%2Fanalysis.html", {
        method: "DELETE",
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ closed: true });
    expect(mockedClose).toHaveBeenCalledWith("Notebook/Section/analysis.html");
    expect(mockedCloseAll).not.toHaveBeenCalled();
  });

  it("DELETE closes every session when no path is supplied", async () => {
    mockedCloseAll.mockReturnValue({ closed: 3 });
    const response = await DELETE(new Request("http://localhost/api/companion/fast-lane", { method: "DELETE" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ closed: 3 });
    expect(mockedCloseAll).toHaveBeenCalledTimes(1);
  });

  it("send POST returns model text without touching the companion tool surface", async () => {
    mockedSend.mockResolvedValue({ text: "42", sessionId: "sess-1", ttftMs: 1800, durationMs: 1850 });

    const response = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({
          path: "Notebook/Section/analysis.html",
          message: "What is 6*7?",
          context: validInlineContext(),
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      text: "42",
      sessionId: "sess-1",
      ttftMs: 1800,
      durationMs: 1850,
    });
    expect(mockedSend).toHaveBeenCalledWith(
      "Notebook/Section/analysis.html",
      "What is 6*7?",
      expect.objectContaining({
        signal: expect.anything(),
        context: expect.objectContaining({
          pagePath: "Notebook/Section/analysis.html",
          workspacePath: "analysis.ipynb",
          content: expect.objectContaining({ activeCellSource: "x = 1" }),
        }),
      })
    );
  });

  it("send POST rejects a missing path", async () => {
    const response = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({ message: "hi" }),
      })
    );
    expect(response.status).toBe(400);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("send POST rejects traversal-shaped page and workspace paths", async () => {
    const traversalPage = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({ path: "../outside.html", message: "hi" }),
      })
    );
    expect(traversalPage.status).toBe(400);

    const traversalWorkspace = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({
          path: "Notebook/Section/analysis.html",
          message: "hi",
          context: {
            workspacePath: "../outside.ipynb",
            documentKind: "notebook",
            activeCellIndex: 0,
            activeCellId: "cell-0",
            caret: { line: 0, column: 0, offset: 0 },
            selection: null,
            selectionRects: [],
            content: {
              activeCellSource: "x = 1",
              activeCellSourceTruncated: false,
              cells: [{ index: 0, id: "cell-0", kind: "code", source: "x = 1", sourceTruncated: false }],
              windowTruncated: false,
            },
          },
        }),
      })
    );
    expect(traversalWorkspace.status).toBe(400);
    await expect(traversalWorkspace.json()).resolves.toMatchObject({ code: "INVALID_JUPYTER_CONTEXT" });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("send POST maps a busy fast-lane error to 409", async () => {
    mockedSend.mockRejectedValue(Object.assign(new Error("busy"), { code: "FAST_LANE_BUSY" }));
    const response = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({ path: "Notebook/Section/analysis.html", message: "hi" }),
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "FAST_LANE_BUSY" });
  });

  it("send POST maps a timeout fast-lane error to 504", async () => {
    mockedSend.mockRejectedValue(Object.assign(new Error("timed out"), { code: "FAST_LANE_TIMEOUT" }));
    const response = await SEND(
      new Request("http://localhost/api/companion/fast-lane/send", {
        method: "POST",
        body: JSON.stringify({ path: "Notebook/Section/analysis.html", message: "hi" }),
      })
    );
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ code: "FAST_LANE_TIMEOUT" });
  });
});

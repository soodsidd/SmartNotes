jest.mock("@/server/jupyter/runtime", () => ({
  ensureSession: jest.fn(),
  getSessionStatus: jest.fn(),
  stopAllSessions: jest.fn(),
  stopSession: jest.fn(),
}));

import { DELETE } from "@/app/api/jupyter/session/route";
import { stopAllSessions, stopSession } from "@/server/jupyter/runtime";

const mockedStopAllSessions = jest.mocked(stopAllSessions);
const mockedStopSession = jest.mocked(stopSession);

describe("jupyter session route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops every Jupyter session when DELETE omits a page path", async () => {
    mockedStopAllSessions.mockResolvedValue({ stopped: 2 });

    const response = await DELETE(new Request("http://localhost/api/jupyter/session", { method: "DELETE" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ stopped: 2 });
    expect(mockedStopAllSessions).toHaveBeenCalledTimes(1);
    expect(mockedStopSession).not.toHaveBeenCalled();
  });

  it("stops one page session when DELETE includes a page path", async () => {
    mockedStopSession.mockResolvedValue({ stopped: true });

    const response = await DELETE(
      new Request("http://localhost/api/jupyter/session?path=Notebook%2FSection%2Fanalysis.html", {
        method: "DELETE",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ stopped: true });
    expect(mockedStopSession).toHaveBeenCalledWith("Notebook/Section/analysis.html");
    expect(mockedStopAllSessions).not.toHaveBeenCalled();
  });
});

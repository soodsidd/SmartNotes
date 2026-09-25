jest.mock("@/server/jupyter/runtime", () => ({
  ensureProjectWorkspaceSession: jest.fn(),
  getProjectWorkspaceStatus: jest.fn(),
  stopProjectWorkspaceSession: jest.fn(),
}));

jest.mock("@/server/jupyter/workspace-root", () => {
  const actual = jest.requireActual("@/server/jupyter/workspace-root");
  return {
    ...actual,
    resolveProjectWorkspace: jest.fn(),
  };
});

import { DELETE, GET, POST } from "@/app/api/jupyter/workspace/session/route";
import {
  ensureProjectWorkspaceSession,
  getProjectWorkspaceStatus,
  stopProjectWorkspaceSession,
} from "@/server/jupyter/runtime";
import { resolveProjectWorkspace } from "@/server/jupyter/workspace-root";
import { resetWorkspaceCapabilitiesForTesting } from "@/server/jupyter/workspace-capability";

const mockedEnsure = jest.mocked(ensureProjectWorkspaceSession);
const mockedStatus = jest.mocked(getProjectWorkspaceStatus);
const mockedStop = jest.mocked(stopProjectWorkspaceSession);
const mockedResolve = jest.mocked(resolveProjectWorkspace);

describe("jupyter project workspace session route (SN-256)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetWorkspaceCapabilitiesForTesting();
  });

  it("GET requires a root query parameter", async () => {
    const response = await GET(new Request("http://localhost/api/jupyter/workspace/session"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PATH" });
    expect(mockedStatus).not.toHaveBeenCalled();
  });

  it("GET forwards root/branch/access query params to the runtime", async () => {
    mockedStatus.mockResolvedValue({ status: "stopped", pagePath: "C:/wt", rootPath: "C:/wt", accessMode: "read-only" });

    const response = await GET(
      new Request(
        "http://localhost/api/jupyter/workspace/session?root=C%3A%2Fwt&branch=main&isDefaultBranch=true&requestedAccess=editable"
      )
    );

    expect(response.status).toBe(200);
    expect(mockedStatus).toHaveBeenCalledWith({
      rootPath: "C:/wt",
      projectId: undefined,
      repoId: undefined,
      branch: "main",
      isDefaultBranch: true,
      requestedAccess: "editable",
      ownerOpen: undefined,
      defaultBranchEditConfirmed: undefined,
    });
  });

  it("POST launches an owner-opened folder and issues a capability without AV identity", async () => {
    mockedResolve.mockResolvedValue({
      key: "project:c:/local-workspace",
      realRoot: "C:/local-workspace",
      accessMode: "editable",
      hideGlobs: [],
      branch: "feature/local",
    });
    mockedEnsure.mockResolvedValue({
      status: "ready",
      url: "http://localhost/api/jupyter/proxy/local/lab?token=xyz",
      pagePath: "C:/local-workspace",
      rootPath: "C:/local-workspace",
      accessMode: "editable",
      branch: "feature/local",
    });
    const body = {
      rootPath: "C:/local-workspace",
      requestedAccess: "editable" as const,
      ownerOpen: true,
      projectName: "local-workspace",
    };

    const response = await POST(new Request("http://localhost/api/jupyter/workspace/session", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      status: "ready",
      accessMode: "editable",
      branch: "feature/local",
      projectName: "local-workspace",
    });
    expect(json.projectId).toBeUndefined();
    expect(json.repoId).toBeUndefined();
    expect(json.workItemId).toBeUndefined();
    expect(json.returnUrl).toBeUndefined();
    expect(json.capability).toMatch(/^dwc_/);
  });

  it("POST launches a session for an explicit worktree root and issues a capability", async () => {
    mockedResolve.mockResolvedValue({
      key: "project:c:/wt",
      realRoot: "C:/wt",
      accessMode: "editable",
      hideGlobs: [],
      branch: "av/sn-256",
      projectId: "project-1",
      repoId: "repo-1",
    });
    mockedEnsure.mockResolvedValue({
      status: "ready",
      url: "http://localhost/api/jupyter/proxy/abc/lab?token=xyz",
      pagePath: "C:/wt",
      rootPath: "C:/wt",
      accessMode: "editable",
      branch: "av/sn-256",
    });

    const body = {
      rootPath: "C:/wt",
      branch: "av/sn-256",
      requestedAccess: "editable",
      projectId: "project-1",
      repoId: "repo-1",
      workItemId: "SN-256",
      worktreeLabel: "SN-256",
      projectName: "Smart Notes",
      returnUrl: "http://127.0.0.1/work-items/SN-256",
    };
    const response = await POST(
      new Request("http://localhost/api/jupyter/workspace/session", {
        method: "POST",
        headers: { origin: "http://localhost:3002" },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      status: "ready",
      accessMode: "editable",
      projectId: "project-1",
      repoId: "repo-1",
      workItemId: "SN-256",
      worktreeLabel: "SN-256",
    });
    expect(typeof json.capability).toBe("string");
    expect(json.capability.startsWith("dwc_")).toBe(true);
    expect(mockedEnsure).toHaveBeenCalledWith(body, { frameOrigin: "http://localhost:3002" });
  });

  it("POST rejects a body missing rootPath", async () => {
    const response = await POST(
      new Request("http://localhost/api/jupyter/workspace/session", {
        method: "POST",
        body: JSON.stringify({ branch: "main" }),
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PATH" });
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it("DELETE requires a root query parameter (unlike the note-owned route, it never stops every session)", async () => {
    const response = await DELETE(new Request("http://localhost/api/jupyter/workspace/session", { method: "DELETE" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PATH" });
    expect(mockedStop).not.toHaveBeenCalled();
  });

  it("DELETE stops the session for the given root", async () => {
    mockedStop.mockResolvedValue({ stopped: true });
    const response = await DELETE(
      new Request("http://localhost/api/jupyter/workspace/session?root=C%3A%2Fwt", { method: "DELETE" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ stopped: true });
    expect(mockedStop).toHaveBeenCalledWith({
      rootPath: "C:/wt",
      projectId: undefined,
      repoId: undefined,
      branch: undefined,
      isDefaultBranch: undefined,
      requestedAccess: undefined,
      ownerOpen: undefined,
      defaultBranchEditConfirmed: undefined,
    });
  });
});

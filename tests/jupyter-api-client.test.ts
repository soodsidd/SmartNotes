import { ApiError } from "@/lib/api/pages";
import {
  __testInternals,
  fetchJupyterWorkspaceSessionStatus,
  launchJupyterSession,
  launchJupyterWorkspaceSession,
  stopJupyterWorkspaceSession,
} from "@/lib/api/jupyter";

function installWindowOrigin(origin = "http://100.104.185.31:57848") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin } },
  });
}

describe("jupyter API client proxy guard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "fetch");
  });

  it("derives the browser-facing proxy status URL from a proxied Lab URL", () => {
    installWindowOrigin();

    expect(
      __testInternals.proxyStatusUrlFromLabUrl(
        "/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123"
      )
    ).toBe("/api/jupyter/proxy/proxy-1/api/status?token=tok123");
  });

  it("rejects non-proxied or cross-origin Jupyter URLs", () => {
    installWindowOrigin();

    expect(__testInternals.proxyStatusUrlFromLabUrl("http://127.0.0.1:8888/lab?token=tok")).toBeNull();
    expect(__testInternals.proxyStatusUrlFromLabUrl("/lab/tree/notebook.ipynb?token=tok")).toBeNull();
  });

  it("preflights the same-origin proxy before returning a ready session", async () => {
    installWindowOrigin();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ready",
          url: "/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123",
          pagePath: "Notebook/Section/page.html",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(launchJupyterSession("Notebook/Section/page.html")).resolves.toMatchObject({
      status: "ready",
      url: "http://100.104.185.31:57848/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/jupyter/proxy/proxy-1/api/status?token=tok123", {
      cache: "no-store",
    });
  });

  it("rewrites the embed URL onto the visible browser origin", () => {
    installWindowOrigin("http://100.104.185.31:3002");

    expect(
      __testInternals.sameOriginProxyEmbedUrl(
        "/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123"
      )
    ).toBe("http://100.104.185.31:3002/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123");

    expect(__testInternals.sameOriginProxyEmbedUrl("http://127.0.0.1:8888/lab?token=tok")).toBeNull();
  });

  it("surfaces a proxy-specific error when the browser cannot reach the proxy", async () => {
    installWindowOrigin();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ready",
          url: "/api/jupyter/proxy/proxy-1/lab/tree/notebook.ipynb?token=tok123",
          pagePath: "Notebook/Section/page.html",
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(launchJupyterSession("Notebook/Section/page.html")).rejects.toMatchObject({
      code: "PROXY_UNAVAILABLE",
      status: 404,
    } satisfies Partial<ApiError>);
  });

  it("launches, reads, and stops a project workspace with encoded identity fields", async () => {
    installWindowOrigin();
    const workspace = {
      rootPath: "C:/Projects/work tree",
      projectId: "project-1",
      repoId: "repo-1",
      branch: "av/sn-257",
      isDefaultBranch: false,
      requestedAccess: "editable" as const,
      ownerOpen: true,
      defaultBranchEditConfirmed: true,
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ready",
          url: "/api/jupyter/proxy/proxy-2/lab?token=workspace-token",
          pagePath: workspace.rootPath,
          rootPath: workspace.rootPath,
          accessMode: "editable",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", pagePath: workspace.rootPath }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ stopped: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(launchJupyterWorkspaceSession(workspace)).resolves.toMatchObject({
      accessMode: "editable",
      url: "http://100.104.185.31:57848/api/jupyter/proxy/proxy-2/lab?token=workspace-token",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/jupyter/workspace/session", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(workspace),
    }));

    await fetchJupyterWorkspaceSessionStatus(workspace);
    const statusUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(statusUrl).toContain("/api/jupyter/workspace/session?");
    expect(statusUrl).toContain("root=C%3A%2FProjects%2Fwork+tree");
    expect(statusUrl).toContain("branch=av%2Fsn-257");
    expect(statusUrl).toContain("requestedAccess=editable");
    expect(statusUrl).toContain("ownerOpen=true");
    expect(statusUrl).toContain("defaultBranchEditConfirmed=true");

    await expect(stopJupyterWorkspaceSession(workspace)).resolves.toEqual({ stopped: true });
    expect(fetchMock).toHaveBeenNthCalledWith(4, expect.stringContaining("root=C%3A%2FProjects%2Fwork+tree"), {
      method: "DELETE",
    });
  });
});

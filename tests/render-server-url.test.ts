import {
  getBoundListenPort,
  isDevRuntime,
  resolvePublicServerBaseUrl,
  resolveRenderServerBaseUrl,
  setBoundListenPort,
} from "@/server/render-server-url";

describe("render-server-url", () => {
  const previousPort = process.env.PORT;
  const previousBase = process.env.SMART_NOTES_RENDER_BASE_URL;
  const previousPublic = process.env.SMART_NOTES_PUBLIC_BASE_URL;

  afterEach(() => {
    if (previousPort) process.env.PORT = previousPort;
    else delete process.env.PORT;
    if (previousBase) process.env.SMART_NOTES_RENDER_BASE_URL = previousBase;
    else delete process.env.SMART_NOTES_RENDER_BASE_URL;
    if (previousPublic) process.env.SMART_NOTES_PUBLIC_BASE_URL = previousPublic;
    else delete process.env.SMART_NOTES_PUBLIC_BASE_URL;
    setBoundListenPort(0);
    delete (globalThis as { _smartNotesListenPort?: number })._smartNotesListenPort;
  });

  it("prefers the bound listen port over PORT env", () => {
    process.env.PORT = "3002";
    setBoundListenPort(58628);
    expect(resolveRenderServerBaseUrl()).toBe("http://127.0.0.1:58628");
  });

  it("honors SMART_NOTES_RENDER_BASE_URL override", () => {
    process.env.SMART_NOTES_RENDER_BASE_URL = "http://127.0.0.1:7777";
    expect(resolveRenderServerBaseUrl()).toBe("http://127.0.0.1:7777");
  });

  it("resolvePublicServerBaseUrl can differ from render loopback", () => {
    process.env.SMART_NOTES_RENDER_BASE_URL = "http://127.0.0.1:58628";
    process.env.SMART_NOTES_PUBLIC_BASE_URL = "http://127.0.0.1:5001";
    expect(resolvePublicServerBaseUrl()).toBe("http://127.0.0.1:5001");
  });

  it("detects dev runtime for preview inspect", () => {
    const previousLifecycle = process.env.npm_lifecycle_event;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.npm_lifecycle_event = "dev";
    process.env.NODE_ENV = "production";
    expect(isDevRuntime()).toBe(true);
    process.env.npm_lifecycle_event = previousLifecycle ?? "";
    if (previousNodeEnv) process.env.NODE_ENV = previousNodeEnv;
    else delete process.env.NODE_ENV;
  });

  it("reads global listen port set by server.js", () => {
    (globalThis as { _smartNotesListenPort?: number })._smartNotesListenPort = 3010;
    expect(getBoundListenPort()).toBe(3010);
  });
});

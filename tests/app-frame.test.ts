import {
  APP_FRAME_MAX_INFLIGHT_RPCS,
  APP_FRAME_MAX_MESSAGES_PER_WINDOW,
  APP_FRAME_MAX_HEIGHT,
  APP_FRAME_MESSAGE_SOURCE,
  AppFrameHostLimiter,
  AppFrameHostLimiterScope,
  buildAppSrcDoc,
  parseAppFrameMessage,
} from "@/lib/app-frame";
import { getAppTemplate } from "@/server/vault/app-templates";
import { JSDOM } from "jsdom";

function rpcMessage(requestId: string) {
  return {
    source: APP_FRAME_MESSAGE_SOURCE,
    nonce: "right",
    kind: "rpc" as const,
    requestId,
    tableId: "items",
    operation: "query" as const,
    query: {},
  };
}

describe("App opaque frame policy (SN-182)", () => {
  it("injects policy and bridge before authored markup with scripts but no same-origin authority", () => {
    const source = '<script data-authored>window.authored=true</script><img src="https://example.test/leak">';
    const doc = buildAppSrcDoc(source, "nonce-1", true);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("data-authored"));
    expect(doc.indexOf("data-smart-notes-app-bridge")).toBeLessThan(doc.indexOf("data-authored"));
    expect(doc).toContain("x-dns-prefetch-control");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("img-src data: blob:");
    expect(doc).toContain("font-src 'none'");
    expect(doc).toContain("media-src 'none'");
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("worker-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain("navigate-to 'none'");
    expect(doc).toContain("base-uri 'none'");
  });

  it("fails closed across imperative network APIs and removes refresh navigation", () => {
    const doc = buildAppSrcDoc("<p>App</p>", "nonce-2", true);
    for (const api of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "Worker", "SharedWorker"]) {
      expect(doc).toContain(api);
    }
    expect(doc).toContain("Too many outstanding App table requests");
    expect(doc).toContain('meta[http-equiv="refresh" i]');
    expect(doc).toContain("navigation-attempt");
    expect(doc).toContain("navigationApi.addEventListener('navigate'");
    expect(doc).not.toContain("event.hashChange");
    expect(doc).toContain("nativeReflectApply(nativePreventDefault, event, [])");
    expect(doc).toContain("document.addEventListener('submit'");
    expect(doc).toContain("if (isDefaultPrevented(event)) return;");
    expect(doc).not.toContain("document.addEventListener('submit', (event) => {\n    event.preventDefault(); post({ kind: 'navigation-attempt' });\n  }, true)");
  });

  it("dynamically intercepts all Navigation API navigation without trusting mutable event fields", () => {
    let navigate: ((event: Event & { hashChange: boolean }) => void) | undefined;
    const posted: unknown[] = [];
    const dom = new JSDOM(buildAppSrcDoc("<p>App</p>", "nonce-navigation", true), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "navigation", {
          value: { addEventListener: (type: string, listener: typeof navigate) => { if (type === "navigate") navigate = listener; } },
        });
        window.postMessage = ((message: unknown) => { posted.push(message); }) as typeof window.postMessage;
      },
    });
    expect(navigate).toBeDefined();
    const navigationEvent = new dom.window.Event("navigate", { cancelable: true }) as Event & { hashChange: boolean };
    Object.defineProperty(navigationEvent, "hashChange", { value: false });
    dom.window.Event.prototype.preventDefault = () => undefined;
    navigate?.(navigationEvent);
    expect(navigationEvent.defaultPrevented).toBe(true);
    expect(posted).toContainEqual(expect.objectContaining({ kind: "navigation-attempt", nonce: "nonce-navigation" }));
    const hashEvent = new dom.window.Event("navigate", { cancelable: true }) as Event & { hashChange: boolean };
    Object.defineProperty(hashEvent, "hashChange", { value: true });
    navigate?.(hashEvent);
    expect(hashEvent.defaultPrevented).toBe(true);
    dom.window.close();
  });

  it("withholds authored execution when Navigation API enforcement is unavailable", () => {
    const hostBlocked = buildAppSrcDoc('<script data-authored>window.authored=true</script>', "nonce-blocked", false);
    expect(hostBlocked).not.toContain("data-authored");
    expect(hostBlocked).toContain("data-smart-notes-app-unsupported");
  });

  it("authenticates frame messages by nonce, bounds height, and rejects malformed RPC", () => {
    expect(parseAppFrameMessage({ source: APP_FRAME_MESSAGE_SOURCE, nonce: "wrong", kind: "height", height: 500 }, "right")).toBeNull();
    expect(parseAppFrameMessage({ source: APP_FRAME_MESSAGE_SOURCE, nonce: "right", kind: "height", height: 999_999 }, "right")).toEqual(
      expect.objectContaining({ height: APP_FRAME_MAX_HEIGHT })
    );
    expect(parseAppFrameMessage({ ...rpcMessage("q_bad_table"), tableId: "bad/table" }, "right")).toBeNull();
    expect(parseAppFrameMessage({ ...rpcMessage("q_bad_operation"), operation: "execute" }, "right")).toBeNull();
    expect(parseAppFrameMessage({ ...rpcMessage("q_extra"), surprise: true }, "right")).toBeNull();
    expect(parseAppFrameMessage({ ...rpcMessage("q_wrong_shape"), rowId: "r_123456" }, "right")).toBeNull();
    expect(parseAppFrameMessage(rpcMessage("q_valid"), "right")).toEqual(rpcMessage("q_valid"));
    const accepted = { source: APP_FRAME_MESSAGE_SOURCE, nonce: "right", kind: "accept" as const, requestId: "q_accept", tableId: "entries", mutationId: "m_entry0001", values: { nested: { sets: [1] } } };
    expect(parseAppFrameMessage(accepted, "right")).toEqual(accepted);
    expect(parseAppFrameMessage({ ...accepted, mutationId: "bad" }, "right")).toBeNull();
    const upserted = { source: APP_FRAME_MESSAGE_SOURCE, nonce: "right", kind: "upsert" as const, requestId: "q_upsert", tableId: "drafts", mutationId: "m_draft0001", upsertKey: "workout", values: { kind: "workout" } };
    expect(parseAppFrameMessage(upserted, "right")).toEqual(upserted);
    expect(parseAppFrameMessage({ ...upserted, upsertKey: "bad key" }, "right")).toBeNull();
    expect(buildAppSrcDoc("<main />", "right", true)).toContain("accept: (tableId, values, mutationId, retire)");
    expect(buildAppSrcDoc("<main />", "right", true)).toContain("upsert: (tableId, upsertKey, values, mutationId)");
  });

  it("posts durable accept with the dedicated parseable bridge shape", () => {
    const posted: unknown[] = [];
    const dom = new JSDOM(buildAppSrcDoc("<main>App</main>", "nonce-accept", true), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "navigation", { value: { addEventListener: () => undefined } });
        window.postMessage = ((message: unknown) => { posted.push(message); }) as typeof window.postMessage;
      },
    });
    const app = (dom.window as unknown as { smartNotesApp: { accept: (tableId: string, values: unknown, mutationId: string) => Promise<unknown> } }).smartNotesApp;
    void app.accept("entries", { nested: { sets: [1] } }, "m_entry0001");
    const message = posted.find((candidate) => (candidate as { kind?: string }).kind === "accept");
    expect(message).toEqual(expect.objectContaining({ kind: "accept", tableId: "entries", mutationId: "m_entry0001" }));
    expect(parseAppFrameMessage(message, "nonce-accept")).toEqual(message);
    dom.window.close();
  });

  it("posts durable draft upserts and atomic accept retirement metadata", () => {
    const posted: unknown[] = [];
    const dom = new JSDOM(buildAppSrcDoc("<main>App</main>", "nonce-upsert", true), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "navigation", { value: { addEventListener: () => undefined } });
        window.postMessage = ((message: unknown) => { posted.push(message); }) as typeof window.postMessage;
      },
    });
    const app = (dom.window as unknown as { smartNotesApp: {
      upsert: (tableId: string, upsertKey: string, values: unknown, mutationId: string) => Promise<unknown>;
      accept: (tableId: string, values: unknown, mutationId: string, retire: unknown) => Promise<unknown>;
    } }).smartNotesApp;
    void app.upsert("drafts", "workout", { kind: "workout" }, "m_draft0001");
    void app.accept("entries", { value: 1 }, "m_entry0001", {
      tableId: "drafts", upsertKey: "workout", mutationId: "m_retire001", values: { kind: "retired" },
    });
    const upsert = posted.find((candidate) => (candidate as { kind?: string }).kind === "upsert");
    const accept = posted.find((candidate) => (candidate as { kind?: string }).kind === "accept");
    expect(parseAppFrameMessage(upsert, "nonce-upsert")).toEqual(upsert);
    expect(parseAppFrameMessage(accept, "nonce-upsert")).toEqual(accept);
    dom.window.close();
  });

  it("enforces host message-rate, duplicate-request, and in-flight limits", () => {
    const duplicateLimiter = new AppFrameHostLimiter();
    expect(duplicateLimiter.admit(rpcMessage("q_duplicate"), 100)).toBeNull();
    expect(duplicateLimiter.admit(rpcMessage("q_duplicate"), 101)).toMatch(/Duplicate/);

    const inflightLimiter = new AppFrameHostLimiter();
    for (let index = 0; index < APP_FRAME_MAX_INFLIGHT_RPCS; index += 1) {
      expect(inflightLimiter.admit(rpcMessage(`q_inflight_${index}`), 100)).toBeNull();
    }
    expect(inflightLimiter.admit(rpcMessage("q_one_too_many"), 100)).toMatch(/in-flight/);

    const rateLimiter = new AppFrameHostLimiter();
    const heartbeat = { source: APP_FRAME_MESSAGE_SOURCE, nonce: "right", kind: "heartbeat" as const };
    for (let index = 0; index < APP_FRAME_MAX_MESSAGES_PER_WINDOW; index += 1) {
      expect(rateLimiter.admit(heartbeat, 100)).toBeNull();
    }
    expect(rateLimiter.admit(heartbeat, 100)).toMatch(/rate limit/);
  });

  it("persists limiter state across host refreshes and resets only for a new frame identity", () => {
    const scope = new AppFrameHostLimiterScope();
    const first = scope.forFrame("Notebook/App.html", "nonce-a");
    expect(first.admit(rpcMessage("q_persisted"), 100)).toBeNull();
    expect(scope.forFrame("Notebook/App.html", "nonce-a")).toBe(first);
    expect(scope.forFrame("Notebook/App.html", "nonce-a").admit(rpcMessage("q_persisted"), 101)).toMatch(/Duplicate/);
    expect(scope.forFrame("Notebook/App.html", "nonce-b")).not.toBe(first);
    expect(scope.forFrame("Notebook/App.html", "nonce-b").admit(rpcMessage("q_persisted"), 102)).toBeNull();
  });

  it("keeps maintained Custom Log form handling while the bridge blocks native form navigation", () => {
    const template = getAppTemplate("custom-log-app");
    expect(template.source).toContain("form.onsubmit=async event=>{event.preventDefault();await smartNotesApp.add");
    const doc = buildAppSrcDoc(template.source, "nonce-log", true);
    expect(doc.indexOf("document.addEventListener('submit'")).toBeLessThan(doc.indexOf("form.onsubmit=async"));
    expect(doc).toContain("form-action 'none'");
    const posted: Array<{ kind?: string }> = [];
    const dom = new JSDOM(doc, {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.defineProperty(window, "navigation", { value: { addEventListener: () => undefined } });
        window.postMessage = ((message: { kind?: string }) => { posted.push(message); }) as typeof window.postMessage;
      },
    });
    const form = dom.window.document.querySelector("#entry-form") as HTMLFormElement | null;
    expect(typeof form?.onsubmit).toBe("function");
    Object.defineProperty(dom.window.Event.prototype, "defaultPrevented", { configurable: true, get: () => false });
    form?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    expect(posted.some((message) => message.kind === "navigation-attempt")).toBe(false);
    dom.window.close();
  });
});

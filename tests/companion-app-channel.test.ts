import {
  deliverCompanionAppMessage,
  type CompanionAppChannel,
} from "@/server/vault/companion-app-channel";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCompanionAppChannel } = require("../server/companion-app-channel.js") as {
  createCompanionAppChannel: (opts: {
    io: { emit: (event: string, data: unknown) => void };
    timeoutMs?: number;
  }) => {
    deliver: (input: { path: string; message: unknown; timeoutMs?: number }) => Promise<{
      delivered: boolean;
      instances: number;
    }>;
    ack: (deliveryId: string, clientId?: string) => void;
    attach: (socket: unknown) => void;
  };
};

describe("SN-203 deliverCompanionAppMessage routing", () => {
  it("reports a running instance when the channel delivers", async () => {
    const channel: CompanionAppChannel = {
      deliver: jest.fn().mockResolvedValue({ delivered: true, instances: 2 }),
    };
    const result = await deliverCompanionAppMessage(
      "Health/Strength/tracker.html",
      { advice: "add a warmup set" },
      { channel }
    );
    expect(result).toMatchObject({ delivered: true, instances: 2, path: "Health/Strength/tracker.html" });
    expect(channel.deliver).toHaveBeenCalledWith({
      path: "Health/Strength/tracker.html",
      message: { advice: "add a warmup set" },
    });
  });

  it("routes to a cross-page target purely by its path", async () => {
    const channel: CompanionAppChannel = {
      deliver: jest.fn().mockResolvedValue({ delivered: true, instances: 1 }),
    };
    // The focused/current page is irrelevant here: routing is by target path only.
    await deliverCompanionAppMessage("Other Notebook/Section/remote-app.html", { ping: true }, { channel });
    expect(channel.deliver).toHaveBeenCalledWith({
      path: "Other Notebook/Section/remote-app.html",
      message: { ping: true },
    });
  });

  it("returns a clear, non-queuing 'app not running' result when no instance acks", async () => {
    const channel: CompanionAppChannel = {
      deliver: jest.fn().mockResolvedValue({ delivered: false, instances: 0 }),
    };
    const result = await deliverCompanionAppMessage("Notebook/app.html", { x: 1 }, { channel });
    expect(result.delivered).toBe(false);
    expect(result.instances).toBe(0);
    expect(result.hint).toContain("app not running");
    expect(result.hint).toContain("not queued");
  });

  it("returns a graceful result when no socket channel exists", async () => {
    const result = await deliverCompanionAppMessage("Notebook/app.html", { x: 1 }, { channel: null });
    expect(result.delivered).toBe(false);
    expect(result.hint).toContain("not available");
  });

  it("rejects malformed or oversized input before touching the channel", async () => {
    const channel: CompanionAppChannel = { deliver: jest.fn() };
    await expect(deliverCompanionAppMessage("https://evil.test/x", {}, { channel })).rejects.toThrow();
    await expect(deliverCompanionAppMessage("../escape.html", {}, { channel })).rejects.toThrow();
    const huge = "z".repeat(2 * 1024 * 1024);
    await expect(deliverCompanionAppMessage("Notebook/app.html", { huge }, { channel })).rejects.toThrow();
    expect(channel.deliver).not.toHaveBeenCalled();
  });
});

describe("SN-203 createCompanionAppChannel socket coordinator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("broadcasts a deliver request and resolves delivered once an instance acks", async () => {
    const emitted: Array<{ event: string; data: { deliveryId: string; path: string; message: unknown } }> = [];
    const io = { emit: (event: string, data: unknown) => emitted.push({ event, data: data as never }) };
    const channel = createCompanionAppChannel({ io, timeoutMs: 1000 });

    const pending = channel.deliver({ path: "Notebook/app.html", message: { hi: true } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ event: "companion_app_deliver", data: { path: "Notebook/app.html" } });

    // A running client acks; delivery resolves immediately rather than holding
    // the companion turn open for the rest of the timeout window.
    channel.ack(emitted[0]!.data.deliveryId, "client-1");
    await expect(pending).resolves.toEqual({ delivered: true, instances: 1 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("resolves not-running when the window elapses with no ack", async () => {
    const io = { emit: jest.fn() };
    const channel = createCompanionAppChannel({ io, timeoutMs: 500 });
    const pending = channel.deliver({ path: "Notebook/app.html", message: {} });
    jest.advanceTimersByTime(500);
    await expect(pending).resolves.toEqual({ delivered: false, instances: 0 });
  });

  it("settles on the first running instance while broadcasting cross-tab", async () => {
    const emitted: Array<{ deliveryId: string }> = [];
    const io = { emit: (_event: string, data: unknown) => emitted.push(data as { deliveryId: string }) };
    const channel = createCompanionAppChannel({ io, timeoutMs: 800 });
    const pending = channel.deliver({ path: "Notebook/app.html", message: {} });
    channel.ack(emitted[0]!.deliveryId, "tab-A");
    await expect(pending).resolves.toEqual({ delivered: true, instances: 1 });
    // Late acks are ignored after settlement; io.emit already broadcast the
    // delivery request to every connected browser client.
    channel.ack(emitted[0]!.deliveryId, "tab-B");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("returns channel-unavailable without a usable io", async () => {
    const channel = createCompanionAppChannel({ io: undefined as never });
    await expect(channel.deliver({ path: "Notebook/app.html", message: {} })).resolves.toMatchObject({
      delivered: false,
      instances: 0,
    });
  });
});

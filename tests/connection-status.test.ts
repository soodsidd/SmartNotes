/**
 * @jest-environment node
 */

import {
  CONNECTION_LOST_MESSAGE,
  __resetConnectionStatusForTests,
  getConnectionState,
  recordWriteFailure,
  recordWriteSuccess,
  vaultWriteFetch,
} from "@/lib/connection-status";

describe("vault-write connection status (SN-85)", () => {
  beforeEach(() => {
    __resetConnectionStatusForTests();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).fetch;
  });

  it("starts in the ok state with no message", () => {
    expect(getConnectionState()).toEqual({ status: "ok", message: null });
  });

  it("raises a sticky connection-lost signal on write failure", () => {
    recordWriteFailure();
    expect(getConnectionState()).toEqual({
      status: "lost",
      message: CONNECTION_LOST_MESSAGE,
    });
  });

  it("clears the signal only when a write succeeds", () => {
    recordWriteFailure();
    expect(getConnectionState().status).toBe("lost");
    recordWriteSuccess();
    expect(getConnectionState()).toEqual({ status: "ok", message: null });
  });

  it("vaultWriteFetch records failure on a 5xx response and rethrows nothing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const response = await vaultWriteFetch("/api/page", { method: "PUT" });
    expect(response.ok).toBe(false);
    expect(getConnectionState().status).toBe("lost");
  });

  it("vaultWriteFetch does NOT raise connection-lost for a 4xx response (SN-83)", async () => {
    // A 409 means the server responded — connection is alive, only a business-logic rejection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 409 });
    const response = await vaultWriteFetch("/api/notebook", { method: "POST" });
    expect(response.ok).toBe(false);
    expect(getConnectionState().status).toBe("ok");
  });

  it("vaultWriteFetch records failure when the network throws and rethrows", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(vaultWriteFetch("/api/page", { method: "PUT" })).rejects.toThrow(
      "Failed to fetch"
    );
    expect(getConnectionState().status).toBe("lost");
  });

  it("vaultWriteFetch clears the signal on a 2xx response", async () => {
    recordWriteFailure();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    await vaultWriteFetch("/api/page", { method: "PUT" });
    expect(getConnectionState()).toEqual({ status: "ok", message: null });
  });
});

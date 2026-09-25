import { validateAppTableAcceptance } from "@/lib/app-contract";

const appTable = {
  kind: "app" as const,
  schema: { fields: [
    { id: "type", name: "Type", type: "select" as const, required: true, options: ["workout", "nutrition"] },
    { id: "details", name: "Details", type: "text" as const, required: true },
    { id: "duration", name: "Duration", type: "number" as const },
  ] },
};

describe("generic durable App acceptance preflight", () => {
  it("returns server-shaped values only for a declared app-owned valid row", () => {
    expect(validateAppTableAcceptance(appTable, { type: "workout", details: { sets: [{ reps: 8 }] }, duration: "35" }))
      .toEqual({ type: "workout", details: { sets: [{ reps: 8 }] }, duration: 35 });
  });

  it("rejects invalid attachments, fields, required values, selects, and oversized JSON before outbox storage", () => {
    expect(() => validateAppTableAcceptance(undefined, {})).toThrow(/not declared/);
    expect(() => validateAppTableAcceptance({ ...appTable, kind: "log" }, {})).toThrow(/app-owned/);
    expect(() => validateAppTableAcceptance(appTable, { type: "workout", details: {}, surprise: true })).toThrow(/Unknown fields/);
    expect(() => validateAppTableAcceptance(appTable, { type: "workout" })).toThrow(/Missing required fields/);
    expect(() => validateAppTableAcceptance(appTable, { type: "unsupported", details: {} })).toThrow(/Invalid option/);
    expect(() => validateAppTableAcceptance(appTable, { type: "workout", details: "x".repeat(300_000) })).toThrow(/exceeds/);
  });
});

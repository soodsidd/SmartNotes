import { safeRandomUUID } from "@/lib/safe-random-uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("safeRandomUUID", () => {
  it("uses native randomUUID when the browser exposes it", () => {
    const nativeUuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(safeRandomUUID({ randomUUID: () => nativeUuid })).toBe(nativeUuid);
  });

  it("creates a valid UUIDv4 on insecure origins that only expose getRandomValues", () => {
    const uuid = safeRandomUUID({
      getRandomValues: ((bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      }) as Crypto["getRandomValues"],
    });

    expect(uuid).toBe("abababab-abab-4bab-abab-abababababab");
    expect(uuid).toMatch(UUID_V4);
  });

  it("keeps the server UUID contract when Web Crypto is unavailable", () => {
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(safeRandomUUID(null)).toMatch(UUID_V4);
    } finally {
      random.mockRestore();
    }
  });
});

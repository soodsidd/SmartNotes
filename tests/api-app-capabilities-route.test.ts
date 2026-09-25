import { GET } from "@/app/api/app/capabilities/route";
import { APP_RPC_OPERATIONS } from "@/lib/app-contract";

describe("App runtime capability endpoint", () => {
  it("advertises the versioned generic App contract without requiring a converted page", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      capability: "smart-notes.app-pages",
      version: 2,
      manifestVersion: 1,
      rpcOperations: [...APP_RPC_OPERATIONS],
    });
  });
});

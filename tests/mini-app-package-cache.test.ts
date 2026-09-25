/** @jest-environment node */

import type { AppBootstrapResponse } from "@/lib/api/app";
import {
  MINI_APP_PACKAGE_MAX_BYTES,
  MINI_APP_PACKAGE_MAX_RECENT,
  planMiniAppPackageRetention,
  queryMiniAppPackage,
  readMiniAppPackage,
  resolveMiniAppBootstrap,
  setMiniAppPackagePinned,
  writeMiniAppPackage,
  type MiniAppPackage,
} from "@/lib/mini-app-package-cache";

function requestKey(request: RequestInfo | URL): string {
  if (request instanceof Request) return request.url;
  return String(request);
}

function createMemoryCaches(): CacheStorage {
  const buckets = new Map<string, Map<string, Response>>();
  return {
    async open(name: string) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const entries = buckets.get(name)!;
      return {
        async match(request: RequestInfo | URL) {
          return entries.get(requestKey(request))?.clone();
        },
        async put(request: RequestInfo | URL, response: Response) {
          entries.set(requestKey(request), response.clone());
        },
        async delete(request: RequestInfo | URL) {
          return entries.delete(requestKey(request));
        },
        async keys() {
          return [...entries.keys()].map((key) => new Request(key));
        },
      } as Cache;
    },
    async has(name: string) { return buckets.has(name); },
    async delete(name: string) { return buckets.delete(name); },
    async keys() { return [...buckets.keys()]; },
    async match() { return undefined; },
  } as CacheStorage;
}

function bootstrap(path: string, revision = "sha256:one"): AppBootstrapResponse {
  return {
    page: { path, title: path.split("/").at(-1) ?? path, body: `<main>${path}</main>` },
    manifest: {
      version: 1,
      enabled: true,
      tables: [{
        id: "entries",
        name: "Entries",
        kind: "app",
        schema: { fields: [
          { id: "kind", name: "Kind", type: "select", options: ["workout", "nutrition"] },
          { id: "minutes", name: "Minutes", type: "number" },
        ] },
      }],
    },
    tables: [{
      id: "entries",
      name: "Entries",
      kind: "app",
      version: 1,
      schema: { fields: [
        { id: "kind", name: "Kind", type: "select", options: ["workout", "nutrition"] },
        { id: "minutes", name: "Minutes", type: "number" },
      ] },
      rows: [
        { id: "r_1", createdAt: "2026-09-14T10:00:00.000Z", values: { kind: "workout", minutes: 30 } },
        { id: "r_2", createdAt: "2026-09-14T11:00:00.000Z", values: { kind: "nutrition", minutes: 0 } },
      ],
    }],
    revision,
    etag: `"${revision}"`,
    sessionToken: "live-session",
    sessionExpiresAt: "2026-09-14T12:30:00.000Z",
  };
}

function packageRecord(path: string, pinned: boolean, lastOpenedAt: string, byteSize = 100): MiniAppPackage {
  const value = bootstrap(path);
  return {
    version: 1,
    path,
    title: value.page.title,
    source: value.page.body,
    manifest: value.manifest,
    tables: value.tables,
    revision: value.revision,
    etag: value.etag,
    capturedAt: lastOpenedAt,
    lastOpenedAt,
    pinned,
    byteSize,
  };
}

describe("mini-App device packages", () => {
  it("writes and restores source, manifest, last-good data, revision, and pin metadata", async () => {
    const cachesImpl = createMemoryCaches();
    const written = await writeMiniAppPackage(bootstrap("Health/Workout.html"), {
      cachesImpl,
      now: () => new Date("2026-09-14T12:00:00.000Z"),
    });
    expect(written).toMatchObject({
      path: "Health/Workout.html",
      source: "<main>Health/Workout.html</main>",
      revision: "sha256:one",
      etag: '"sha256:one"',
      pinned: false,
    });
    expect(written?.tables[0].rows).toHaveLength(2);

    const pinned = await setMiniAppPackagePinned("Health/Workout.html", true, { cachesImpl });
    expect(pinned.pinned).toBe(true);
    const refreshed = await writeMiniAppPackage(bootstrap("Health/Workout.html", "sha256:two"), { cachesImpl });
    expect(refreshed).toMatchObject({ pinned: true, revision: "sha256:two" });
    expect((await readMiniAppPackage("Health/Workout.html", { cachesImpl }))?.revision).toBe("sha256:two");
  });

  it("keeps pinned packages and only the four most-recent unpinned packages", () => {
    const packages = [
      packageRecord("Pinned.html", true, "2026-09-14T00:00:00.000Z"),
      ...Array.from({ length: MINI_APP_PACKAGE_MAX_RECENT + 2 }, (_, index) =>
        packageRecord(`Recent-${index}.html`, false, `2026-09-14T0${index + 1}:00:00.000Z`)
      ),
    ];
    const plan = planMiniAppPackageRetention(packages);
    expect(plan.kept.map((item) => item.path)).toContain("Pinned.html");
    expect(plan.kept.filter((item) => !item.pinned)).toHaveLength(MINI_APP_PACKAGE_MAX_RECENT);
    expect(plan.evicted.map((item) => item.path)).toEqual(["Recent-0.html", "Recent-1.html"]);
  });

  it("honors the 25 MiB cap and refuses a pinned set that cannot fit", () => {
    const pinned = packageRecord("Pinned.html", true, "2026-09-14T00:00:00.000Z", MINI_APP_PACKAGE_MAX_BYTES - 100);
    const recent = packageRecord("Recent.html", false, "2026-09-14T01:00:00.000Z", 101);
    expect(planMiniAppPackageRetention([pinned, recent]).evicted).toEqual([recent]);
    expect(() => planMiniAppPackageRetention([
      packageRecord("Pinned-a.html", true, "2026-09-14T00:00:00.000Z", MINI_APP_PACKAGE_MAX_BYTES),
      packageRecord("Pinned-b.html", true, "2026-09-14T01:00:00.000Z", 1),
    ])).toThrow(/25 MiB/);
  });

  it("opens immediately from the package while offline without attempting bootstrap", async () => {
    const cachesImpl = createMemoryCaches();
    await writeMiniAppPackage(bootstrap("Health/Workout.html"), { cachesImpl });
    const fetchLive = jest.fn(async () => bootstrap("Health/Workout.html", "sha256:live"));
    const resolved = await resolveMiniAppBootstrap("Health/Workout.html", fetchLive, {
      cachesImpl,
      online: false,
    });
    expect(fetchLive).not.toHaveBeenCalled();
    expect(resolved.mode).toBe("local");
    expect(resolved.bootstrap.sessionToken).toBe("");
    expect(resolved.bootstrap.page.body).toContain("Workout");
  });

  it("falls back to the last-good package when live bootstrap exceeds its deadline", async () => {
    const cachesImpl = createMemoryCaches();
    await writeMiniAppPackage(bootstrap("Health/Workout.html"), { cachesImpl });
    let signal: AbortSignal | undefined;
    const fetchLive = jest.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<AppBootstrapResponse>(() => undefined);
    });
    const resolved = await resolveMiniAppBootstrap("Health/Workout.html", fetchLive, {
      cachesImpl,
      online: true,
      timeoutMs: 5,
    });
    expect(signal?.aborted).toBe(true);
    expect(resolved.mode).toBe("local");
    expect(resolved.fallbackReason).toMatchObject({ name: "TimeoutError" });
  });

  it("uses a recovered live bootstrap and refreshes the stored revision", async () => {
    const cachesImpl = createMemoryCaches();
    await writeMiniAppPackage(bootstrap("Health/Workout.html"), { cachesImpl });
    const resolved = await resolveMiniAppBootstrap(
      "Health/Workout.html",
      async () => bootstrap("Health/Workout.html", "sha256:fresh"),
      { cachesImpl, online: true }
    );
    expect(resolved.mode).toBe("synced");
    expect(resolved.bootstrap.sessionToken).toBe("live-session");
    expect((await readMiniAppPackage("Health/Workout.html", { cachesImpl }))?.revision).toBe("sha256:fresh");
  });

  it("can return live data without replacing the device package while local mutations need reconciliation", async () => {
    const cachesImpl = createMemoryCaches();
    await writeMiniAppPackage(bootstrap("Health/Workout.html", "sha256:local"), { cachesImpl });
    const resolved = await resolveMiniAppBootstrap(
      "Health/Workout.html",
      async () => ({
        ...bootstrap("Health/Workout.html", "sha256:server"),
        page: { path: "Health/Workout.html", title: "Workout.html", body: "<main>Changed server source</main>" },
      }),
      { cachesImpl, online: true, persistLive: false }
    );
    expect(resolved.mode).toBe("synced");
    expect(resolved.bootstrap.revision).toBe("sha256:server");
    expect((await readMiniAppPackage("Health/Workout.html", { cachesImpl, touch: false }))?.revision).toBe("sha256:local");
  });

  it("answers bounded offline queries from the package snapshot", async () => {
    const cachesImpl = createMemoryCaches();
    const stored = await writeMiniAppPackage(bootstrap("Health/Workout.html"), { cachesImpl });
    expect(stored).not.toBeNull();
    const result = queryMiniAppPackage(stored!, "entries", { where: { kind: "workout" }, limit: 1 }) as { rows: unknown[] };
    expect(result.rows).toHaveLength(1);
    expect(() => queryMiniAppPackage(stored!, "entries", { limit: 201 })).toThrow(/1 to 200/);
    expect(() => queryMiniAppPackage(stored!, "private", {})).toThrow(/not included/);
  });
});

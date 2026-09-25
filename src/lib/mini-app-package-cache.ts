import type { AppManifest, AppTableSnapshot } from "@/lib/app-contract";
import type { AppBootstrapResponse, AppDataSnapshotResponse } from "@/lib/api/app";

export const MINI_APP_PACKAGE_CACHE_NAME = "smart-notes-mini-app-packages-v1";
export const MINI_APP_PACKAGE_MAX_BYTES = 25 * 1024 * 1024;
export const MINI_APP_PACKAGE_MAX_ENTRIES = 12;
export const MINI_APP_PACKAGE_MAX_RECENT = 4;
export const MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS = 4000;

export interface MiniAppPackage {
  version: 1;
  path: string;
  title: string;
  source: string;
  manifest: AppManifest;
  tables: AppTableSnapshot[];
  revision: string;
  etag: string | null;
  capturedAt: string;
  lastOpenedAt: string;
  pinned: boolean;
  byteSize: number;
}

interface PackageCacheOptions {
  cachesImpl?: CacheStorage | null;
  now?: () => Date;
}

interface WritePackageOptions extends PackageCacheOptions {
  pinned?: boolean;
}

export interface MiniAppPackageRetentionPlan {
  kept: MiniAppPackage[];
  evicted: MiniAppPackage[];
}

export interface ResolvedMiniAppBootstrap {
  bootstrap: AppBootstrapResponse;
  package: MiniAppPackage | null;
  mode: "local" | "synced";
  fallbackReason?: unknown;
  packageError?: unknown;
}

function resolveCaches(cachesImpl: CacheStorage | null | undefined): CacheStorage | null {
  if (cachesImpl === null) return null;
  if (cachesImpl) return cachesImpl;
  return typeof caches === "undefined" ? null : caches;
}

function packageCacheKey(path: string): string {
  const origin = typeof location === "undefined" ? "https://smart-notes.local" : location.origin;
  return `${origin}/__smart-notes/mini-app-package?path=${encodeURIComponent(path)}`;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function withMeasuredByteSize(value: Omit<MiniAppPackage, "byteSize"> | MiniAppPackage): MiniAppPackage {
  const measured = { ...value, byteSize: 0 } as MiniAppPackage;
  // The decimal byteSize field contributes to its own serialized length. It
  // stabilizes in at most a couple of passes, but keep a small hard bound.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = serializedBytes(measured);
    if (next === measured.byteSize) break;
    measured.byteSize = next;
  }
  return measured;
}

function isMiniAppPackage(value: unknown): value is MiniAppPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<MiniAppPackage>;
  return item.version === 1
    && typeof item.path === "string"
    && typeof item.title === "string"
    && typeof item.source === "string"
    && Boolean(item.manifest && typeof item.manifest === "object")
    && Array.isArray(item.tables)
    && typeof item.revision === "string"
    && (typeof item.etag === "string" || item.etag === null)
    && typeof item.capturedAt === "string"
    && typeof item.lastOpenedAt === "string"
    && typeof item.pinned === "boolean"
    && Number.isFinite(item.byteSize);
}

function packageFromSnapshot(
  snapshot: AppBootstrapResponse | AppDataSnapshotResponse,
  pinned: boolean,
  now: Date
): MiniAppPackage {
  const withoutSize = {
    version: 1 as const,
    path: snapshot.page.path,
    title: snapshot.page.title,
    source: snapshot.page.body,
    manifest: snapshot.manifest,
    tables: snapshot.tables,
    revision: snapshot.revision,
    etag: snapshot.etag,
    capturedAt: now.toISOString(),
    lastOpenedAt: now.toISOString(),
    pinned,
  };
  return withMeasuredByteSize(withoutSize);
}

function oldestFirst(left: MiniAppPackage, right: MiniAppPackage): number {
  return left.lastOpenedAt.localeCompare(right.lastOpenedAt) || left.path.localeCompare(right.path);
}

export function planMiniAppPackageRetention(packages: MiniAppPackage[]): MiniAppPackageRetentionPlan {
  const pinned = packages.filter((item) => item.pinned);
  const pinnedBytes = pinned.reduce((total, item) => total + item.byteSize, 0);
  if (pinned.length > MINI_APP_PACKAGE_MAX_ENTRIES || pinnedBytes > MINI_APP_PACKAGE_MAX_BYTES) {
    throw new Error("Kept offline Apps exceed the 25 MiB device package limit. Remove one before keeping another.");
  }

  const kept = [...pinned];
  let keptBytes = pinnedBytes;
  const recent = packages.filter((item) => !item.pinned).sort(oldestFirst).reverse();
  for (const item of recent) {
    if (
      kept.filter((candidate) => !candidate.pinned).length >= MINI_APP_PACKAGE_MAX_RECENT
      || kept.length >= MINI_APP_PACKAGE_MAX_ENTRIES
      || keptBytes + item.byteSize > MINI_APP_PACKAGE_MAX_BYTES
    ) continue;
    kept.push(item);
    keptBytes += item.byteSize;
  }
  const keptPaths = new Set(kept.map((item) => item.path));
  return { kept, evicted: packages.filter((item) => !keptPaths.has(item.path)) };
}

async function readAllPackages(cache: Cache): Promise<MiniAppPackage[]> {
  const packages: MiniAppPackage[] = [];
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    const value = await response.json().catch(() => null);
    if (isMiniAppPackage(value)) packages.push(value);
  }
  return packages;
}

async function putPackage(cache: Cache, value: MiniAppPackage): Promise<void> {
  await cache.put(packageCacheKey(value.path), new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  }));
}

export async function writeMiniAppPackage(
  snapshot: AppBootstrapResponse | AppDataSnapshotResponse,
  options: WritePackageOptions = {}
): Promise<MiniAppPackage | null> {
  const store = resolveCaches(options.cachesImpl);
  if (!store) return null;
  const cache = await store.open(MINI_APP_PACKAGE_CACHE_NAME);
  const existing = await readMiniAppPackage(snapshot.page.path, { ...options, touch: false });
  const candidate = packageFromSnapshot(snapshot, options.pinned ?? existing?.pinned ?? false, (options.now ?? (() => new Date()))());
  if (candidate.byteSize > MINI_APP_PACKAGE_MAX_BYTES) {
    throw new Error("This App package is larger than the 25 MiB device package limit.");
  }
  const all = (await readAllPackages(cache)).filter((item) => item.path !== candidate.path);
  const plan = planMiniAppPackageRetention([...all, candidate]);
  if (!plan.kept.some((item) => item.path === candidate.path)) return null;
  await putPackage(cache, candidate);
  await Promise.all(plan.evicted.map((item) => cache.delete(packageCacheKey(item.path))));
  return candidate;
}

export async function readMiniAppPackage(
  path: string,
  options: PackageCacheOptions & { touch?: boolean } = {}
): Promise<MiniAppPackage | null> {
  const store = resolveCaches(options.cachesImpl);
  if (!store) return null;
  const cache = await store.open(MINI_APP_PACKAGE_CACHE_NAME);
  const response = await cache.match(packageCacheKey(path));
  if (!response) return null;
  const value = await response.json().catch(() => null);
  if (!isMiniAppPackage(value)) {
    await cache.delete(packageCacheKey(path));
    return null;
  }
  if (options.touch === false) return value;
  const touched = withMeasuredByteSize({
    ...value,
    lastOpenedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  await putPackage(cache, touched);
  return touched;
}

export async function setMiniAppPackagePinned(
  path: string,
  pinned: boolean,
  options: PackageCacheOptions = {}
): Promise<MiniAppPackage> {
  const store = resolveCaches(options.cachesImpl);
  if (!store) throw new Error("Offline App packages are not supported by this browser.");
  const cache = await store.open(MINI_APP_PACKAGE_CACHE_NAME);
  const current = await readMiniAppPackage(path, { ...options, touch: false });
  if (!current) throw new Error("Open this App online once before keeping it offline.");
  const updated = withMeasuredByteSize({
    ...current,
    pinned,
    lastOpenedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  const all = (await readAllPackages(cache)).filter((item) => item.path !== path);
  const plan = planMiniAppPackageRetention([...all, updated]);
  if (!plan.kept.some((item) => item.path === path)) {
    throw new Error("This App cannot fit within the 25 MiB device package limit.");
  }
  await putPackage(cache, updated);
  await Promise.all(plan.evicted.map((item) => cache.delete(packageCacheKey(item.path))));
  return updated;
}

export function miniAppPackageAsBootstrap(value: MiniAppPackage): AppBootstrapResponse {
  return {
    page: { path: value.path, title: value.title, body: value.source },
    manifest: value.manifest,
    tables: value.tables,
    revision: value.revision,
    etag: value.etag,
    sessionToken: "",
    sessionExpiresAt: "",
  };
}

export function queryMiniAppPackage(
  value: MiniAppPackage,
  tableId: string,
  rawQuery: unknown = {}
): unknown {
  const table = value.tables.find((candidate) => candidate.id === tableId);
  if (!table) throw new Error("That table is not included in the Local App package.");
  if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) throw new Error("query must be an object.");
  const query = rawQuery as { where?: unknown; limit?: unknown };
  const unsupported = Object.keys(query).filter((key) => key !== "where" && key !== "limit");
  if (unsupported.length) throw new Error(`Unsupported query keys: ${unsupported.join(", ")}`);
  const where = query.where === undefined ? {} : query.where;
  if (!where || typeof where !== "object" || Array.isArray(where)) throw new Error("query.where must be an object.");
  const allowed = new Set(table.schema.fields.map((field) => field.id));
  const unknown = Object.keys(where).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown query fields: ${unknown.join(", ")}`);
  const limit = query.limit === undefined ? 200 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("query.limit must be an integer from 1 to 200.");
  const rows = table.rows
    .filter((row) => Object.entries(where).every(([key, expected]) => Object.is(row.values[key], expected)))
    .slice(0, limit);
  return { table: { id: table.id, name: table.name, kind: table.kind, schema: table.schema }, rows };
}

export async function withMiniAppBootstrapTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("App bootstrap timed out.", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveMiniAppBootstrap(
  path: string,
  fetchLive: (signal: AbortSignal) => Promise<AppBootstrapResponse>,
  options: PackageCacheOptions & { online?: boolean; timeoutMs?: number; persistLive?: boolean } = {}
): Promise<ResolvedMiniAppBootstrap> {
  let fallbackReason: unknown = new Error("The device is offline.");
  const online = options.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  if (online) {
    try {
      const bootstrap = await withMiniAppBootstrapTimeout(
        fetchLive,
        options.timeoutMs ?? MINI_APP_PACKAGE_BOOTSTRAP_TIMEOUT_MS
      );
      if (options.persistLive === false) {
        const available = await readMiniAppPackage(path, { ...options, touch: false }).catch(() => null);
        return { bootstrap, package: available, mode: "synced" };
      }
      try {
        const stored = await writeMiniAppPackage(bootstrap, options);
        const available = stored ?? await readMiniAppPackage(path, { ...options, touch: false });
        return { bootstrap, package: available, mode: "synced" };
      } catch (packageError) {
        const available = await readMiniAppPackage(path, { ...options, touch: false }).catch(() => null);
        return { bootstrap, package: available, mode: "synced", packageError };
      }
    } catch (error) {
      fallbackReason = error;
    }
  }
  const stored = await readMiniAppPackage(path, options);
  if (!stored) throw fallbackReason;
  return {
    bootstrap: miniAppPackageAsBootstrap(stored),
    package: stored,
    mode: "local",
    fallbackReason,
  };
}

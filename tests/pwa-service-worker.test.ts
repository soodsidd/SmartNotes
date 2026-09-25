/**
 * @jest-environment node
 */

import fs from "fs";
import path from "path";

describe("service worker shell caching", () => {
  const serviceWorkerPath = path.resolve(__dirname, "../public/service-worker.js");
  const templatePath = path.resolve(__dirname, "../scripts/service-worker.template.js");
  const generatorPath = path.resolve(__dirname, "../scripts/generate-service-worker.mjs");

  it("keeps note data network-backed while caching the static shell", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");

    expect(serviceWorker).toContain('requestUrl.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('requestUrl.pathname.startsWith("/vault/")');
    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).toContain('requestUrl.pathname.startsWith("/_next/static/")');
  });

  it("versions cache buckets with the build id instead of fixed v1 names", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    expect(template).toContain('const BUILD_ID = "__BUILD_ID__"');
    expect(template).toContain("smart-notes-app-shell-${BUILD_ID}");
    expect(template).toContain("smart-notes-static-${BUILD_ID}");
    expect(serviceWorker).not.toContain("smart-notes-app-shell-v1");
    expect(serviceWorker).not.toContain("smart-notes-runtime-v1");
    expect(serviceWorker).toMatch(/smart-notes-app-shell-[^\s"']+/);
    expect(serviceWorker).toMatch(/smart-notes-static-[^\s"']+/);
  });

  it("reads the build id from the active Next dist directory", () => {
    const generator = fs.readFileSync(generatorPath, "utf8");

    expect(generator).toContain("process.env.SMART_NOTES_NEXT_DIST_DIR");
    expect(generator).toContain('|| ".next"');
    expect(generator).toContain("path.join(root, nextDistDir, \"BUILD_ID\")");
  });

  it("uses stale-while-revalidate for hashed static assets so repeat PWA launches hit cache", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");

    expect(serviceWorker).toContain("function staleWhileRevalidate");
    expect(serviceWorker).toContain("event.respondWith(staleWhileRevalidate(request, STATIC_CACHE))");
    expect(serviceWorker).not.toContain("event.respondWith(networkFirst(request, STATIC_CACHE))");
  });

  it("serves cached navigations before the network for repeat PWA launches", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");

    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).toContain("return cachedResponse || networkResponse");
  });

  it("clones navigation responses before caching so the body is not drained twice", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain("const forRequest = response.clone()");
      expect(source).not.toMatch(/cache\.put\(request, response\.clone\(\)\);\s*cache\.put\("\/", response\.clone\(\)\)/);
    }
  });

  it("only caches the root shell under the / key for root navigations", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain('if (requestUrl.pathname === "/")');
      expect(source).toContain('cache.put("/", forRoot)');
    }
  });

  it("evicts prior shell builds but preserves vault PDF caches on activate", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain(
        'const VAULT_PDF_CACHE_PREFIX = "smart-notes-vault-pdfs-"'
      );
      expect(source).toContain("key !== APP_SHELL_CACHE");
      expect(source).toContain("key !== STATIC_CACHE");
      expect(source).toContain("!key.startsWith(VAULT_PDF_CACHE_PREFIX)");
      expect(source).toContain(
        'const MINI_APP_PACKAGE_CACHE_PREFIX = "smart-notes-mini-app-packages-"'
      );
      expect(source).toContain("!key.startsWith(MINI_APP_PACKAGE_CACHE_PREFIX)");
      expect(source).toContain("caches.delete(key)");
    }
  });

  it("polls /api/version on navigation and notifies clients of a new build (SN-85)", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain("function checkForBuildUpdate");
      expect(source).toContain('fetch("/api/version"');
      expect(source).toContain("serverBuildId !== BUILD_ID");
      expect(source).toContain('type: "SW_UPDATE_AVAILABLE"');
      expect(source).toContain("event.waitUntil(checkForBuildUpdate())");
    }
  });

  it("clears cached app shell entries for root and installed start_url on FORCE_RELOAD (SN-85/SN-91)", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain('APP_SHELL_NAVIGATION_KEYS = ["/", "/?source=pwa"]');
      expect(source).toContain('data.type !== "FORCE_RELOAD"');
      expect(source).toContain("APP_SHELL_NAVIGATION_KEYS.flatMap");
      expect(source).toContain("cache.delete(url)");
      expect(source).toContain("cache.delete(new Request(url))");
      expect(source).toContain('type: "FORCE_RELOAD_DONE"');
    }
  });

  it("FORCE_RELOAD does not wipe vault PDF Cache Storage (SN-151)", () => {
    const serviceWorker = fs.readFileSync(serviceWorkerPath, "utf8");
    const template = fs.readFileSync(templatePath, "utf8");

    for (const source of [serviceWorker, template]) {
      expect(source).toContain("FORCE_RELOAD");
      expect(source).toContain("APP_SHELL_CACHE");
      // Reloading the app shell must not delete large book caches.
      const forceReloadBlock = source.slice(
        source.indexOf('data.type !== "FORCE_RELOAD"')
      );
      expect(forceReloadBlock).not.toContain("smart-notes-vault-pdfs-");
    }
  });
});

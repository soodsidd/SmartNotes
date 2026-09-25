/* Smart Notes service worker — BUILD_ID: __BUILD_ID__ */
const BUILD_ID = "__BUILD_ID__";
const APP_SHELL_CACHE = `smart-notes-app-shell-${BUILD_ID}`;
const STATIC_CACHE = `smart-notes-static-${BUILD_ID}`;
const VAULT_PDF_CACHE_PREFIX = "smart-notes-vault-pdfs-";
const MINI_APP_PACKAGE_CACHE_PREFIX = "smart-notes-mini-app-packages-";
const PRECACHE_URLS = ["/", "/icon-192.png", "/icon-512.png"];
const APP_SHELL_NAVIGATION_KEYS = ["/", "/?source=pwa"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== APP_SHELL_CACHE &&
                key !== STATIC_CACHE &&
                !key.startsWith(VAULT_PDF_CACHE_PREFIX) &&
                !key.startsWith(MINI_APP_PACKAGE_CACHE_PREFIX)
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// SN-85: detect a newer deployed build by comparing the server's reported build
// id against the id baked into this worker. Runs in the background on every
// navigation; on mismatch it asks window clients to surface the update banner.
function notifyClientsUpdateAvailable(buildId) {
  return self.clients.matchAll({ type: "window" }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: "SW_UPDATE_AVAILABLE", buildId: buildId });
    });
  });
}

function checkForBuildUpdate() {
  return fetch("/api/version", { cache: "no-store" })
    .then((response) => {
      if (!response || !response.ok) {
        const headerBuildId = response && response.headers.get("SW-Build-ID");
        return headerBuildId ? { buildId: headerBuildId } : null;
      }
      const headerBuildId = response.headers.get("SW-Build-ID");
      return response
        .json()
        .catch(() => (headerBuildId ? { buildId: headerBuildId } : null));
    })
    .then((payload) => {
      const serverBuildId = payload && payload.buildId;
      if (serverBuildId && serverBuildId !== BUILD_ID) {
        return notifyClientsUpdateAvailable(serverBuildId);
      }
      return undefined;
    })
    .catch(() => undefined);
}

// SN-85: manual escape hatch. The client posts FORCE_RELOAD; we drop the cached
// app shell entries for root navigation variants so the next navigation fetches
// from the network, then acknowledge so the client can reload.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "FORCE_RELOAD") {
    return;
  }

  const ack = () => {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: "FORCE_RELOAD_DONE" });
    }
  };

  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) =>
        Promise.all(
          APP_SHELL_NAVIGATION_KEYS.flatMap((url) => [
            cache.delete(url),
            cache.delete(new Request(url)),
          ])
        )
      )
      .then(ack)
      .catch(ack)
  );
});

function shouldBypass(requestUrl) {
  return (
    requestUrl.pathname.startsWith("/api/") ||
    requestUrl.pathname.startsWith("/vault/") ||
    requestUrl.pathname === "/manifest.json"
  );
}

function isHashedStaticAsset(requestUrl, destination) {
  return (
    requestUrl.pathname.startsWith("/_next/static/") ||
    destination === "script" ||
    destination === "style"
  );
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cachedResponse) => {
      const networkResponse = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkResponse;
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin || shouldBypass(requestUrl)) {
    return;
  }

  if (request.mode === "navigate") {
    event.waitUntil(checkForBuildUpdate());
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then((cache) =>
        cache.match(request).then((cachedResponse) => {
          const networkResponse = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                const forRequest = response.clone();
                cache.put(request, forRequest);
                if (requestUrl.pathname === "/") {
                  const forRoot = response.clone();
                  cache.put("/", forRoot);
                }
              }
              return response;
            })
            .catch(() => cachedResponse);

          return cachedResponse || networkResponse;
        })
      )
    );
    return;
  }

  if (isHashedStaticAsset(requestUrl, request.destination)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (["font", "image"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

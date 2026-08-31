const CACHE_PREFIX = "alpha2-pwa-";
const CACHE_VERSION = "v6";
const SHELL_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}-runtime`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

async function putIfCacheable(cacheName, request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(APP_SHELL.map(async (path) => {
      const url = new URL(path, self.registration.scope).toString();
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`Failed to precache ${url}`);
      await cache.put(url, response.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && !ACTIVE_CACHES.has(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, {
        cache: request.mode === "navigate" ? "no-store" : "no-cache"
      });
      await putIfCacheable(RUNTIME_CACHE, request, response);
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return caches.match(new URL("./index.html", self.registration.scope).toString());
      }
      throw new Error("Offline and no cached response available");
    }
  })());
});

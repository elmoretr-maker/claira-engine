/**
 * Claira PWA — v2 cache: precached shell + icons/manifest, smart fetch, no API caching.
 */
const CACHE_NAME = "claira-cache-v2";

const PRECACHE_URLS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

function isNetworkOnlyPath(pathname) {
  if (pathname.startsWith("/api") || pathname.startsWith("/__claira")) {
    return true;
  }
  if (pathname === "/run" || pathname.startsWith("/run/")) {
    return true;
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (!url.href.startsWith(self.location.origin)) {
    return;
  }

  if (isNetworkOnlyPath(url.pathname)) {
    return;
  }

  const isNavigation =
    request.mode === "navigate" || request.destination === "document";

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(request).then((res) => {
        if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return res;
      });
    })
  );
});

const CACHE_NAME = "claira-shell-v1";
const SHELL_URLS = ["/", "/index.html"];

// Routes that must ALWAYS go to the network (API calls, assets that change).
// Any request matching these prefixes bypasses the cache entirely.
const NETWORK_ONLY_PREFIXES = [
  "/__claira/",
  "/api/",
  "/run",
];

function isNetworkOnly(url) {
  const { pathname } = new URL(url);
  return NETWORK_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate immediately — no waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Remove stale caches from previous SW versions.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only intercept same-origin GET requests.
  // POST requests (API calls) and cross-origin requests go straight to the network.
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // API routes — always fetch from network, never cache.
  if (isNetworkOnly(request.url)) {
    return;
  }

  // For navigation requests and the app shell: cache-first, fallback to network.
  event.respondWith(
    caches
      .match(request)
      .then((cached) => cached || fetch(request))
      .catch(() => caches.match("/index.html"))
  );
});

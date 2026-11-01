// Service worker: lets the app install and open its shell offline. It never touches /api, so chat streams, speech
// and the voice WebSocket always go straight to the server. Bump VERSION to drop every cache on the next visit.
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const FONTS = `fonts-${VERSION}`;
const CACHES = [SHELL, ASSETS, FONTS];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Answers from the cache when there is a copy, and refreshes the copy in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? fresh;
}

/** Fingerprinted files never change, so a cached copy is always right. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** Page loads try the network first so a new release shows up at once, and fall back to the saved shell offline. */
async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL)).put("/", response.clone());
    return response;
  } catch {
    return (await caches.match("/")) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (request.mode === "navigate") return event.respondWith(navigate(request));
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/models/")) return event.respondWith(cacheFirst(request, ASSETS));
    return event.respondWith(staleWhileRevalidate(request, SHELL));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONTS));
  }
});

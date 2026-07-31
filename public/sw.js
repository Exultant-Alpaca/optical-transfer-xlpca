const CACHE_NAME = "optical-transfer-demo-v1";

// Built assets are content hashed and have no query string, so a URL that does
// carry one is a versioned or volatile request. Caching those first-come and
// never revalidating them lets two generations of the same dependency coexist,
// which in development served a stale React against a fresh React DOM and broke
// every page that used a hook.
function isVolatile(url) {
  return url.search.length > 0;
}

// Vite fingerprints everything under /assets/, so those are safe to serve from
// cache forever. The WASM modules keep stable filenames across builds, so they
// have to be revalidated or a rebuilt decoder would never reach an installed
// client.
function isRevalidated(url) {
  return url.pathname.includes("/wasm/") || url.pathname.endsWith(".webmanifest");
}

// Never persist a failure. These responses are served cache first, so caching a
// 404 or a 502 from a mid-deploy fetch would leave the QR reader permanently
// unable to start, and no amount of reloading would clear it.
function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === "basic";
}

async function cacheIfUsable(request, response) {
  if (!isCacheable(response)) return;
  const copy = response.clone();
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, copy);
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.add(new Request("./index.html", { cache: "reload" }));
    await cache.add("./site.webmanifest");
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })).then(async (response) => {
      if (isCacheable(response)) await cacheIfUsable("./index.html", response);
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }

  const url = new URL(event.request.url);

  if (isVolatile(url)) return;

  if (isRevalidated(url)) {
    event.respondWith(fetch(event.request).then(async (response) => {
      await cacheIfUsable(event.request, response);
      // A stale copy still beats a broken decoder when the response is bad or
      // the device is offline.
      if (!isCacheable(response)) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) ?? Response.error()));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then(async (response) => {
    await cacheIfUsable(event.request, response);
    return response;
  }).catch(() => Response.error())));
});

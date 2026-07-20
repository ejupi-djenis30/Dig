const CACHE_PREFIX = "dig-protocol-explorer-";
const CACHE_NAME = `${CACHE_PREFIX}v2.1.1`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=2.1.1",
  "./app.mjs?v=2.1.1",
  "./protocol.mjs",
  "./manifest.webmanifest",
  "./fixtures/root.txt",
  "./assets/dig-mark.svg",
  "./assets/dig-lockup.svg",
  "./assets/demo-poster.svg",
];

async function cachedOrError(request) {
  return (await caches.match(request)) ?? Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("range")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put("./", response.clone());
          }
          return response;
        })
        .catch(() => cachedOrError("./")),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cachedOrError(request)),
  );
});

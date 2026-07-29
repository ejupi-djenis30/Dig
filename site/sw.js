const CACHE_PREFIX = "dig-protocol-explorer-";
const CACHE_NAME = `${CACHE_PREFIX}v3.2.0`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=3.2.0",
  "./app.mjs?v=3.2.0",
  "./protocol.mjs?v=3.2.0",
  "./manifest.webmanifest",
  "./fixtures/root.txt?v=3.2.0",
  "./assets/dig-mark.svg",
  "./assets/dig-lockup.svg",
  "./assets/dig-mark-180.png",
  "./assets/dig-mark-192.png",
  "./assets/dig-mark-512.png",
  "./assets/dig-mark-maskable.svg",
];

async function cachedOrError(request) {
  return (await caches.match(request)) ?? Response.error();
}

function isServerError(response) {
  return response.status >= 500 && response.status <= 599;
}

function isApiRequest(url) {
  const scope = new URL(self.registration.scope);
  const scopePath = scope.pathname.endsWith("/")
    ? scope.pathname
    : `${scope.pathname}/`;
  return url.origin === scope.origin && url.pathname.startsWith(`${scopePath}api/`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS)),
  );
});

self.addEventListener("message", (event) => {
  let sourceOrigin = null;
  try {
    sourceOrigin = new URL(event.source?.url).origin;
  } catch {
    return;
  }
  if (
    event.origin === self.location.origin
    && sourceOrigin === self.location.origin
    && event.data?.type === "SKIP_WAITING"
  ) {
    event.waitUntil(self.skipWaiting());
  }
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
    isApiRequest(url) ||
    request.headers.has("range")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (isServerError(response)) {
            return cachedOrError("./");
          }
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
        if (isServerError(response)) {
          return cachedOrError(request);
        }
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cachedOrError(request)),
  );
});

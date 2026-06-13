const CACHE_NAME = "pencraft-v4";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  //"./styles.css",
  //"./app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./").then((cached) => {
        return cached || fetch(request);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request);
    })
  );
});
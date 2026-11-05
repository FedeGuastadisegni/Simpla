/* Shell de Simpla. Subí CACHE cuando cambien los archivos precacheados. */
const CACHE = "simpla-shell-v3";

const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "db.js",
  "vendor/supabase.js",
  "manifest.webmanifest",
  "favicon.ico",
  "icons/logo.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "fonts/bricolage-grotesque-latin-400-normal.woff2",
  "fonts/bricolage-grotesque-latin-600-normal.woff2",
  "fonts/bricolage-grotesque-latin-800-normal.woff2",
  "fonts/instrument-serif-latin-400-italic.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(FILES.map((path) => new URL(path, self.location).href));
      const index = await cache.match(new URL("index.html", self.location).href);
      if (!index) {
        throw new Error("index.html no quedó en la caché");
      }
      await cache.put(new URL("./", self.location).href, index.clone());
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        if (request.mode === "navigate") {
          const fallback =
            (await cache.match(new URL("index.html", self.location).href)) ||
            (await cache.match(new URL("./", self.location).href));
          if (fallback) return fallback;
        }
        return new Response("Sin conexión", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })()
  );
});

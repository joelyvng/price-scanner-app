/* 轻松管理 service worker.
 * Strategy:
 *  - App shell + built assets: cache-first (hashed filenames make this safe).
 *  - Navigations: network-first with cached fallback to "/" (SPA offline).
 *  - Tesseract CDN assets (wasm/lang data): cache-first once fetched, so OCR
 *    works offline only after it has run once online.
 */
const CACHE = "price-scanner-v2";
const SHELL = ["/price-scanner-app/", "/price-scanner-app/manifest.webmanifest", "/price-scanner-app/icons/icon-192.png", "/price-scanner-app/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // SPA navigations: network first (saltando la caché HTTP, para que las
  // actualizaciones lleguen al momento), fallback to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/price-scanner-app/", copy));
          return res;
        })
        .catch(() => caches.match("/price-scanner-app/")),
    );
    return;
  }

  // Solo los estáticos de la app. Las Edge Functions de datos (/functions/v1/inventario,
  // /precios, /altas…) comparten origen y NUNCA deben servirse desde caché.
  const cacheable =
    (url.origin === self.location.origin && url.pathname.startsWith("/price-scanner-app/")) ||
    /tesseract|unpkg|jsdelivr/.test(url.hostname);
  if (!cacheable) return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && (res.type === "basic" || res.type === "cors")) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

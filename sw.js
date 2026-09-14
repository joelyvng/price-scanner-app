/* 轻松管理 service worker.
 * Strategy:
 *  - App shell + built assets: cache-first (hashed filenames make this safe).
 *  - Navigations: network-first with cached fallback to "/" (SPA offline).
 *  - Tesseract CDN assets (wasm/lang data): cache-first once fetched, so OCR
 *    works offline only after it has run once online.
 */
const CACHE = "price-scanner-v3";
const SHELL = ["/price-scanner-app/", "/price-scanner-app/manifest.webmanifest", "/price-scanner-app/icons/icon-192.png", "/price-scanner-app/icons/icon-512.png"];
const SHARE_TARGET_PATH = "/price-scanner-app/share-target";
const SHARE_DB = "price-scanner-share-target";
const SHARE_STORE = "shared-imports";
const SHARE_KEY = "latest";
const EXCEL_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function idbTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Share DB failed"));
  });
}

function isSharedFile(value) {
  return value && typeof value !== "string" && typeof value.arrayBuffer === "function";
}

function fileKind(file) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(avif|heic|heif|jpe?g|png|webp)$/.test(name)) return "image";
  if (EXCEL_TYPES.has(type) || /\.(xlsx|xls)$/.test(name)) return "excel";
  return "unknown";
}

function routeForSharedFiles(files) {
  const knownFile = files.find((file) => fileKind(file) !== "unknown") || files[0];
  const kind = fileKind(knownFile);
  if (kind === "pdf") return "/importar/pdf";
  if (kind === "image") return "/importar/foto";
  if (kind === "excel") return "/importar/excel";
  return "/importar";
}

function appUrl(route, query = "") {
  return new URL(`/price-scanner-app/#${route}${query}`, self.location.origin).toString();
}

async function saveSharedFiles(files) {
  const db = await openShareDb();
  try {
    const transaction = db.transaction(SHARE_STORE, "readwrite");
    transaction.objectStore(SHARE_STORE).put(
      {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
        createdAt: new Date().toISOString(),
        files: files.map((file) => ({
          name: file.name || "albaran",
          type: file.type || "",
          lastModified: file.lastModified || Date.now(),
          file,
        })),
      },
      SHARE_KEY,
    );
    await idbTransaction(transaction);
  } finally {
    db.close();
  }
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = [...formData.values()].filter(isSharedFile);
    if (files.length === 0) {
      return Response.redirect(appUrl("/importar", "?shared=empty"), 303);
    }
    await saveSharedFiles(files);
    return Response.redirect(appUrl(routeForSharedFiles(files), "?shared=1"), 303);
  } catch {
    return Response.redirect(appUrl("/importar", "?shared=error"), 303);
  }
}

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
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(req));
    return;
  }
  if (req.method !== "GET") return;

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

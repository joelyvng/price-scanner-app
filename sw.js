/* 轻松管理 service worker.
 * Strategy:
 *  - App shell + built assets: cache-first (hashed filenames make this safe).
 *  - Navigations: network-first with a short timeout, falling back to the cached
 *    shell, so a weak shop Wi-Fi does not leave the app hanging on a blank screen.
 *  - On each new deploy (the entry script referenced by index.html changes), cached
 *    assets that the new build no longer references are deleted. Without this the
 *    cache grows ~3 MB per deploy forever, and under storage pressure the browser
 *    evicts the whole origin — IndexedDB (the delivery notes) included.
 */
// Si alguna vez se edita a mano un asset sin cambiar su nombre (hash), hay que subir
// este número: la caché es cache-first por nombre y si no, los móviles seguirían
// usando la copia vieja para siempre.
const CACHE = "price-scanner-v5";
const SCOPE = "/price-scanner-app/";
const SHELL_URL = SCOPE;
const SHELL = [SHELL_URL, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`, `${SCOPE}icons/icon-512.png`];
const ASSETS_PREFIX = `${SCOPE}assets/`;
const BUILD_MARKER = `${SCOPE}__build-entry__`;
const NAV_TIMEOUT_MS = 4000;
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

// Rutas absolutas de los ficheros de build que menciona un texto (HTML o JS).
// Cubre las dos formas que genera Vite: "assets/x-HASH.js" y "/price-scanner-app/assets/x-HASH.js".
function assetRefs(text) {
  const refs = new Set();
  for (const match of text.matchAll(/assets\/[\w.-]+\.(?:js|mjs|css|wasm)/g)) {
    refs.add(`${SCOPE}${match[0]}`);
  }
  return refs;
}

function entryScript(html) {
  const match = html.match(/assets\/index-[\w-]+\.js/);
  return match ? `${SCOPE}${match[0]}` : null;
}

// Borra de la caché los assets que el build actual ya no usa. Recorre el grafo de
// dependencias desde index.html leyendo los propios ficheros cacheados (el script de
// entrada lista todos los chunks perezosos; algún chunk referencia a su vez un worker).
async function pruneStaleAssets(html) {
  const entry = entryScript(html);
  if (!entry) return;
  const cache = await caches.open(CACHE);
  const marker = await cache.match(BUILD_MARKER);
  if (marker && (await marker.text()) === entry) return;

  const keep = new Set();
  const queue = [...assetRefs(html)];
  while (queue.length > 0) {
    const url = queue.pop();
    if (keep.has(url)) continue;
    keep.add(url);
    if (!/\.m?js$/.test(url)) continue;
    let res = await cache.match(url);
    if (!res && url === entry) {
      // El script de entrada se va a necesitar igualmente; lo descargamos y cacheamos.
      res = await fetch(url, { cache: "no-cache" }).catch(() => undefined);
      if (res && res.ok) await cache.put(url, res.clone());
    }
    if (!res || !res.ok) continue;
    for (const ref of assetRefs(await res.text())) queue.push(ref);
  }

  // Si no se pudo leer el script de entrada, no hay grafo fiable: no se borra nada.
  if (!keep.has(entry) || !(await cache.match(entry))) return;

  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith(ASSETS_PREFIX) && !keep.has(path)) await cache.delete(req);
  }
  await cache.put(BUILD_MARKER, new Response(entry));
}

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

async function handleNavigation(event) {
  const network = fetch(event.request, { cache: "no-cache" });

  // Guarda el shell solo si es una respuesta buena: nunca una página de error
  // (un 404 o un 5xx de GitHub Pages quedaría como "app" offline para siempre).
  const updateShell = network
    .then(async (res) => {
      if (!res.ok || res.type !== "basic" || !isHtml(res)) return;
      // Clonar antes de cualquier await: en cuanto la página empieza a leer el
      // cuerpo de `res`, clone() ya no es posible.
      const forCache = res.clone();
      const html = await res.clone().text();
      const cache = await caches.open(CACHE);
      await cache.put(SHELL_URL, forCache);
      await pruneStaleAssets(html);
    })
    .catch(() => {});
  event.waitUntil(updateShell);

  const cached = await caches.match(SHELL_URL);
  if (!cached) return network;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const winner = await Promise.race([network.catch(() => null), timeout]);
  if (winner && winner.ok) return winner;
  return cached;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: "reload" salta la caché HTTP para no precachear un shell viejo.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
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
    event.respondWith(handleNavigation(event));
    return;
  }

  // Solo los estáticos de la app. Las Edge Functions (Supabase) son de otro origen,
  // así que nunca pasan por aquí y nunca se sirven desde caché.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        // "no-cache": revalida con el servidor (ETag → 304 si no ha cambiado). GitHub Pages
        // envía max-age=600, y sin esto un fichero recién parcheado podría salir de la caché
        // HTTP del navegador con el contenido viejo y quedarse así guardado para siempre.
        fetch(req, { cache: "no-cache" }).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

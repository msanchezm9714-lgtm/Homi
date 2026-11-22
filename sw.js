/* Homi · service worker
   · shell: páginas con red primero y copia de respaldo sin conexión
   · fotos: photos.bin se guarda completo en segundo plano (si la conexión lo permite) y las peticiones
     por rango se responden desde esa copia
   · estáticos (íconos, fuentes): caché con actualización en segundo plano */
const V = "2b1b079503";
const SHELL = `homi-shell-${V}`, PHOTOS = `homi-photos-${V}`, RUNTIME = `homi-rt-${V}`;
const PRE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/og-image.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(PRE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("homi-") && !k.endsWith(V)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

let filling = null;
function fillPhotos() {
  const c = navigator.connection;
  if (c && (c.saveData || /2g|3g/.test(c.effectiveType || ""))) return Promise.resolve();
  return filling || (filling = caches.open(PHOTOS).then(async cache => {
    if (await cache.match("/photos.bin")) return;
    const r = await fetch("/photos.bin", { cache: "no-store" });
    if (r.ok && r.status === 200) await cache.put("/photos.bin", r);
  }).catch(() => {}).finally(() => { filling = null; }));
}

async function photos(req, e) {
  const cache = await caches.open(PHOTOS), full = await cache.match("/photos.bin");
  const range = req.headers.get("range");
  if (full) {
    if (!range) return full;
    const m = /bytes=(\d+)-(\d+)?/.exec(range), buf = await full.arrayBuffer();
    const a = +m[1], b = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
    return new Response(buf.slice(a, b + 1), { status: 206, headers: {
      "Content-Type": "application/octet-stream", "Content-Range": `bytes ${a}-${b}/${buf.byteLength}`, "Content-Length": String(b - a + 1) } });
  }
  e.waitUntil(fillPhotos());
  return fetch(req);
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;
    if (url.pathname === "/photos.bin") return e.respondWith(photos(req, e));
    if (req.mode === "navigate") {
      return e.respondWith(fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return r;
      }).catch(async () => (await caches.match(req)) || (await caches.match("/")) || Response.error()));
    }
  }
  if (/\.(png|jpg|webp|webmanifest|woff2?|css)$/.test(url.pathname) || /fonts\.(googleapis|gstatic)\.com|unpkg\.com/.test(url.host)) {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});

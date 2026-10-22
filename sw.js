// Service worker: guarda la app para que funcione sin conexión.
// Al publicar una versión nueva, cambia VERSION para que se renueve la caché.

const VERSION = 'plano-cole-v2';
const TESELAS = 'plano-cole-teselas';
const ARCHIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/modelo.js', 'js/geo.js', 'js/vista.js', 'js/espacios.js', 'js/herramientas.js',
  'js/panel.js', 'js/archivo.js', 'js/estilo.js', 'js/satelite.js', 'js/anotar.js', 'js/tresd.js',
  'vendor/three.module.min.js', 'vendor/OrbitControls.js',
  'iconos/icono.svg', 'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== TESELAS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function tesela(req) {
  const c = await caches.open(TESELAS);
  const guardada = await c.match(req);
  if (guardada) return guardada;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') {
    c.put(req, r.clone());
    // límite blando: unas 4000 teselas (~60 MB como mucho)
    c.keys().then((ks) => { if (ks.length > 4000) ks.slice(0, 500).forEach((k) => c.delete(k)); });
  }
  return r;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // fotos aéreas del IGN: primero la caché (no cambian), así se ven sin conexión
  if (url.hostname === 'www.ign.es' && url.pathname.startsWith('/wmts/')) {
    e.respondWith(tesela(e.request));
    return;
  }
  if (url.origin !== location.origin) return;
  // la app: red primero (para recibir mejoras en cuanto se publican); si no hay red, la caché
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

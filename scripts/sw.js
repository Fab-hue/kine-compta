// Service worker Kiné Compta : tout est précaché à l'installation, puis servi depuis le cache (hors ligne).
// Les deux marqueurs ci-dessous (version et liste) sont remplacés au build par le plugin de vite.config.ts.
const VERSION = '__VERSION__';
const CACHE = `kine-compta-${VERSION}`;
const FICHIERS = __PRECACHE__; // chemins relatifs à la racine de l'app

const url = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FICHIERS.map((p) => new Request(url(p), { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n.startsWith('kine-compta-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  // uniquement les GET de même origine : rien d'autre n'est jamais mis en cache ni intercepté
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(r, { ignoreSearch: true, ignoreVary: true }) /* Vary: Origin des modules */;
      if (hit) return hit;
      if (r.mode === 'navigate') return (await c.match(url('index.html'), { ignoreVary: true })) ?? fetch(r);
      return fetch(r); // hors liste : réseau, sans mise en cache
    }),
  );
});

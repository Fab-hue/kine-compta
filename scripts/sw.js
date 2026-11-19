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

// clic sur le rappel de 18h : ramener l'app au premier plan (ou l'ouvrir)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => x.url.startsWith(self.registration.scope));
      return c ? c.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});

// Rappel de 18h app fermée : le serveur de rappel envoie un push VIDE (aucune donnée). Ici, dans le téléphone,
// on regarde si la journée est vide dans la base locale, et seulement alors on affiche la notification.
const PAS = 30; // même règle que estVide() de src/lib/creneaux.ts
const estVide = (c) => !c.statut && !(c.patient ?? '').trim() && !(c.commentaire ?? '').trim() && c.fin - c.debut === PAS;
const p2 = (n) => String(n).padStart(2, '0');

function lireBase() {
  return new Promise((ok, ko) => {
    const req = indexedDB.open('kine-compta');
    // base absente : ne surtout pas la créer ici (l'app la crée avec sa propre version)
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => ko(req.error);
    req.onsuccess = () => ok(req.result);
  });
}

async function faut_il_rappeler() {
  const d = new Date();
  if (d.getDay() === 0 || d.getDay() === 6) return false;
  const jour = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  let db;
  try { db = await lireBase(); } catch { return true; } // pas de base : rien de noté
  try {
    const lire = (store, f) => new Promise((ok, ko) => {
      const r = f(db.transaction(store).objectStore(store));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    const reglages = await lire('reglages', (s) => s.get('r'));
    if (reglages && reglages.rappel === false) return false;
    const creneaux = await lire('creneaux', (s) => s.getAll(IDBKeyRange.bound(`${jour}|`, `${jour}|￿`)));
    return creneaux.every(estVide);
  } finally { db.close(); }
}

// bouton « Tester » des Réglages : l'app pose ce marqueur (Cache API) juste avant de demander un push de test.
// Nom hors du préfixe « kine-compta- » pour ne pas être effacé par le nettoyage de activate.
const TEST = 'kc-push-test';
async function estUnTest() {
  const c = await caches.open(TEST);
  const r = await c.match(url('__test'));
  if (!r) return false;
  await caches.delete(TEST);
  return Date.now() - Number(await r.text()) < 120000;
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const test = await estUnTest().catch(() => false);
    if (!test && !(await faut_il_rappeler().catch(() => true))) return;
    await self.registration.showNotification('Kiné Compta', {
      body: test ? 'Test réussi : le rappel de 18h arrivera même app fermée.' : 'Il est 18h : pense à remplir l\'agenda du jour.',
      icon: url('icon-192.png'), tag: 'rappel-agenda',
    });
  })());
});

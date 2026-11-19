// Rappel de 18h même app fermée (Android, ordinateur) : abonnement Web Push au serveur de rappel (rappel-push/).
// Le serveur n'apprend RIEN des patients ni de l'agenda : il ne reçoit que l'adresse de push anonyme du navigateur
// (endpoint) et, quand l'agenda du jour est rempli, la date du jour (pour ne pas sonner ce soir-là).
// Le push reçu est vide ; c'est le service worker (scripts/sw.js) qui vérifie localement si la journée est vide.

export const URL_RAPPEL = 'https://kine-rappel.votes-bruxelles.workers.dev';
export const VAPID_PUBLIC = 'BMrfY6_nIBDF3Me4xuPNy_bn8hBJSHh9VDca7ohfRqnuPk7seCid445aOKu7PJGpYbovoPM_HVxAiEvsqqfH-X8';

const CLE_ABO = 'kc-push-abo'; // « endpoint|date » du dernier envoi au serveur (au plus 1 par jour)
const CLE_FAIT = 'kc-push-fait'; // « endpoint|date » du dernier « agenda rempli » signalé

export const pushDisponible = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function cleOctets(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const memo = {
  lire: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  ecrire: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  effacer: (k: string) => { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

async function envoyer(chemin: string, corps: object) {
  const r = await fetch(URL_RAPPEL + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  return r.ok;
}

/** Abonnement push existant (sans en créer). null en développement (pas de service worker). */
export async function abonnementPush() {
  if (!pushDisponible()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Abonne ce navigateur au rappel de 18h. Demande d'abord la permission de notifier. */
export async function activerPush(aujourdhui: string): Promise<boolean> {
  if (!pushDisponible() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleOctets(VAPID_PUBLIC) }));
  const marque = `${sub.endpoint}|${aujourdhui}`;
  if (memo.lire(CLE_ABO) === marque) return true;
  if (!(await envoyer('/abonner', { endpoint: sub.endpoint }))) return false;
  memo.ecrire(CLE_ABO, marque);
  return true;
}

export async function desactiverPush() {
  const sub = await abonnementPush();
  memo.effacer(CLE_ABO);
  memo.effacer(CLE_FAIT);
  if (!sub) return;
  try { await envoyer('/desabonner', { endpoint: sub.endpoint }); } catch { /* hors ligne : l'abonnement expirera */ }
  await sub.unsubscribe();
}

/** L'agenda du jour est rempli : le serveur ne sonnera pas ce soir (une fois par jour). */
export async function signalerFait(aujourdhui: string) {
  const sub = await abonnementPush();
  if (!sub) return;
  const marque = `${sub.endpoint}|${aujourdhui}`;
  if (memo.lire(CLE_FAIT) === marque) return;
  if (await envoyer('/fait', { endpoint: sub.endpoint, date: aujourdhui })) memo.ecrire(CLE_FAIT, marque);
}

/** Envoie tout de suite un push à CE navigateur (bouton Tester). */
export async function testerPush() {
  const sub = await abonnementPush();
  if (!sub) return false;
  // marqueur lu par le service worker : affiche la notification de test même si la journée est remplie
  const c = await caches.open('kc-push-test');
  await c.put(new URL('__test', (await navigator.serviceWorker.getRegistration())!.scope).href, new Response(String(Date.now())));
  return envoyer('/test', { endpoint: sub.endpoint });
}

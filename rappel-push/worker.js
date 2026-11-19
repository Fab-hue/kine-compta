// Rappel 18h de Kiné Compta (Cloudflare Worker, offre gratuite).
// Le téléphone fermé ne peut pas se réveiller seul à heure fixe : ce Worker lui envoie, les jours ouvrés à 18h
// (heure de Bruxelles), un push VIDE. Aucune donnée n'est transmise : c'est le service worker de l'app qui
// regarde ensuite, dans le téléphone, si la journée est vide et affiche la notification.
// Stocké ici : seulement l'adresse de push anonyme du navigateur (endpoint) et la date du dernier jour noté.

const ORIGINE = 'https://fab-hue.github.io';
const HEURE = 18;
const SITE = 'https://fab-hue.github.io/kine-compta/';
// services de push des navigateurs : on n'envoie jamais de requête ailleurs
const SERVICES = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];

const cors = {
  'Access-Control-Allow-Origin': ORIGINE,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const rep = (status) => new Response(null, { status, headers: cors });

function valide(ep) {
  if (typeof ep !== 'string' || ep.length > 1000) return false;
  try {
    const u = new URL(ep);
    return u.protocol === 'https:' && SERVICES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
  } catch { return false; }
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const texte = (s) => b64url(new TextEncoder().encode(s));

async function cle(ep) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ep)));
}

/** Date (AAAA-MM-JJ), heure et jour de la semaine à Bruxelles (gère l'heure d'été). */
function bruxelles(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour), ouvre: !['Sat', 'Sun'].includes(p.weekday) };
}

/** JWT VAPID (ES256) pour le service de push de l'endpoint. */
async function vapid(ep, env) {
  const prive = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const corps = `${texte(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${texte(JSON.stringify({
    aud: new URL(ep).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SITE,
  }))}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, prive, new TextEncoder().encode(corps));
  return `vapid t=${corps}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function pousser(ep, env) {
  return fetch(ep, {
    method: 'POST',
    headers: { TTL: '7200', Urgency: 'high', Topic: 'rappel-agenda', Authorization: await vapid(ep, env) },
    body: '',
  });
}

async function envoyerTous(env, quand, forcer = false) {
  const b = bruxelles(quand);
  if (!forcer && (!b.ouvre || b.heure !== HEURE)) return { envoyes: 0, raison: 'pas 18h un jour ouvré' };
  let envoyes = 0;
  let curseur;
  do {
    const l = await env.ABOS.list({ cursor: curseur });
    for (const k of l.keys) {
      const a = await env.ABOS.get(k.name, 'json');
      if (!a?.endpoint || a.fait === b.date) continue; // agenda déjà rempli aujourd'hui
      const r = await pousser(a.endpoint, env);
      if (r.status === 404 || r.status === 410) await env.ABOS.delete(k.name); // abonnement expiré
      else if (r.ok) envoyes++;
    }
    curseur = l.list_complete ? undefined : l.cursor;
  } while (curseur);
  return { envoyes };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return new Response('Kiné Compta : rappel de 18h', { headers: cors });
    let corps;
    try { corps = await req.json(); } catch { return rep(400); }
    const ep = corps?.endpoint;
    if (!valide(ep)) return rep(400);
    const k = await cle(ep);
    const chemin = new URL(req.url).pathname;
    if (chemin === '/abonner') {
      const avant = await env.ABOS.get(k, 'json');
      await env.ABOS.put(k, JSON.stringify({ endpoint: ep, fait: avant?.fait }));
    } else if (chemin === '/desabonner') {
      await env.ABOS.delete(k);
    } else if (chemin === '/fait') {
      // l'app signale que l'agenda du jour est rempli : pas de push ce soir
      // pas de lecture KV ici : juste après /abonner, KV peut encore répondre « absent » (cache jusqu'à 60 s)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(corps.date ?? '')) return rep(400);
      await env.ABOS.put(k, JSON.stringify({ endpoint: ep, fait: corps.date }));
    } else if (chemin === '/test') {
      // push immédiat vers CET endpoint seulement (bouton « Tester » des Réglages). Pas de vérification KV
      // (même délai de cache) : le service de push refuse de toute façon un endpoint créé sans notre clé VAPID.
      const r = await pousser(ep, env);
      return rep(r.ok ? 204 : 502);
    } else return rep(404);
    return rep(204);
  },

  // cron toutes les heures 16 et 17 UTC : l'une des deux tombe à 18h à Bruxelles (heure d'hiver ou d'été)
  async scheduled(evt, env, ctx) {
    ctx.waitUntil(envoyerTous(env, new Date(evt.scheduledTime)));
  },
};

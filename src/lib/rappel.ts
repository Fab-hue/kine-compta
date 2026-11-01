// Rappel quotidien « remplis l'agenda » à 18h, sans serveur (RGPD) :
// - bandeau dans l'app après 18h si la journée (lun-ven) est vide ;
// - notification système à 18h tant que l'app est ouverte (ou en arrière-plan sur ordinateur) ;
// - fichier .ics : l'agenda du téléphone rappelle chaque jour ouvré à 18h, même app fermée.
import { jourVide, type Creneau } from './creneaux';

export const HEURE_RAPPEL = 18;

const p2 = (n: number) => String(n).padStart(2, '0');
export const isoLocal = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const ouvre = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

/** Faut-il rappeler maintenant ? Jour ouvré, 18h passées, aucun créneau rempli aujourd'hui. */
export function rappelDu(maintenant: Date, creneaux: Creneau[]) {
  return ouvre(maintenant) && maintenant.getHours() >= HEURE_RAPPEL && jourVide(isoLocal(maintenant), creneaux);
}

/** Millisecondes jusqu'au prochain 18h00 (aujourd'hui si pas encore passé, sinon demain). */
export function delaiProchainRappel(maintenant: Date) {
  const c = new Date(maintenant);
  c.setHours(HEURE_RAPPEL, 0, 0, 0);
  if (c <= maintenant) c.setDate(c.getDate() + 1);
  return c.getTime() - maintenant.getTime();
}

/** Événement récurrent lun-ven à 18h00 avec alarme, à importer dans l'agenda du téléphone. */
export function icsRappel(lienApp: string, debut: Date = new Date()) {
  const j = isoLocal(debut).replaceAll('-', '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kine Compta//Rappel//FR', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:rappel-agenda-${j}@kine-compta`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${j}T${p2(HEURE_RAPPEL)}0000`,
    `DTEND:${j}T${p2(HEURE_RAPPEL)}1500`,
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    'SUMMARY:Kiné Compta : remplir l\'agenda du jour',
    `DESCRIPTION:Ouvre Kiné Compta et note les séances du jour : ${lienApp}`,
    `URL:${lienApp}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Remplir l\'agenda Kiné Compta', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/** Affiche la notification (via le service worker si présent : obligatoire sur Android). */
export async function notifier() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  const titre = 'Kiné Compta';
  const opts: NotificationOptions = { body: 'Il est 18h : pense à remplir l\'agenda du jour.', icon: './icon-192.png', tag: 'rappel-agenda' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(titre, opts); return true; }
  } catch { /* repli ci-dessous */ }
  try { new Notification(titre, opts); return true; } catch { return false; }
}

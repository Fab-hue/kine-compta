// Agenda en créneaux de 30 min (8h-17h), sans nom de patient (RGPD) :
// statut payé / à recevoir, mode totalité / tiers payant, commentaire libre (initiales).

export type Statut = 'paye' | 'arecevoir';
export type Mode = 'totalite' | 'tiers';

export interface Creneau {
  /** `${date}|HH:MM` du début */
  id: string;
  /** AAAA-MM-JJ */
  date: string;
  /** minutes depuis minuit */
  debut: number;
  fin: number;
  statut?: Statut;
  mode?: Mode;
  commentaire?: string;
}

export const PAS = 30;
export const PREMIER = 8 * 60; // 08h00
export const DERNIER = 17 * 60; // 17h00 : dernier créneau (17h00-17h30)

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
export const idCreneau = (date: string, debut: number) => `${date}|${hhmm(debut).replace('h', ':')}`;

/** Créneau par défaut, non enregistré. */
const defaut = (date: string, debut: number): Creneau => ({ id: idCreneau(date, debut), date, debut, fin: debut + PAS });

/** Rien à garder : 30 min, sans statut ni commentaire (pas besoin de l'enregistrer). */
export const estVide = (c: Creneau) => !c.statut && !c.commentaire?.trim() && c.fin - c.debut === PAS;

/** Créneaux d'un jour : les créneaux par défaut, remplacés ou couverts par ceux enregistrés (fusionnés). */
export function creneauxDuJour(date: string, enregistres: Creneau[]): Creneau[] {
  const du = enregistres.filter((c) => c.date === date);
  const jour: Creneau[] = [];
  for (let t = PREMIER; t <= DERNIER; t += PAS) {
    const c = du.find((x) => x.debut <= t && t < x.fin);
    if (!c) jour.push(defaut(date, t));
    else if (c.debut === t) jour.push(c);
  }
  return jour;
}

const donnees = (c: Creneau) => ({ statut: c.statut, mode: c.mode, commentaire: c.commentaire });
const aDesDonnees = (c: Creneau) => !!c.statut || !!c.commentaire?.trim();

/**
 * Fusionne le créneau `i` du jour avec le précédent (-1) ou le suivant (+1).
 * Garde le statut du créneau `i` s'il en a un, sinon celui de l'autre ; les commentaires sont joints.
 * Renvoie le créneau fusionné (id = celui du premier) et l'id à supprimer, ou null si impossible.
 */
export function fusionner(jour: Creneau[], i: number, sens: -1 | 1): { fusion: Creneau; supprime: string } | null {
  const a = jour[i];
  const b = jour[i + sens];
  if (!a || !b) return null;
  const [premier, second] = sens === 1 ? [a, b] : [b, a];
  const source = aDesDonnees(a) || !aDesDonnees(b) ? a : b;
  const autre = source === a ? b : a;
  const notes = [premier.commentaire?.trim(), second.commentaire?.trim()].filter(Boolean);
  const fusion: Creneau = {
    ...donnees(source),
    id: premier.id,
    date: premier.date,
    debut: premier.debut,
    fin: second.fin,
    statut: source.statut ?? autre.statut,
    mode: source.mode ?? autre.mode,
    commentaire: notes.length ? notes.join(' / ') : undefined,
  };
  if (!fusion.statut) delete fusion.mode;
  for (const k of ['statut', 'mode', 'commentaire'] as const) if (fusion[k] === undefined) delete fusion[k];
  return { fusion, supprime: second.id };
}

/** Sépare un créneau fusionné : il redevient un créneau de 30 min (les suivants reviennent par défaut). */
export const separer = (c: Creneau): Creneau => ({ ...c, fin: c.debut + PAS });

export interface ResumeMois {
  paye: { totalite: number; tiers: number };
  arecevoir: { totalite: number; tiers: number };
}

/** Nombre de créneaux payés / à recevoir du mois (AAAA-MM), par mode. */
export function resumeMois(creneaux: Creneau[], mois: string): ResumeMois {
  const r: ResumeMois = { paye: { totalite: 0, tiers: 0 }, arecevoir: { totalite: 0, tiers: 0 } };
  for (const c of creneaux) {
    if (!c.statut || !c.date.startsWith(mois)) continue;
    r[c.statut][c.mode ?? 'tiers']++;
  }
  return r;
}

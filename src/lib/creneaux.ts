// Agenda en créneaux de 30 min (8h-17h), sans nom de patient (RGPD) :
// statut payé / à recevoir, mode totalité / tiers payant, pathologie, BIM, domicile,
// commentaire libre (initiales).
import { calculer, findTarif, type Montants } from './tarifs';

export type Statut = 'paye' | 'arecevoir';
export type Mode = 'totalite' | 'tiers';
export type Pathologie = 'courant' | 'fa' | 'fb' | 'e';

/** Codes INAMI d'une séance de 30 min (cabinet / domicile), grille du 01-01-2026. */
export const PATHOLOGIES: Record<Pathologie, { libelle: string; court: string; cabinet: string; domicile: string }> = {
  courant: { libelle: 'Courant', court: 'Cour.', cabinet: '560011', domicile: '560313' },
  fa: { libelle: 'FA', court: 'FA', cabinet: '563010', domicile: '563312' },
  fb: { libelle: 'FB', court: 'FB', cabinet: '563614', domicile: '563916' },
  e: { libelle: 'E', court: 'E', cabinet: '560652', domicile: '561013' },
};

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
  /** défaut : courant */
  pathologie?: Pathologie;
  /** patient BIM / VIPO (compte seulement en tiers payant) */
  bim?: boolean;
  domicile?: boolean;
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

const CHAMPS = ['statut', 'mode', 'pathologie', 'bim', 'domicile', 'commentaire'] as const;
const donnees = (c: Creneau) => ({ statut: c.statut, mode: c.mode, pathologie: c.pathologie, bim: c.bim, domicile: c.domicile });
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
  if (!fusion.statut) for (const k of ['mode', 'pathologie', 'bim', 'domicile'] as const) delete fusion[k];
  for (const k of CHAMPS) if (fusion[k] === undefined || fusion[k] === false) delete fusion[k];
  return { fusion, supprime: second.id };
}

/** Sépare un créneau fusionné : il redevient un créneau de 30 min (les suivants reviennent par défaut). */
export const separer = (c: Creneau): Creneau => ({ ...c, fin: c.debut + PAS });

/** Code INAMI du créneau (pathologie + lieu). */
export const codeCreneau = (c: Pick<Creneau, 'pathologie' | 'domicile'>) =>
  PATHOLOGIES[c.pathologie ?? 'courant'][c.domicile ? 'domicile' : 'cabinet'];

/**
 * Montants d'une séance du créneau (une séance, même si le créneau est fusionné).
 * Tiers payant : le patient paie le ticket modérateur, la mutuelle l'intervention (selon BIM).
 * Totalité : le patient paie les honoraires.
 */
export function montantCreneau(c: Creneau, conventionne = true): Montants | null {
  if (!c.statut) return null;
  const t = findTarif(codeCreneau(c));
  if (!t) return null;
  const tiersPayant = (c.mode ?? 'tiers') === 'tiers';
  return calculer(t, { bim: tiersPayant && !!c.bim, conventionne, tiersPayant });
}

export interface Ligne {
  nombre: number;
  /** total encaissé du patient */
  patient: number;
  /** total versé par la mutuelle */
  mutuelle: number;
}

export interface ResumeMois {
  paye: { totalite: number; tiers: number } & Ligne;
  arecevoir: { totalite: number; tiers: number } & Ligne;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Créneaux payés / à recevoir du mois (AAAA-MM) : nombre par mode et montants. */
export function resumeMois(creneaux: Creneau[], mois: string, conventionne = true): ResumeMois {
  const vide = () => ({ totalite: 0, tiers: 0, nombre: 0, patient: 0, mutuelle: 0 });
  const r: ResumeMois = { paye: vide(), arecevoir: vide() };
  for (const c of creneaux) {
    if (!c.statut || !c.date.startsWith(mois)) continue;
    const x = r[c.statut];
    x[c.mode ?? 'tiers']++;
    x.nombre++;
    const m = montantCreneau(c, conventionne);
    if (m) {
      x.patient = r2(x.patient + m.patient);
      x.mutuelle = r2(x.mutuelle + m.mutuelle);
    }
  }
  return r;
}

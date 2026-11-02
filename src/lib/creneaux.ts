// Agenda en créneaux de 30 min (8h-17h) : patient (nom complet, reste sur l'appareil),
// statut payé / à recevoir, mode totalité / tiers payant, pathologie, bilan / rapport, BIM, domicile, commentaire libre.
import { calculer, findTarif, type Montants } from './tarifs';

export type Statut = 'paye' | 'arecevoir';
export type Mode = 'totalite' | 'tiers';
export type Pathologie = 'courant' | 'fa' | 'fb' | 'fb60' | 'e' | 'perinatal';
export type Supplement = 'bilan' | 'rapport' | 'prestation';

/**
 * Codes INAMI d'une séance (cabinet / domicile), fiche INAMI du 01-07-2026.
 * Les codes de début de série (567011 courante 1 à 9, 567276 FA 1 à 20) ont les mêmes montants.
 */
export const PATHOLOGIES: Record<Pathologie, { libelle: string; court: string; cabinet: string; domicile: string }> = {
  courant: { libelle: 'Courante', court: 'Cour.', cabinet: '560011', domicile: '560313' },
  fa: { libelle: 'FA', court: 'FA', cabinet: '563010', domicile: '563312' },
  fb: { libelle: 'FB (1 à 60)', court: 'FB', cabinet: '563614', domicile: '563916' },
  fb60: { libelle: 'FB plus de 60 (61 à 80)', court: 'FB+60', cabinet: '564270', domicile: '564336' },
  e: { libelle: 'Liste E', court: 'E', cabinet: '560652', domicile: '561013' },
  perinatal: { libelle: 'Périnatale', court: 'Péri.', cabinet: '561595', domicile: '561654' },
};

export interface DefSupplement {
  id: Supplement;
  libelle: string;
  court: string;
  cabinet: string;
  domicile: string;
  /** honoraires du 01-07-2026 quand ils diffèrent de la grille du 01-01-2026 */
  honoraires?: number;
}

/** Rapport FA / FB / E : honoraires 34,62 €, remboursement 33,75 € (fiche INAMI juillet 2026). */
const RAPPORT = 34.62;
const rapport = (cabinet: string, domicile: string): DefSupplement => ({
  id: 'rapport', libelle: 'Rapport', court: 'Rapp.', cabinet, domicile, honoraires: RAPPORT,
});

/** Bilans, rapports et prestations qui s'ajoutent à la séance, selon la pathologie. */
export const SUPPLEMENTS: Record<Pathologie, DefSupplement[]> = {
  courant: [{ id: 'bilan', libelle: 'Bilan (intake)', court: 'Bilan', cabinet: '567033', domicile: '567151' }],
  fa: [rapport('563076', '563371')],
  fb: [rapport('563673', '563975')],
  fb60: [rapport('563673', '563975')],
  e: [
    rapport('560711', '561072'),
    { id: 'prestation', libelle: 'Prestation liste E (M12)', court: 'Prest.', cabinet: '560696', domicile: '561050' },
  ],
  perinatal: [],
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
  /** patient BIM / VIPO : remboursement majoré */
  bim?: boolean;
  domicile?: boolean;
  /** bilan / rapport / prestation en plus de la séance (selon la pathologie) */
  supplements?: Supplement[];
  /** tiers payant à recevoir : le patient a déjà payé sa part, seule la mutuelle doit encore payer */
  patientPaye?: boolean;
  /** nom du patient (« NOM Prénom », comme dans Rosa) : regroupe ses séances dans l'onglet Patients */
  patient?: string;
  commentaire?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const PAS = 30;
export const PREMIER = 8 * 60; // 08h00
export const DERNIER = 17 * 60; // 17h00 : dernier créneau (17h00-17h30)

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
export const idCreneau = (date: string, debut: number) => `${date}|${hhmm(debut).replace('h', ':')}`;

/** Créneau par défaut, non enregistré. */
const defaut = (date: string, debut: number): Creneau => ({ id: idCreneau(date, debut), date, debut, fin: debut + PAS });

/** Rien à garder : 30 min, sans statut, patient ni commentaire (pas besoin de l'enregistrer). */
export const estVide = (c: Creneau) => !c.statut && !c.patient?.trim() && !c.commentaire?.trim() && c.fin - c.debut === PAS;

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

/**
 * Créneaux enregistrés tels qu'affichés dans le Calendrier : un créneau caché sous un bloc fusionné
 * (ou hors de la grille 8h-17h30) n'est pas une séance et ne compte jamais.
 */
export function creneauxVisibles(creneaux: Creneau[]): Creneau[] {
  const parDate = new Map<string, Creneau[]>();
  for (const c of creneaux) {
    const l = parDate.get(c.date);
    if (l) l.push(c);
    else parDate.set(c.date, [c]);
  }
  const res: Creneau[] = [];
  for (const [date, l] of parDate) for (const c of creneauxDuJour(date, l)) if (l.includes(c)) res.push(c);
  return res;
}

/** Créneaux enregistrés du jour qui recouvrent la plage [debut, fin[ (cachés compris), sauf `sauf`. */
export const creneauxSous = (creneaux: Creneau[], date: string, debut: number, fin: number, sauf?: string) =>
  creneaux.filter((c) => c.date === date && c.id !== sauf && c.debut < fin && debut < c.fin);

const CHAMPS = ['statut', 'mode', 'pathologie', 'bim', 'domicile', 'supplements', 'patientPaye', 'patient', 'commentaire'] as const;
const donnees = (c: Creneau) => ({
  statut: c.statut, mode: c.mode, pathologie: c.pathologie, bim: c.bim, domicile: c.domicile,
  supplements: c.supplements, patientPaye: c.patientPaye,
});
const aDesDonnees = (c: Creneau) => !!c.statut || !!c.patient?.trim() || !!c.commentaire?.trim();

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
    patient: source.patient?.trim() || autre.patient?.trim() || undefined,
    commentaire: notes.length ? notes.join(' / ') : undefined,
  };
  if (!fusion.statut) for (const k of ['mode', 'pathologie', 'bim', 'domicile', 'supplements', 'patientPaye'] as const) delete fusion[k];
  for (const k of CHAMPS) {
    const v = fusion[k];
    if (v === undefined || v === false || (Array.isArray(v) && !v.length)) delete fusion[k];
  }
  return { fusion, supprime: second.id };
}

/** Sépare un créneau fusionné : il redevient un créneau de 30 min (les suivants reviennent par défaut). */
export const separer = (c: Creneau): Creneau => ({ ...c, fin: c.debut + PAS });

/** Code INAMI du créneau (pathologie + lieu). */
export const codeCreneau = (c: Pick<Creneau, 'pathologie' | 'domicile'>) =>
  PATHOLOGIES[c.pathologie ?? 'courant'][c.domicile ? 'domicile' : 'cabinet'];

export interface LigneMontant {
  libelle: string;
  code: string;
  montants: Montants;
}

/** Bilans / rapports possibles pour la pathologie du créneau. */
export const supplementsDe = (p: Pathologie | undefined) => SUPPLEMENTS[p ?? 'courant'];

/**
 * Lignes facturées du créneau : la séance (une seule, même si le créneau est fusionné) + bilan / rapport cochés.
 * Tiers payant : le patient paie le ticket modérateur, la mutuelle l'intervention (selon BIM).
 * Totalité : le patient paie les honoraires et se fait rembourser l'intervention par sa mutuelle.
 */
export function lignesCreneau(c: Creneau, conventionne = true): LigneMontant[] {
  if (!c.statut) return [];
  const lieu = c.domicile ? 'domicile' : 'cabinet';
  const profil = { bim: !!c.bim, conventionne, tiersPayant: (c.mode ?? 'tiers') === 'tiers' };
  const lignes: LigneMontant[] = [];
  const code = codeCreneau(c);
  const t = findTarif(code);
  if (t) lignes.push({ libelle: 'Séance', code, montants: calculer(t, profil) });
  for (const s of supplementsDe(c.pathologie)) {
    if (!c.supplements?.includes(s.id)) continue;
    const ts = findTarif(s[lieu]);
    if (ts) lignes.push({ libelle: s.libelle, code: s[lieu], montants: calculer(ts, profil, s.honoraires) });
  }
  return lignes;
}

/** Total du créneau (séance + bilan / rapport), ou null si le créneau est libre. */
export function montantCreneau(c: Creneau, conventionne = true): Montants | null {
  const lignes = lignesCreneau(c, conventionne);
  if (!lignes.length) return null;
  const total: Montants = { honoraires: 0, intervention: 0, ticketModerateur: 0, patient: 0, mutuelle: 0 };
  for (const { montants: m } of lignes) for (const k of Object.keys(total) as (keyof Montants)[]) total[k] = r2(total[k] + m[k]);
  return total;
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

/** Créneaux payés / à recevoir du mois (AAAA-MM) : nombre par mode et montants. */
export function resumeMois(creneaux: Creneau[], mois: string, conventionne = true): ResumeMois {
  const vide = () => ({ totalite: 0, tiers: 0, nombre: 0, patient: 0, mutuelle: 0 });
  const r: ResumeMois = { paye: vide(), arecevoir: vide() };
  for (const c of creneauxVisibles(creneaux.filter((x) => x.date.startsWith(mois)))) {
    if (!c.statut || !c.date.startsWith(mois)) continue;
    const x = r[c.statut];
    x[c.mode ?? 'tiers']++;
    x.nombre++;
    const m = montantCreneau(c, conventionne);
    if (m) {
      // tiers payant : la part patient déjà payée passe dans « payé », la mutuelle reste à recevoir
      const p = c.statut === 'arecevoir' && c.mode !== 'totalite' && c.patientPaye ? r.paye : x;
      p.patient = r2(p.patient + m.patient);
      x.mutuelle = r2(x.mutuelle + m.mutuelle);
    }
  }
  return r;
}

/**
 * Totaux de l'agenda par mois de la séance (année donnée), pour l'export Excel :
 * tout le perçu (patient + mutuelle) va dans Virements (eAttest, pas de carnet papier). Payés et à recevoir comptent (mois de la séance).
 */
export function totauxCreneauxParMois(creneaux: Creneau[], annee: number, conventionne = true) {
  const res = Array.from({ length: 12 }, (_, mois) => ({ mois, carnet: 0, virements: 0, nbSeances: 0 }));
  for (const c of creneauxVisibles(creneaux)) {
    if (!c.statut || !c.date.startsWith(`${annee}-`)) continue;
    const m = montantCreneau(c, conventionne);
    if (!m) continue;
    const x = res[Number(c.date.slice(5, 7)) - 1];
    x.virements = r2(x.virements + m.patient + m.mutuelle);
    x.nbSeances++;
  }
  return res;
}

/** Séances de l'agenda (payées ou à recevoir) par jour de l'année : nombre et total, pour vérifier l'export. */
export function seancesParJour(creneaux: Creneau[], annee: number, conventionne = true) {
  const parJour = new Map<string, { date: string; nombre: number; total: number }>();
  for (const c of creneauxVisibles(creneaux)) {
    if (!c.statut || !c.date.startsWith(`${annee}-`)) continue;
    const m = montantCreneau(c, conventionne);
    if (!m) continue;
    const j = parJour.get(c.date) ?? { date: c.date, nombre: 0, total: 0 };
    j.nombre++;
    j.total = r2(j.total + m.patient + m.mutuelle);
    parJour.set(c.date, j);
  }
  return [...parJour.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Jour ouvré (lun-ven) sans aucun créneau rempli ? */
export const jourVide = (date: string, creneaux: Creneau[]) => !creneaux.some((c) => c.date === date && !estVide(c));

/** Ce qui reste à encaisser pour un créneau à recevoir (tiers payant avec part patient déjà payée : la mutuelle seule). */
export function resteCreneau(c: Creneau, conventionne = true): number {
  if (c.statut !== 'arecevoir') return 0;
  const m = montantCreneau(c, conventionne);
  if (!m) return 0;
  return c.mode !== 'totalite' && c.patientPaye ? m.mutuelle : r2(m.patient + m.mutuelle);
}

export interface ProfilPatient {
  /** nom du patient, '' pour les séances sans nom */
  nom: string;
  /** séances (créneaux avec ce nom), de la plus récente à la plus ancienne */
  seances: Creneau[];
  /** total des séances notées (payé + à recevoir) */
  total: number;
  paye: number;
  reste: number;
  /** séances sans statut (importées de Rosa, paiement pas encore noté) */
  aCompleter: number;
}

/** Séances de l'agenda regroupées par patient, avec total, payé et reste à recevoir. Les plus gros restes d'abord. */
export function profilsPatients(creneaux: Creneau[], conventionne = true): ProfilPatient[] {
  const parNom = new Map<string, ProfilPatient>();
  for (const c of creneauxVisibles(creneaux)) {
    const nom = c.patient?.trim() ?? '';
    if (!nom && !c.statut) continue;
    let p = parNom.get(nom);
    if (!p) parNom.set(nom, (p = { nom, seances: [], total: 0, paye: 0, reste: 0, aCompleter: 0 }));
    p.seances.push(c);
    if (!c.statut) {
      p.aCompleter++;
      continue;
    }
    const m = montantCreneau(c, conventionne);
    const t = m ? r2(m.patient + m.mutuelle) : 0;
    const reste = resteCreneau(c, conventionne);
    p.total = r2(p.total + t);
    p.reste = r2(p.reste + reste);
    p.paye = r2(p.total - p.reste);
  }
  for (const p of parNom.values()) p.seances.sort((a, b) => b.date.localeCompare(a.date) || b.debut - a.debut);
  return [...parNom.values()].sort((a, b) => (!a.nom ? 1 : 0) - (!b.nom ? 1 : 0) || b.reste - a.reste || a.nom.localeCompare(b.nom, 'fr'));
}

/** Bascule une séance notée entre payé et à recevoir (payée : la case « part patient déjà payée » n'a plus de sens). */
export function basculerPaiement(c: Creneau): Creneau {
  if (!c.statut) return c;
  const x: Creneau = { ...c, statut: c.statut === 'paye' ? 'arecevoir' : 'paye' };
  delete x.patientPaye;
  return x;
}

/**
 * Paramètres habituels d'un patient (clé = nom complet) : préremplis dans ses nouvelles séances.
 * Les séances déjà notées gardent leurs propres valeurs ; un changement ne vaut que pour les suivantes.
 */
export interface ParamsPatient {
  nom: string;
  mode?: Mode;
  pathologie?: Pathologie;
  bim?: boolean;
  domicile?: boolean;
}

/** Paramètres du patient à reprendre depuis un créneau noté. */
export const paramsDepuis = (nom: string, c: Pick<Creneau, 'mode' | 'pathologie' | 'bim' | 'domicile'>): ParamsPatient => ({
  nom, mode: c.mode, pathologie: c.pathologie, bim: c.bim, domicile: c.domicile,
});

/** Même paramètres ? (évite d'écrire le profil pour rien) */
export const memesParams = (a: ParamsPatient | undefined, b: ParamsPatient) =>
  !!a && (a.mode ?? 'tiers') === (b.mode ?? 'tiers') && (a.pathologie ?? 'courant') === (b.pathologie ?? 'courant')
  && !!a.bim === !!b.bim && !!a.domicile === !!b.domicile;

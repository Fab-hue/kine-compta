// Moteur de calcul des honoraires INAMI kiné (grille au 01-01-2026).
import tarifsJson from '../data/tarifs.json';
import labelsJson from '../data/labels.json';

export interface Tarif {
  amb: string | null;
  hos: string | null;
  section: string;
  lieu: string;
  article: string;
  coef: number;
  valeurM: number;
  /** null = honoraires libres (*) : à saisir par la kiné */
  honoraires: number | null;
  bim_conv: number;
  bim_nonconv: number;
  nonbim_conv: number;
  nonbim_nonconv: number;
}

export const TARIFS: Tarif[] = tarifsJson as Tarif[];

/** Code de nomenclature affiché (ambulatoire, sinon hospitalisé). */
export const codeOf = (t: Tarif) => t.amb ?? t.hos ?? '';

export const findTarif = (code: string) => TARIFS.find((t) => t.amb === code || t.hos === code);

export interface ProfilPaiement {
  bim: boolean;
  conventionne: boolean;
  tiersPayant: boolean;
}

export interface Montants {
  honoraires: number;
  intervention: number;
  ticketModerateur: number;
  /** encaissé directement du patient (=> colonne Carnet) */
  patient: number;
  /** versé par la mutuelle (tiers payant => colonne Virements) */
  mutuelle: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function intervention(t: Tarif, p: Pick<ProfilPaiement, 'bim' | 'conventionne'>): number {
  if (p.bim) return p.conventionne ? t.bim_conv : t.bim_nonconv;
  return p.conventionne ? t.nonbim_conv : t.nonbim_nonconv;
}

/**
 * Calcule ce que rapporte une prestation.
 * Hors tiers payant le patient paie tout et se fait rembourser lui-même.
 * En tiers payant le patient ne paie que le ticket modérateur.
 * honorairesLibres sert pour les codes (*) ou un non-conventionné qui fixe son prix.
 */
export function calculer(t: Tarif, p: ProfilPaiement, honorairesLibres?: number): Montants {
  const inter = intervention(t, p);
  const hono = honorairesLibres ?? t.honoraires ?? inter;
  const tm = r2(Math.max(0, hono - inter));
  return p.tiersPayant
    ? { honoraires: hono, intervention: inter, ticketModerateur: tm, patient: tm, mutuelle: inter }
    : { honoraires: hono, intervention: inter, ticketModerateur: tm, patient: hono, mutuelle: 0 };
}

/** Sections (lieux) disponibles, dans l'ordre de la grille. */
export const SECTIONS = [...new Map(TARIFS.map((t) => [t.section, t.lieu])).entries()].map(
  ([section, lieu]) => ({ section, lieu }),
);

export const articlesDe = (section: string) => [
  ...new Set(TARIFS.filter((t) => t.section === section).map((t) => t.article)),
];

export const tarifsDe = (section: string, article: string) =>
  TARIFS.filter((t) => t.section === section && t.article === article);

/** Indemnités de déplacement (domicile). */
export const DEPLACEMENTS = TARIFS.filter((t) => t.article.startsWith('Indemnit'));


export interface Libelle {
  label: string;
  duree: number | null;
  conditions: string | null;
  confirme: boolean;
}

const LABELS = labelsJson as unknown as Record<string, Libelle>;

export const libelle = (code: string): Libelle | undefined => LABELS[code];

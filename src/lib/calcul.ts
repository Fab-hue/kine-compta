// Calcul des séances importées : quel code, combien, qui paie.
import { calculer, findTarif, type Montants } from './tarifs';

export interface Patient {
  /** clé locale = nom tel qu'il apparaît dans Rosa (jamais envoyé nulle part) */
  id: string;
  section: string;
  article: string;
  /** code de la séance normale */
  code: string;
  /** après `seuil` séances, ce code est utilisé (ex. tarif réduit après 60) */
  codeApresSeuil?: string;
  seuil?: number;
  /** séances déjà prestées avant la première séance importée */
  seancesAnterieures: number;
  bim: boolean;
  tiersPayant: boolean;
  /** mutuelle du patient (ex. « Solidaris ») : sert à lier ses séances aux dispatchs */
  mutuelle?: string;
  /** code d'indemnité de déplacement ajouté à chaque séance (domicile) */
  codeDeplacement?: string;
  /** prix pratiqué si honoraires libres (*) ou non conventionnée */
  honorairesLibres?: number;
}

/** reçu (vert) ou à percevoir (rouge) */
export type EtatPaiement = 'recu' | 'attente';

/**
 * Suivi de l'argent d'une séance.
 * 'tm' : le patient paie le ticket modérateur, la mutuelle le reste (deux moitiés P | M).
 * 'totalite' : le patient paie tout (un seul bloc, `mutuelle` ignoré).
 */
export interface Paiement {
  mode: 'tm' | 'totalite';
  patient: EtatPaiement;
  mutuelle: EtatPaiement;
  /** numéro de dispatch Kinéquick qui a payé la part mutuelle */
  dispatch?: string;
}

export const paiementDefaut = (p?: Pick<Patient, 'tiersPayant'>): Paiement => ({
  mode: p?.tiersPayant ? 'tm' : 'totalite',
  patient: 'attente',
  mutuelle: 'attente',
});

/** Tout est reçu ? (vert complet) */
export const toutRecu = (pa: Paiement) => pa.patient === 'recu' && (pa.mode === 'totalite' || pa.mutuelle === 'recu');

export interface Seance {
  id: string;
  patientId: string;
  /** AAAA-MM-JJ */
  date: string;
  /** HH:MM, début du rendez-vous (pour le calendrier) */
  heure?: string;
  /** absent = paiementDefaut(patient) */
  paiement?: Paiement;
  dureeMin: number;
  /** remplace le code du patient pour cette séance */
  codeForce?: string;
  /** séance non prestée (absence) : ne compte pas */
  annulee?: boolean;
}

export interface SeanceCalculee extends Montants {
  seance: Seance;
  numero: number;
  code: string;
  deplacement: number;
  erreur?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calculerSeances(
  seances: Seance[],
  patients: Map<string, Patient>,
  conventionne: boolean,
): SeanceCalculee[] {
  const tri = [...seances].filter((s) => !s.annulee).sort((a, b) => a.date.localeCompare(b.date));
  const compteur = new Map<string, number>();
  const vide = { honoraires: 0, intervention: 0, ticketModerateur: 0, patient: 0, mutuelle: 0, deplacement: 0 };
  return tri.map((s) => {
    const p = patients.get(s.patientId);
    if (!p) return { ...vide, seance: s, numero: 0, code: '', erreur: 'Patient non configuré' };
    const numero = (compteur.get(p.id) ?? p.seancesAnterieures) + 1;
    compteur.set(p.id, numero);
    const code =
      s.codeForce ?? (p.codeApresSeuil && p.seuil && numero > p.seuil ? p.codeApresSeuil : p.code);
    const t = findTarif(code);
    if (!t) return { ...vide, seance: s, numero, code, erreur: `Code ${code} inconnu` };
    const profil = { bim: p.bim, conventionne, tiersPayant: p.tiersPayant };
    const m = calculer(t, profil, p.honorairesLibres);
    let deplacement = 0;
    if (p.codeDeplacement) {
      const d = findTarif(p.codeDeplacement);
      if (d) {
        const md = calculer(d, profil);
        deplacement = md.honoraires;
        m.honoraires = r2(m.honoraires + md.honoraires);
        m.intervention = r2(m.intervention + md.intervention);
        m.ticketModerateur = r2(m.ticketModerateur + md.ticketModerateur);
        m.patient = r2(m.patient + md.patient);
        m.mutuelle = r2(m.mutuelle + md.mutuelle);
      }
    }
    return { ...m, seance: s, numero, code, deplacement };
  });
}

export interface TotalMois {
  /** 0 = janvier */
  mois: number;
  carnet: number;
  virements: number;
  nbSeances: number;
}

/** Totaux par mois de la séance (année donnée). */
export function totauxParMois(calc: SeanceCalculee[], annee: number): TotalMois[] {
  const res = Array.from({ length: 12 }, (_, mois) => ({ mois, carnet: 0, virements: 0, nbSeances: 0 }));
  for (const c of calc) {
    if (c.erreur || !c.seance.date.startsWith(String(annee))) continue;
    const m = res[Number(c.seance.date.slice(5, 7)) - 1];
    // Carnet = séances payées en totalité, Virements = séances en tiers payant (part patient + mutuelle)
    const mode = c.seance.paiement?.mode ?? (c.mutuelle > 0 ? 'tm' : 'totalite');
    const total = c.patient + c.mutuelle;
    if (mode === 'totalite') m.carnet = r2(m.carnet + total);
    else m.virements = r2(m.virements + total);
    m.nbSeances++;
  }
  return res;
}

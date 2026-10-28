// Suivi des paiements : parts dues par le patient et par la mutuelle pour une séance.
import { paiementDefaut, type Paiement, type Patient, type Seance, type SeanceCalculee } from './calcul';

/** Paiement de la séance, ou valeur par défaut selon le patient (tiers payant ou non). */
export const paiementDe = (s: Seance, p?: Pick<Patient, 'tiersPayant'>): Paiement => s.paiement ?? paiementDefaut(p);

/** Montant dû par le patient : tout en mode « totalité », le ticket modérateur sinon. */
export const partPatient = (c: SeanceCalculee | undefined, mode: Paiement['mode']) =>
  !c || c.erreur ? 0 : mode === 'totalite' ? c.honoraires : c.patient;

/** Montant dû par la mutuelle (0 en mode « totalité »). */
export const partMutuelle = (c: SeanceCalculee | undefined, mode: Paiement['mode']) =>
  !c || c.erreur || mode === 'totalite' ? 0 : c.mutuelle;

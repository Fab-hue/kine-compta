// Stockage local (IndexedDB). Rien n'est envoyé sur internet.
import { openDB, type DBSchema } from 'idb';
import type { Patient, Seance } from './calcul';
import type { Depense } from './excel';
import type { Mouvement } from './banque';
import type { Creneau } from './creneaux';

export interface Ticket extends Depense {
  photo?: Blob;
  texteOcr?: string;
}

/** Numéro de dispatch Kinéquick saisi par la kiné (envoi groupé d'attestations à une mutuelle). */
export interface Dispatch {
  /** `${numero}|${mutuelle normalisée}` : un même numéro peut exister pour plusieurs mutuelles */
  id: string;
  /** 3 chiffres, ex. "370" */
  numero: string;
  /** ex. « Solidaris », « Alliance » ; vide = n'importe quel émetteur */
  mutuelle?: string;
  /** AAAA-MM-JJ de saisie */
  ajoute: string;
  note?: string;
  /** montant attendu (écran eFact Kinéquick) */
  montant?: number;
  /** état affiché par Kinéquick */
  etat?: 'paye' | 'impaye';
  /** AAAA-MM-JJ de l'envoi (écran Kinéquick) */
  date?: string;
}

export interface Reglages {
  annee: number;
  conventionne: boolean;
  loyerMensuel: number;
  retrocession: number[];
  primeInami: { mois: number; montant: number };
  identite: { nomPrenom?: string; adresse?: string; cpCommune?: string; bce?: string };
}

export const REGLAGES_DEFAUT: Reglages = {
  annee: 2026,
  conventionne: true,
  loyerMensuel: 350,
  retrocession: Array(12).fill(0),
  primeInami: { mois: 0, montant: 0 },
  identite: {},
};

interface Schema extends DBSchema {
  patients: { key: string; value: Patient };
  seances: { key: string; value: Seance; indexes: { patient: string } };
  tickets: { key: string; value: Ticket };
  reglages: { key: string; value: Reglages };
  dispatchs: { key: string; value: Dispatch };
  mouvements: { key: string; value: Mouvement };
  creneaux: { key: string; value: Creneau };
}

type Store = 'patients' | 'seances' | 'tickets' | 'dispatchs' | 'mouvements' | 'creneaux';

export const idDispatch = (numero: string, mutuelle?: string) =>
  `${numero}|${(mutuelle ?? '').trim().toLowerCase()}`;

const db = openDB<Schema>('kine-compta', 4, {
  upgrade(d, ancienne) {
    if (ancienne < 1) {
      d.createObjectStore('patients', { keyPath: 'id' });
      d.createObjectStore('seances', { keyPath: 'id' }).createIndex('patient', 'patientId');
      d.createObjectStore('tickets', { keyPath: 'id' });
      d.createObjectStore('reglages');
    }
    if (ancienne < 2) d.createObjectStore('mouvements', { keyPath: 'id' });
    // v3 : dispatchs indexés par id (numéro + mutuelle) au lieu du seul numéro
    if (ancienne === 2) d.deleteObjectStore('dispatchs');
    if (ancienne < 3) d.createObjectStore('dispatchs', { keyPath: 'id' });
    // v4 : agenda en créneaux de 30 min (sans nom de patient)
    if (ancienne < 4) d.createObjectStore('creneaux', { keyPath: 'id' });
  },
});

export const tous = async <S extends Store>(s: S) => (await db).getAll(s);
export const enregistrer = async <S extends Store>(s: S, v: Schema[S]['value']) => (await db).put(s, v);
export const supprimer = async (s: Store, id: string) => (await db).delete(s, id);

/** Ajoute des mouvements bancaires (même id = même ligne, pas de doublon). */
export async function enregistrerMouvements(mouvements: Mouvement[]) {
  const tx = (await db).transaction('mouvements', 'readwrite');
  await Promise.all([...mouvements.map((m) => tx.store.put(m)), tx.done]);
}

export async function enregistrerSeances(seances: Seance[]) {
  const tx = (await db).transaction('seances', 'readwrite');
  await Promise.all([...seances.map((s) => tx.store.put(s)), tx.done]);
}

export const lireReglages = async () => ({ ...REGLAGES_DEFAUT, ...((await (await db).get('reglages', 'r')) ?? {}) });
export const ecrireReglages = async (r: Reglages) => (await db).put('reglages', r, 'r');

/** Sauvegarde complète en JSON (sans les photos) pour changer d'appareil. */
export async function exporterSauvegarde() {
  const tickets = (await tous('tickets')).map(({ photo: _p, ...t }) => t);
  return JSON.stringify({
    patients: await tous('patients'),
    seances: await tous('seances'),
    tickets,
    dispatchs: await tous('dispatchs'),
    mouvements: await tous('mouvements'),
    creneaux: await tous('creneaux'),
    reglages: await lireReglages(),
  });
}

export async function importerSauvegarde(json: string) {
  const d = JSON.parse(json);
  for (const p of d.patients ?? []) await enregistrer('patients', p);
  await enregistrerSeances(d.seances ?? []);
  for (const t of d.tickets ?? []) await enregistrer('tickets', t);
  for (const x of d.dispatchs ?? []) await enregistrer('dispatchs', { ...x, id: x.id ?? idDispatch(x.numero, x.mutuelle) });
  await enregistrerMouvements(d.mouvements ?? []);
  for (const c of d.creneaux ?? []) await enregistrer('creneaux', c);
  if (d.reglages) await ecrireReglages(d.reglages);
}

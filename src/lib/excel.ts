// Remplit une copie de l'Excel du comptable (Fis26) sans toucher aux formules.
import type { TotalMois } from './calcul';

export interface Depense {
  id: string;
  /** AAAA-MM-JJ */
  date: string;
  /** TVA comprise (exemptée art. 44 : pas de TVA récupérable) */
  montant: number;
  /** lettre de colonne de l'onglet Dépenses, ex. "AA" */
  colonne: string;
  fournisseur: string;
  note?: string;
}

/** Catégories de l'onglet « Nom P Dépenses » utiles à une kiné (lettre → libellé). */
export const CATEGORIES: { col: string; label: string }[] = [
  { col: 'A', label: 'Loyer' },
  { col: 'C', label: 'Charges' },
  { col: 'G', label: "Produits d'entretien" },
  { col: 'H', label: 'Entretien / réparations' },
  { col: 'K', label: 'Voiture : taxe' },
  { col: 'L', label: 'Voiture : assurance' },
  { col: 'M', label: 'Voiture : entretien' },
  { col: 'N', label: 'Carburant' },
  { col: 'O', label: 'Frais de transport' },
  { col: 'P', label: 'Voiture : financement' },
  { col: 'Q', label: 'Voyages' },
  { col: 'R', label: 'Trains / taxis' },
  { col: 'U', label: 'Téléphone / GSM' },
  { col: 'V', label: 'Frais de bureau' },
  { col: 'W', label: 'Fournitures de bureau' },
  { col: 'X', label: 'Informatique' },
  { col: 'Y', label: 'Formation' },
  { col: 'Z', label: 'Abonnements / publications' },
  { col: 'AA', label: 'Matériel professionnel' },
  { col: 'AB', label: 'Documentation' },
  { col: 'AC', label: 'Frais de représentation' },
  { col: 'AD', label: 'Cotisations (AXXON, ordre…)' },
  { col: 'AI', label: 'Secrétariat social' },
  { col: 'AJ', label: 'Honoraires (comptable…)' },
  { col: 'AL', label: 'Honoraires divers' },
  { col: 'AO', label: 'Assurance incendie' },
  { col: 'AR', label: 'Assurance RC' },
  { col: 'AT', label: 'Assurance hospitalisation' },
  { col: 'AV', label: 'PLCI' },
  { col: 'AW', label: 'Cotisations sociales' },
  { col: 'AX', label: 'Régularisation cotisations sociales' },
  { col: 'AY', label: 'Revenu garanti' },
  { col: 'BJ', label: 'Frais BCE' },
  { col: 'BL', label: 'Carnets (attestations)' },
  { col: 'BM', label: 'Collecte déchets' },
  { col: 'BQ', label: 'Frais bancaires' },
  { col: 'BR', label: 'Intérêts' },
  { col: 'CD', label: 'Entretien matériel' },
  { col: 'CE', label: 'Petit matériel' },
  { col: 'CF', label: 'Vêtements professionnels' },
  { col: 'CN', label: 'Produits (crèmes, huiles…)' },
  { col: 'CP', label: 'Accessoires' },
];

export const labelCategorie = (col: string) => CATEGORIES.find((c) => c.col === col)?.label ?? col;

export interface Identite {
  nomPrenom?: string;
  adresse?: string;
  cpCommune?: string;
  bce?: string;
}

export interface DonneesExport {
  mois: TotalMois[];
  /** rétrocession par mois (0 = janvier), montant positif */
  retrocession?: number[];
  /** prime INAMI (montant annuel, mis sur le mois choisi) */
  primeInami?: { mois: number; montant: number };
  depenses: Depense[];
  identite?: Identite;
}

const PREMIERE_LIGNE_DEP = 4;
const DERNIERE_LIGNE_DEP = 45;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lignes à écrire dans une colonne : un ticket par ligne, ou un total par mois s'il y en a trop. */
export function lignesColonne(deps: Depense[]): number[] {
  const tri = [...deps].sort((a, b) => a.date.localeCompare(b.date));
  if (tri.length <= DERNIERE_LIGNE_DEP - PREMIERE_LIGNE_DEP + 1) return tri.map((d) => r2(d.montant));
  const parMois = new Map<string, number>();
  for (const d of tri) parMois.set(d.date.slice(0, 7), r2((parMois.get(d.date.slice(0, 7)) ?? 0) + d.montant));
  return [...parMois.values()];
}

export async function remplirExcel(modele: ArrayBuffer, d: DonneesExport): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs'); // chargé seulement à l'export
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modele);

  const rec = wb.getWorksheet('Recettes');
  if (!rec) throw new Error('Onglet « Recettes » introuvable');
  for (const m of d.mois) {
    const row = 7 + m.mois;
    rec.getCell(`E${row}`).value = m.carnet;
    rec.getCell(`G${row}`).value = m.virements;
    rec.getCell(`F${row}`).value = d.retrocession?.[m.mois] ?? 0;
  }
  if (d.primeInami && d.primeInami.montant) rec.getCell(`H${7 + d.primeInami.mois}`).value = d.primeInami.montant;

  const dep = wb.worksheets.find((w) => w.name.endsWith('Dépenses'));
  if (!dep) throw new Error('Onglet « Dépenses » introuvable');
  const parCol = new Map<string, Depense[]>();
  for (const x of d.depenses) parCol.set(x.colonne, [...(parCol.get(x.colonne) ?? []), x]);
  for (const [col, deps] of parCol) {
    for (let r = PREMIERE_LIGNE_DEP; r <= DERNIERE_LIGNE_DEP; r++) dep.getCell(`${col}${r}`).value = null;
    lignesColonne(deps).forEach((v, i) => {
      dep.getCell(`${col}${PREMIERE_LIGNE_DEP + i}`).value = v;
    });
  }

  const syn = wb.getWorksheet('Nom prénom') ?? wb.worksheets[0];
  const id = d.identite;
  if (id?.nomPrenom) syn.getCell('A1').value = id.nomPrenom;
  if (id?.adresse) syn.getCell('A2').value = id.adresse;
  if (id?.cpCommune) syn.getCell('A3').value = id.cpCommune;
  if (id?.bce) syn.getCell('A5').value = id.bce;

  // Excel recalcule les formules à l'ouverture.
  wb.calcProperties.fullCalcOnLoad = true;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Dépenses fixes mensuelles (ex. loyer) générées pour chaque mois de l'année. */
export function depensesFixes(annee: number, fixes: { colonne: string; montant: number; libelle: string }[]): Depense[] {
  return fixes.flatMap((f) =>
    Array.from({ length: 12 }, (_, m) => ({
      id: `fixe-${f.colonne}-${annee}-${m + 1}`,
      date: `${annee}-${String(m + 1).padStart(2, '0')}-01`,
      montant: f.montant,
      colonne: f.colonne,
      fournisseur: f.libelle,
    })),
  );
}

// Lecture d'un extrait de compte (CSV de la banque) et rapprochement des paiements.
// Tout se passe dans le navigateur.
import { lireCsv, parseDate } from './rosa';

export interface Mouvement {
  id: string;
  /** AAAA-MM-JJ */
  date: string;
  /** positif = argent reçu */
  montant: number;
  /** nom de la contrepartie (patient, mutuelle…) */
  nom: string;
  communication: string;
}

export interface ColonnesBanque {
  date: string;
  montant: string;
  nom?: string;
  communication: string[];
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Devine les colonnes d'un CSV bancaire belge (Belfius, BNP, KBC, ING, Argenta…). */
export function devinerColonnesBanque(colonnes: string[]): ColonnesBanque {
  const trouve = (...mots: string[]) => colonnes.find((c) => mots.some((m) => norm(c).includes(m)));
  return {
    date: trouve('date valeur', 'date de valeur', 'date comptable', 'date', 'datum') ?? '',
    montant: trouve('montant', 'bedrag', 'amount') ?? '',
    nom: trouve('nom de la contrepartie', 'contrepartie', 'nom', 'naam', 'name'),
    communication: colonnes.filter((c) =>
      ['communication', 'mededeling', 'libelle', 'details', 'description', 'message'].some((m) => norm(c).includes(m)),
    ),
  };
}

/** « 1.234,56 », « -12,50 », « 58.40 », « +350,00 EUR » → nombre. */
export function parseMontant(s: string): number | null {
  let t = s.replace(/[^\d,.\-+]/g, '');
  if (!/\d/.test(t)) return null;
  // signe en fin de nombre (extrait BNP : « 29,14+ », « 350,00- »)
  const fin = t.match(/^([\d.,]+)([+-])$/);
  if (fin) t = (fin[2] === '-' ? '-' : '') + fin[1];
  const v = t.lastIndexOf(','), p = t.lastIndexOf('.');
  if (v > p) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function lireReleve(texte: string, c?: ColonnesBanque): { colonnes: string[]; mouvements: Mouvement[] } {
  const { colonnes, lignes } = lireCsv(texte);
  const col = c ?? devinerColonnesBanque(colonnes);
  const mouvements: Mouvement[] = [];
  const vus = new Set<string>();
  lignes.forEach((l, i) => {
    const d = parseDate(l[col.date] ?? '');
    const m = parseMontant(l[col.montant] ?? '');
    if (!d || m == null) return;
    const nom = col.nom ? (l[col.nom] ?? '').trim() : '';
    const communication = col.communication.map((k) => (l[k] ?? '').trim()).filter(Boolean).join(' ');
    // id stable : réimporter le même relevé ne crée pas de doublons
    let id = `${d.date}|${m}|${nom}|${communication}`;
    if (vus.has(id)) id += `#${i}`;
    vus.add(id);
    mouvements.push({ id, date: d.date, montant: m, nom, communication });
  });
  return { colonnes, mouvements };
}

/**
 * Numéros de dispatch Kinéquick dans une communication :
 * - exactement 3 chiffres suivis d'un « / » (370/… oui, 5370/… non) ;
 * - ou 3 chiffres après « EN/ZE » (format réel des virements mutuelle sur l'extrait BNP :
 *   « 10029132436 EN/ZE 364 »).
 */
export function numerosDispatch(communication: string): string[] {
  const res = [
    ...[...communication.matchAll(/(?<!\d)(\d{3})\s*\//g)].map((m) => m[1]),
    ...[...communication.matchAll(/EN\s*\/\s*ZE\s+(\d{3})(?!\d)/gi)].map((m) => m[1]),
  ];
  return [...new Set(res)];
}

export interface LigneKinequick {
  numero: string;
  /** nom de la mutuelle (table MUTUELLES) si le code 100/300… est lu */
  mutuelle?: string;
  /** montant attendu du dispatch */
  montant?: number;
  etat?: 'paye' | 'impaye';
  /** AAAA-MM-JJ */
  date?: string;
  /** fin du n° de listing tiers payant (« TP202620 » → « 2620 ») */
  listing?: string;
}

/**
 * Lignes de l'écran eFact de Kinéquick (texte OCR d'une photo) :
 * « 26/10/2026 TP202620 370 € 29,14 Impayé 300 Solidaris, Union Nationale… ».
 * Le code de la mutuelle (100, 300…) n'est pas pris pour un dispatch.
 * L'OCR d'une photo d'écran abîme souvent le texte (« 1P202609 », « €2914 », « 200 Solidaris ») : on tolère ces erreurs.
 */
export function lireEcranKinequick(texte: string): LigneKinequick[] {
  const res: LigneKinequick[] = [];
  for (const brute of texte.split(/\r?\n/)) {
    const dm = brute.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    const tp = brute.match(/[TI1l]\s?P\s?[\dA-Za-z]?\d{4,}/);
    if (!dm && !tp) continue;
    // le n° de dispatch suit le n° de listing ; sans listing lu, on retire la date
    let reste = tp ? brute.slice(tp.index! + tp[0].length) : brute.replace(dm![0], ' ');
    const avecVirgule = reste.match(/(\d{1,3}(?:[.\s]\d{3})*,\d{2})/);
    // « €2914 » : virgule perdue à la lecture
    const sansVirgule = avecVirgule ? null : reste.match(/[€E]\s?(\d{1,4})(\d{2})(?!\d)/);
    const mt = avecVirgule ? [avecVirgule[0], avecVirgule[1]] : sansVirgule ? [sansVirgule[0], `${sansVirgule[1]},${sansVirgule[2]}`] : null;
    if (mt) reste = reste.replace(mt[0], ' ');
    const code = reste.match(/(?<!\d)([1-9]00)\s+[A-Za-zÀ-ÿ]/);
    const sansCode = code ? reste.slice(0, code.index) : reste;
    const num = sansCode.match(/(?<![\d,.])(\d{3})(?![\d,.])/);
    if (!num) continue;
    // le nom lu l'emporte sur le code, plus souvent mal lu (« 200 Solidaris »)
    const mutuelle = MUTUELLES.find((x) => x.alias.some((a) => norm(brute).includes(a)))?.nom
      ?? mutuelleConnue(code?.[1] ?? '')?.nom;
    const etat = /impay/i.test(brute) ? 'impaye' : /pay/i.test(brute) ? 'paye' : undefined;
    const date = dm && +dm[1] >= 1 && +dm[1] <= 31 && +dm[2] >= 1 && +dm[2] <= 12
      ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : undefined;
    res.push({
      numero: num[1],
      ...(mutuelle ? { mutuelle } : {}),
      ...(mt ? { montant: parseMontant(mt[1]) ?? undefined } : {}),
      ...(etat ? { etat } : {}),
      ...(date ? { date } : {}),
      // 4 derniers chiffres du listing (« TP202620 » → 2620) : sert à fusionner plusieurs lectures
      ...(tp ? { listing: tp[0].replace(/\D/g, '').slice(-4) } : {}),
    });
  }
  return res;
}

/**
 * Fusionne plusieurs lectures de la même photo : une ligne par n° de listing (à défaut n° + date),
 * les champs manquants d'une lecture sont complétés par les autres. Ordre de l'écran (listing décroissant).
 */
export function fusionnerEcransKinequick(lectures: LigneKinequick[][]): LigneKinequick[] {
  const parCle = new Map<string, LigneKinequick>();
  for (const l of lectures.flat()) {
    const cle = l.listing ?? `${l.numero}|${l.date ?? ''}`;
    const deja = parCle.get(cle);
    parCle.set(cle, deja ? { ...l, ...deja } : l);
  }
  // une ligne sans listing déjà couverte par une ligne avec listing (même n°, même date) est un doublon
  const lignes = [...parCle.values()].filter((l) => l.listing
    || ![...parCle.values()].some((x) => x.listing && x.numero === l.numero && x.date === l.date));
  return lignes.sort((a, b) => (b.listing ?? '').localeCompare(a.listing ?? ''));
}

/** Morceau de texte d'une page PDF avec sa position horizontale (points). */
export interface MorceauPdf { x: number; s: string }

/**
 * Extrait de compte PDF BNP Paribas Fortis, lu ligne par ligne (une ligne = morceaux à la même hauteur).
 * Opération : « 0398 | Virement en euros | IBAN | 30-09 | 29,14+ », puis à gauche le détail
 * (« Communication : … »), à droite (x ≥ 300) IBAN, BIC, nom et adresse de la contrepartie.
 */
export function lireExtraitBnp(lignes: MorceauPdf[][]): Mouvement[] {
  const res: Mouvement[] = [];
  const vus = new Set<string>();
  const texte = lignes.map((l) => l.map((m) => m.s).join(' ')).join('\n');
  const annee = texte.match(/\d{2}-\d{2}-(\d{4})/)?.[1] ?? String(new Date().getFullYear());
  let jour: string | undefined; // date de l'en-tête « 30-09-2026 »
  let op: { date: string; montant: number; type: string; gauche: string[]; droite: string[] } | null = null;

  const clore = () => {
    if (!op) return;
    const i = op.gauche.findIndex((g) => /^communication\s*:/i.test(g));
    const comm: string[] = [];
    if (i >= 0) {
      comm.push(op.gauche[i].replace(/^communication\s*:\s*/i, ''));
      for (const g of op.gauche.slice(i + 1)) {
        if (/^r[ée]f[ée]rence|^bic\b|^compte/i.test(g)) break;
        comm.push(g);
      }
    }
    const nom = op.droite.find((r) => !/^[A-Z]{2}\d{2}/.test(r) && !/^[A-Z]{6}[A-Z0-9]{2,5}$/.test(r))
      ?? op.gauche.find((g) => /bancontact|payconiq|wero/i.test(g)) ?? op.type;
    const communication = comm.join(' ').replace(/\s+/g, ' ').trim();
    let id = `${op.date}|${op.montant}|${nom}|${communication}`;
    if (vus.has(id)) id += `#${res.length}`;
    vus.add(id);
    res.push({ id, date: op.date, montant: op.montant, nom, communication });
    op = null;
  };

  for (const l of lignes) {
    const tout = l.map((m) => m.s.trim()).join(' ');
    const seul = tout.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (seul) { clore(); jour = `${seul[3]}-${seul[2]}-${seul[1]}`; continue; }
    if (/^solde|bnpparibasfortis|^p\.doc|^les d[ée]p[ôo]ts/i.test(tout) || /solde (actuel|pr[ée]c[ée]dent)/i.test(tout)) { clore(); continue; }
    const debut = /^\d{4}$/.test(l[0]?.s.trim() ?? '') && l[0].x < 70;
    const dernier = l[l.length - 1]?.s.trim() ?? '';
    if (debut && /^[\d.]+,\d{2}\s*[+-]$/.test(dernier)) {
      clore();
      const val = l.find((m) => /^\d{2}-\d{2}$/.test(m.s.trim()))?.s.trim();
      const date = jour ?? (val ? `${annee}-${val.slice(3, 5)}-${val.slice(0, 2)}` : '');
      const montant = parseMontant(dernier);
      if (!date || montant == null) continue;
      op = { date, montant, type: l[1]?.s.trim() ?? '', gauche: [], droite: [] };
      continue;
    }
    if (!op) continue;
    const g = l.filter((m) => m.x < 300).map((m) => m.s.trim()).join(' ').trim();
    const d = l.filter((m) => m.x >= 300 && m.x < 440).map((m) => m.s.trim()).join(' ').trim();
    if (g) op.gauche.push(g);
    if (d) op.droite.push(d);
  }
  clore();
  return res;
}

/**
 * Numéros de dispatch lus sur une capture d'écran Kinéquick (texte OCR) :
 * nombres isolés de 3 chiffres, hors montants (412,30), dates et heures.
 */
export function dispatchsDansTexte(texte: string): string[] {
  const res = [...texte.matchAll(/(?<![\d.,:/-])(\d{3})(?![\d.,:-])/g)].map((m) => m[1]);
  return [...new Set(res)];
}

/** Pour chaque numéro de dispatch saisi, les virements reçus qui le contiennent. */
export function rapprocherDispatchs(numeros: string[], mouvements: Mouvement[]): Map<string, Mouvement[]> {
  const res = new Map(numeros.map((n) => [n, [] as Mouvement[]]));
  for (const m of mouvements) {
    if (m.montant <= 0) continue;
    for (const n of new Set(numerosDispatch(m.communication))) res.get(n)?.push(m);
  }
  return res;
}

/** Vrai si tous les mots du nom de la mutuelle (ex. « Solidaris ») sont dans l'émetteur ou la communication. */
export function correspondMutuelle(mutuelle: string, m: Mouvement): boolean {
  // « F.M.S.B. » sur l'extrait → « fmsb »
  const t = norm(`${m.nom} ${m.communication}`).replace(/\./g, '');
  const connue = mutuelleConnue(mutuelle);
  if (connue) return connue.alias.some((a) => new RegExp(`(^|[^a-z])${a}($|[^a-z])`).test(t));
  const mots = norm(mutuelle).split(/[\s-]+/).filter((x) => x.length > 2);
  return mots.length > 0 && mots.every((x) => t.includes(x));
}

/**
 * Mutuelles belges (code de l'organisme assureur) et noms vus sur les relevés.
 * Ex. Alliance vire sous « LCM-ANMC », Solidaris Brabant sous « FMSB » (300).
 */
export const MUTUELLES: { nom: string; code: string; alias: string[] }[] = [
  { nom: 'Alliance', code: '100', alias: ['allianc', 'anmc', 'lcm', 'mutualite chretienne', 'christelijke'] },
  { nom: 'Solidaris', code: '300', alias: ['solida', 'fmsb', 'mutualite socialiste', 'socialistische'] },
  { nom: 'Mutualités neutres', code: '200', alias: ['mutualite neutre', 'neutrale', 'unmn'] },
  { nom: 'Mutualités libérales', code: '400', alias: ['liberale', 'liberal'] },
  { nom: 'Mutualités libres (Partenamut, Helan…)', code: '500', alias: ['partenamut', 'helan', 'mloz', 'mutualites libres', 'onafhankelijk'] },
  { nom: 'CAAMI', code: '600', alias: ['caami', 'hziv'] },
  { nom: 'HR Rail', code: '900', alias: ['hr rail'] },
];

/** Mutuelle connue d'après un nom saisi (« Solidaris », « fmsb », « 300 »…). */
export function mutuelleConnue(saisie: string) {
  const s = norm(saisie);
  if (!s) return undefined;
  return MUTUELLES.find((x) => x.code === s || norm(x.nom).startsWith(s) || x.alias.some((a) => a === s));
}

/**
 * Virements d'un dispatch. Un même numéro (ex. 363) peut venir de plusieurs mutuelles
 * (Alliance, Solidaris…), chacune avec son virement : si la mutuelle est indiquée,
 * seuls ses virements comptent ; `autres` = virements du même numéro venant d'ailleurs.
 */
export function virementsDispatch(
  d: { numero: string; mutuelle?: string },
  mouvements: Mouvement[],
): { recus: Mouvement[]; autres: Mouvement[] } {
  const tous = rapprocherDispatchs([d.numero], mouvements).get(d.numero) ?? [];
  if (!d.mutuelle?.trim()) return { recus: tous, autres: [] };
  const mut = d.mutuelle;
  return { recus: tous.filter((m) => correspondMutuelle(mut, m)), autres: tous.filter((m) => !correspondMutuelle(mut, m)) };
}

/** Virements dont le nom ou la communication contient tous les mots du nom du patient. */
export function paiementsPatient(patient: string, mouvements: Mouvement[]): Mouvement[] {
  const mots = norm(patient).split(/\s+/).filter((m) => m.length > 1);
  if (!mots.length) return [];
  return mouvements.filter((m) => {
    if (m.montant <= 0) return false;
    const t = norm(`${m.nom} ${m.communication}`);
    return mots.every((x) => t.includes(x));
  });
}

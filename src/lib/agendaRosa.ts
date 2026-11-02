// Lecture d'une capture d'écran de l'agenda Rosa (vue Jour) : noms des patients et heures des rendez-vous.
// Tout se fait sur l'appareil (OCR tesseract.js local). Fonctions pures, testables sans navigateur.
//
// Méthode : les petites heures blanches des blocs (« 09h00 – 09h30 ») se lisent mal, les noms et l'axe des heures
// (« 9:00 », « 9:30 ») se lisent bien. On recale donc l'axe (position verticale → minutes) avec les libellés lus,
// on place chaque nom « NOM Prénom - consultation … » sur cet axe (début), et on mesure la hauteur du bloc coloré
// sous le nom (fin). Une heure « HHhMM – HHhMM » bien lue et cohérente avec la position l'emporte.
import { PAS } from './creneaux';

/** Ligne lue par l'OCR, coordonnées en pixels de l'image analysée (y = haut de la ligne). */
export interface LigneOcr {
  texte: string;
  x: number;
  y: number;
  h: number;
}

/** Pixels RVBA de l'image analysée (même échelle que les lignes). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RdvLu {
  nom: string;
  /** minutes depuis minuit */
  debut: number;
  fin: number;
  /** d'où vient l'heure de fin : texte lu, hauteur du bloc mesurée, ou 30 min par défaut */
  source: 'texte' | 'bloc' | 'defaut';
  /** nom probablement mal lu (début coupé, ou pas au format « NOM Prénom ») : à vérifier dans l'aperçu */
  douteux: boolean;
}

export interface AgendaLu {
  /** AAAA-MM-JJ lue dans l'en-tête (« Lun. 2 nov. 2026 »), si trouvée */
  date?: string;
  rdv: RdvLu[];
}

/** Droite y = a + b × minutes. */
interface Axe {
  a: number;
  b: number;
}

const LIBELLE_HEURE = /^\D{0,3}?(\d{1,2})\s?[:.h ]?\s?(\d{2})\D{0,3}$/;

/** Libellés de l'axe (« 9:00 », « 10.00 », « 1030 », « 13 00 ») → points (minutes, y du centre). */
function pointsAxe(lignes: LigneOcr[]) {
  const pts: { m: number; y: number }[] = [];
  for (const l of lignes) {
    const r = LIBELLE_HEURE.exec(l.texte.trim());
    if (!r) continue;
    const h = Number(r[1]);
    const mn = Number(r[2]);
    if (h < 6 || h > 21 || (mn !== 0 && mn !== 30)) continue;
    pts.push({ m: h * 60 + mn, y: l.y + l.h / 2 });
  }
  return pts;
}

/**
 * Recale l'axe des heures malgré les libellés mal lus (« 18:30 » pour 13:30) : on essaie chaque paire de points,
 * on garde la droite qui en explique le plus (à 8 min près), puis on l'ajuste aux moindres carrés sur ces points.
 */
export function recalerAxe(lignes: LigneOcr[]): Axe | null {
  const pts = pointsAxe(lignes);
  let meilleurs: typeof pts = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const p = pts[i];
      const q = pts[j];
      if (p.m === q.m) continue;
      const b = (q.y - p.y) / (q.m - p.m);
      if (b <= 0) continue;
      const a = p.y - b * p.m;
      const ok = pts.filter((r) => Math.abs(a + b * r.m - r.y) < b * 8);
      // un même libellé lu par deux passages compte une fois
      const distincts = new Set(ok.map((r) => r.m)).size;
      if (distincts > new Set(meilleurs.map((r) => r.m)).size) meilleurs = ok;
    }
  }
  if (new Set(meilleurs.map((r) => r.m)).size < 3) return null;
  const n = meilleurs.length;
  const mx = meilleurs.reduce((s, r) => s + r.m, 0) / n;
  const my = meilleurs.reduce((s, r) => s + r.y, 0) / n;
  const sxy = meilleurs.reduce((s, r) => s + (r.m - mx) * (r.y - my), 0);
  const sxx = meilleurs.reduce((s, r) => s + (r.m - mx) ** 2, 0);
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

const MOIS: Record<string, number> = {
  janv: 1, jan: 1, fevr: 2, fev: 2, mars: 3, mar: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8,
  sept: 9, sep: 9, oct: 10, nov: 11, dec: 12,
};
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « Lun. 2 nov. 2026 » (OCR parfois sans espaces : « Lun.2nov.2026 ») → 2026-11-02. */
export function dateEntete(texte: string): string | undefined {
  const r = /(\d{1,2})\s*\.?\s*([a-z]{3,5})\w*\.?\s*(20\d{2})/i.exec(sansAccents(texte));
  if (!r) return undefined;
  const mois = MOIS[r[2].toLowerCase()] ?? MOIS[r[2].toLowerCase().slice(0, 3)];
  const jour = Number(r[1]);
  if (!mois || jour < 1 || jour > 31) return undefined;
  return `${r[3]}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** « DUPONT Jean - consultation générale » → « DUPONT Jean » (null si ce n'est pas un rendez-vous). */
export function nomDuBloc(texte: string): string | null {
  const r = /^(.*?)\s*[-–—~=]?\s*c[o0]nsu[l1I]t/i.exec(texte);
  if (!r) return null;
  const nom = r[1].replace(/^[^A-Za-zÀ-ÿ]+/, '').replace(/[\s\-–—~=]+$/, '').trim();
  return /[A-Za-zÀ-ÿ]{2}/.test(nom) ? nom : null;
}

/** Rosa écrit « NOM Prénom » : un nom qui suit ce format est plus probablement bien lu. */
const FORMAT_NOM = /^[A-ZÀ-Ý][A-ZÀ-Ý'’-]+(\s[A-ZÀ-Ý'’-]{2,})*\s[A-ZÀ-Ý][a-zà-ÿ'’-]+/;

const PLAGE = /(\d{1,2})\s*[hH]\s*(\d{2})\s*[-–—=~]+\s*(\d{1,2})\s*[hH]\s*(\d{2})/;

/** Distance entre deux couleurs (somme des écarts R, V, B). */
const ecart = (px: Pixels, x: number, y: number, c: number[]) => {
  const i = (y * px.width + x) * 4;
  return Math.abs(px.data[i] - c[0]) + Math.abs(px.data[i + 1] - c[1]) + Math.abs(px.data[i + 2] - c[2]);
};

/**
 * Bas du bloc coloré : depuis (x, y) on descend tant que la couleur reste celle du bloc.
 * La fine ligne claire entre deux blocs, ou le fond, arrête la descente (3 pixels différents de suite).
 */
export function basDuBloc(px: Pixels, x: number, y: number): number | null {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || x >= px.width || y < 0 || y >= px.height) return null;
  const i = (y * px.width + x) * 4;
  const c = [px.data[i], px.data[i + 1], px.data[i + 2]];
  let differents = 0;
  for (let yy = y + 1; yy < px.height; yy++) {
    if (ecart(px, x, yy, c) > 90) {
      if (++differents === 3) return yy - 3;
    } else differents = 0;
  }
  return null;
}

const arrondi = (m: number, pas: number) => Math.round(m / pas) * pas;

/**
 * Rendez-vous de la capture. `passages` : lignes de plusieurs lectures OCR de la même image (même échelle),
 * chacune rate des noms différents. `px` : pixels de l'image, pour mesurer la hauteur des blocs.
 */
export function lireAgendaRosa(passages: LigneOcr[][], px?: Pixels): AgendaLu {
  const toutes = passages.flat();
  const date = toutes.map((l) => dateEntete(l.texte)).find(Boolean);
  const axe = recalerAxe(toutes);
  if (!axe) return { date, rdv: [] };
  const minute = (y: number) => (y - axe.a) / axe.b;

  // noms lus, regroupés par position verticale (le même bloc lu par plusieurs passages)
  const noms = toutes
    .map((l) => ({ l, nom: nomDuBloc(l.texte) }))
    .filter((x): x is { l: LigneOcr; nom: string } => !!x.nom)
    .sort((p, q) => p.l.y - q.l.y);
  const groupes: (typeof noms)[] = [];
  for (const n of noms) {
    const g = groupes.at(-1);
    if (g && Math.abs(n.l.y - g[0].l.y) < axe.b * 8) g.push(n);
    else groupes.push([n]);
  }
  // bord gauche des noms complets : un nom lu plus à droite a perdu son début
  const gauche = Math.min(...noms.map((n) => n.l.x));

  const rdv: RdvLu[] = [];
  for (const g of groupes) {
    const aGauche = (n: (typeof g)[number]) => Math.abs(n.l.x - gauche) < axe.b * 3;
    const note = (n: (typeof g)[number]) => (aGauche(n) ? 0 : 2) + (FORMAT_NOM.test(n.nom) ? 0 : 1);
    const choix = [...g].sort((p, q) => note(p) - note(q) || q.nom.length - p.nom.length)[0];
    const { l } = choix;
    // le haut du texte est un peu sous le haut du bloc ; Rosa place les rendez-vous au quart d'heure
    let debut = arrondi(minute(l.y) - 2, 15);
    let fin = debut + PAS;
    let source: RdvLu['source'] = 'defaut';

    const plage = toutes
      .filter((t) => t.y > l.y && t.y < l.y + l.h * 3.5 && Math.abs(t.x - l.x) < axe.b * 10)
      .map((t) => PLAGE.exec(t.texte))
      .find(Boolean);
    const d1 = plage ? Number(plage[1]) * 60 + Number(plage[2]) : NaN;
    const f1 = plage ? Number(plage[3]) * 60 + Number(plage[4]) : NaN;
    if (plage && Math.abs(d1 - debut) <= 20 && f1 > d1 && f1 - d1 <= 180) {
      debut = d1;
      fin = f1;
      source = 'texte';
    } else if (px) {
      const bas = basDuBloc(px, gauche - axe.b * 2, l.y + l.h / 2);
      const f = bas == null ? NaN : arrondi(minute(bas), 15);
      if (f > debut && f - debut <= 180) {
        fin = f;
        source = 'bloc';
      }
    }
    rdv.push({ nom: choix.nom, debut, fin, source, douteux: note(choix) > 0 });
  }
  return { date, rdv };
}

/** Créneau de l'app (grille de 30 min) pour un rendez-vous Rosa : début arrondi à la demi-heure inférieure. */
export function versGrille(r: Pick<RdvLu, 'debut' | 'fin'>): { debut: number; fin: number } {
  const debut = Math.floor(r.debut / PAS) * PAS;
  const duree = Math.max(PAS, arrondi(r.fin - r.debut, PAS));
  return { debut, fin: debut + duree };
}

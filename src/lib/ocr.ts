// OCR gratuit dans le navigateur (tesseract.js). L'image ne quitte pas l'appareil ;
// worker, noyau wasm et modèle français sont servis par l'app elle-même (public/tesseract/, aucun CDN).
import type { PSM, Worker } from 'tesseract.js';

/** dossier public/tesseract/ résolu contre la page (fonctionne sous un sous-chemin, ex. GitHub Pages) */
const dossierOcr = () => new URL('tesseract/', document.baseURI).href;

let worker: Promise<Worker> | null = null;
/** suivi de la lecture en cours (le logger du worker est fixé à sa création) */
let suivi: ((p: number) => void) | undefined;

/** Worker tesseract unique, créé au premier besoin. */
async function obtenirWorker(): Promise<Worker> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('fra', 1, {
    workerPath: `${dossierOcr()}worker.min.js`,
    corePath: dossierOcr(),
    langPath: dossierOcr(),
    logger: (m) => m.status === 'recognizing text' && suivi?.(m.progress),
  }));
  try {
    return await worker;
  } catch (e) {
    worker = null; // réessayer la prochaine fois (ex. fichiers pas encore en cache)
    throw e;
  }
}

/** `psm` : mode de découpage de tesseract ('3' = page automatique, '6' = un seul bloc de texte). */
export async function lireImage(image: Blob, progression?: (p: number) => void, psm = '3'): Promise<string> {
  const w = await obtenirWorker();
  suivi = progression;
  await w.setParameters({ tessedit_pageseg_mode: psm as PSM });
  const { data } = await w.recognize(image);
  return data.text;
}

/**
 * Photo d'écran (Kinéquick eFact) : l'image brute d'un écran photographié (moiré, 12 Mpx) se lit très mal.
 * On la réduit, la passe en gris contrasté avec un léger flou, et on lit le texte comme un seul bloc,
 * à deux tailles : chaque passage rate quelques lignes, mais rarement les mêmes.
 */
export async function lireEcran(image: Blob, progression?: (p: number) => void): Promise<string[]> {
  const bmp = await createImageBitmap(image);
  const passages = [{ largeur: 2000, flou: 0.8, contraste: 1.5 }, { largeur: 2400, flou: 1.2, contraste: 1.8 }];
  const textes: string[] = [];
  for (const [i, p] of passages.entries()) {
    const c = document.createElement('canvas');
    c.width = p.largeur;
    c.height = Math.round((bmp.height * p.largeur) / bmp.width);
    const ctx = c.getContext('2d')!;
    ctx.filter = `grayscale(1) contrast(${p.contraste}) blur(${p.flou}px)`;
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    textes.push(await lireImage(await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png')),
      (x) => progression?.((i + x) / passages.length), '6'));
  }
  bmp.close();
  return textes;
}

/**
 * Capture d'écran de l'agenda Rosa (vue Jour) : renvoie les lignes lues avec leur position, et les pixels de l'image
 * (même échelle) pour mesurer la hauteur des blocs. Trois passages à 1800 px de large, PSM 11 (texte épars) :
 * - « foncé » = 255 − min(R, V, B) : le texte blanc sur turquoise et le texte noir deviennent tous deux sombres ;
 * - « seuil 200 » = noir/blanc inversé : lit les heures de l'axe (et presque rien d'autre) ;
 * - « seuil 128 » : rattrape une partie des noms mal lus par le premier passage.
 * Chaque passage rate des noms différents ; `lireAgendaRosa` fusionne.
 */
export async function lireAgenda(image: Blob, progression?: (p: number) => void): Promise<{
  passages: { texte: string; x: number; y: number; h: number }[][];
  pixels: ImageData;
}> {
  const bmp = await createImageBitmap(image);
  const largeur = 1800;
  const c = document.createElement('canvas');
  c.width = largeur;
  c.height = Math.round((bmp.height * largeur) / bmp.width);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const pixels = ctx.getImageData(0, 0, c.width, c.height);

  const w = await obtenirWorker();
  const filtres: ((r: number, g: number, b: number) => number)[] = [
    (r, g, b) => 255 - Math.min(r, g, b),
    (r, g, b) => (Math.min(r, g, b) > 200 ? 0 : 255),
    (r, g, b) => (Math.min(r, g, b) > 128 ? 0 : 255),
  ];
  const passages: { texte: string; x: number; y: number; h: number }[][] = [];
  for (const [i, f] of filtres.entries()) {
    const img = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    const d = img.data;
    for (let k = 0; k < d.length; k += 4) d[k] = d[k + 1] = d[k + 2] = f(d[k], d[k + 1], d[k + 2]);
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
    suivi = (x) => progression?.((i + x) / filtres.length);
    await w.setParameters({ tessedit_pageseg_mode: '11' as PSM });
    const { data } = await w.recognize(blob, {}, { blocks: true });
    const lignes = (data.blocks ?? []).flatMap((bl) => bl.paragraphs.flatMap((p) => p.lines));
    passages.push(lignes.map((l) => ({
      texte: l.text.trim(), x: l.bbox.x0, y: l.bbox.y0, h: l.bbox.y1 - l.bbox.y0,
    })).filter((l) => l.texte));
  }
  return { passages, pixels };
}

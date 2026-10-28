// OCR gratuit dans le navigateur (tesseract.js). L'image ne quitte pas l'appareil ;
// worker, noyau wasm et modèle français sont servis par l'app elle-même (public/tesseract/, aucun CDN).
import type { PSM, Worker } from 'tesseract.js';

/** dossier public/tesseract/ résolu contre la page (fonctionne sous un sous-chemin, ex. GitHub Pages) */
const dossierOcr = () => new URL('tesseract/', document.baseURI).href;

let worker: Promise<Worker> | null = null;
/** suivi de la lecture en cours (le logger du worker est fixé à sa création) */
let suivi: ((p: number) => void) | undefined;

/** `psm` : mode de découpage de tesseract ('3' = page automatique, '6' = un seul bloc de texte). */
export async function lireImage(image: Blob, progression?: (p: number) => void, psm = '3'): Promise<string> {
  worker ??= import('tesseract.js').then(({ createWorker }) => createWorker('fra', 1, {
    workerPath: `${dossierOcr()}worker.min.js`,
    corePath: dossierOcr(),
    langPath: dossierOcr(),
    logger: (m) => m.status === 'recognizing text' && suivi?.(m.progress),
  }));
  let w: Worker;
  try {
    w = await worker;
  } catch (e) {
    worker = null; // réessayer au prochain ticket (ex. fichiers pas encore en cache)
    throw e;
  }
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

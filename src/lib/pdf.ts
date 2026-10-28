// Lecture du texte d'un PDF dans le navigateur (pdf.js). Le fichier n'est envoyé nulle part.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { MorceauPdf } from './banque';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Lignes du PDF, page par page : morceaux à la même hauteur, triés de gauche à droite. */
export async function lignesPdf(f: File): Promise<MorceauPdf[][]> {
  const tache = getDocument({ data: new Uint8Array(await f.arrayBuffer()) });
  const doc = await tache.promise;
  const res: MorceauPdf[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const contenu = await (await doc.getPage(n)).getTextContent();
    const parY = new Map<number, MorceauPdf[]>();
    for (const it of contenu.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      // tolérance de 2 points : un même texte peut être décalé d'une fraction
      const cle = [...parY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      parY.set(cle, [...(parY.get(cle) ?? []), { x: it.transform[4], s: it.str }]);
    }
    // y décroissant = du haut vers le bas de la page
    for (const y of [...parY.keys()].sort((a, b) => b - a)) res.push(parY.get(y)!.sort((a, b) => a.x - b.x));
  }
  await tache.destroy();
  return res;
}

// Copie worker, noyaux wasm (variantes lstm) et modèle fra dans public/tesseract/ : l'OCR ne télécharge rien.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

const dest = 'public/tesseract';
mkdirSync(dest, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${dest}/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${dest}/${f}`);
}
cpSync('node_modules/@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz', `${dest}/fra.traineddata.gz`);

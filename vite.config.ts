import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Écrit dist/sw.js : liste de TOUS les fichiers du build + version = hash de leur contenu. */
function precache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'kine-precache',
    apply: 'build',
    configResolved: (c) => { outDir = c.build.outDir; },
    closeBundle() {
      const liste: string[] = [];
      const parcourir = (d: string) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) parcourir(p);
          else liste.push(relative(outDir, p).replaceAll(sep, '/'));
        }
      };
      parcourir(outDir);
      const fichiers = liste.filter((f) => f !== 'sw.js').sort();
      const h = createHash('sha256');
      for (const f of fichiers) h.update(f).update(readFileSync(join(outDir, f)));
      const modele = readFileSync('scripts/sw.js', 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        modele.replace('__VERSION__', h.digest('hex').slice(0, 12)).replace('__PRECACHE__', JSON.stringify(fichiers, null, 1)),
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), precache()],
});

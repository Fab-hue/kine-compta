// Génère les icônes PWA (carré arrondi #156b7a + « K » blanc) en PNG, sans dépendance.
// Usage : node scripts/icones.mjs  → public/icon-192.png, icon-512.png, icon-maskable-512.png
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };

// polygones du « K » dans un repère 0..1 (centré)
const poly = (pts) => pts;
const K = [
  poly([[0.34, 0.25], [0.44, 0.25], [0.44, 0.75], [0.34, 0.75]]),
  poly([[0.44, 0.52], [0.58, 0.25], [0.70, 0.25], [0.53, 0.58]]),
  poly([[0.47, 0.50], [0.56, 0.44], [0.71, 0.75], [0.59, 0.75]]),
];
const dans = (x, y, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r; return r; };

function png(n, rayon, echelleK) {
  const SS = 3, raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      let fond = 0, k = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / n, v = (y + (sy + 0.5) / SS) / n;
        const cx = Math.min(Math.max(u, rayon), 1 - rayon), cy = Math.min(Math.max(v, rayon), 1 - rayon);
        if ((u - cx) ** 2 + (v - cy) ** 2 <= rayon ** 2) {
          fond++;
          const ku = (u - 0.5) / echelleK + 0.5, kv = (v - 0.5) / echelleK + 0.5;
          if (K.some((p) => dans(ku, kv, p))) k++;
        }
      }
      const tot = SS * SS, o = y * (n * 4 + 1) + 1 + x * 4;
      const a = fond / tot, w = k / Math.max(fond, 1);
      raw[o] = Math.round(0x15 + (255 - 0x15) * w); raw[o + 1] = Math.round(0x6b + (255 - 0x6b) * w);
      raw[o + 2] = Math.round(0x7a + (255 - 0x7a) * w); raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', png(192, 0.19, 1));
writeFileSync('public/icon-512.png', png(512, 0.19, 1));
// maskable : fond plein (le système découpe), K réduit dans la zone sûre (80 %)
writeFileSync('public/icon-maskable-512.png', png(512, 0, 0.8));

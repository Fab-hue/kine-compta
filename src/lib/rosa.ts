// Import CSV Rosa : lu dans le navigateur uniquement.
import Papa from 'papaparse';

export interface Correspondance {
  patient: string[];
  date: string;
  debut?: string;
  fin?: string;
  duree?: string;
  statut?: string;
}

export function lireCsv(texte: string): { colonnes: string[]; lignes: Record<string, string>[] } {
  const r = Papa.parse<Record<string, string>>(texte.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    delimitersToGuess: [';', ',', '\t'],
  });
  return { colonnes: r.meta.fields ?? [], lignes: r.data };
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Devine la correspondance des colonnes d'après leur nom. */
export function devinerCorrespondance(colonnes: string[]): Correspondance {
  const trouve = (...mots: string[]) => colonnes.find((c) => mots.some((m) => norm(c).includes(m)));
  const nom = trouve('nom', 'patient', 'client', 'last');
  const prenom = colonnes.find((c) => ['prenom', 'first'].some((m) => norm(c).includes(m)));
  return {
    patient: [nom, prenom].filter((c): c is string => !!c && c !== undefined).filter((c, i, a) => a.indexOf(c) === i),
    date: trouve('date', 'jour', 'day') ?? '',
    debut: trouve('debut', 'start', 'heure', 'de '),
    fin: trouve('fin', 'end', 'jusqu'),
    duree: trouve('duree', 'duration', 'minutes'),
    statut: trouve('statut', 'status', 'etat', 'annul'),
  };
}

/** Accepte JJ/MM/AAAA, JJ-MM-AAAA, AAAA-MM-JJ, avec heure éventuelle. */
export function parseDate(s: string): { date: string; heure?: string } | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, heure: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2})[:h](\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return {
      date: `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      heure: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : undefined,
    };
  }
  return null;
}

const minutes = (h: string) => {
  const m = h.match(/(\d{1,2})[:h](\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** « 30 », « 30 min », « 0:30 », « 1h », « 01:00 » → minutes. */
export function parseDuree(s: string): number | null {
  const t = norm(s);
  const hm = t.match(/^(\d{1,2})[:h](\d{2})?/);
  if (hm && (t.includes(':') || t.includes('h'))) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const n = t.match(/\d+/);
  return n ? Number(n[0]) : null;
}

export interface RdvRosa {
  patient: string;
  date: string;
  /** HH:MM si connue */
  heure?: string;
  dureeMin: number;
  annule: boolean;
}

const ANNULE = /annul|absent|cancel|no.?show|excus/;

export function extraireRdv(lignes: Record<string, string>[], c: Correspondance): RdvRosa[] {
  const out: RdvRosa[] = [];
  for (const l of lignes) {
    const patient = c.patient.map((k) => (l[k] ?? '').trim()).filter(Boolean).join(' ');
    const d = parseDate(l[c.date] ?? '');
    if (!patient || !d) continue;
    let duree: number | null = c.duree ? parseDuree(l[c.duree] ?? '') : null;
    if (duree == null && c.debut && c.fin) {
      const deb = minutes(l[c.debut] ?? '');
      const fin = minutes(l[c.fin] ?? '');
      if (deb != null && fin != null) duree = fin - deb;
    }
    const hDebut = c.debut ? minutes(l[c.debut] ?? '') : null;
    const heure =
      hDebut != null ? `${String(Math.floor(hDebut / 60)).padStart(2, '0')}:${String(hDebut % 60).padStart(2, '0')}` : d.heure;
    out.push({
      patient,
      date: d.date,
      heure,
      dureeMin: duree ?? 30,
      annule: c.statut ? ANNULE.test(norm(l[c.statut] ?? '')) : false,
    });
  }
  return out;
}

// Import d'une capture d'écran de l'agenda Rosa (vue Jour) : noms et horaires → créneaux du Calendrier.
// Lecture OCR sur l'appareil, aperçu modifiable avant d'ajouter quoi que ce soit.
import { useState } from 'react';
import { lireAgendaRosa, versGrille, type RdvLu } from '../lib/agendaRosa';
import { creneauxDuJour, DERNIER, estVide, hhmm, idCreneau, PAS, PREMIER, type Creneau } from '../lib/creneaux';
import { enregistrer } from '../lib/db';
import { lireAgenda } from '../lib/ocr';
import { formatDate, type Donnees } from './common';

interface Ligne extends RdvLu {
  coche: boolean;
}

const versHeure = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const depuisHeure = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/** Pourquoi la ligne ne peut pas être ajoutée (null = OK). `avant` : lignes cochées au-dessus. */
function probleme(l: Ligne, date: string, creneaux: Creneau[], avant: Ligne[]): string | null {
  if (!l.nom.trim()) return 'nom vide';
  if (!(l.fin > l.debut)) return 'heures incorrectes';
  const g = versGrille(l);
  if (g.debut < PREMIER || g.fin > DERNIER + PAS) return 'hors de 8h00 – 17h30';
  const jour = creneauxDuJour(date, creneaux);
  const occupe = jour.find((c) => !estVide(c) && c.debut < g.fin && g.debut < c.fin);
  if (occupe) return `déjà rempli à ${hhmm(occupe.debut)}${occupe.patient ? ` (${occupe.patient})` : ''}`;
  const double = avant.find((a) => {
    const h = versGrille(a);
    return h.debut < g.fin && g.debut < h.fin;
  });
  if (double) return `même créneau que ${double.nom}`;
  return null;
}

export default function ImportCapture({ d, jourAffiche, onDate }: { d: Donnees; jourAffiche: string; onDate: (date: string) => void }) {
  const [lecture, setLecture] = useState<number | null>(null);
  const [erreur, setErreur] = useState('');
  const [date, setDate] = useState('');
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [ajoute, setAjoute] = useState('');

  const lire = async (f: File | undefined) => {
    if (!f) return;
    setLecture(0);
    setErreur('');
    setAjoute('');
    setLignes(null);
    try {
      const { passages, pixels } = await lireAgenda(f, setLecture);
      const lu = lireAgendaRosa(passages, pixels);
      const jour = lu.date ?? jourAffiche;
      setDate(jour);
      const l = lu.rdv.map((r) => ({ ...r, coche: true }));
      // décoche d'office ce qui ne peut pas être ajouté (créneau déjà rempli, hors horaire…)
      const cochees: Ligne[] = [];
      for (const x of l) {
        x.coche = !probleme(x, jour, d.creneaux, cochees);
        if (x.coche) cochees.push(x);
      }
      setLignes(l);
      if (!lu.rdv.length) setErreur('Aucun rendez-vous reconnu. Utilise une capture d\'écran (pas une photo) de la vue Jour de Rosa.');
    } catch (e) {
      setErreur(`Lecture impossible (${e instanceof Error ? e.message : 'erreur'}).`);
    } finally {
      setLecture(null);
    }
  };

  const maj = (i: number, ch: Partial<Ligne>) => setLignes((l) => l && l.map((x, k) => (k === i ? { ...x, ...ch } : x)));

  // problème de chaque ligne, en tenant compte des lignes cochées au-dessus
  const problemes: (string | null)[] = [];
  const cochees: Ligne[] = [];
  for (const l of lignes ?? []) {
    const p = date ? probleme(l, date, d.creneaux, cochees) : 'date manquante';
    problemes.push(p);
    if (l.coche && !p) cochees.push(l);
  }
  const aAjouter = (lignes ?? []).filter((l, i) => l.coche && !problemes[i]);

  const ajouter = async () => {
    for (const l of aAjouter) {
      const g = versGrille(l);
      const c: Creneau = { id: idCreneau(date, g.debut), date, debut: g.debut, fin: g.fin, patient: l.nom.trim() };
      // heure Rosa hors de la grille de 30 min : on la garde en commentaire
      if (g.debut !== l.debut || g.fin !== l.fin) c.commentaire = `Rosa ${hhmm(l.debut)} – ${hhmm(l.fin)}`;
      await enregistrer('creneaux', c);
    }
    await d.recharger();
    setAjoute(`${aAjouter.length} rendez-vous ajouté${aAjouter.length > 1 ? 's' : ''} le ${formatDate(date)}. Clique sur chacun pour noter le paiement.`);
    setLignes(null);
    onDate(date);
  };

  return (
    <div className="import-capture">
      <label className="bouton">
        Importer une capture Rosa
        <input type="file" accept="image/*" hidden onChange={(e) => { void lire(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {lecture != null && (
        <div>
          <p>Lecture de la capture en cours…</p>
          <progress value={lecture} max={1} />
        </div>
      )}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {ajoute && <p className="ok" role="status">{ajoute}</p>}
      {lignes && lignes.length > 0 && (
        <div className="avertissement">
          <strong>Rendez-vous lus sur la capture.</strong> La lecture peut se tromper : vérifie les noms et les heures avant d'ajouter.
          <label className="champ">
            <span>Jour</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <table className="import-table">
            <thead>
              <tr><th aria-label="Ajouter" /><th>Patient</th><th>Début</th><th>Fin</th><th>Remarque</th></tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => {
                const g = versGrille(l);
                const horsGrille = l.fin > l.debut && (g.debut !== l.debut || g.fin !== l.fin);
                return (
                  <tr key={i} className={problemes[i] ? 'import-ko' : ''}>
                    <td><input type="checkbox" aria-label={`Ajouter ${l.nom}`} checked={l.coche} onChange={(e) => maj(i, { coche: e.target.checked })} /></td>
                    <td>
                      <input value={l.nom} aria-label="Nom du patient" onChange={(e) => maj(i, { nom: e.target.value, douteux: false })} />
                      {l.douteux && <small className="a-configurer"> à vérifier</small>}
                    </td>
                    <td><input type="time" step={900} value={versHeure(l.debut)} aria-label="Début" onChange={(e) => maj(i, { debut: depuisHeure(e.target.value) })} /></td>
                    <td><input type="time" step={900} value={versHeure(l.fin)} aria-label="Fin" onChange={(e) => maj(i, { fin: depuisHeure(e.target.value) })} /></td>
                    <td>
                      {problemes[i] ? <small className="erreur">{problemes[i]}</small>
                        : horsGrille ? <small>placé {hhmm(g.debut)} – {hhmm(g.fin)}</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>
            <button className="primaire" disabled={!aAjouter.length} onClick={() => void ajouter()}>
              Ajouter {aAjouter.length} rendez-vous
            </button>{' '}
            <button onClick={() => setLignes(null)}>Annuler</button>
          </p>
        </div>
      )}
    </div>
  );
}

// Import d'une capture d'écran de l'agenda Rosa (vue Jour) : noms et horaires → créneaux du Calendrier.
// Lecture OCR sur l'appareil, aperçu modifiable avant d'ajouter quoi que ce soit.
import { useState } from 'react';
import { lireAgendaRosa, versGrille, type RdvLu } from '../lib/agendaRosa';
import { creneauxSous, DERNIER, estVide, hhmm, idCreneau, PAS, PREMIER, type Creneau } from '../lib/creneaux';
import { enregistrer, supprimer } from '../lib/db';
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

/** Créneaux déjà remplis du Calendrier que ce rendez-vous recouvre. */
function occupes(l: Ligne, date: string, creneaux: Creneau[]): Creneau[] {
  if (!(l.fin > l.debut)) return [];
  const g = versGrille(l);
  // aussi les créneaux restés cachés sous un bloc fusionné : écraser les supprime
  return creneauxSous(creneaux, date, g.debut, g.fin).filter((c) => !estVide(c));
}

const texteOccupe = (o: Creneau[]) =>
  `déjà rempli : ${o.map((c) => `${hhmm(c.debut)}${c.patient ? ` ${c.patient}` : ''}`).join(', ')}`;

/** Pourquoi la ligne ne peut pas être ajoutée (null = OK). `avant` : lignes cochées au-dessus. */
function probleme(l: Ligne, avant: Ligne[]): string | null {
  if (!l.nom.trim()) return 'nom vide';
  if (!(l.fin > l.debut)) return 'heures incorrectes';
  const g = versGrille(l);
  if (g.debut < PREMIER || g.fin > DERNIER + PAS) return 'hors de 8h00 – 17h30';
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
  const [confirmer, setConfirmer] = useState(false);

  const lire = async (f: File | undefined) => {
    if (!f) return;
    setLecture(0);
    setErreur('');
    setAjoute('');
    setLignes(null);
    setConfirmer(false);
    try {
      const { passages, pixels } = await lireAgenda(f, setLecture);
      const lu = lireAgendaRosa(passages, pixels);
      const jour = lu.date ?? jourAffiche;
      setDate(jour);
      const l = lu.rdv.map((r) => ({ ...r, coche: true }));
      // décoche d'office ce qui ne peut pas être ajouté (hors horaire, nom vide…) ; un créneau déjà rempli reste coché :
      // on demandera à l'ajout s'il faut l'écraser
      const cochees: Ligne[] = [];
      for (const x of l) {
        x.coche = !probleme(x, cochees);
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

  const maj = (i: number, ch: Partial<Ligne>) => {
    setLignes((l) => l && l.map((x, k) => (k === i ? { ...x, ...ch } : x)));
    setConfirmer(false);
  };

  // problème de chaque ligne, en tenant compte des lignes cochées au-dessus
  const problemes: (string | null)[] = [];
  const cochees: Ligne[] = [];
  for (const l of lignes ?? []) {
    const p = date ? probleme(l, cochees) : 'date manquante';
    problemes.push(p);
    if (l.coche && !p) cochees.push(l);
  }
  const aAjouter = (lignes ?? []).filter((l, i) => l.coche && !problemes[i]);
  const enConflit = date ? aAjouter.filter((l) => occupes(l, date, d.creneaux).length) : [];

  /** `ecraser` : remplace les créneaux déjà remplis ; sinon ces rendez-vous-là sont laissés de côté. */
  const ajouter = async (ecraser: boolean) => {
    setConfirmer(false);
    const liste = ecraser ? aAjouter : aAjouter.filter((l) => !enConflit.includes(l));
    if (ecraser) {
      const ids = new Set(enConflit.flatMap((l) => occupes(l, date, d.creneaux).map((c) => c.id)));
      for (const id of ids) await supprimer('creneaux', id);
    }
    for (const l of liste) {
      const g = versGrille(l);
      const c: Creneau = { id: idCreneau(date, g.debut), date, debut: g.debut, fin: g.fin, patient: l.nom.trim() };
      // heure Rosa hors de la grille de 30 min : on la garde en commentaire
      if (g.debut !== l.debut || g.fin !== l.fin) c.commentaire = `Rosa ${hhmm(l.debut)} – ${hhmm(l.fin)}`;
      await enregistrer('creneaux', c);
    }
    await d.recharger();
    const garde = aAjouter.length - liste.length;
    const pl = (n: number) => (n > 1 ? 's' : '');
    setAjoute(`${liste.length} rendez-vous ajouté${pl(liste.length)} le ${formatDate(date)}`
      + (ecraser && enConflit.length ? ` (${enConflit.length} à la place de l'existant)` : '')
      + (garde ? `, ${garde} non ajouté${pl(garde)} (créneau déjà rempli gardé)` : '')
      + '. Clique sur chacun pour noter le paiement.');
    setLignes(null);
    onDate(date);
  };

  return (
    <div className="import-capture">
      <label className="bouton primaire">
        Importer une capture d'écran Rosa
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
                const occ = date && !problemes[i] ? occupes(l, date, d.creneaux) : [];
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
                      {problemes[i] ? <small className="erreur">{problemes[i]}</small> : (
                        <>
                          {horsGrille && <small>placé {hhmm(g.debut)} – {hhmm(g.fin)} </small>}
                          {occ.length > 0 && <small className="a-configurer">{texteOccupe(occ)}</small>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {confirmer ? (
            <div className="import-confirmer" role="alertdialog" aria-label="Créneaux déjà remplis">
              <p>
                <strong>{enConflit.length} rendez-vous tombe{enConflit.length > 1 ? 'nt' : ''} sur des créneaux déjà remplis.</strong>{' '}
                Écraser ce qui est en place ? Le paiement déjà noté sur ces créneaux sera perdu.
              </p>
              <p>
                <button className="danger" onClick={() => void ajouter(true)}>Écraser</button>{' '}
                <button className="primaire" onClick={() => void ajouter(false)}>Garder l'existant</button>{' '}
                <button onClick={() => setConfirmer(false)}>Retour</button>
              </p>
            </div>
          ) : (
            <p>
              <button className="primaire" disabled={!aAjouter.length}
                onClick={() => (enConflit.length ? setConfirmer(true) : void ajouter(false))}>
                Ajouter {aAjouter.length} rendez-vous
              </button>{' '}
              <button onClick={() => setLignes(null)}>Annuler</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

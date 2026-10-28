import { useEffect, useRef, useState } from 'react';
import { enregistrer, supprimer, type Ticket } from '../lib/db';
import { CATEGORIES, labelCategorie } from '../lib/excel';
import { lireImage } from '../lib/ocr';
import { analyserTicket } from '../lib/ticket';
import { eur, formatDate, libelleMois, NumInput, uid, Vignette, type Donnees } from './common';

interface Brouillon {
  cle: string;
  id: string;
  photo?: Blob;
  url?: string;
  texteOcr?: string;
  etat: 'attente' | 'lecture' | 'pret';
  progression: number;
  info?: string;
  date: string;
  montant: number | undefined;
  fournisseur: string;
  colonne: string;
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const vierge = (): Brouillon => ({
  cle: uid(), id: uid(), etat: 'pret', progression: 0, date: aujourdhui(), montant: undefined, fournisseur: '', colonne: 'N',
});

export default function Tickets({ d }: { d: Donnees }) {
  const [brouillons, setBrouillons] = useState<Brouillon[]>([]);
  const [filtre, setFiltre] = useState('');
  const enCours = useRef(false);

  const modifier = (cle: string, ch: Partial<Brouillon>) =>
    setBrouillons((l) => l.map((b) => (b.cle === cle ? { ...b, ...ch } : b)));

  // File d'attente OCR : une image à la fois.
  useEffect(() => {
    const suivant = brouillons.find((b) => b.etat === 'attente');
    if (!suivant || enCours.current || !suivant.photo) return;
    enCours.current = true;
    modifier(suivant.cle, { etat: 'lecture', progression: 0 });
    lireImage(suivant.photo, (p) => modifier(suivant.cle, { progression: p }))
      .then((texte) => {
        const t = analyserTicket(texte);
        modifier(suivant.cle, {
          etat: 'pret', texteOcr: texte, date: t.date ?? aujourdhui(), montant: t.montant,
          fournisseur: t.fournisseur ?? '', colonne: t.colonne ?? 'N',
        });
      })
      .catch((e) =>
        modifier(suivant.cle, {
          etat: 'pret',
          info: `Lecture automatique impossible (${e instanceof Error ? e.message : 'erreur'}). Remplis les champs à la main.`,
        }),
      )
      .finally(() => { enCours.current = false; setBrouillons((l) => [...l]); });
  }, [brouillons]);

  const ajouterImages = (files: FileList | null) => {
    if (!files) return;
    const nouveaux: Brouillon[] = [...files].map((f) => ({
      ...vierge(), photo: f, url: URL.createObjectURL(f), etat: 'attente',
    }));
    setBrouillons((l) => [...l, ...nouveaux]);
  };

  const retirer = (b: Brouillon) => {
    if (b.url) URL.revokeObjectURL(b.url);
    setBrouillons((l) => l.filter((x) => x.cle !== b.cle));
  };

  const sauver = async (b: Brouillon) => {
    if (b.montant == null || !b.date) return;
    const t: Ticket = {
      id: b.id, date: b.date, montant: b.montant, colonne: b.colonne, fournisseur: b.fournisseur.trim(),
      ...(b.photo ? { photo: b.photo } : {}), ...(b.texteOcr ? { texteOcr: b.texteOcr } : {}),
    };
    await enregistrer('tickets', t);
    await d.recharger();
    retirer(b);
  };

  const modifierExistant = (t: Ticket) => {
    if (brouillons.some((b) => b.id === t.id)) return;
    setBrouillons((l) => [
      ...l,
      { cle: uid(), id: t.id, photo: t.photo, etat: 'pret', progression: 0, texteOcr: t.texteOcr, date: t.date, montant: t.montant, fournisseur: t.fournisseur, colonne: t.colonne },
    ]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const effacer = async (t: Ticket) => {
    if (!confirm(`Supprimer le ticket « ${t.fournisseur || 'sans nom'} » du ${formatDate(t.date)} ?`)) return;
    await supprimer('tickets', t.id);
    await d.recharger();
  };

  const mois = [...new Set(d.tickets.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const courant = filtre || mois[0] || '';
  const liste = d.tickets.filter((t) => t.date.startsWith(courant)).sort((a, b) => b.date.localeCompare(a.date));
  const parCat = new Map<string, number>();
  for (const t of liste) parCat.set(t.colonne, (parCat.get(t.colonne) ?? 0) + t.montant);
  const total = liste.reduce((s, t) => s + t.montant, 0);

  return (
    <div>
      <section className="carte">
        <h2>Ajouter des tickets</h2>
        <p className="aide">La photo est lue sur ton appareil (la première fois, le modèle de lecture en français est téléchargé, ensuite il est gardé en mémoire).</p>
        <label className="bouton primaire">
          Photographier / choisir une image
          <input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { ajouterImages(e.target.files); e.target.value = ''; }} />
        </label>{' '}
        <button onClick={() => setBrouillons((l) => [...l, vierge()])}>Saisie manuelle</button>

        {brouillons.map((b) => (
          <div className="brouillon" key={b.cle}>
            {b.photo && <Vignette blob={b.photo} />}
            <div className="brouillon-champs">
              {b.etat !== 'pret' ? (
                <div>
                  <p>{b.etat === 'attente' ? 'En attente de lecture…' : 'Lecture du ticket en cours…'}</p>
                  <progress value={b.progression} max={1} />
                </div>
              ) : (
                <>
                  {b.info && <p className="erreur">{b.info}</p>}
                  <div className="grille">
                    <label className="champ"><span>Date</span>
                      <input type="date" value={b.date} onChange={(e) => modifier(b.cle, { date: e.target.value })} />
                    </label>
                    <label className="champ"><span>Montant TVA comprise (€)</span>
                      <NumInput value={b.montant} onChange={(n) => modifier(b.cle, { montant: n })} />
                    </label>
                    <label className="champ"><span>Fournisseur</span>
                      <input value={b.fournisseur} onChange={(e) => modifier(b.cle, { fournisseur: e.target.value })} />
                    </label>
                    <label className="champ"><span>Catégorie</span>
                      <select value={b.colonne} onChange={(e) => modifier(b.cle, { colonne: e.target.value })}>
                        {CATEGORIES.map((c) => <option key={c.col} value={c.col}>{c.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <button className="primaire" disabled={b.montant == null || !b.date} onClick={() => void sauver(b)}>Enregistrer</button>{' '}
                  <button onClick={() => retirer(b)}>Annuler</button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="carte">
        <div className="barre">
          <h2>Tickets enregistrés</h2>
          <label className="champ en-ligne"><span>Mois</span>
            <select value={courant} onChange={(e) => setFiltre(e.target.value)}>
              {mois.length === 0 && <option value="">(aucun ticket)</option>}
              {mois.map((m) => <option key={m} value={m}>{libelleMois(m)}</option>)}
            </select>
          </label>
        </div>
        {liste.length === 0 ? <p className="vide">Aucun ticket pour ce mois.</p> : (
          <>
            <div className="totaux">
              <div><span>Total du mois</span><strong>{eur(total)}</strong></div>
              {[...parCat.entries()].map(([col, m]) => (
                <div key={col}><span>{labelCategorie(col)}</span><strong>{eur(m)}</strong></div>
              ))}
            </div>
            <ul className="liste tickets">
              {liste.map((t) => (
                <li key={t.id}>
                  {t.photo && <Vignette blob={t.photo} />}
                  <div className="ticket-info">
                    <strong>{t.fournisseur || 'Sans nom'}</strong>
                    <span>{formatDate(t.date)} · {labelCategorie(t.colonne)}</span>
                  </div>
                  <strong className="num">{eur(t.montant)}</strong>
                  <button onClick={() => modifierExistant(t)}>Modifier</button>
                  <button className="danger" onClick={() => void effacer(t)}>Supprimer</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

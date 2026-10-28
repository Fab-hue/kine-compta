import { useMemo, useState } from 'react';
import { calculerSeances, type Seance } from '../lib/calcul';
import type { Dispatch } from '../lib/db';
import {
  devinerColonnesBanque, dispatchsDansTexte, fusionnerEcransKinequick, lireEcranKinequick, lireExtraitBnp, lireReleve, MUTUELLES, mutuelleConnue,
  paiementsPatient, virementsDispatch, type ColonnesBanque, type LigneKinequick, type Mouvement,
} from '../lib/banque';
import { enregistrer, enregistrerMouvements, idDispatch, enregistrerSeances, supprimer } from '../lib/db';
import { lireEcran } from '../lib/ocr';
import { lireCsv } from '../lib/rosa';
import { paiementDe, partMutuelle, partPatient } from '../lib/suivi';
import { eur, formatDate, libelleMois, type Donnees } from './common';

const aujourdhui = () => new Date().toISOString().slice(0, 10);

function Releve({ d }: { d: Donnees }) {
  const [texte, setTexte] = useState('');
  const [colonnes, setColonnes] = useState<string[]>([]);
  const [col, setCol] = useState<ColonnesBanque | null>(null);
  const [message, setMessage] = useState('');
  const [pdf, setPdf] = useState<Mouvement[] | null>(null);
  const [erreur, setErreur] = useState('');

  const choisir = async (f: File | undefined) => {
    if (!f) return;
    setErreur('');
    setMessage('');
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      try {
        const { lignesPdf } = await import('../lib/pdf'); // chargé seulement si besoin
        const m = lireExtraitBnp(await lignesPdf(f));
        setPdf(m);
        if (m.length === 0) setErreur("Aucun mouvement trouvé dans ce PDF. Seuls les extraits BNP Paribas Fortis sont reconnus : exporte plutôt un CSV.");
      } catch (e) {
        setErreur(`PDF illisible (${e instanceof Error ? e.message : 'erreur'}).`);
      }
      return;
    }
    const t = await f.text(); // lu sur l'appareil, jamais envoyé
    const r = lireCsv(t);
    setTexte(t);
    setColonnes(r.colonnes);
    setCol(devinerColonnesBanque(r.colonnes));
    setMessage('');
  };

  const lu = useMemo(() => (texte && col ? lireReleve(texte, col).mouvements : []), [texte, col]);

  const ajouter = async (m: Mouvement[]) => {
    await enregistrerMouvements(m);
    await d.recharger();
    setMessage(`${m.length} mouvement(s) ajouté(s) (les lignes déjà connues ne sont pas dupliquées).`);
    setTexte('');
    setCol(null);
    setPdf(null);
  };

  const vider = async () => {
    if (!confirm(`Supprimer les ${d.mouvements.length} mouvements bancaires enregistrés ?`)) return;
    for (const m of d.mouvements) await supprimer('mouvements', m.id);
    await d.recharger();
  };

  const dates = d.mouvements.map((m) => m.date).sort();

  const sel = (label: string, val: string | undefined, set: (v: string) => void, optionnel = true) => (
    <label className="champ">
      <span>{label}</span>
      <select value={val ?? ''} onChange={(e) => set(e.target.value)}>
        {optionnel && <option value="">(aucune)</option>}
        {!optionnel && !val && <option value="">Choisir…</option>}
        {colonnes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );

  return (
    <section className="carte">
      <h2>Relevé bancaire</h2>
      <p className="aide">Extrait de compte en PDF (BNP Paribas Fortis) ou en CSV (toutes banques). Le fichier est lu sur cet appareil, il n'est envoyé nulle part.</p>
      <label className="bouton primaire">
        Choisir l'extrait (PDF ou CSV)
        <input type="file" accept=".pdf,application/pdf,.csv,text/csv,text/plain" hidden onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {message && <p className="ok">{message}</p>}
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {pdf && pdf.length > 0 && (
        <div>
          <h3>Mouvements lus dans le PDF</h3>
          <div className="defile">
            <table>
              <thead><tr><th>Date</th><th>Montant</th><th>Contrepartie</th><th>Communication</th></tr></thead>
              <tbody>
                {pdf.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.date)}</td>
                    <td className={m.montant >= 0 ? 'ok' : undefined}>{eur(m.montant)}</td>
                    <td>{m.nom}</td>
                    <td>{m.communication}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primaire" onClick={() => void ajouter(pdf)}>Ajouter {pdf.length} mouvement(s) au suivi</button>{' '}
          <button onClick={() => setPdf(null)}>Annuler</button>
        </div>
      )}
      {col && (
        <div>
          <h3>Correspondance des colonnes</h3>
          <p className="aide">Vérifie que chaque information est bien associée à la bonne colonne.</p>
          <div className="grille">
            {sel('Date', col.date, (v) => setCol({ ...col, date: v }), false)}
            {sel('Montant', col.montant, (v) => setCol({ ...col, montant: v }), false)}
            {sel('Nom de la contrepartie', col.nom, (v) => setCol({ ...col, nom: v || undefined }))}
          </div>
          <fieldset>
            <legend>Colonnes de communication</legend>
            <div className="cases">
              {colonnes.map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={col.communication.includes(c)}
                    onChange={(e) =>
                      setCol({ ...col, communication: e.target.checked ? [...col.communication, c] : col.communication.filter((x) => x !== c) })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          <p>{lu.length} mouvement(s) lisible(s){lu.length === 0 && ' : vérifie les colonnes date et montant.'}</p>
          <button className="primaire" disabled={lu.length === 0} onClick={() => void ajouter(lu)}>Ajouter au suivi</button>{' '}
          <button onClick={() => { setTexte(''); setCol(null); }}>Annuler</button>
        </div>
      )}
      <p>
        {d.mouvements.length === 0
          ? 'Aucun mouvement enregistré.'
          : `${d.mouvements.length} mouvement(s) enregistré(s), du ${formatDate(dates[0])} au ${formatDate(dates[dates.length - 1])}.`}{' '}
        {d.mouvements.length > 0 && <button className="danger" onClick={() => void vider()}>Vider les mouvements</button>}
      </p>
    </section>
  );
}

const NUMERO = /^\d{3}$/;

/** Choix de la mutuelle émettrice d'un dispatch. */
function ChoixMutuelle(props: { valeur: string; onChange: (v: string) => void; label: string }) {
  return (
    <select aria-label={props.label} value={props.valeur} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">Autre / inconnue</option>
      {MUTUELLES.map((m) => <option key={m.code} value={m.nom}>{m.nom}</option>)}
    </select>
  );
}

function Dispatchs({ d }: { d: Donnees }) {
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState('');
  const [lecture, setLecture] = useState<{ progression: number } | null>(null);
  const [mutSaisie, setMutSaisie] = useState('');
  const [propose, setPropose] = useState<(LigneKinequick & { mutuelle: string; coche: boolean })[] | null>(null);
  const [toutes, setToutes] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [filtre, setFiltre] = useState('');

  const connus = new Set(d.dispatchs.map((x) => x.id));
  const patients = useMemo(() => new Map(d.patients.map((p) => [p.id, p])), [d.patients]);
  const calc = useMemo(
    () => new Map(calculerSeances(d.seances, patients, d.reglages.conventionne).map((c) => [c.seance.id, c])),
    [d.seances, patients, d.reglages.conventionne],
  );

  const ajouterNumeros = async (items: (LigneKinequick & { mutuelle: string })[]) => {
    for (const { numero, mutuelle, montant, etat, date } of items) {
      const id = idDispatch(numero, mutuelle);
      if (connus.has(id)) continue;
      await enregistrer('dispatchs', {
        id, numero, ...(mutuelle ? { mutuelle } : {}), ajoute: aujourdhui(),
        ...(montant != null ? { montant } : {}), ...(etat ? { etat } : {}), ...(date ? { date } : {}),
      });
    }
    await d.recharger();
  };

  const ajouterSaisie = async () => {
    const mots = saisie.split(/[\s,;]+/).filter(Boolean);
    const faux = mots.filter((m) => !NUMERO.test(m));
    if (mots.length === 0) return setErreur('Saisis au moins un numéro.');
    if (faux.length) return setErreur(`Chaque numéro doit avoir exactement 3 chiffres (à corriger : ${faux.join(', ')}).`);
    await ajouterNumeros([...new Set(mots)].map((numero) => ({ numero, mutuelle: mutSaisie })));
    setSaisie('');
    setErreur('');
  };

  const lirePhoto = async (f: File | undefined) => {
    if (!f) return;
    setLecture({ progression: 0 });
    setPropose(null);
    setErreur('');
    try {
      const textes = await lireEcran(f, (p) => setLecture({ progression: p }));
      // écran eFact reconnu : n°, mutuelle et montant ; sinon simples nombres de 3 chiffres
      const ecran = fusionnerEcransKinequick(textes.map(lireEcranKinequick));
      const lignes: LigneKinequick[] = ecran.length ? ecran
        : [...new Set(textes.flatMap(dispatchsDansTexte))].map((numero) => ({ numero }));
      setPropose(lignes.map((x) => ({ ...x, mutuelle: x.mutuelle ?? '', coche: true })));
    } catch (e) {
      setErreur(`Lecture de la photo impossible (${e instanceof Error ? e.message : 'erreur'}). Saisis les numéros à la main.`);
    } finally {
      setLecture(null);
    }
  };

  const confirmerPhoto = async () => {
    await ajouterNumeros(propose!.filter((x) => x.coche && !connus.has(idDispatch(x.numero, x.mutuelle))));
    setPropose(null);
  };

  const lignes = d.dispatchs
    .map((x) => ({ ...x, ...virementsDispatch(x, d.mouvements) }))
    .sort((a, b) => Number(a.recus.length > 0) - Number(b.recus.length > 0) || a.numero.localeCompare(b.numero) || (a.mutuelle ?? '').localeCompare(b.mutuelle ?? ''));
  const nomDispatch = (x: { numero: string; mutuelle?: string }) => (x.mutuelle ? `${x.numero} (${x.mutuelle})` : x.numero);

  // séances dont la part mutuelle est à percevoir (mode ticket modérateur)
  const candidates = (x: Dispatch, toutesMutuelles: boolean) =>
    d.seances.filter((s) => {
      if (s.annulee) return false;
      const pa = paiementDe(s, patients.get(s.patientId));
      if (pa.mode !== 'tm' || pa.mutuelle !== 'attente') return false;
      // pré-filtre : patients de la mutuelle du dispatch (si connue des deux côtés)
      const m = mutuelleConnue(x.mutuelle ?? '');
      const mp = mutuelleConnue(patients.get(s.patientId)?.mutuelle ?? '');
      return toutesMutuelles || !m || m.nom === mp?.nom;
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.heure ?? '').localeCompare(b.heure ?? '')).map((s) => ({ s, lie: s.paiement?.dispatch === x.id }));

  const ouvrir = (x: Dispatch) => {
    if (ouvert === x.id) return setOuvert(null);
    setOuvert(x.id);
    setFiltre('');
    setToutes(false);
    setCoches(new Set(candidates(x, true).filter((c) => c.lie).map((c) => c.s.id)));
  };

  const valider = async (x: Dispatch) => {
    const choisies = candidates(x, true).filter((c) => coches.has(c.s.id)).map((c): Seance => {
      const pa = paiementDe(c.s, patients.get(c.s.patientId));
      return { ...c.s, paiement: { ...pa, mutuelle: 'recu', dispatch: x.id } };
    });
    await enregistrerSeances(choisies);
    await d.recharger();
    setOuvert(null);
  };

  // changer la mutuelle change l'identifiant : on recopie le dispatch et on suit les séances liées
  const changerMutuelle = async (x: Dispatch, mutuelle: string) => {
    const id = idDispatch(x.numero, mutuelle);
    if (id === x.id) return;
    if (connus.has(id)) return setErreur(`Le dispatch ${x.numero} existe déjà pour ${mutuelle || 'une mutuelle non précisée'}.`);
    const { mutuelle: _ancienne, ...reste } = x;
    await enregistrer('dispatchs', { ...reste, id, ...(mutuelle ? { mutuelle } : {}) });
    await supprimer('dispatchs', x.id);
    await enregistrerSeances(d.seances.filter((s) => s.paiement?.dispatch === x.id).map((s) => ({ ...s, paiement: { ...s.paiement!, dispatch: id } })));
    if (ouvert === x.id) setOuvert(null);
    await d.recharger();
  };

  const effacer = async (x: Dispatch) => {
    if (!confirm(`Supprimer le dispatch ${nomDispatch(x)} ?`)) return;
    await supprimer('dispatchs', x.id);
    if (ouvert === x.id) setOuvert(null);
    await d.recharger();
  };

  const dOuvert = d.dispatchs.find((x) => x.id === ouvert);
  const liste = dOuvert ? candidates(dOuvert, toutes) : [];
  const moisListe = [...new Set(liste.map((c) => c.s.date.slice(0, 7)))].sort().reverse();
  const visibles = liste.filter((c) => !filtre || c.s.date.startsWith(filtre));
  const bascule = (id: string, on: boolean) =>
    setCoches((c) => { const n = new Set(c); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <section className="carte">
      <h2>Numéros de dispatch Kinéquick</h2>
      <p className="aide">Un numéro de 3 chiffres identifie un envoi groupé à une mutuelle. Quand le virement apparaît dans le relevé avec ce numéro, la mutuelle a payé.</p>
      <div className="ajout">
        <label className="champ" style={{ flex: 1 }}><span>Numéro(s) à la main (séparés par un espace ou une virgule)</span>
          <input value={saisie} inputMode="numeric" placeholder="370, 371" onChange={(e) => setSaisie(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ajouterSaisie()} />
        </label>
        <label className="champ"><span>Mutuelle</span>
          <ChoixMutuelle label="Mutuelle des numéros saisis" valeur={mutSaisie} onChange={setMutSaisie} />
        </label>
        <button className="primaire" style={{ alignSelf: 'flex-end' }} onClick={() => void ajouterSaisie()}>Ajouter</button>
      </div>
      <label className="bouton">
        Photo de l'écran Kinéquick
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void lirePhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {erreur && <p className="erreur" role="alert">{erreur}</p>}
      {lecture && (
        <div>
          <p>Lecture de la photo en cours…</p>
          <progress value={lecture.progression} max={1} />
        </div>
      )}
      {propose && (
        <div className="avertissement">
          <strong>Numéros repérés sur la photo.</strong> La lecture automatique peut se tromper : vérifie chaque numéro avant d'ajouter.
          {propose.length === 0 ? <p>Aucun numéro à 3 chiffres trouvé. Saisis-les à la main.</p> : (
            <div className="cases">
              {propose.map((x, i) => {
                const deja = connus.has(idDispatch(x.numero, x.mutuelle));
                return (
                  <span key={i} style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center' }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={x.coche && !deja}
                        disabled={deja}
                        onChange={(e) => setPropose(propose.map((y, j) => (j === i ? { ...y, coche: e.target.checked } : y)))}
                      />
                      {x.numero}{x.montant != null && ` · ${eur(x.montant)}`}{x.date && ` · ${formatDate(x.date)}`}{deja && ' (déjà saisi)'}
                    </label>
                    <ChoixMutuelle
                      label={`Mutuelle du dispatch ${x.numero}`}
                      valeur={x.mutuelle}
                      onChange={(v) => setPropose(propose.map((y, j) => (j === i ? { ...y, mutuelle: v } : y)))}
                    />
                  </span>
                );
              })}
            </div>
          )}
          <button className="primaire" disabled={!propose.some((x) => x.coche && !connus.has(idDispatch(x.numero, x.mutuelle)))} onClick={() => void confirmerPhoto()}>Ajouter la sélection</button>{' '}
          <button onClick={() => setPropose(null)}>Annuler</button>
        </div>
      )}

      {lignes.length === 0 ? <p className="vide">Aucun dispatch enregistré.</p> : (
        <div className="defile">
          <table>
            <thead><tr><th>N°</th><th>Mutuelle</th><th>Attendu</th><th>Statut</th><th>Virements</th><th>Actions</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.numero}</strong></td>
                  <td><ChoixMutuelle label={`Mutuelle du dispatch ${l.numero}`} valeur={l.mutuelle ?? ''} onChange={(v) => void changerMutuelle(d.dispatchs.find((y) => y.id === l.id)!, v)} /></td>
                  <td>{l.montant != null ? eur(l.montant) : <span className="vide">?</span>}</td>
                  <td>{l.recus.length ? <span className="ok">✓ Reçu</span> : <span className="erreur">! Pas encore reçu</span>}</td>
                  <td>
                    {l.recus.map((m) => (
                      <div key={m.id}>{formatDate(m.date)} · {eur(m.montant)}{m.nom && ` · ${m.nom}`}</div>
                    ))}
                    {l.montant != null && l.recus.length > 0 && Math.abs(l.recus.reduce((t, m) => t + m.montant, 0) - l.montant) > 0.005 && (
                      <div className="erreur">Écart : reçu {eur(l.recus.reduce((t, m) => t + m.montant, 0))} pour {eur(l.montant)} attendu</div>
                    )}
                    {!l.mutuelle && l.recus.length > 1 && (
                      <div className="aide">Plusieurs virements portent ce numéro : précise la mutuelle.</div>
                    )}
                    {l.autres.length > 0 && (
                      <div className="aide">
                        Aussi un virement {l.numero} d'un autre émetteur : {l.autres.map((m) => `${m.nom || 'sans nom'}, ${eur(m.montant)}`).join(' ; ')}
                      </div>
                    )}
                  </td>
                  <td className="actions">
                    {l.recus.length > 0 && (
                      <button aria-expanded={ouvert === l.id} onClick={() => ouvrir(l)}>Marquer les séances</button>
                    )}
                    <button className="danger" onClick={() => void effacer(l)} aria-label={`Supprimer le dispatch ${nomDispatch(l)}`}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ouvert && (
        <div className="brouillon" style={{ display: 'block' }}>
          <h3 style={{ marginTop: 0 }}>Séances payées par le dispatch {dOuvert ? nomDispatch(dOuvert) : ''}</h3>
          <p className="aide">Coche les séances dont la part mutuelle fait partie de ce virement.</p>
          <label className="cases" style={{ margin: 0 }}>
            <input type="checkbox" checked={toutes} onChange={(e) => setToutes(e.target.checked)} />
            Afficher toutes les mutuelles (sinon : patients de la mutuelle du dispatch)
          </label>
          <label className="champ en-ligne"><span>Mois</span>
            <select value={filtre} onChange={(e) => setFiltre(e.target.value)}>
              <option value="">Tous les mois</option>
              {moisListe.map((m) => <option key={m} value={m}>{libelleMois(m)}</option>)}
            </select>
          </label>
          {visibles.length === 0 ? <p className="vide">Aucune séance avec une part mutuelle en attente.</p> : (
            <ul className="liste">
              {visibles.map(({ s }) => (
                <li key={s.id}>
                  <label className="cases" style={{ margin: 0 }}>
                    <input type="checkbox" checked={coches.has(s.id)} onChange={(e) => bascule(s.id, e.target.checked)} />
                    <span>{formatDate(s.date)}{s.heure ? ` ${s.heure}` : ''} · {s.patientId} · {eur(partMutuelle(calc.get(s.id), 'tm'))}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p>
            <button className="primaire" disabled={coches.size === 0} onClick={() => dOuvert && void valider(dOuvert)}>Marquer {coches.size} séance(s) comme reçue(s)</button>{' '}
            <button onClick={() => setOuvert(null)}>Fermer</button>
          </p>
        </div>
      )}
    </section>
  );
}

function PaiementsPatients({ d }: { d: Donnees }) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [coches, setCoches] = useState<Set<string>>(new Set());

  const patients = useMemo(() => new Map(d.patients.map((p) => [p.id, p])), [d.patients]);
  const calc = useMemo(
    () => new Map(calculerSeances(d.seances, patients, d.reglages.conventionne).map((c) => [c.seance.id, c])),
    [d.seances, patients, d.reglages.conventionne],
  );

  const groupes = useMemo(() => {
    const m = new Map<string, Seance[]>();
    for (const s of d.seances) {
      if (s.annulee || paiementDe(s, patients.get(s.patientId)).patient !== 'attente') continue;
      m.set(s.patientId, [...(m.get(s.patientId) ?? []), s]);
    }
    return [...m.entries()]
      .map(([nom, seances]) => ({
        nom,
        seances: seances.sort((a, b) => a.date.localeCompare(b.date)),
        virements: paiementsPatient(nom, d.mouvements),
        du: seances.reduce((t, s) => t + partPatient(calc.get(s.id), paiementDe(s, patients.get(nom)).mode), 0),
      }))
      .sort((a, b) => b.virements.length - a.virements.length || a.nom.localeCompare(b.nom));
  }, [d.seances, d.mouvements, patients, calc]);

  const ouvrir = (nom: string, seances: Seance[]) => {
    if (ouvert === nom) return setOuvert(null);
    setOuvert(nom);
    setCoches(new Set(seances.map((s) => s.id)));
  };

  const valider = async (seances: Seance[]) => {
    const maj = seances.filter((s) => coches.has(s.id)).map((s): Seance => ({
      ...s, paiement: { ...paiementDe(s, patients.get(s.patientId)), patient: 'recu' },
    }));
    await enregistrerSeances(maj);
    await d.recharger();
    setOuvert(null);
  };

  return (
    <section className="carte">
      <h2>Paiements patients repérés</h2>
      <p className="aide">Virements du relevé dont le nom correspond à un patient. Les paiements en cash se marquent à la main dans l'onglet Calendrier.</p>
      {groupes.length === 0 ? <p className="vide">Aucune part patient en attente.</p> : (
        <ul className="liste">
          {groupes.map((g) => (
            <li key={g.nom}>
              <div className="barre" style={{ marginBottom: 0 }}>
                <div>
                  <strong>{g.nom}</strong> · dû {eur(g.du)} ({g.seances.length} séance(s))
                  {g.virements.length > 0 ? (
                    <div>
                      {g.virements.map((m) => <div key={m.id} className="ok">Virement du {formatDate(m.date)} : {eur(m.montant)}</div>)}
                    </div>
                  ) : <div className="vide">Aucun virement repéré</div>}
                </div>
                {g.virements.length > 0 && (
                  <button aria-expanded={ouvert === g.nom} onClick={() => ouvrir(g.nom, g.seances)}>Marquer reçu</button>
                )}
              </div>
              {ouvert === g.nom && (
                <div className="brouillon" style={{ display: 'block' }}>
                  <p className="aide">Confirme les séances à marquer comme payées par {g.nom}.</p>
                  <ul className="liste">
                    {g.seances.map((s) => (
                      <li key={s.id}>
                        <label className="cases" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={coches.has(s.id)}
                            onChange={(e) => setCoches((c) => { const n = new Set(c); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })}
                          />
                          <span>{formatDate(s.date)}{s.heure ? ` ${s.heure}` : ''} · {eur(partPatient(calc.get(s.id), paiementDe(s, patients.get(g.nom)).mode))}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button className="primaire" disabled={coches.size === 0} onClick={() => void valider(g.seances)}>Confirmer ({coches.size})</button>{' '}
                  <button onClick={() => setOuvert(null)}>Annuler</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Banque({ d }: { d: Donnees }) {
  return (
    <div>
      <Releve d={d} />
      <Dispatchs d={d} />
      <PaiementsPatients d={d} />
    </div>
  );
}

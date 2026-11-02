import { useMemo, useState } from 'react';
import { calculerSeances, type Patient, type Seance } from '../lib/calcul';
import { enregistrer, enregistrerSeances } from '../lib/db';
import { devinerCorrespondance, extraireRdv, lireCsv, type Correspondance } from '../lib/rosa';
import { tarifsDe, codeOf } from '../lib/tarifs';
import { eur, formatDate, hash, libelleMois, type Donnees } from './common';
import ImportCapture from './ImportCapture';

function Import({ d }: { d: Donnees }) {
  const [csv, setCsv] = useState<{ colonnes: string[]; lignes: Record<string, string>[] } | null>(null);
  const [corr, setCorr] = useState<Correspondance | null>(null);
  const [message, setMessage] = useState('');
  const [inconnus, setInconnus] = useState<string[]>([]);

  const choisir = async (f: File | undefined) => {
    if (!f) return;
    const texte = await f.text();
    const r = lireCsv(texte);
    setCsv(r);
    setCorr(devinerCorrespondance(r.colonnes));
    setMessage('');
    setInconnus([]);
  };

  const apercu = useMemo(() => (csv && corr ? extraireRdv(csv.lignes.slice(0, 5), corr) : []), [csv, corr]);
  const total = useMemo(() => (csv && corr ? extraireRdv(csv.lignes, corr).length : 0), [csv, corr]);

  const importer = async () => {
    if (!csv || !corr) return;
    const rdvs = extraireRdv(csv.lignes, corr);
    const occ = new Map<string, number>();
    const existants = new Map(d.seances.map((s) => [s.id, s]));
    const seances: Seance[] = rdvs.map((r) => {
      const cle = `${r.patient}|${r.date}`;
      const n = (occ.get(cle) ?? 0) + 1;
      occ.set(cle, n);
      const id = `${r.date}-${hash(`${cle}|${n}`)}`;
      const ex = existants.get(id);
      return {
        id,
        patientId: r.patient,
        date: r.date,
        heure: r.heure,
        dureeMin: r.dureeMin,
        annulee: r.annule || ex?.annulee || undefined,
        codeForce: ex?.codeForce,
        paiement: ex?.paiement,
      };
    });
    await enregistrerSeances(seances);
    const connus = new Set(d.patients.map((p) => p.id));
    const nouveaux = [...new Set(rdvs.map((r) => r.patient))].filter((p) => !connus.has(p));
    for (const id of nouveaux) {
      const p: Patient = { id, section: '', article: '', code: '', seancesAnterieures: 0, bim: false, tiersPayant: false };
      await enregistrer('patients', p);
    }
    await d.recharger();
    setInconnus(nouveaux);
    setMessage(`${seances.length} rendez-vous importés (en cas de ré-importation, les doublons sont remplacés, pas ajoutés).`);
    setCsv(null);
    setCorr(null);
  };

  const sel = (label: string, val: string | undefined, set: (v: string) => void, optionnel = true) => (
    <label className="champ">
      <span>{label}</span>
      <select value={val ?? ''} onChange={(e) => set(e.target.value)}>
        {optionnel && <option value="">(aucune)</option>}
        {!optionnel && !val && <option value="">Choisir…</option>}
        {csv!.colonnes.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="carte">
      <h2>Importer l'agenda Rosa</h2>
      <p className="aide">Capture d'écran de la vue Jour : les rendez-vous vont dans le Calendrier.</p>
      <ImportCapture d={d} jourAffiche={new Date().toLocaleDateString('sv-SE')}
        onDate={(j) => { sessionStorage.setItem('kc-jour', j); d.aller('calendrier'); }} />
      <p className="aide">Ou un export CSV (ordinateur) :</p>
      <label className="bouton">
        Importer un CSV Rosa
        <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {message && <p className="ok">{message}</p>}
      {inconnus.length > 0 && (
        <div className="avertissement">
          <strong>{inconnus.length} patient(s) à configurer</strong> (lieu, code, tiers payant…) : {inconnus.join(', ')}.{' '}
          <button className="lien" onClick={() => d.aller('patients')}>Ouvrir l'onglet Patients</button>
        </div>
      )}
      {csv && corr && (
        <div>
          <h3>Correspondance des colonnes</h3>
          <p className="aide">Vérifie que chaque information est bien associée à la bonne colonne de ton fichier.</p>
          <div className="grille">
            {sel('Patient : colonne 1 (nom)', corr.patient[0], (v) => setCorr({ ...corr, patient: [v, corr.patient[1]].filter(Boolean) }), false)}
            {sel('Patient : colonne 2 (prénom)', corr.patient[1], (v) => setCorr({ ...corr, patient: [corr.patient[0], v].filter(Boolean) }))}
            {sel('Date', corr.date, (v) => setCorr({ ...corr, date: v }), false)}
            {sel('Heure de début', corr.debut, (v) => setCorr({ ...corr, debut: v || undefined }))}
            {sel('Heure de fin', corr.fin, (v) => setCorr({ ...corr, fin: v || undefined }))}
            {sel('Durée', corr.duree, (v) => setCorr({ ...corr, duree: v || undefined }))}
            {sel('Statut (annulé…)', corr.statut, (v) => setCorr({ ...corr, statut: v || undefined }))}
          </div>
          <h3>Aperçu (5 premières lignes)</h3>
          <div className="defile">
            <table>
              <thead><tr><th>Patient</th><th>Date</th><th>Durée</th><th>Annulé</th></tr></thead>
              <tbody>
                {apercu.map((r, i) => (
                  <tr key={i}><td>{r.patient}</td><td>{formatDate(r.date)}</td><td>{r.dureeMin} min</td><td>{r.annule ? 'oui' : 'non'}</td></tr>
                ))}
                {apercu.length === 0 && <tr><td colSpan={4} className="vide">Aucune ligne lisible : vérifie les colonnes patient et date.</td></tr>}
              </tbody>
            </table>
          </div>
          <p>{total} rendez-vous lisibles sur {csv.lignes.length} lignes.</p>
          <button className="primaire" disabled={total === 0} onClick={() => void importer()}>Importer</button>{' '}
          <button onClick={() => { setCsv(null); setCorr(null); }}>Annuler</button>
        </div>
      )}
    </section>
  );
}

export default function Seances({ d }: { d: Donnees }) {
  const patients = useMemo(() => {
    const m = new Map<string, Patient>();
    for (const p of d.patients) if (p.code) m.set(p.id, p);
    return m;
  }, [d.patients]);
  const calc = useMemo(() => calculerSeances(d.seances, patients, d.reglages.conventionne), [d.seances, patients, d.reglages.conventionne]);
  const mois = useMemo(() => [...new Set(d.seances.map((s) => s.date.slice(0, 7)))].sort().reverse(), [d.seances]);
  const [choix, setChoix] = useState('');
  const maintenant = new Date().toISOString().slice(0, 7);
  const courant = choix || (mois.includes(maintenant) ? maintenant : mois[0] ?? '');
  const lignes = calc.filter((c) => c.seance.date.startsWith(courant)).reverse();
  const annulees = d.seances.filter((s) => s.annulee && s.date.startsWith(courant)).sort((a, b) => b.date.localeCompare(a.date));
  const ok = lignes.filter((c) => !c.erreur);
  const somme = (f: (c: (typeof ok)[number]) => number) => ok.reduce((t, c) => t + f(c), 0);

  const maj = async (s: Seance, ch: Partial<Seance>) => {
    await enregistrer('seances', { ...s, ...ch });
    await d.recharger();
  };

  const codesPossibles = (pid: string) => {
    const p = patients.get(pid);
    if (!p) return [];
    const base = tarifsDe(p.section, p.article).map(codeOf);
    return [...new Set([...base, p.code, ...(p.codeApresSeuil ? [p.codeApresSeuil] : [])])];
  };

  return (
    <div>
      <Import d={d} />
      <section className="carte">
        <div className="barre">
          <h2>Séances calculées</h2>
          <label className="champ en-ligne">
            <span>Mois</span>
            <select value={courant} onChange={(e) => setChoix(e.target.value)}>
              {mois.length === 0 && <option value="">(aucune séance)</option>}
              {mois.map((m) => <option key={m} value={m}>{libelleMois(m)}</option>)}
            </select>
          </label>
        </div>
        <div className="totaux">
          <div><span>Séances</span><strong>{ok.length}</strong></div>
          <div><span>Honoraires</span><strong>{eur(somme((c) => c.honoraires))}</strong></div>
          <div><span>Part patient (Carnet)</span><strong>{eur(somme((c) => c.patient))}</strong></div>
          <div><span>Part mutuelle (Virements)</span><strong>{eur(somme((c) => c.mutuelle))}</strong></div>
        </div>
        {lignes.length === 0 ? (
          <p className="vide">Aucune séance pour ce mois. Importe un CSV Rosa ci-dessus.</p>
        ) : (
          <div className="defile">
            <table>
              <thead>
                <tr><th>Date</th><th>Patient</th><th>N°</th><th>Code</th><th>Durée</th><th>Honoraires</th><th>Patient</th><th>Mutuelle</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {lignes.map((c) => (
                  <tr key={c.seance.id} className={c.erreur ? 'ligne-erreur' : ''}>
                    <td>{formatDate(c.seance.date)}</td>
                    <td>{c.seance.patientId}</td>
                    <td>{c.numero || ''}</td>
                    <td>
                      {c.erreur ? <span className="erreur">{c.erreur}</span> : c.code}
                      {c.seance.codeForce && <small> (forcé)</small>}
                    </td>
                    <td>{c.seance.dureeMin} min</td>
                    <td className="num">{c.erreur ? '' : eur(c.honoraires)}</td>
                    <td className="num">{c.erreur ? '' : eur(c.patient)}</td>
                    <td className="num">{c.erreur ? '' : eur(c.mutuelle)}</td>
                    <td className="actions">
                      {patients.has(c.seance.patientId) && (
                        <select
                          aria-label="Forcer un code"
                          value={c.seance.codeForce ?? ''}
                          onChange={(e) => void maj(c.seance, { codeForce: e.target.value || undefined })}
                        >
                          <option value="">Code auto</option>
                          {codesPossibles(c.seance.patientId).map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      )}
                      <button onClick={() => void maj(c.seance, { annulee: true })}>Annulée</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {annulees.length > 0 && (
          <details>
            <summary>{annulees.length} séance(s) annulée(s) ce mois-ci</summary>
            <ul className="liste">
              {annulees.map((s) => (
                <li key={s.id}>
                  {formatDate(s.date)} · {s.patientId} <button onClick={() => void maj(s, { annulee: false })}>Rétablir</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

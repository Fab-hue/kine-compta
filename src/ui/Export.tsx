import { useMemo, useState } from 'react';
import { calculerSeances, totauxParMois, type Patient } from '../lib/calcul';
import { totauxCreneauxParMois } from '../lib/creneaux';
import { depensesFixes, remplirExcel } from '../lib/excel';
import { eur, MOIS, type Donnees } from './common';

export default function Export({ d }: { d: Donnees }) {
  const { reglages: r } = d;
  const [annee, setAnnee] = useState(r.annee);
  const [etat, setEtat] = useState('');
  const [enCours, setEnCours] = useState(false);

  const mois = useMemo(() => {
    const patients = new Map<string, Patient>();
    for (const p of d.patients) if (p.code) patients.set(p.id, p);
    // agenda (créneaux payés ou à recevoir) + séances importées, au mois de la séance
    const ag = totauxCreneauxParMois(d.creneaux, annee, r.conventionne);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return totauxParMois(calculerSeances(d.seances, patients, r.conventionne), annee).map((m, i) => ({
      mois: m.mois,
      carnet: r2(m.carnet + ag[i].carnet),
      virements: r2(m.virements + ag[i].virements),
      nbSeances: m.nbSeances + ag[i].nbSeances,
    }));
  }, [d.patients, d.seances, d.creneaux, r.conventionne, annee]);

  const tickets = d.tickets.filter((t) => t.date.startsWith(String(annee)));
  const depMois = (m: number) =>
    tickets.filter((t) => Number(t.date.slice(5, 7)) - 1 === m).reduce((s, t) => s + t.montant, 0);
  const tot = (f: (m: (typeof mois)[number]) => number) => mois.reduce((s, m) => s + f(m), 0);

  const incomplets = d.patients.filter((p) => !p.code && d.seances.some((s) => s.patientId === p.id && s.date.startsWith(String(annee))));

  const telecharger = async () => {
    setEnCours(true);
    setEtat('');
    try {
      const rep = await fetch('./Fis26__BLANC.xlsx');
      if (!rep.ok) throw new Error('modèle Excel introuvable');
      const modele = await rep.arrayBuffer();
      const fixes = r.loyerMensuel > 0 ? depensesFixes(annee, [{ colonne: 'A', montant: r.loyerMensuel, libelle: 'Loyer' }]) : [];
      const buf = await remplirExcel(modele, {
        mois,
        retrocession: r.retrocession,
        primeInami: r.primeInami,
        identite: r.identite,
        depenses: [...tickets, ...fixes],
      });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Fis${String(annee).slice(2)}_rempli_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setEtat('Fichier téléchargé.');
    } catch (e) {
      setEtat(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="carte">
      <div className="barre">
        <h2>Export Excel</h2>
        <label className="champ en-ligne"><span>Année</span>
          <input type="number" value={annee} onChange={(e) => setAnnee(Number(e.target.value) || r.annee)} />
        </label>
      </div>
      {incomplets.length > 0 && (
        <p className="avertissement">
          {incomplets.length} patient(s) ne sont pas configurés : leurs séances ne sont pas comptées ({incomplets.map((p) => p.id).join(', ')}).{' '}
          <button className="lien" onClick={() => d.aller('patients')}>Configurer</button>
        </p>
      )}
      <p className="aide">Carnet = part patient, Virements = part mutuelle. Comptés : créneaux de l'agenda payés ou à recevoir + séances importées, au mois de la séance.</p>
      <div className="defile">
        <table>
          <thead><tr><th>Mois</th><th>Carnet</th><th>Virements</th><th>Séances</th><th>Dépenses (tickets)</th></tr></thead>
          <tbody>
            {mois.map((m) => (
              <tr key={m.mois}>
                <td>{MOIS[m.mois]}</td>
                <td className="num">{eur(m.carnet)}</td>
                <td className="num">{eur(m.virements)}</td>
                <td className="num">{m.nbSeances}</td>
                <td className="num">{eur(depMois(m.mois))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="num">{eur(tot((m) => m.carnet))}</th>
              <th className="num">{eur(tot((m) => m.virements))}</th>
              <th className="num">{tot((m) => m.nbSeances)}</th>
              <th className="num">{eur(tickets.reduce((s, t) => s + t.montant, 0))}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="aide">
        Le loyer ({eur(r.loyerMensuel)} par mois) est ajouté automatiquement dans le fichier s'il est supérieur à zéro.
      </p>
      <button className="primaire" disabled={enCours} onClick={() => void telecharger()}>
        {enCours ? 'Préparation…' : "Télécharger l'Excel rempli"}
      </button>
      {etat && <p className={etat.startsWith('Erreur') ? 'erreur' : 'ok'}>{etat}</p>}
    </section>
  );
}

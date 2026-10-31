import { useState } from 'react';
import { ecrireReglages, exporterSauvegarde, importerSauvegarde, REGLAGES_DEFAUT, supprimer, tous, type Reglages } from '../lib/db';
import { MOIS, NumInput, type Donnees } from './common';

export default function ReglagesTab({ d }: { d: Donnees }) {
  const r = d.reglages;
  const [msg, setMsg] = useState('');
  const maj = (ch: Partial<Reglages>) => d.setReglages({ ...r, ...ch });
  const majId = (ch: Partial<Reglages['identite']>) => maj({ identite: { ...r.identite, ...ch } });

  const exporter = async () => {
    const json = await exporterSauvegarde();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `kine-compta-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setMsg('Sauvegarde téléchargée (les photos des tickets ne sont pas incluses).');
  };

  const importer = async (f: File | undefined) => {
    if (!f) return;
    try {
      await importerSauvegarde(await f.text());
      await d.recharger();
      setMsg('Sauvegarde restaurée.');
    } catch (e) {
      setMsg(`Erreur : fichier illisible (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const toutEffacer = async () => {
    if (!confirm('Effacer TOUTES les données (patients, séances, agenda, tickets, banque, réglages) de cet appareil ? Cette action est définitive.')) return;
    if (!confirm('Dernière confirmation : tout effacer ?')) return;
    for (const s of ['patients', 'seances', 'tickets', 'dispatchs', 'mouvements', 'creneaux'] as const) {
      for (const x of await tous(s)) await supprimer(s, x.id);
    }
    await ecrireReglages(REGLAGES_DEFAUT);
    await d.recharger();
    setMsg('Toutes les données ont été effacées.');
  };

  return (
    <div>
      <section className="carte">
        <h2>Réglages généraux</h2>
        <div className="grille">
          <label className="champ"><span>Année comptable</span>
            <input type="number" value={r.annee} onChange={(e) => maj({ annee: Number(e.target.value) || r.annee })} />
          </label>
          <label className="champ"><span>Loyer mensuel (€)</span>
            <NumInput value={r.loyerMensuel} onChange={(n) => maj({ loyerMensuel: n ?? 0 })} />
          </label>
        </div>
        <div className="cases">
          <label><input type="checkbox" checked={r.conventionne} onChange={(e) => maj({ conventionne: e.target.checked })} /> Kiné conventionnée</label>
        </div>
      </section>

      <section className="carte">
        <h2>Rétrocession par mois (€)</h2>
        <div className="grille mois">
          {MOIS.map((m, i) => (
            <label className="champ" key={m}><span>{m}</span>
              <NumInput value={r.retrocession[i] || undefined} placeholder="0" onChange={(n) => maj({ retrocession: r.retrocession.map((v, j) => (j === i ? n ?? 0 : v)) })} />
            </label>
          ))}
        </div>
      </section>

      <section className="carte">
        <h2>Prime INAMI</h2>
        <div className="grille">
          <label className="champ"><span>Montant (€)</span>
            <NumInput value={r.primeInami.montant || undefined} placeholder="0" onChange={(n) => maj({ primeInami: { ...r.primeInami, montant: n ?? 0 } })} />
          </label>
          <label className="champ"><span>Mois de réception</span>
            <select value={r.primeInami.mois} onChange={(e) => maj({ primeInami: { ...r.primeInami, mois: Number(e.target.value) } })}>
              {MOIS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="carte">
        <h2>Identité (pour l'Excel)</h2>
        <div className="grille">
          <label className="champ"><span>Nom Prénom</span><input value={r.identite.nomPrenom ?? ''} onChange={(e) => majId({ nomPrenom: e.target.value })} /></label>
          <label className="champ"><span>Adresse</span><input value={r.identite.adresse ?? ''} onChange={(e) => majId({ adresse: e.target.value })} /></label>
          <label className="champ"><span>Code postal et commune</span><input value={r.identite.cpCommune ?? ''} onChange={(e) => majId({ cpCommune: e.target.value })} /></label>
          <label className="champ"><span>N° BCE</span><input value={r.identite.bce ?? ''} onChange={(e) => majId({ bce: e.target.value })} /></label>
        </div>
        <p className="aide">Les réglages sont enregistrés automatiquement.</p>
      </section>

      <section className="carte">
        <h2>Sauvegarde</h2>
        <p>Tes données restent sur cet appareil ; fais une sauvegarde régulière.</p>
        <button className="primaire" onClick={() => void exporter()}>Exporter une sauvegarde (JSON)</button>{' '}
        <label className="bouton">
          Importer une sauvegarde
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { void importer(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {msg && <p className={msg.startsWith('Erreur') ? 'erreur' : 'ok'}>{msg}</p>}
        <hr />
        <button className="danger" onClick={() => void toutEffacer()}>Tout effacer</button>
      </section>
    </div>
  );
}

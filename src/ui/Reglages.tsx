import { useState } from 'react';
import { ecrireReglages, exporterSauvegarde, importerSauvegarde, REGLAGES_DEFAUT, supprimer, tous, type Reglages } from '../lib/db';
import { MOIS, NumInput, type Donnees } from './common';
import { icsRappel, isoLocal, notifier } from '../lib/rappel';

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

  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'absent'));
  const lienApp = new URL(import.meta.env.BASE_URL, location.origin).href;
  const autoriser = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') void notifier();
  };
  const telechargerIcs = () => {
    const url = URL.createObjectURL(new Blob([icsRappel(lienApp)], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rappel-kine-compta.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const j = isoLocal(new Date()).replaceAll('-', '');
  // aucune donnée patient dans ce lien : seulement le titre du rappel et l'heure
  const lienGoogle = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent("Kiné Compta : remplir l'agenda du jour")}`
    + `&dates=${j}T180000/${j}T181500&ctz=Europe/Brussels`
    + `&recur=${encodeURIComponent('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')}`
    + `&details=${encodeURIComponent(lienApp)}`;

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
        <h2>Rappel à 18h</h2>
        <div className="cases">
          <label><input type="checkbox" checked={!!r.rappel} onChange={(e) => maj({ rappel: e.target.checked })} /> Me rappeler de remplir l'agenda (lun-ven, 18h)</label>
        </div>
        <p className="aide">
          Dans l'app : un bandeau s'affiche après 18h si rien n'est noté pour la journée. Avec les notifications autorisées,
          une notification arrive aussi à 18h, mais seulement si l'app est ouverte (ou en arrière-plan sur ordinateur).
        </p>
        {perm === 'granted' ? (
          <p className="ok">Notifications autorisées. <button className="lien" onClick={() => void notifier()}>Tester</button></p>
        ) : perm === 'denied' ? (
          <p className="avertissement">Notifications bloquées : les réautoriser dans les réglages du navigateur pour ce site.</p>
        ) : perm === 'absent' ? (
          <p className="aide">Ce navigateur ne gère pas les notifications (sur iPhone : installer l'app sur l'écran d'accueil d'abord).</p>
        ) : (
          <button onClick={() => void autoriser()} disabled={!r.rappel}>Autoriser les notifications</button>
        )}
        <h3>Rappel même app fermée</h3>
        <p className="aide">
          Sans serveur (aucune donnée ne sort du téléphone), seul l'agenda du téléphone peut sonner à 18h quand l'app est fermée.
          Ajoute une fois l'événement récurrent :
        </p>
        <button onClick={telechargerIcs}>Ajouter à l'agenda du téléphone (.ics)</button>{' '}
        <a className="bouton" href={lienGoogle} target="_blank" rel="noopener noreferrer">Ajouter à Google Agenda</a>
        <p className="aide">iPhone : fichier .ics. Android : Google Agenda (le lien n'envoie que le titre du rappel et l'heure).</p>
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

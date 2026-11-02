// Suivi par patient (agenda) : séances, total, payé, reste à recevoir, bascule Payé / À recevoir,
// et paramètres habituels (mode, pathologie, BIM, domicile) repris pour ses prochaines séances.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  basculerPaiement, hhmm, montantCreneau, PATHOLOGIES, profilsPatients, resteCreneau,
  type Creneau, type Mode, type ProfilPatient, type ParamsPatient, type Pathologie,
} from '../lib/creneaux';
import { enregistrer } from '../lib/db';
import { eur, formatDate, type Donnees } from './common';

const SANS_NOM = 'Séances sans nom';

function Parametres({ d, nom }: { d: Donnees; nom: string }) {
  const actuel = d.profils.find((p) => p.nom === nom);
  const [p, setP] = useState<ParamsPatient>(actuel ?? { nom });
  const [ok, setOk] = useState(false);
  const maj = (ch: Partial<ParamsPatient>) => { setP((x) => ({ ...x, ...ch })); setOk(false); };

  const sauver = async () => {
    await enregistrer('profils', { ...p, nom });
    await d.recharger();
    setOk(true);
  };

  return (
    <fieldset>
      <legend>Paramètres habituels</legend>
      <p className="aide">
        Repris d'office pour ses prochaines séances. Les séances déjà notées gardent leurs propres valeurs.
        {!actuel && ' Rien d\'enregistré pour l\'instant : ils seront retenus à sa prochaine séance notée.'}
      </p>
      <div className="cases">
        <label><input type="radio" name="p-mode" checked={(p.mode ?? 'tiers') === 'tiers'} onChange={() => maj({ mode: 'tiers' as Mode })} /> Tiers payant</label>
        <label><input type="radio" name="p-mode" checked={p.mode === 'totalite'} onChange={() => maj({ mode: 'totalite' as Mode })} /> Totalité</label>
      </div>
      <div className="cases">
        <label><input type="checkbox" checked={!!p.bim} onChange={(e) => maj({ bim: e.target.checked })} /> BIM / VIPO</label>
        <label><input type="checkbox" checked={!!p.domicile} onChange={(e) => maj({ domicile: e.target.checked })} /> À domicile</label>
      </div>
      <label className="champ">
        <span>Pathologie</span>
        <select value={p.pathologie ?? 'courant'} onChange={(e) => maj({ pathologie: e.target.value as Pathologie })}>
          {(Object.keys(PATHOLOGIES) as Pathologie[]).map((x) => <option key={x} value={x}>{PATHOLOGIES[x].libelle}</option>)}
        </select>
      </label>
      <p>
        <button className="primaire" onClick={() => void sauver()}>Enregistrer les paramètres</button>
        {ok && <span className="ok" role="status"> Enregistré.</span>}
      </p>
    </fieldset>
  );
}

function LigneSeance({ c, d }: { c: Creneau; d: Donnees }) {
  const m = montantCreneau(c, d.reglages.conventionne);
  const reste = resteCreneau(c, d.reglages.conventionne);
  const basculer = async () => {
    await enregistrer('creneaux', basculerPaiement(c));
    await d.recharger();
  };
  return (
    <li className={`suivi-seance ${c.statut ?? 'acompleter'}`}>
      <span>
        <strong>{formatDate(c.date)}</strong> {hhmm(c.debut)} – {hhmm(c.fin)}
        <small>
          {[
            c.mode === 'totalite' ? 'Totalité' : c.statut ? 'Tiers payant' : '',
            c.pathologie && c.pathologie !== 'courant' ? PATHOLOGIES[c.pathologie].court : '',
            c.bim ? 'BIM' : '',
            c.domicile ? 'Dom.' : '',
            m ? eur(m.patient + m.mutuelle) : '',
            reste && m && reste < m.patient + m.mutuelle ? `reste ${eur(reste)} (mutuelle)` : '',
          ].filter(Boolean).join(' · ')}
        </small>
      </span>
      {c.statut ? (
        <button className={`suivi-statut ${c.statut}`} onClick={() => void basculer()}
          aria-label={`${c.statut === 'paye' ? 'Payé' : 'À recevoir'} : passer à ${c.statut === 'paye' ? 'à recevoir' : 'payé'}`}>
          {c.statut === 'paye' ? '✓ Payé' : '! À recevoir'}
          <small>{c.statut === 'paye' ? 'marquer à recevoir' : 'marquer payé'}</small>
        </button>
      ) : (
        <small className="a-configurer">paiement à noter dans le Calendrier</small>
      )}
    </li>
  );
}

/** Fiche d'un patient, ouverte juste sous son nom dans la liste (visible sans défiler sur mobile). */
function Profil({ courant, d, fermer }: { courant: ProfilPatient; d: Donnees; fermer: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }, []);
  return (
    <section ref={ref} className="carte suivi-profil" aria-label={`Profil de ${courant.nom || SANS_NOM}`}>
      <div className="barre">
        <h2>{courant.nom || SANS_NOM}</h2>
        <button onClick={fermer}>Fermer</button>
      </div>
      <div className="totaux">
        <div><span>Total</span><strong>{eur(courant.total)}</strong></div>
        <div><span>Payé</span><strong>{eur(courant.paye)}</strong></div>
        <div><span>Reste à recevoir</span><strong className={courant.reste > 0 ? 'suivi-reste' : ''}>{eur(courant.reste)}</strong></div>
      </div>
      <h3>Séances</h3>
      <p className="aide">Clique sur Payé / À recevoir pour changer le statut d'une séance.</p>
      <ul className="liste suivi-liste">
        {courant.seances.map((c) => <LigneSeance key={c.id} c={c} d={d} />)}
      </ul>
      {courant.nom && <Parametres key={courant.nom} d={d} nom={courant.nom} />}
    </section>
  );
}

export default function SuiviPatients({ d }: { d: Donnees }) {
  const profils = useMemo(() => profilsPatients(d.creneaux, d.reglages.conventionne), [d.creneaux, d.reglages.conventionne]);
  const [sel, setSel] = useState<string | null>(null);
  const [filtre, setFiltre] = useState('');
  const visibles = profils.filter((p) => (p.nom || SANS_NOM).toLowerCase().includes(filtre.trim().toLowerCase()));
  const resteTotal = profils.reduce((s, p) => s + p.reste, 0);

  return (
    <>
      <section className="carte">
        <h2>Suivi des patients</h2>
        <p className="aide">
          Un profil par nom noté dans le Calendrier. Reste à recevoir en tout : <strong>{eur(resteTotal)}</strong>.
        </p>
        {profils.length === 0 ? (
          <p className="vide">Aucun patient dans l'agenda. Note le nom dans un créneau du Calendrier ou importe une capture Rosa.</p>
        ) : (
          <>
            {profils.length > 6 && (
              <input className="suivi-filtre" value={filtre} placeholder="Chercher un patient" aria-label="Chercher un patient"
                onChange={(e) => setFiltre(e.target.value)} />
            )}
            <ul className="liste-patients">
              {visibles.map((p) => (
                <li key={p.nom}>
                  <button className={p.nom === sel ? 'actif' : ''} onClick={() => setSel(p.nom === sel ? null : p.nom)}>
                    <span>{p.nom || SANS_NOM}</span>
                    <small>{p.seances.length} séance{p.seances.length > 1 ? 's' : ''} · total {eur(p.total)}</small>
                    {p.reste > 0 ? <small className="suivi-reste">reste {eur(p.reste)}</small> : <small className="suivi-ajour">rien à recevoir</small>}
                    {p.aCompleter > 0 && <small className="a-configurer">{p.aCompleter} paiement{p.aCompleter > 1 ? 's' : ''} à noter</small>}
                  </button>
                  {p.nom === sel && <Profil courant={p} d={d} fermer={() => setSel(null)} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

    </>
  );
}

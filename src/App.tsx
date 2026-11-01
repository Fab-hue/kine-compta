import { useCallback, useEffect, useRef, useState } from 'react';
import { ecrireReglages, lireReglages, REGLAGES_DEFAUT, surBlocage, tous, type Reglages } from './lib/db';
import type { Patient, Seance } from './lib/calcul';
import type { Dispatch, Ticket } from './lib/db';
import type { Mouvement } from './lib/banque';
import type { Creneau } from './lib/creneaux';
import { delaiProchainRappel, notifier, rappelDu } from './lib/rappel';
import type { Donnees } from './ui/common';
import Seances from './ui/Seances';
import Calendrier from './ui/Calendrier';
import Banque from './ui/Banque';
import Patients from './ui/Patients';
import Tickets from './ui/Tickets';
import Export from './ui/Export';
import ReglagesTab from './ui/Reglages';

const ONGLETS = [
  { id: 'calendrier', label: 'Calendrier' },
  { id: 'seances', label: 'Séances' },
  { id: 'banque', label: 'Banque' },
  { id: 'patients', label: 'Patients' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'export', label: 'Export Excel' },
  { id: 'reglages', label: 'Réglages' },
];

export default function App() {
  const [onglet, setOnglet] = useState('calendrier');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [seances, setSeances] = useState<Seance[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [dispatchs, setDispatchs] = useState<Dispatch[]>([]);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [creneaux, setCreneaux] = useState<Creneau[]>([]);
  const [reglages, setReglagesState] = useState<Reglages>(REGLAGES_DEFAUT);
  const [pret, setPret] = useState(false);
  const [erreur, setErreur] = useState('');

  const recharger = useCallback(async () => {
    try {
      const [p, s, t, di, mv, cr, r] = await Promise.all([
        tous('patients'), tous('seances'), tous('tickets'), tous('dispatchs'), tous('mouvements'), tous('creneaux'), lireReglages(),
      ]);
      setPatients(p);
      setSeances(s);
      setTickets(t);
      setDispatchs(di);
      setMouvements(mv);
      setCreneaux(cr);
      setReglagesState(r);
      setPret(true);
    } catch (e) {
      setErreur(`Impossible de lire les données locales : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  // chargement bloqué (ancienne version ouverte ailleurs) ou trop long : le dire au lieu de « Chargement… » sans fin
  const [bloque, setBloque] = useState(false);
  useEffect(() => {
    surBlocage(() => setBloque(true));
    const t = setTimeout(() => setBloque(true), 6000);
    return () => clearTimeout(t);
  }, []);

  const setReglages = (r: Reglages) => {
    setReglagesState(r);
    void ecrireReglages(r);
  };

  // rappel de 18h : réévalué à 18h pile et quand l'app revient au premier plan
  const [maintenant, setMaintenant] = useState(() => new Date());
  const creneauxRef = useRef(creneaux);
  creneauxRef.current = creneaux;
  useEffect(() => {
    if (!reglages.rappel) return;
    let t: ReturnType<typeof setTimeout>;
    const planifier = () => {
      t = setTimeout(() => {
        const n = new Date();
        setMaintenant(n);
        if (rappelDu(n, creneauxRef.current)) void notifier();
        planifier();
      }, delaiProchainRappel(new Date()) + 1000);
    };
    planifier();
    const vu = () => { if (document.visibilityState === 'visible') setMaintenant(new Date()); };
    document.addEventListener('visibilitychange', vu);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vu); };
  }, [reglages.rappel]);
  const rappel = pret && !!reglages.rappel && rappelDu(maintenant, creneaux);

  const d: Donnees = { patients, seances, tickets, dispatchs, mouvements, creneaux, reglages, recharger, setReglages, aller: setOnglet };

  return (
    <div className="app">
      <div className="bandeau">100 % local : aucune donnée patient n'est envoyée</div>
      <header className="entete">
        <h1>Kiné Compta</h1>
        <nav className="onglets" aria-label="Sections">
          {ONGLETS.map((o) => (
            <button key={o.id} className={o.id === onglet ? 'actif' : ''} onClick={() => setOnglet(o.id)}>
              {o.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {rappel && onglet !== 'calendrier' && (
          <p className="avertissement rappel">
            Il est plus de 18h et rien n'est noté aujourd'hui dans l'agenda.{' '}
            <button className="lien" onClick={() => setOnglet('calendrier')}>Remplir l'agenda</button>
          </p>
        )}
        {rappel && onglet === 'calendrier' && (
          <p className="avertissement rappel">Il est plus de 18h : note les séances du jour.</p>
        )}
        {erreur && <p className="erreur">{erreur}</p>}
        {!pret && !erreur && <p>Chargement…</p>}
        {!pret && !erreur && bloque && (
          <p className="erreur">
            L'app ne se charge pas : une ancienne version est sans doute encore ouverte. Ferme tous les onglets et
            l'app Kiné Compta (aussi dans les apps récentes du téléphone), puis rouvre-la.{' '}
            <button onClick={() => location.reload()}>Recharger</button>
          </p>
        )}
        {pret && onglet === 'seances' && <Seances d={d} />}
        {pret && onglet === 'calendrier' && <Calendrier d={d} />}
        {pret && onglet === 'banque' && <Banque d={d} />}
        {pret && onglet === 'patients' && <Patients d={d} />}
        {pret && onglet === 'tickets' && <Tickets d={d} />}
        {pret && onglet === 'export' && <Export d={d} />}
        {pret && onglet === 'reglages' && <ReglagesTab d={d} />}
      </main>
    </div>
  );
}

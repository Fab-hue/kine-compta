import { useCallback, useEffect, useState } from 'react';
import { ecrireReglages, lireReglages, REGLAGES_DEFAUT, tous, type Reglages } from './lib/db';
import type { Patient, Seance } from './lib/calcul';
import type { Dispatch, Ticket } from './lib/db';
import type { Mouvement } from './lib/banque';
import type { Creneau } from './lib/creneaux';
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

  const setReglages = (r: Reglages) => {
    setReglagesState(r);
    void ecrireReglages(r);
  };

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
        {erreur && <p className="erreur">{erreur}</p>}
        {!pret && !erreur && <p>Chargement…</p>}
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

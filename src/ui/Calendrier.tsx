import { useEffect, useMemo, useRef, useState } from 'react';
import { calculerSeances, toutRecu, type EtatPaiement, type Paiement, type Seance, type SeanceCalculee } from '../lib/calcul';
import { enregistrer } from '../lib/db';
import { paiementDe, partMutuelle, partPatient } from '../lib/suivi';
import { eur, formatDate, libelleMois, type Donnees } from './common';

const PX_PAR_CRENEAU = 30; // hauteur d'un créneau de 30 min
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const iso = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const depuisIso = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const ajouterJours = (s: string, n: number) => {
  const dt = depuisIso(s);
  dt.setDate(dt.getDate() + n);
  return iso(dt);
};
/** Lundi de la semaine contenant la date. */
const lundi = (s: string) => ajouterJours(s, -((depuisIso(s).getDay() + 6) % 7));
const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const jourLong = (s: string) => `${JOURS[(depuisIso(s).getDay() + 6) % 7]} ${formatDate(s)}`;

interface Bloc {
  s: Seance;
  debut: number;
  fin: number;
  voie: number;
  voies: number;
}

/** Répartit les séances qui se chevauchent côte à côte (voies). */
function placer(seances: Seance[]): Bloc[] {
  const tri: Bloc[] = seances
    .filter((s) => s.heure)
    .map((s) => ({ s, debut: minutes(s.heure!), fin: minutes(s.heure!) + Math.max(s.dureeMin, 15), voie: 0, voies: 1 }))
    .sort((a, b) => a.debut - b.debut);
  let groupe: Bloc[] = [];
  let finGroupe = -1;
  const clore = () => {
    const n = Math.max(1, ...groupe.map((b) => b.voie + 1));
    groupe.forEach((b) => (b.voies = n));
    groupe = [];
  };
  for (const b of tri) {
    if (groupe.length && b.debut >= finGroupe) clore();
    let v = 0;
    while (groupe.some((g) => g.voie === v && g.fin > b.debut)) v++;
    b.voie = v;
    groupe.push(b);
    finGroupe = Math.max(finGroupe, b.fin);
  }
  clore();
  return tri;
}

const classe = (e: EtatPaiement) => (e === 'recu' ? 'recu' : 'attente');
const marque = (e: EtatPaiement) => (e === 'recu' ? '✓' : '!');
const mot = (e: EtatPaiement) => (e === 'recu' ? 'reçu' : 'à percevoir');

const resumePaiement = (pa: Paiement) =>
  pa.mode === 'tm' ? `patient ${mot(pa.patient)}, mutuelle ${mot(pa.mutuelle)}` : `patient ${mot(pa.patient)}`;

/** Bloc cliquable d'une séance : deux moitiés P | M (ticket modérateur) ou un seul bloc (totalité). */
function BoutonSeance({ s, d, style, onOuvrir }: { s: Seance; d: Donnees; style?: React.CSSProperties; onOuvrir: (s: Seance) => void }) {
  const pa = paiementDe(s, d.patients.find((p) => p.id === s.patientId));
  return (
    <button
      className={`cal-bloc ${pa.mode === 'tm' ? 'tm' : classe(pa.patient)} ${toutRecu(pa) ? 'complet' : ''}`}
      style={style}
      onClick={() => onOuvrir(s)}
      title={`${s.patientId} ${s.heure ?? ''}`}
      aria-label={`${s.patientId}, ${formatDate(s.date)}${s.heure ? ` à ${s.heure}` : ''} : ${resumePaiement(pa)}. Ouvrir la séance.`}
    >
      <span className="cal-nom">{s.patientId}</span>
      <span className="cal-parties" aria-hidden="true">
        {pa.mode === 'tm' ? (
          <>
            <span className={`cal-part ${classe(pa.patient)}`}>P {marque(pa.patient)}</span>
            <span className={`cal-part ${classe(pa.mutuelle)}`}>M {marque(pa.mutuelle)}</span>
          </>
        ) : (
          <span className={`cal-part ${classe(pa.patient)}`}>{marque(pa.patient)}</span>
        )}
      </span>
    </button>
  );
}

function Fiche({ s, c, d, onFermer }: { s: Seance; c?: SeanceCalculee; d: Donnees; onFermer: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pa0 = paiementDe(s, d.patients.find((p) => p.id === s.patientId));
  const [mode, setMode] = useState(pa0.mode);
  const [patient, setPatient] = useState(pa0.patient);
  const [mutuelle, setMutuelle] = useState(pa0.mutuelle);
  // anciennes séances : n° seul (« 370 ») → id du dispatch s'il n'y en a qu'un avec ce n°
  const [dispatch, setDispatch] = useState(() => {
    const v = pa0.dispatch ?? '';
    const memes = d.dispatchs.filter((x) => x.numero === v);
    return !v.includes('|') && memes.length === 1 ? memes[0].id : v;
  });
  const dispatchs = [...d.dispatchs].sort((a, b) => b.numero.localeCompare(a.numero) || (a.mutuelle ?? '').localeCompare(b.mutuelle ?? ''));
  const montants = c && !c.erreur;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const sauver = async () => {
    const paiement: Paiement = {
      mode,
      patient,
      mutuelle: mode === 'tm' ? mutuelle : 'attente',
      ...(mode === 'tm' && dispatch ? { dispatch } : {}),
    };
    await enregistrer('seances', { ...s, paiement });
    await d.recharger();
    onFermer();
  };

  const choix = (nom: string, val: EtatPaiement, set: (v: EtatPaiement) => void) => (
    <div className="cases">
      <label><input type="radio" name={nom} checked={val === 'recu'} onChange={() => set('recu')} /> Reçu</label>
      <label><input type="radio" name={nom} checked={val === 'attente'} onChange={() => set('attente')} /> À percevoir</label>
    </div>
  );

  return (
    <dialog ref={ref} className="fiche" aria-labelledby="fiche-titre" onClose={onFermer}>
      <h2 id="fiche-titre">{s.patientId}</h2>
      <p>
        {jourLong(s.date)}{s.heure ? ` à ${s.heure}` : ' (sans heure)'} · {s.dureeMin} min
      </p>
      {montants ? (
        <p className="aide">
          Honoraires {eur(c.honoraires)} · ticket modérateur (patient) {eur(c.patient)} · mutuelle {eur(c.mutuelle)}
        </p>
      ) : (
        c?.erreur && <p className="aide">Montants indisponibles : {c.erreur}.</p>
      )}
      <fieldset>
        <legend>Mode de paiement</legend>
        <div className="cases">
          <label><input type="radio" name="mode" checked={mode === 'tm'} onChange={() => setMode('tm')} /> Ticket modérateur (patient + mutuelle)</label>
          <label><input type="radio" name="mode" checked={mode === 'totalite'} onChange={() => setMode('totalite')} /> Totalité payée par le patient</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>{mode === 'tm' ? 'Part patient (P)' : 'Paiement du patient'}{montants ? ` : ${eur(partPatient(c, mode))}` : ''}</legend>
        {choix('patient', patient, setPatient)}
      </fieldset>
      {mode === 'tm' && (
        <>
          <fieldset>
            <legend>Part mutuelle (M){montants ? ` : ${eur(partMutuelle(c, mode))}` : ''}</legend>
            {choix('mutuelle', mutuelle, setMutuelle)}
          </fieldset>
          <label className="champ"><span>Dispatch Kinéquick (facultatif)</span>
            <select value={dispatch} onChange={(e) => setDispatch(e.target.value)}>
              <option value="">(aucun)</option>
              {dispatch && !dispatchs.some((x) => x.id === dispatch) && <option value={dispatch}>{dispatch} (inconnu)</option>}
              {dispatchs.map((x) => (
                <option key={x.id} value={x.id}>{x.numero}{x.mutuelle ? ` · ${x.mutuelle}` : ''}{x.montant != null ? ` · ${eur(x.montant)}` : ''}</option>
              ))}
            </select>
          </label>
          {dispatchs.length === 0 && <p className="aide">Ajoute d'abord les numéros dans l'onglet Banque.</p>}
        </>
      )}
      <p>
        <button className="primaire" onClick={() => void sauver()}>Enregistrer</button>{' '}
        <button onClick={onFermer}>Annuler</button>
      </p>
    </dialog>
  );
}

export default function Calendrier({ d }: { d: Donnees }) {
  const [vue, setVue] = useState<'semaine' | 'jour'>(() => (window.matchMedia('(max-width: 699px)').matches ? 'jour' : 'semaine'));
  const [pivot, setPivot] = useState(() => iso(new Date()));
  const [ouverte, setOuverte] = useState<string | null>(null);

  const calc = useMemo(() => {
    const patients = new Map(d.patients.map((p) => [p.id, p]));
    return new Map(calculerSeances(d.seances, patients, d.reglages.conventionne).map((c) => [c.seance.id, c]));
  }, [d.seances, d.patients, d.reglages.conventionne]);

  const actives = useMemo(() => d.seances.filter((s) => !s.annulee), [d.seances]);

  const debutSemaine = lundi(pivot);
  const jours = vue === 'jour' ? [pivot] : Array.from({ length: 6 }, (_, i) => ajouterJours(debutSemaine, i));
  const parJour = new Map(jours.map((j) => [j, actives.filter((s) => s.date === j)]));
  const horaires = jours.flatMap((j) => parJour.get(j)!.filter((s) => s.heure));

  // plage horaire : de la première à la dernière heure des séances affichées (défaut 8h-19h)
  let h0 = 8, h1 = 19;
  if (horaires.length) {
    h0 = Math.floor(Math.min(...horaires.map((s) => minutes(s.heure!))) / 60);
    h1 = Math.min(24, Math.ceil(Math.max(...horaires.map((s) => minutes(s.heure!) + s.dureeMin)) / 60));
    if (h1 - h0 < 4) h1 = Math.min(24, h0 + 4);
  }
  const debutMin = h0 * 60;
  const hauteur = (h1 - h0) * 2 * PX_PAR_CRENEAU;
  const pxMin = PX_PAR_CRENEAU / 30;
  const sansHeure = jours.some((j) => parJour.get(j)!.some((s) => !s.heure));
  const aujourdhui = iso(new Date());

  const pas = vue === 'jour' ? 1 : 7;
  const titre = vue === 'jour' ? jourLong(pivot) : `Semaine du ${formatDate(debutSemaine)} au ${formatDate(ajouterJours(debutSemaine, 5))}`;

  // résumé du mois affiché
  const mois = pivot.slice(0, 7);
  const resume = { pat: 0, patMontant: 0, mut: 0, mutMontant: 0 };
  for (const s of actives) {
    if (!s.date.startsWith(mois)) continue;
    const pa = paiementDe(s, d.patients.find((p) => p.id === s.patientId));
    const c = calc.get(s.id);
    if (pa.patient === 'attente') { resume.pat++; resume.patMontant += partPatient(c, pa.mode); }
    if (pa.mode === 'tm' && pa.mutuelle === 'attente') { resume.mut++; resume.mutMontant += partMutuelle(c, pa.mode); }
  }

  const seanceOuverte = ouverte ? d.seances.find((s) => s.id === ouverte) : undefined;
  const colonnes = `3.2rem repeat(${jours.length}, minmax(${vue === 'jour' ? '0' : '7.5rem'}, 1fr))`;

  return (
    <div>
      <section className="carte">
        <h2>Résumé de {libelleMois(mois)}</h2>
        <div className="totaux">
          <div><span>Patients : à percevoir</span><strong>{eur(resume.patMontant)}</strong><span>{resume.pat} séance(s) au moins</span></div>
          <div><span>Mutuelles : à percevoir</span><strong>{eur(resume.mutMontant)}</strong><span>{resume.mut} séance(s) au moins</span></div>
        </div>
        <p className="aide">« Au moins » : les séances de patients non configurés comptent, mais sans montant.</p>
      </section>

      <section className="carte">
        <div className="barre">
          <h2>{titre}</h2>
          <div className="cal-nav">
            <button onClick={() => setPivot(ajouterJours(pivot, -pas))} aria-label={vue === 'jour' ? 'Jour précédent' : 'Semaine précédente'}>◀</button>
            <button onClick={() => setPivot(aujourdhui)}>Aujourd'hui</button>
            <button onClick={() => setPivot(ajouterJours(pivot, pas))} aria-label={vue === 'jour' ? 'Jour suivant' : 'Semaine suivante'}>▶</button>
            <button aria-pressed={vue === 'semaine'} className={vue === 'semaine' ? 'primaire' : ''} onClick={() => setVue('semaine')}>Semaine</button>
            <button aria-pressed={vue === 'jour'} className={vue === 'jour' ? 'primaire' : ''} onClick={() => setVue('jour')}>Jour</button>
          </div>
        </div>

        {d.seances.length === 0 && <p className="vide">Aucune séance : importe l'agenda Rosa dans l'onglet Séances.</p>}

        <div className="defile">
          <div className="cal" style={{ gridTemplateColumns: colonnes }}>
            <div />
            {jours.map((j) => (
              <div className={`cal-tete ${j === aujourdhui ? 'aujourdhui' : ''}`} key={j}>
                {vue === 'jour' ? jourLong(j) : `${JOURS[jours.indexOf(j)]} ${j.slice(8, 10)}/${j.slice(5, 7)}`}
              </div>
            ))}
            {sansHeure && (
              <>
                <div className="cal-heure">sans heure</div>
                {jours.map((j) => (
                  <div className="cal-sans" key={j}>
                    {parJour.get(j)!.filter((s) => !s.heure).map((s) => (
                      <BoutonSeance key={s.id} s={s} d={d} onOuvrir={(x) => setOuverte(x.id)} />
                    ))}
                  </div>
                ))}
              </>
            )}
            <div className="cal-heures" style={{ height: hauteur }} aria-hidden="true">
              {Array.from({ length: h1 - h0 }, (_, i) => (
                <span key={i} style={{ top: i * 2 * PX_PAR_CRENEAU }}>{h0 + i}h</span>
              ))}
            </div>
            {jours.map((j) => (
              <div className="cal-jour" key={j} style={{ height: hauteur, backgroundSize: `100% ${PX_PAR_CRENEAU * 2}px` }}>
                {placer(parJour.get(j)!).map((b) => (
                  <BoutonSeance
                    key={b.s.id}
                    s={b.s}
                    d={d}
                    onOuvrir={(x) => setOuverte(x.id)}
                    style={{
                      top: (b.debut - debutMin) * pxMin,
                      height: Math.max((b.fin - b.debut) * pxMin - 2, 28),
                      left: `${(b.voie / b.voies) * 100}%`,
                      width: `calc(${100 / b.voies}% - 2px)`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="cal-legende">
          <span><i className="cal-puce recu" /> vert ✓ = reçu</span>
          <span><i className="cal-puce attente" /> rouge ! = à percevoir</span>
          <span>P = patient (ticket modérateur) · M = mutuelle · bloc unique = totalité payée par le patient</span>
        </div>
        <p className="aide">Les séances annulées ne sont pas affichées.</p>
      </section>

      {seanceOuverte && (
        <Fiche key={seanceOuverte.id} s={seanceOuverte} c={calc.get(seanceOuverte.id)} d={d} onFermer={() => setOuverte(null)} />
      )}
    </div>
  );
}

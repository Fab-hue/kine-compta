import { useEffect, useMemo, useRef, useState } from 'react';
import { enregistrer, supprimer } from '../lib/db';
import {
  creneauxDuJour, DERNIER, estVide, fusionner, hhmm, lignesCreneau, memesParams, montantCreneau, paramsDepuis, PAS, PATHOLOGIES, PREMIER,
  resumeMois, separer, supplementsDe, type Creneau, type Mode, type ParamsPatient, type Pathologie, type Statut, type Supplement,
} from '../lib/creneaux';
import { eur, formatDate, libelleMois, type Donnees } from './common';
import ImportCapture from './ImportCapture';

const PX_PAR_CRENEAU = 48; // hauteur d'un créneau de 30 min : 2 lignes lisibles + zone tactile confortable
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
const jourLong = (s: string) => `${JOURS[(depuisIso(s).getDay() + 6) % 7]} ${formatDate(s)}`;

const plage = (c: Creneau) => `${hhmm(c.debut)} – ${hhmm(c.fin)}`;
const STATUT_MOT: Record<Statut, string> = { paye: 'Payé', arecevoir: 'À recevoir' };

/** Détails courts d'un créneau : « TP · BIM · FA · Dom. · Rapp. ». */
const details = (c: Creneau) =>
  [
    c.mode === 'totalite' ? 'Tot.' : 'TP',
    c.bim ? 'BIM' : '',
    c.pathologie && c.pathologie !== 'courant' ? PATHOLOGIES[c.pathologie].court : '',
    c.domicile ? 'Dom.' : '',
    ...supplementsDe(c.pathologie).filter((s) => c.supplements?.includes(s.id)).map((s) => s.court),
    c.patientPaye && c.statut === 'arecevoir' && c.mode !== 'totalite' ? 'P. payé' : '',
  ].filter(Boolean).join(' · ');

/** Enregistre le créneau, ou l'efface s'il est redevenu un créneau vide de 30 min. */
async function sauverCreneau(c: Creneau) {
  if (estVide(c)) await supprimer('creneaux', c.id);
  else await enregistrer('creneaux', c);
}

function BlocCreneau({ c, style, onOuvrir }: { c: Creneau; style: React.CSSProperties; onOuvrir: () => void }) {
  const fusionne = c.fin - c.debut > PAS;
  return (
    <button
      className={`cr-bloc ${c.statut ?? ''}`}
      style={style}
      onClick={onOuvrir}
      aria-label={`${formatDate(c.date)} ${plage(c)}${c.patient ? ` ${c.patient}` : ''}${c.statut ? ` : ${STATUT_MOT[c.statut]}, ${details(c)}` : ' : libre'}${c.commentaire ? `, ${c.commentaire}` : ''}`}
    >
      <span className="cr-ligne">
        <span className="cr-heure">{fusionne ? plage(c) : hhmm(c.debut)}</span>
        {c.statut && <span className="cr-etat">{c.statut === 'paye' ? '✓' : '!'} {details(c)}</span>}
      </span>
      {(c.patient || c.commentaire) && (
        <span className="cr-note">
          {c.patient && <span className="cr-patient">{c.patient}</span>}
          {c.patient && c.commentaire ? ' · ' : ''}
          {c.commentaire}
        </span>
      )}
    </button>
  );
}

function Fiche({ c, jour, d, onOuvrir, onFermer }: {
  c: Creneau;
  jour: Creneau[];
  d: Donnees;
  onOuvrir: (id: string) => void;
  onFermer: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const profilDe = (nom: string) => d.profils.find((p) => p.nom === nom.trim());
  // séance pas encore notée : on part des paramètres habituels du patient ; séance notée : ses propres valeurs
  const profilDepart = !c.statut && c.patient ? profilDe(c.patient) : undefined;
  const depart: Partial<ParamsPatient> = profilDepart ?? c;
  const [patient, setPatient] = useState(c.patient ?? '');
  const [statut, setStatut] = useState<Statut | ''>(c.statut ?? '');
  const [mode, setMode] = useState<Mode>(depart.mode ?? 'tiers');
  const [pathologie, setPathologie] = useState<Pathologie>(depart.pathologie ?? 'courant');
  const [bim, setBim] = useState(!!depart.bim);
  const [domicile, setDomicile] = useState(!!depart.domicile);
  const [repris, setRepris] = useState(!!profilDepart);
  const [supplements, setSupplements] = useState<Supplement[]>(c.supplements ?? []);
  const [patientPaye, setPatientPaye] = useState(!!c.patientPaye);
  const [commentaire, setCommentaire] = useState(c.commentaire ?? '');
  const [confirmer, setConfirmer] = useState(false);
  const i = jour.findIndex((x) => x.id === c.id);

  /** Noms déjà connus (agenda + paramètres) pour l'autocomplétion. */
  const noms = useMemo(
    () => [...new Set([...d.creneaux.map((x) => x.patient?.trim() ?? ''), ...d.profils.map((p) => p.nom)].filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'fr')),
    [d.creneaux, d.profils],
  );

  /** Nom choisi sur une séance pas encore notée : reprendre ses paramètres habituels. */
  const changerPatient = (nom: string) => {
    setPatient(nom);
    const p = !c.statut ? profilDe(nom) : undefined;
    if (p) {
      setMode(p.mode ?? 'tiers');
      setPathologie(p.pathologie ?? 'courant');
      setBim(!!p.bim);
      setDomicile(!!p.domicile);
    }
    setRepris(!!p);
  };

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /** Créneau avec les valeurs du formulaire. */
  const courant = (): Creneau => {
    const x: Creneau = { id: c.id, date: c.date, debut: c.debut, fin: c.fin };
    if (statut) {
      Object.assign(x, { statut, mode });
      if (pathologie !== 'courant') x.pathologie = pathologie;
      if (bim) x.bim = true;
      if (domicile) x.domicile = true;
      const possibles = supplementsDe(pathologie).map((s) => s.id);
      const sup = supplements.filter((s) => possibles.includes(s));
      if (sup.length) x.supplements = sup;
      if (statut === 'arecevoir' && mode === 'tiers' && patientPaye) x.patientPaye = true;
    }
    if (patient.trim()) x.patient = patient.trim();
    if (commentaire.trim()) x.commentaire = commentaire.trim();
    return x;
  };

  /**
   * Retient les paramètres du patient pour ses prochaines séances, si cette séance est sa plus récente
   * (corriger une vieille séance ne change pas le profil). Les séances déjà notées gardent leurs valeurs.
   */
  const memoriser = async (x: Creneau) => {
    const nom = x.patient;
    if (!nom || !x.statut) return;
    const plusRecente = d.creneaux.some((y) => y.id !== x.id && y.patient?.trim() === nom && y.statut
      && (y.date > x.date || (y.date === x.date && y.debut > x.debut)));
    if (plusRecente) return;
    const p = paramsDepuis(nom, x);
    if (!memesParams(profilDe(nom), p)) await enregistrer('profils', p);
  };

  const sauver = async () => {
    const x = courant();
    await sauverCreneau(x);
    await memoriser(x);
    await d.recharger();
    onFermer();
  };

  const fusion = async (sens: -1 | 1) => {
    const j = [...jour];
    j[i] = courant();
    const r = fusionner(j, i, sens);
    if (!r) return;
    await supprimer('creneaux', r.supprime);
    await sauverCreneau(r.fusion);
    await d.recharger();
    onOuvrir(r.fusion.id);
  };

  /** Efface tout : le créneau (même fusionné) redevient des créneaux libres de 30 min. */
  const effacer = async () => {
    await supprimer('creneaux', c.id);
    await d.recharger();
    onFermer();
  };

  const montant = montantCreneau(courant(), d.reglages.conventionne);
  const lignes = lignesCreneau(courant(), d.reglages.conventionne);
  const basculer = (s: Supplement, oui: boolean) =>
    setSupplements((l) => (oui ? [...l.filter((x) => x !== s), s] : l.filter((x) => x !== s)));

  const separation = async () => {
    await sauverCreneau(separer(courant()));
    await d.recharger();
    onOuvrir(c.id);
  };

  return (
    <dialog ref={ref} className="fiche" aria-labelledby="fiche-titre" onClose={onFermer}>
      <h2 id="fiche-titre">{plage(c)}</h2>
      <p className="cr-jour">{jourLong(c.date)}</p>

      <div className="cr-fusion">
        <button onClick={() => void fusion(-1)} disabled={i <= 0}>↑ Fusionner avec le précédent</button>
        <button onClick={() => void fusion(1)} disabled={i < 0 || i >= jour.length - 1}>↓ Fusionner avec le suivant</button>
        {c.fin - c.debut > PAS && <button onClick={() => void separation()}>Séparer en 30 min</button>}
      </div>

      <label className="champ">
        <span>Patient</span>
        <input value={patient} maxLength={120} list="noms-patients" autoComplete="off"
          onChange={(e) => changerPatient(e.target.value)} placeholder="NOM Prénom" />
        <datalist id="noms-patients">{noms.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      {repris && (
        <p className="aide">
          Paramètres habituels de {patient.trim()} repris{statut ? '' : ' : choisis Payé ou À recevoir'}.
          S'ils changent, modifie-les ici : ses prochaines séances prendront les nouveaux.
        </p>
      )}

      <fieldset>
        <legend>Paiement</legend>
        <div className="cases">
          <label><input type="radio" name="statut" checked={statut === ''} onChange={() => setStatut('')} /> Libre</label>
          <label className="cr-choix paye"><input type="radio" name="statut" checked={statut === 'paye'} onChange={() => setStatut('paye')} /> Payé</label>
          <label className="cr-choix arecevoir"><input type="radio" name="statut" checked={statut === 'arecevoir'} onChange={() => setStatut('arecevoir')} /> À recevoir</label>
        </div>
        {statut && (
          <>
            <div className="cases">
              <label><input type="radio" name="mode" checked={mode === 'tiers'} onChange={() => setMode('tiers')} /> Tiers payant</label>
              <label><input type="radio" name="mode" checked={mode === 'totalite'} onChange={() => setMode('totalite')} /> Totalité</label>
            </div>
            <div className="cases">
              <label><input type="checkbox" checked={bim} onChange={(e) => setBim(e.target.checked)} /> Patient BIM / VIPO</label>
              <label><input type="checkbox" checked={domicile} onChange={(e) => setDomicile(e.target.checked)} /> À domicile</label>
            </div>
            {statut === 'arecevoir' && mode === 'tiers' && (
              <div className="cases">
                <label><input type="checkbox" checked={patientPaye} onChange={(e) => setPatientPaye(e.target.checked)} /> Le patient a déjà payé sa part</label>
              </div>
            )}
          </>
        )}
      </fieldset>

      {statut && (
        <fieldset>
          <legend>Pathologie</legend>
          <div className="cases">
            {(Object.keys(PATHOLOGIES) as Pathologie[]).map((p) => (
              <label key={p}>
                <input type="radio" name="pathologie" checked={pathologie === p} onChange={() => setPathologie(p)} /> {PATHOLOGIES[p].libelle}
              </label>
            ))}
          </div>
          {supplementsDe(pathologie).length > 0 && (
            <div className="cases">
              {supplementsDe(pathologie).map((s) => (
                <label key={s.id}>
                  <input type="checkbox" checked={supplements.includes(s.id)} onChange={(e) => basculer(s.id, e.target.checked)} /> {s.libelle}
                </label>
              ))}
            </div>
          )}
          {montant && (
            <div className="cr-montant">
              {lignes.map((l) => (
                <div key={l.code}>
                  {l.libelle} · code {l.code} · honoraires {eur(l.montants.honoraires)}
                  {mode === 'tiers' && <> (patient {eur(l.montants.patient)}, mutuelle {eur(l.montants.mutuelle)})</>}
                </div>
              ))}
              {mode === 'tiers' ? (
                <div>
                  <strong>Patient : {eur(montant.patient)}</strong> · <strong>Mutuelle : {eur(montant.mutuelle)}</strong>
                </div>
              ) : (
                <div>
                  <strong>Patient : {eur(montant.patient)}</strong>
                  <br />
                  <span className="aide">La mutuelle lui rembourse {eur(montant.intervention)} ({bim ? 'BIM' : 'non BIM'}).</span>
                </div>
              )}
            </div>
          )}
        </fieldset>
      )}

      <label className="champ">
        <span>Commentaire</span>
        <input value={commentaire} maxLength={60} onChange={(e) => setCommentaire(e.target.value)} placeholder="ex. 2e séance" />
      </label>
      <p className="aide">Tout reste sur cet appareil : rien n'est envoyé sur internet.</p>

      <p>
        <button className="primaire" onClick={() => void sauver()}>Enregistrer</button>{' '}
        <button onClick={onFermer}>Annuler</button>
      </p>
      {!estVide(c) && (
        <p className="cr-effacer">
          {confirmer ? (
            <>
              Tout effacer pour {plage(c)} ?{' '}
              <button className="danger" onClick={() => void effacer()}>Oui, effacer</button>{' '}
              <button onClick={() => setConfirmer(false)}>Non</button>
            </>
          ) : (
            <button className="danger" onClick={() => setConfirmer(true)}>Effacer ce créneau</button>
          )}
        </p>
      )}
    </dialog>
  );
}

/** Total gagné sur la journée : payé + à recevoir, et nombre de séances (les créneaux libres ne comptent pas). */
function TotalJour({ r }: { r: ReturnType<typeof resumeMois> }) {
  const paye = Math.round((r.paye.patient + r.paye.mutuelle) * 100) / 100;
  const attente = Math.round((r.arecevoir.patient + r.arecevoir.mutuelle) * 100) / 100;
  const n = r.paye.nombre + r.arecevoir.nombre;
  if (!n) return null;
  return (
    <span className="cal-total">
      <strong>{eur(paye + attente)} · {n} séance{n > 1 ? 's' : ''}</strong>
      <small>✓ {eur(paye)} · ! {eur(attente)}</small>
    </span>
  );
}

export default function Calendrier({ d }: { d: Donnees }) {
  const [vue, setVue] = useState<'semaine' | 'jour'>(() => (window.matchMedia('(max-width: 699px)').matches ? 'jour' : 'semaine'));
  const [pivot, setPivot] = useState(() => {
    // jour choisi par un import fait depuis l'onglet Séances
    const j = sessionStorage.getItem('kc-jour');
    sessionStorage.removeItem('kc-jour');
    return j ?? iso(new Date());
  });
  const [ouvert, setOuvert] = useState<string | null>(null);

  const debutSemaine = lundi(pivot);
  const jours = vue === 'jour' ? [pivot] : Array.from({ length: 5 }, (_, i) => ajouterJours(debutSemaine, i));
  const aujourdhui = iso(new Date());
  const pas = vue === 'jour' ? 1 : 7;
  const titre = vue === 'jour' ? jourLong(pivot) : `Semaine du ${formatDate(debutSemaine)} au ${formatDate(ajouterJours(debutSemaine, 4))}`;

  const nbCreneaux = (DERNIER - PREMIER) / PAS + 1;
  const hauteur = nbCreneaux * PX_PAR_CRENEAU;
  const pxMin = PX_PAR_CRENEAU / PAS;

  const mois = pivot.slice(0, 7);
  const resume = resumeMois(d.creneaux, mois, d.reglages.conventionne);

  const creneauOuvert = ouvert ? d.creneaux.find((c) => c.id === ouvert) ?? creneauxDuJour(ouvert.slice(0, 10), d.creneaux).find((c) => c.id === ouvert) : undefined;
  const jourOuvert = creneauOuvert ? creneauxDuJour(creneauOuvert.date, d.creneaux) : [];
  const colonnes = `3.2rem repeat(${jours.length}, minmax(${vue === 'jour' ? '0' : '7.5rem'}, 1fr))`;

  return (
    <div>
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

        <div className="defile">
          <div className="cal" style={{ gridTemplateColumns: colonnes }}>
            <div />
            {jours.map((j) => (
              <div className={`cal-tete ${j === aujourdhui ? 'aujourdhui' : ''}`} key={j}>
                {vue === 'jour' ? jourLong(j) : `${JOURS[(depuisIso(j).getDay() + 6) % 7]} ${j.slice(8, 10)}/${j.slice(5, 7)}`}
                <TotalJour r={resumeMois(d.creneaux, j, d.reglages.conventionne)} />
              </div>
            ))}
            <div className="cal-heures" style={{ height: hauteur }} aria-hidden="true">
              {Array.from({ length: nbCreneaux }, (_, i) => (
                <span key={i} style={{ top: i * PX_PAR_CRENEAU + PX_PAR_CRENEAU / 2 }}>{hhmm(PREMIER + i * PAS)}</span>
              ))}
            </div>
            {jours.map((j) => (
              <div className="cal-jour cr-jour-col" key={j} style={{ height: hauteur }}>
                {creneauxDuJour(j, d.creneaux).map((c) => (
                  <BlocCreneau
                    key={c.id}
                    c={c}
                    onOuvrir={() => setOuvert(c.id)}
                    style={{ top: (c.debut - PREMIER) * pxMin + 2, height: (c.fin - c.debut) * pxMin - 4 }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="cal-legende">
          <span><i className="cal-puce recu" /> vert = payé</span>
          <span><i className="cal-puce attente" /> rouge = à recevoir</span>
          <span>✓ payé · ! à recevoir · TP = tiers payant · Tot. = totalité · Dom. = à domicile · Rapp. = rapport · Prest. = prestation liste E</span>
        </div>
        <p className="aide">Clique sur un créneau pour noter le patient et le paiement, ou le fusionner avec le précédent / le suivant.</p>
        <ImportCapture d={d} jourAffiche={pivot} onDate={(j) => { setPivot(j); setVue('jour'); }} />
      </section>

      <section className="carte">
        <h2>Résumé de {libelleMois(mois)}</h2>
        <div className="totaux">
          <div>
            <span>Payé · {resume.paye.nombre} séance{resume.paye.nombre > 1 ? 's' : ''}</span>
            <strong>{eur(resume.paye.patient + resume.paye.mutuelle)}</strong>
            <span>patients {eur(resume.paye.patient)} · mutuelles {eur(resume.paye.mutuelle)}</span>
            <span>{resume.paye.tiers} tiers payant · {resume.paye.totalite} totalité</span>
          </div>
          <div>
            <span>À recevoir · {resume.arecevoir.nombre} séance{resume.arecevoir.nombre > 1 ? 's' : ''}</span>
            <strong>{eur(resume.arecevoir.patient + resume.arecevoir.mutuelle)}</strong>
            <span>patients {eur(resume.arecevoir.patient)} · mutuelles {eur(resume.arecevoir.mutuelle)}</span>
            <span>{resume.arecevoir.tiers} tiers payant · {resume.arecevoir.totalite} totalité</span>
          </div>
        </div>
        <p className="aide">
          Les séances à recevoir sont suivies par patient dans l'onglet{' '}
          <button className="lien" onClick={() => d.aller('patients')}>Patients</button>.
        </p>
      </section>

      {creneauOuvert && (
        <Fiche
          key={`${creneauOuvert.id}-${creneauOuvert.fin}`}
          c={creneauOuvert}
          jour={jourOuvert}
          d={d}
          onOuvrir={setOuvert}
          onFermer={() => setOuvert(null)}
        />
      )}
    </div>
  );
}

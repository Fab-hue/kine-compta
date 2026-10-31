import { useEffect, useMemo, useRef, useState } from 'react';
import { enregistrer, supprimer } from '../lib/db';
import {
  codeCreneau, creneauxDuJour, DERNIER, estVide, fusionner, hhmm, montantCreneau, PAS, PATHOLOGIES, PREMIER, resumeMois, separer,
  type Creneau, type Mode, type Pathologie, type Statut,
} from '../lib/creneaux';
import { eur, formatDate, libelleMois, type Donnees } from './common';

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
const MODE_COURT: Record<Mode, string> = { totalite: 'Totalité', tiers: 'Tiers payant' };
const STATUT_MOT: Record<Statut, string> = { paye: 'Payé', arecevoir: 'À recevoir' };

/** Détails courts d'un créneau : « TP · BIM · FA · Dom. ». */
const details = (c: Creneau, avecMode = true) =>
  [
    avecMode ? (c.mode === 'totalite' ? 'Tot.' : 'TP') : '',
    c.mode !== 'totalite' && c.bim ? 'BIM' : '',
    c.pathologie && c.pathologie !== 'courant' ? PATHOLOGIES[c.pathologie].court : '',
    c.domicile ? 'Dom.' : '',
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
      aria-label={`${formatDate(c.date)} ${plage(c)}${c.statut ? ` : ${STATUT_MOT[c.statut]}, ${details(c)}` : ' : libre'}${c.commentaire ? `, ${c.commentaire}` : ''}`}
    >
      <span className="cr-ligne">
        <span className="cr-heure">{fusionne ? plage(c) : hhmm(c.debut)}</span>
        {c.statut && <span className="cr-etat">{c.statut === 'paye' ? '✓' : '!'} {details(c)}</span>}
      </span>
      {c.commentaire && <span className="cr-note">{c.commentaire}</span>}
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
  const [statut, setStatut] = useState<Statut | ''>(c.statut ?? '');
  const [mode, setMode] = useState<Mode>(c.mode ?? 'tiers');
  const [pathologie, setPathologie] = useState<Pathologie>(c.pathologie ?? 'courant');
  const [bim, setBim] = useState(!!c.bim);
  const [domicile, setDomicile] = useState(!!c.domicile);
  const [commentaire, setCommentaire] = useState(c.commentaire ?? '');
  const [confirmer, setConfirmer] = useState(false);
  const i = jour.findIndex((x) => x.id === c.id);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /** Créneau avec les valeurs du formulaire. */
  const courant = (): Creneau => {
    const x: Creneau = { id: c.id, date: c.date, debut: c.debut, fin: c.fin };
    if (statut) {
      Object.assign(x, { statut, mode });
      if (pathologie !== 'courant') x.pathologie = pathologie;
      if (mode === 'tiers' && bim) x.bim = true;
      if (domicile) x.domicile = true;
    }
    if (commentaire.trim()) x.commentaire = commentaire.trim();
    return x;
  };

  const sauver = async () => {
    await sauverCreneau(courant());
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
              {mode === 'tiers' && (
                <label><input type="checkbox" checked={bim} onChange={(e) => setBim(e.target.checked)} /> Patient BIM / VIPO</label>
              )}
              <label><input type="checkbox" checked={domicile} onChange={(e) => setDomicile(e.target.checked)} /> À domicile</label>
            </div>
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
          {montant && (
            <p className="cr-montant">
              Code {codeCreneau({ pathologie, domicile })} · honoraires {eur(montant.honoraires)}
              <br />
              <strong>Patient : {eur(montant.patient)}</strong>
              {mode === 'tiers' && <> · <strong>Mutuelle : {eur(montant.mutuelle)}</strong></>}
            </p>
          )}
        </fieldset>
      )}

      <label className="champ">
        <span>Commentaire</span>
        <input value={commentaire} maxLength={60} onChange={(e) => setCommentaire(e.target.value)} placeholder="ex. J.D., 2e séance" />
      </label>
      <p className="aide">Initiales seulement, jamais de nom complet (RGPD).</p>

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

const montantTexte = (c: Creneau, d: Donnees) => {
  const m = montantCreneau(c, d.reglages.conventionne);
  return m ? eur(m.patient + m.mutuelle) : '';
};

export default function Calendrier({ d }: { d: Donnees }) {
  const [vue, setVue] = useState<'semaine' | 'jour'>(() => (window.matchMedia('(max-width: 699px)').matches ? 'jour' : 'semaine'));
  const [pivot, setPivot] = useState(() => iso(new Date()));
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
  const aRecevoir = useMemo(
    () => d.creneaux.filter((c) => c.statut === 'arecevoir').sort((a, b) => a.date.localeCompare(b.date) || a.debut - b.debut),
    [d.creneaux],
  );

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
          <span>✓ payé · ! à recevoir · TP = tiers payant · Tot. = totalité · Dom. = à domicile</span>
        </div>
        <p className="aide">Clique sur un créneau pour noter le paiement ou le fusionner avec le précédent / le suivant.</p>
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
        <h3>Tout ce qui reste à recevoir</h3>
        {aRecevoir.length === 0 ? (
          <p className="vide">Rien à recevoir.</p>
        ) : (
          <ul className="liste">
            {aRecevoir.map((c) => (
              <li key={c.id}>
                <button className="lien" onClick={() => setOuvert(c.id)}>
                  {jourLong(c.date)} · {plage(c)}
                </button>{' '}
                · {[MODE_COURT[c.mode ?? 'tiers'], details(c, false), montantTexte(c, d), c.commentaire].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        )}
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

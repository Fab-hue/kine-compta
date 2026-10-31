import { useEffect, useMemo, useRef, useState } from 'react';
import { enregistrer, supprimer } from '../lib/db';
import {
  creneauxDuJour, DERNIER, estVide, fusionner, hhmm, PAS, PREMIER, resumeMois, separer,
  type Creneau, type Mode, type Statut,
} from '../lib/creneaux';
import { formatDate, libelleMois, type Donnees } from './common';

const PX_PAR_CRENEAU = 40; // hauteur d'un créneau de 30 min (zone tactile confortable)
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
      aria-label={`${formatDate(c.date)} ${plage(c)}${c.statut ? ` : ${STATUT_MOT[c.statut]}, ${MODE_COURT[c.mode ?? 'tiers']}` : ' : libre'}${c.commentaire ? `, ${c.commentaire}` : ''}`}
    >
      <span className="cr-heure">{fusionne ? plage(c) : hhmm(c.debut)}</span>
      {c.statut && (
        <span className="cr-etat">
          {c.statut === 'paye' ? '✓' : '!'} {STATUT_MOT[c.statut]} · {c.mode === 'totalite' ? 'Tot.' : 'TP'}
        </span>
      )}
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
  const [commentaire, setCommentaire] = useState(c.commentaire ?? '');
  const i = jour.findIndex((x) => x.id === c.id);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  /** Créneau avec les valeurs du formulaire. */
  const courant = (): Creneau => {
    const x: Creneau = { id: c.id, date: c.date, debut: c.debut, fin: c.fin };
    if (statut) Object.assign(x, { statut, mode });
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
          <div className="cases">
            <label><input type="radio" name="mode" checked={mode === 'tiers'} onChange={() => setMode('tiers')} /> Tiers payant</label>
            <label><input type="radio" name="mode" checked={mode === 'totalite'} onChange={() => setMode('totalite')} /> Totalité</label>
          </div>
        )}
      </fieldset>

      <label className="champ">
        <span>Commentaire</span>
        <input value={commentaire} maxLength={60} onChange={(e) => setCommentaire(e.target.value)} placeholder="ex. J.D., 2e séance" />
      </label>
      <p className="aide">Initiales seulement, jamais de nom complet (RGPD).</p>

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
  const resume = resumeMois(d.creneaux, mois);
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
          <span>TP = tiers payant · Tot. = totalité</span>
        </div>
        <p className="aide">Clique sur un créneau pour noter le paiement ou le fusionner avec le précédent / le suivant.</p>
      </section>

      <section className="carte">
        <h2>Résumé de {libelleMois(mois)}</h2>
        <div className="totaux">
          <div><span>Payé</span><strong>{resume.paye.tiers + resume.paye.totalite}</strong><span>{resume.paye.tiers} tiers payant · {resume.paye.totalite} totalité</span></div>
          <div><span>À recevoir</span><strong>{resume.arecevoir.tiers + resume.arecevoir.totalite}</strong><span>{resume.arecevoir.tiers} tiers payant · {resume.arecevoir.totalite} totalité</span></div>
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
                · {MODE_COURT[c.mode ?? 'tiers']}{c.commentaire ? ` · ${c.commentaire}` : ''}
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
